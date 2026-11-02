import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { appendFile, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";

import { DesktopDemo, sleep } from "./demo-helpers.mjs";

const execFileAsync = promisify(execFile);

// Inputs describing the app under test. They are read from the environment so
// the skill works wherever it is installed and against any Electron app.
//   DEMO_APP_DIR       required. Directory the launch command runs in.
//   DEMO_WINDOW_TITLE  required. Exact title of the app's main window.
//   DEMO_LAUNCH_CMD    shell command that starts the app with remote debugging
//                      on {port}. Defaults to an electron-vite dev server.
const DEFAULT_LAUNCH_CMD = "pnpm dev --remoteDebuggingPort {port} --noSandbox";

function readInputs() {
  const appDir = process.env.DEMO_APP_DIR?.trim();
  const windowTitle = process.env.DEMO_WINDOW_TITLE?.trim();
  const launchCmd = process.env.DEMO_LAUNCH_CMD?.trim() || DEFAULT_LAUNCH_CMD;
  if (!appDir) throw new Error("DEMO_APP_DIR is required: the directory to launch the app from");
  if (!windowTitle) throw new Error("DEMO_WINDOW_TITLE is required: the main window's exact title");
  // Without the placeholder the app would start with no debugging port and the
  // runner would wait the full CDP timeout before failing.
  if (!launchCmd.includes("{port}")) {
    throw new Error("DEMO_LAUNCH_CMD must contain {port} for the remote debugging port");
  }
  // Checked up front because a bad cwd makes spawn fail after Xvfb and the
  // capture have started, which is harder to read than a plain input error.
  if (!existsSync(resolve(appDir))) throw new Error(`DEMO_APP_DIR does not exist: ${appDir}`);
  return { appDir: resolve(appDir), windowTitle, launchCmd };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function outputName(demoPath) {
  const summary = basename(demoPath)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-");
  return `/tmp/${timestamp()}-${summary}.mp4`;
}

async function portIsFree(port) {
  return new Promise((resolvePromise) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolvePromise(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function acquireSlot() {
  for (let number = 99; number <= 130; number += 1) {
    const lockDir = `/tmp/desktop-demo-slot-${number}`;
    const port = 19_000 + number;
    try {
      await mkdir(lockDir);
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw error;
    }
    const displayTaken = await readFile(`/tmp/.X${number}-lock`, "utf8").then(
      () => true,
      () => false,
    );
    if (displayTaken || !(await portIsFree(port))) {
      await rm(lockDir, { recursive: true });
      continue;
    }
    await writeFile(
      `${lockDir}/owner.json`,
      `${JSON.stringify({ pid: process.pid, display: `:${number}`, port, createdAt: new Date().toISOString() }, null, 2)}\n`,
    );
    return { number, display: `:${number}`, port, lockDir };
  }
  throw new Error("No free desktop demo slot between displays :99 and :130");
}

function spawnOwned(command, args, { cwd = process.cwd(), env = process.env, logPath }) {
  const logFd = openSync(logPath, "a");
  const proc = spawn(command, args, {
    cwd,
    detached: true,
    env,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  proc.unref();
  return { pid: proc.pid };
}

async function waitUntil(check, description, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let lastError;
  while (performance.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(
    `${description} did not become ready within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ""}`,
  );
}

async function stopGroup(pid, signal = "SIGTERM") {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitForExit(pid, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      process.kill(pid, 0);
      await sleep(100);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
  }
  return false;
}

async function findMainWindow(display, windowTitle) {
  const { stdout } = await execFileAsync(
    "xdotool",
    ["search", "--onlyvisible", "--name", `^${escapeRegex(windowTitle)}$`],
    { env: { ...process.env, DISPLAY: display } },
  );
  const ids = stdout.trim().split("\n").filter(Boolean);
  let largest = null;
  for (const id of ids) {
    const geometry = await execFileAsync("xdotool", ["getwindowgeometry", "--shell", id], {
      env: { ...process.env, DISPLAY: display },
    });
    const values = Object.fromEntries(
      geometry.stdout
        .trim()
        .split("\n")
        .map((line) => line.split("=", 2)),
    );
    const area = Number(values.WIDTH) * Number(values.HEIGHT);
    if (!largest || area > largest.area) largest = { id, area };
  }
  return largest?.id ?? null;
}

async function startRecorder(display, takePath, logPath) {
  const logHandle = await open(logPath, "a");
  const proc = spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "x11grab",
      "-framerate",
      "30",
      "-video_size",
      "1920x1080",
      "-i",
      display,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      takePath,
    ],
    {
      detached: true,
      env: { ...process.env, DISPLAY: display },
      stdio: ["ignore", logHandle.fd, logHandle.fd],
    },
  );
  return { proc, logHandle };
}

async function stopRecorder(recorder) {
  if (!recorder) return;
  const done = new Promise((resolvePromise) => recorder.proc.once("close", resolvePromise));
  try {
    process.kill(recorder.proc.pid, "SIGINT");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await Promise.race([done, sleep(10_000)]);
  await recorder.logHandle.close();
}

async function runFfmpeg(args, logPath) {
  const logHandle = await open(logPath, "a");
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", logHandle.fd, logHandle.fd] });
  const result = await new Promise((resolvePromise, rejectPromise) => {
    proc.once("error", rejectPromise);
    proc.once("close", (code) => resolvePromise(code));
  });
  await logHandle.close();
  if (result !== 0) throw new Error(`ffmpeg exited with code ${result}; see ${logPath}`);
}

async function trimAndVerify({ markersPath, outputPath, runDir, takePath }) {
  const markers = (await readFile(markersPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const appVisible = markers.find((marker) => marker.name === "app_visible");
  const completed = [...markers].reverse().find((marker) => marker.name === "demo_complete");
  if (!appVisible || !completed) throw new Error("Missing app_visible or demo_complete marker");
  const start = Math.max(0, appVisible.elapsedSeconds - 1.5);
  const end = completed.elapsedSeconds + 3;
  const duration = end - start;
  await mkdir(dirname(outputPath), { recursive: true });
  await runFfmpeg(
    [
      "-y",
      "-ss",
      start.toFixed(3),
      "-t",
      duration.toFixed(3),
      "-i",
      takePath,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    `${runDir}/trim.log`,
  );
  const { stdout: probe } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name,width,height,pix_fmt:format=duration,size",
    "-of",
    "json",
    outputPath,
  ]);
  const metadata = JSON.parse(probe);
  const stream = metadata.streams?.[0];
  if (stream?.codec_name !== "h264" || stream?.width !== 1920 || stream?.height !== 1080) {
    throw new Error(`Unexpected output stream: ${JSON.stringify(stream)}`);
  }
  await writeFile(`${runDir}/ffprobe.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  await runFfmpeg(
    [
      "-y",
      "-i",
      outputPath,
      "-vf",
      "fps=1/3,scale=480:-1,tile=4x3",
      "-frames:v",
      "1",
      `${runDir}/contact-sheet.png`,
    ],
    `${runDir}/evidence.log`,
  );
  await runFfmpeg(
    ["-y", "-sseof", "-0.1", "-i", outputPath, "-frames:v", "1", `${runDir}/final-frame.png`],
    `${runDir}/evidence.log`,
  );
  await writeFile(
    `${runDir}/result.json`,
    `${JSON.stringify({ outputPath, takePath, start, end, metadata }, null, 2)}\n`,
  );
  return metadata;
}

async function main() {
  if (process.platform !== "linux") {
    throw new Error(
      `This runner needs Xvfb and xdotool and only runs on Linux; on ${process.platform} follow reference/desktop-macos.md`,
    );
  }
  const { appDir, windowTitle, launchCmd } = readInputs();
  const demoArg = process.argv[2];
  if (!demoArg) throw new Error("Usage: pnpm record <demo-module.mjs> [output.mp4]");
  const demoPath = resolve(process.cwd(), demoArg);
  const outputPath = resolve(process.argv[3] ?? outputName(demoPath));
  const demoModule = await import(pathToFileURL(demoPath).href);
  if (typeof demoModule.default !== "function") {
    throw new Error(`${demoPath} must default-export an async demo function`);
  }

  const slot = await acquireSlot();
  const runDir = `/tmp/desktop-demo-${timestamp()}-${slot.number}`;
  const fixturePath = `${runDir}/fixture/demo-workspace`;
  const takePath = `${runDir}/take.mp4`;
  const markersPath = `${runDir}/markers.jsonl`;
  const pids = {};
  let browser;
  let recorder;
  let succeeded = false;
  await mkdir(`${runDir}/config`, { recursive: true });
  await mkdir(fixturePath, { recursive: true });
  await writeFile(markersPath, "");
  await writeFile(`${fixturePath}/README.md`, "# Demo workspace\n");
  await writeFile(
    `${runDir}/run.json`,
    `${JSON.stringify({ ...slot, runDir, fixturePath, outputPath }, null, 2)}\n`,
  );

  const cleanup = async () => {
    if (browser) await browser.close().catch(() => undefined);
    await stopRecorder(recorder).catch(() => undefined);
    for (const pid of [pids.app, pids.openbox, pids.xvfb]) {
      await stopGroup(pid).catch(() => undefined);
    }
    for (const pid of [pids.app, pids.openbox, pids.xvfb]) {
      if (pid && !(await waitForExit(pid, 3_000)))
        await stopGroup(pid, "SIGKILL").catch(() => undefined);
    }
    await rm(slot.lockDir, { recursive: true }).catch(() => undefined);
    if (succeeded) await rm(`${runDir}/config`, { recursive: true }).catch(() => undefined);
  };

  const signalHandler = (signal) => {
    void appendFile(`${runDir}/runner.log`, `${new Date().toISOString()} received ${signal}\n`)
      .then(cleanup)
      .finally(() => process.exit(128));
  };
  process.once("SIGINT", () => signalHandler("SIGINT"));
  process.once("SIGTERM", () => signalHandler("SIGTERM"));

  try {
    const commonEnv = {
      ...process.env,
      DISPLAY: slot.display,
      XDG_CONFIG_HOME: `${runDir}/config`,
    };
    pids.xvfb = spawnOwned("Xvfb", [slot.display, "-screen", "0", "1920x1080x24"], {
      env: commonEnv,
      logPath: `${runDir}/xvfb.log`,
    }).pid;
    await waitUntil(
      () => execFileAsync("xdpyinfo", [], { env: commonEnv }).then(() => true),
      "Xvfb",
      10_000,
    );
    pids.openbox = spawnOwned("openbox", [], {
      env: commonEnv,
      logPath: `${runDir}/openbox.log`,
    }).pid;

    const recordingStartedAt = performance.now();
    recorder = await startRecorder(slot.display, takePath, `${runDir}/recording.log`);
    await appendFile(
      markersPath,
      `${JSON.stringify({ name: "recording_started", elapsedSeconds: 0, recordedAt: new Date().toISOString() })}\n`,
    );
    pids.app = spawnOwned("sh", ["-c", launchCmd.replaceAll("{port}", String(slot.port))], {
      cwd: appDir,
      env: { ...commonEnv, ELECTRON_DISABLE_SANDBOX: "1" },
      logPath: `${runDir}/desktop.log`,
    }).pid;
    await waitUntil(
      () => fetch(`http://127.0.0.1:${slot.port}/json/version`).then((response) => response.ok),
      "Electron CDP",
      90_000,
    );
    const windowId = await waitUntil(
      () => findMainWindow(slot.display, windowTitle),
      `"${windowTitle}" main window`,
      90_000,
    );
    await execFileAsync(
      "xdotool",
      [
        "windowmove",
        windowId,
        "0",
        "0",
        "windowsize",
        windowId,
        "1920",
        "1080",
        "windowactivate",
        "--sync",
        windowId,
      ],
      { env: commonEnv },
    );
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${slot.port}`);
    const context = browser.contexts()[0];
    const page = await waitUntil(
      async () => {
        for (const candidate of context.pages()) {
          if (!candidate.url().includes("#") && (await candidate.title()) === windowTitle)
            return candidate;
        }
        return null;
      },
      `"${windowTitle}" renderer page`,
      15_000,
    );
    const demo = new DesktopDemo({
      display: slot.display,
      page,
      recordingStartedAt,
      runDir,
      windowId,
    });
    await demo.geometry();
    await demo.marker("app_visible", { windowId });
    await demo.screenshot("app-visible");
    await demoModule.default({ demo, fixturePath, page, runDir });
    await demo.marker("demo_complete");
    await sleep(3_000);
    await stopRecorder(recorder);
    recorder = null;
    const metadata = await trimAndVerify({ markersPath, outputPath, runDir, takePath });
    succeeded = true;
    process.stdout.write(`${JSON.stringify({ outputPath, runDir, metadata })}\n`);
  } catch (error) {
    await appendFile(`${runDir}/runner.log`, `${error?.stack ?? error}\n`);
    process.stderr.write(
      `record-demo failed: ${error?.message ?? error}\nDiagnostics: ${runDir}\n`,
    );
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

await main();
