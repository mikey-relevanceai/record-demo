// Records a human-paced walkthrough of the app and writes an MP4 for a PR.
//
// It launches Chromium with video capture, runs a demo script that drives the
// app through the Human helpers, then transcodes the captured WebM to a
// web-playable MP4 via ffmpeg.
//
// A demo script default-exports async ({ page, human }) => { ... }. It targets
// controls the way a person would - getByRole / getByText - never test hooks.
//
// Env in:
//   PR_RECORDER_BASE_URL     required. e.g. http://localhost:3000
//   PR_RECORDER_DEMO         demo script path (default ./demo.ts, or argv[2])
//   PR_RECORDER_OUT          output mp4 path (default ./pr-demo.mp4)
//   PR_RECORDER_HEADED       "1" to show the browser window
//   PR_RECORDER_SPEED        pace multiplier for motion (default 1)
//   PR_RECORDER_JITTER       per-step pointer tremor px (default 1)
//   PR_RECORDER_KEEP_WEBM    "1" to keep the intermediate WebM
//   PR_RECORDER_WARMUP       paths to load before capture starts ("1" = "/")
//   PR_RECORDER_TRIM_HEAD    override the automatic app-boot head trim (seconds)
// Out: MP4 at PR_RECORDER_OUT. Diagnostics -> stderr.

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium, type Page } from "playwright";

import { createHuman, type Human } from "./human.ts";

export type DemoContext = { page: Page; human: Human };
export type Demo = (ctx: DemoContext) => Promise<void>;

function fail(msg: string): never {
  console.error(`[record] FAIL: ${msg}`);
  process.exit(1);
}

const baseUrl = (process.env.PR_RECORDER_BASE_URL ?? "").replace(/\/$/, "");
if (!baseUrl) {
  fail("PR_RECORDER_BASE_URL is required (e.g. http://localhost:3000)");
}

const demoPath = resolve(process.env.PR_RECORDER_DEMO ?? process.argv[2] ?? "./demo.ts");
const outPath = resolve(process.env.PR_RECORDER_OUT ?? "./pr-demo.mp4");
const headed = process.env.PR_RECORDER_HEADED === "1";
const speed = Number(process.env.PR_RECORDER_SPEED ?? "1");
const jitter = Number(process.env.PR_RECORDER_JITTER ?? "1");
const keepWebm = process.env.PR_RECORDER_KEEP_WEBM === "1";
// Validated here rather than at the use site: the trim is the last step after a
// full capture, so a typo that fell through to "no trim" would only surface once
// the recording had already been paid for.
const trimHeadOverride = readTrimHeadOverride();

const VIEWPORT = { width: 1440, height: 900 };

// Left on the front of the video after the automatic trim, so it opens on a
// beat of the loaded page rather than cutting straight into the first move.
const LEAD_IN_SECONDS = 0.5;

function readTrimHeadOverride(): number | null {
  const raw = process.env.PR_RECORDER_TRIM_HEAD?.trim();
  if (!raw) {
    return null;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    fail(`PR_RECORDER_TRIM_HEAD must be a non-negative number of seconds, got "${raw}"`);
  }
  return seconds;
}

// Paths to load before the recording context exists. "1" is shorthand for the
// app root; otherwise a comma-separated list, ideally the pages the demo visits.
function warmupPaths(): string[] {
  const raw = process.env.PR_RECORDER_WARMUP?.trim();
  if (!raw) {
    return [];
  }
  if (raw === "1") {
    return ["/"];
  }
  return raw
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean);
}

function ffmpegTranscode(webm: string, mp4: string, trimSeconds: number): Promise<void> {
  // libx264 + yuv420p + faststart is the broadly-playable combination (GitHub,
  // Safari, Chrome). The pad rounds odd dimensions up to even, which libx264
  // requires; -r 30 gives a steady frame rate from Playwright's variable one.
  const args = [
    "-y",
    // Before -i so ffmpeg seeks the input rather than decoding and discarding;
    // we re-encode anyway, so the seek lands frame-accurate.
    ...(trimSeconds > 0 ? ["-ss", String(trimSeconds)] : []),
    "-i",
    webm,
    "-r",
    "30",
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
    proc.on("error", (err) =>
      rejectPromise(new Error(`ffmpeg failed to start (is it installed?): ${err.message}`)),
    );
    proc.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

async function loadDemo(): Promise<Demo> {
  const mod = (await import(pathToFileURL(demoPath).href)) as { default?: Demo };
  if (typeof mod.default !== "function") {
    fail(`demo ${demoPath} must default-export an async ({ page, human }) => {...} function`);
  }
  return mod.default;
}

const demo = await loadDemo();

const videoDir = resolve(".pr-recorder-video");
mkdirSync(videoDir, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });

const browser = await chromium.launch({ headless: !headed });

// Load the demo's pages once in a throwaway context, before the recording
// context exists, so nothing here reaches the video. A dev server compiles a
// route on first request and serves it instantly after, which is most of the
// dead air at the head of a cold recording.
const warmups = warmupPaths();
if (warmups.length > 0) {
  const warmContext = await browser.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true });
  const warmPage = await warmContext.newPage();
  for (const path of warmups) {
    const startedAt = Date.now();
    try {
      await warmPage.goto(path, { waitUntil: "networkidle", timeout: 120_000 });
      console.error(`[record] warmed ${path} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    } catch (err) {
      // A warmup is an optimisation; a slow or failing one must not lose a run.
      console.error(`[record] warmup ${path} skipped: ${err instanceof Error ? err.message : err}`);
    }
  }
  await warmContext.close();
}

// Video capture begins with the context, so this is frame zero of the WebM.
const captureStartedAt = Date.now();
const context = await browser.newContext({
  baseURL: baseUrl,
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  // Local dev servers often serve a self-signed or locally-trusted cert that
  // headless Chromium doesn't recognise; the target is a local build, so accept it.
  ignoreHTTPSErrors: true,
  recordVideo: { dir: videoDir, size: VIEWPORT },
});

const page = await context.newPage();
const human = createHuman(page, { speed, jitter });
await human.installCursor();

const video = page.video();
try {
  await demo({ page, human });
} catch (err) {
  console.error(`[record] demo threw: ${err instanceof Error ? err.message : err}`);
  // Still close the context below so the partial video is flushed for debugging.
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}

if (!video) {
  fail("no video was captured");
}
const webmPath = await video.path();
console.error(`[record] captured ${webmPath}`);

// Drop the app-boot frames: everything up to the first loaded page, less a
// short lead-in. PR_RECORDER_TRIM_HEAD overrides it (including "0" to keep the
// load on screen, e.g. when the load itself is what the PR changed).
const bootSeconds =
  human.firstContentReadyAt === null ? null : (human.firstContentReadyAt - captureStartedAt) / 1000;
const trimHeadSeconds =
  trimHeadOverride ?? (bootSeconds === null ? 0 : Math.max(0, bootSeconds - LEAD_IN_SECONDS));

await ffmpegTranscode(webmPath, outPath, trimHeadSeconds);
if (trimHeadSeconds > 0) {
  console.error(
    `[record] trimmed ${trimHeadSeconds.toFixed(1)}s of app-boot off the head` +
      (trimHeadOverride === null ? "" : " (PR_RECORDER_TRIM_HEAD)"),
  );
} else if (trimHeadOverride !== null) {
  console.error("[record] kept the app-boot head (PR_RECORDER_TRIM_HEAD=0)");
} else if (bootSeconds === null) {
  // No navigation means no known boot moment, so the head is whatever the demo
  // did before its first goto - worth saying, since the trim silently did nothing.
  console.error("[record] no head trim - the demo never called goto()");
}
if (!keepWebm) {
  rmSync(videoDir, { recursive: true, force: true });
}
console.error(`[record] wrote ${outPath}`);
process.stdout.write(outPath);
