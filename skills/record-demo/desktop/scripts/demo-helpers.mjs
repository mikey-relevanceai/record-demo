import { execFile, spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseShellAssignments(output) {
  return Object.fromEntries(
    output
      .trim()
      .split("\n")
      .map((line) => line.split("=", 2))
      .filter(([key, value]) => key && value !== undefined),
  );
}

async function waitForProcess(proc, label) {
  return new Promise((resolve, reject) => {
    proc.once("error", reject);
    proc.once("close", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`${label} exited with code ${code ?? "null"} signal ${signal ?? "none"}`));
    });
  });
}

export class DesktopDemo {
  constructor({ display, page, recordingStartedAt, runDir, windowId }) {
    this.display = display;
    this.page = page;
    this.recordingStartedAt = recordingStartedAt;
    this.runDir = runDir;
    this.windowId = windowId;
    this.markersPath = `${runDir}/markers.jsonl`;
    this.screenshotIndex = 0;
  }

  async marker(name, fields = {}) {
    const marker = {
      name,
      elapsedSeconds: Number(((performance.now() - this.recordingStartedAt) / 1000).toFixed(3)),
      recordedAt: new Date().toISOString(),
      ...fields,
    };
    await appendFile(this.markersPath, `${JSON.stringify(marker)}\n`);
    return marker;
  }

  async geometry() {
    const metrics = await this.page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      screenX: window.screenX,
      screenY: window.screenY,
    }));
    const { stdout } = await execFileAsync(
      "xdotool",
      ["getwindowgeometry", "--shell", this.windowId],
      { env: this.x11Env() },
    );
    const x11 = parseShellAssignments(stdout);
    const measured = {
      x: Number(x11.X),
      y: Number(x11.Y),
      width: Number(x11.WIDTH),
      height: Number(x11.HEIGHT),
    };
    const tolerance = 2;
    if (
      Math.abs(metrics.screenX - measured.x) > tolerance ||
      Math.abs(metrics.screenY - measured.y) > tolerance ||
      Math.abs(metrics.innerWidth * metrics.devicePixelRatio - measured.width) > tolerance ||
      Math.abs(metrics.innerHeight * metrics.devicePixelRatio - measured.height) > tolerance
    ) {
      throw new Error(`CDP/X11 geometry mismatch: ${JSON.stringify({ metrics, measured })}`);
    }
    return { metrics, measured };
  }

  async pointFor(locator, label) {
    await locator.waitFor({ state: "visible", timeout: 15_000 });
    const box = await locator.boundingBox();
    if (!box) throw new Error(`No bounding box for ${label}`);
    const { metrics, measured } = await this.geometry();
    const x = Math.round(measured.x + (box.x + box.width / 2) * metrics.devicePixelRatio);
    const y = Math.round(measured.y + (box.y + box.height / 2) * metrics.devicePixelRatio);
    if (
      x < measured.x ||
      y < measured.y ||
      x >= measured.x + measured.width ||
      y >= measured.y + measured.height
    ) {
      throw new Error(`Target ${label} resolved outside the app window at ${x},${y}`);
    }
    return { x, y, box };
  }

  async click(locator, label, { pauseMs = 700 } = {}) {
    const { x, y } = await this.pointFor(locator, label);
    await this.smoothMove(x, y);
    await execFileAsync("xdotool", ["click", "1"], { env: this.x11Env() });
    await this.marker("click", { label, x, y });
    await sleep(pauseMs);
  }

  async key(chord, label = chord, { pauseMs = 500 } = {}) {
    await execFileAsync("xdotool", ["key", "--clearmodifiers", chord], { env: this.x11Env() });
    await this.marker("key", { chord, label });
    await sleep(pauseMs);
  }

  async type(text, label = "type", { delayMs = 45, pauseMs = 700 } = {}) {
    await execFileAsync(
      "xdotool",
      ["type", "--clearmodifiers", "--delay", String(delayMs), "--", text],
      { env: this.x11Env(), maxBuffer: 1024 * 1024 },
    );
    await this.marker("type", { label, characters: text.length });
    await sleep(pauseMs);
  }

  async pause(ms, label = "pause") {
    await this.marker("pause", { label, milliseconds: ms });
    await sleep(ms);
  }

  async waitForNativeWindow(name, { timeoutMs = 15_000 } = {}) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      try {
        const { stdout } = await execFileAsync(
          "xdotool",
          ["search", "--onlyvisible", "--name", name],
          { env: this.x11Env() },
        );
        const ids = stdout.trim().split("\n").filter(Boolean);
        if (ids.length > 0) return ids.at(-1);
      } catch {
        // xdotool exits non-zero while the native window is absent.
      }
      await sleep(150);
    }
    throw new Error(`Native window ${name} did not appear within ${timeoutMs}ms`);
  }

  async waitForNativeWindowToClose(name, { timeoutMs = 15_000 } = {}) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      try {
        await execFileAsync("xdotool", ["search", "--onlyvisible", "--name", name], {
          env: this.x11Env(),
        });
      } catch {
        return;
      }
      await sleep(150);
    }
    throw new Error(`Native window ${name} did not close within ${timeoutMs}ms`);
  }

  async activateWindow(windowId) {
    await execFileAsync("xdotool", ["windowactivate", "--sync", windowId], {
      env: this.x11Env(),
    });
    await this.marker("native_window_activated", { windowId });
  }

  async nativeClick(windowId, offsetX, offsetY, label, { pauseMs = 500 } = {}) {
    const { stdout } = await execFileAsync("xdotool", ["getwindowgeometry", "--shell", windowId], {
      env: this.x11Env(),
    });
    const geometry = parseShellAssignments(stdout);
    const width = Number(geometry.WIDTH);
    const height = Number(geometry.HEIGHT);
    if (offsetX < 0 || offsetY < 0 || offsetX >= width || offsetY >= height) {
      throw new Error(`Native target ${label} is outside ${width}x${height}`);
    }
    const x = Number(geometry.X) + offsetX;
    const y = Number(geometry.Y) + offsetY;
    await this.smoothMove(x, y);
    await execFileAsync("xdotool", ["click", "1"], { env: this.x11Env() });
    await this.marker("native_click", { label, windowId, x, y, offsetX, offsetY });
    await sleep(pauseMs);
  }

  async screenshot(label) {
    const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "");
    const path = `${this.runDir}/screenshots/${String(++this.screenshotIndex).padStart(2, "0")}-${safeLabel}.png`;
    await mkdir(`${this.runDir}/screenshots`, { recursive: true });
    const proc = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "x11grab",
        "-video_size",
        "1920x1080",
        "-i",
        this.display,
        "-frames:v",
        "1",
        path,
      ],
      { env: this.x11Env(), stdio: "ignore" },
    );
    await waitForProcess(proc, "screenshot ffmpeg");
    await this.marker("screenshot", { label, path });
    return path;
  }

  async smoothMove(targetX, targetY, steps = 30) {
    const { stdout } = await execFileAsync("xdotool", ["getmouselocation", "--shell"], {
      env: this.x11Env(),
    });
    const start = parseShellAssignments(stdout);
    const startX = Number(start.X);
    const startY = Number(start.Y);
    for (let index = 1; index <= steps; index += 1) {
      const unit = index / steps;
      const eased = unit * unit * (3 - 2 * unit);
      const x = Math.round(startX + (targetX - startX) * eased);
      const y = Math.round(startY + (targetY - startY) * eased);
      await execFileAsync("xdotool", ["mousemove", String(x), String(y)], {
        env: this.x11Env(),
      });
      await sleep(16);
    }
  }

  x11Env() {
    return { ...process.env, DISPLAY: this.display };
  }
}

export { sleep };
