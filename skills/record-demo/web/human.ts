// The human-motion layer that makes a recorded Playwright session look like a
// person using the app instead of a machine teleporting an invisible cursor.
//
// Three things stock Playwright does not give us, all provided here:
//   1. A VISIBLE cursor. Headless Chromium never renders the OS pointer into
//      the captured video, so we inject a DOM pointer (installCursor) that
//      tracks the synthetic mouse events Playwright dispatches.
//   2. NATURAL motion. page.mouse.move jumps straight to a point in one hop;
//      moveTo() walks a curved, eased, distance-timed Bezier path instead.
//   3. HUMAN pacing. type() varies per-keystroke delay; settle() pauses so a
//      viewer can follow what just happened.
//
// Targets are Playwright Locators built from role/text/label queries
// (getByRole, getByText, ...) - the same way a person finds a control - so demo
// scripts never depend on test-only hooks in the app.

import type { Locator, Page } from "playwright";

export interface HumanOptions {
  // Global pace multiplier. >1 slows everything down, <1 speeds it up.
  speed?: number;
  // Extra per-step positional wobble in pixels. 0 disables the tremor.
  jitter?: number;
}

export interface MoveOptions {
  // Fraction of the target box the click point may stray from dead centre
  // (0 = exact centre, 0.5 = anywhere within the element). Humans don't hit
  // the geometric centre every time.
  spread?: number;
}

export interface TypeOptions {
  // Clear the field before typing.
  clear?: boolean;
}

export interface GotoOptions {
  // Wait for this to be visible before the demo continues. Lazily-loaded
  // editors and dev-server route compiles mean `domcontentloaded` fires long
  // before the surface is usable, and the alternative authors reach for - a
  // flat `waitForTimeout` - pads every recording with dead air.
  ready?: Locator;
  // Cap for `ready`, in ms. Generous by default: a cold dev-server route
  // compile is slow once and fast forever after.
  readyTimeout?: number;
}

interface Point {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Symmetric jitter in [-magnitude, magnitude].
const wobble = (magnitude: number): number => (Math.random() * 2 - 1) * magnitude;

// easeInOutCubic - slow start, fast middle, slow stop. This single curve is
// what most sells the motion as human: real pointer moves accelerate off the
// mark and decelerate into the target rather than travelling at constant speed.
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// A point on a cubic Bezier defined by p0..p3 at parameter t.
const bezier = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
};

export class Human {
  private pos: Point;
  // When the first navigation finished loading. Everything captured before this
  // is the app booting, which no viewer needs to watch - the recorder trims the
  // video back to here.
  private contentReadyAt: number | null = null;

  constructor(
    private readonly page: Page,
    private readonly opts: HumanOptions = {},
  ) {
    // Start the cursor near the top-left, as if the pointer just entered the
    // window. The first moveTo curves away from here.
    this.pos = { x: 90, y: 90 };
  }

  private get speed(): number {
    return this.opts.speed ?? 1;
  }

  private get jitter(): number {
    return this.opts.jitter ?? 1;
  }

  // Installs the visible cursor + click-ripple overlay. Registered as an init
  // script so it re-installs on every navigation (each new document wipes the
  // DOM). Call once, before the first navigation.
  //
  // Injected as a source string, not a function: tsx/esbuild's keepNames wraps
  // named functions with a `__name(...)` helper that is undefined in the page,
  // so a serialised function would throw at document-start and silently leave
  // us with no cursor.
  async installCursor(): Promise<void> {
    await this.page.addInitScript(CURSOR_INIT_SCRIPT);
  }

  // Navigate and keep the visible cursor where the tracked pointer already is,
  // so it doesn't flash back to the corner after a fresh document loads.
  async goto(url: string, opts: GotoOptions = {}): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.page.mouse.move(this.pos.x, this.pos.y);
    if (opts.ready) {
      await this.waitFor(opts.ready, opts.readyTimeout);
    }
    this.contentReadyAt ??= Date.now();
    await this.settle(400);
  }

  // Wall-clock ms at which the first page finished loading, or null if the demo
  // never navigated.
  get firstContentReadyAt(): number | null {
    return this.contentReadyAt;
  }

  // Block until a control is on screen, then pause only long enough to read the
  // new state. Prefer this over `page.waitForTimeout(...)`: it continues the
  // moment the app is ready instead of always paying the worst case, and it
  // fails loudly (naming the locator) rather than silently driving a half-built
  // page.
  async waitFor(target: Locator, timeoutMs = 60_000): Promise<void> {
    const startedAt = Date.now();
    try {
      await target.first().waitFor({ state: "visible", timeout: timeoutMs });
    } catch (err) {
      // Playwright's own message distinguishes a genuine timeout from a strict-mode
      // violation, and the recorder only ever prints `.message` for a failed demo.
      const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
      throw new Error(`waitFor: ${target} never became visible within ${timeoutMs}ms - ${detail}`, {
        cause: err,
      });
    }
    const waited = Date.now() - startedAt;
    if (waited > 3000) {
      // A long wait here is the cold-compile cost that PR_RECORDER_WARMUP
      // exists to move off the front of the video.
      console.error(`[human] waited ${(waited / 1000).toFixed(1)}s for ${target} - warm up?`);
    }
    await this.settle(320);
  }

  // Glide the pointer to a target along a curved, eased path. Scrolls the
  // target into view first, then aims at a slightly off-centre point.
  async moveTo(target: Locator, opts: MoveOptions = {}): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    await target.waitFor({ state: "visible" });
    const box = await target.boundingBox();
    if (!box) {
      throw new Error("moveTo: target has no bounding box (not visible/attached)");
    }

    const spread = opts.spread ?? 0.28;
    const dest: Point = {
      x: box.x + box.width / 2 + wobble((box.width / 2) * spread),
      y: box.y + box.height / 2 + wobble((box.height / 2) * spread),
    };
    await this.glide(dest);
  }

  // Move to an absolute viewport coordinate (for gestures that aren't tied to
  // an element, e.g. dragging across a canvas).
  async moveToPoint(x: number, y: number): Promise<void> {
    await this.glide({ x, y });
  }

  async click(target: Locator, opts: MoveOptions = {}): Promise<void> {
    await this.moveTo(target, opts);
    await sleep(this.scaled(90 + Math.random() * 120));
    await this.page.mouse.down();
    await sleep(this.scaled(40 + Math.random() * 60));
    await this.page.mouse.up();
    await this.settle();
  }

  // Focus the field, then type character-by-character with a varied cadence:
  // a base delay per keystroke plus a longer beat after spaces and sentence
  // punctuation, the way real typing clusters into words.
  async type(target: Locator, text: string, opts: TypeOptions = {}): Promise<void> {
    await this.click(target);
    if (opts.clear) {
      await this.page.keyboard.press("ControlOrMeta+A");
      await this.page.keyboard.press("Backspace");
      await sleep(this.scaled(150));
    }
    for (const char of text) {
      await this.page.keyboard.type(char);
      let delay = 55 + Math.random() * 90;
      if (char === " ") {
        delay += 40 + Math.random() * 80;
      }
      if (".!?,".includes(char)) {
        delay += 120 + Math.random() * 160;
      }
      await sleep(this.scaled(delay));
    }
    await this.settle();
  }

  // Native smooth scroll - the browser's own easing reads naturally and copes
  // with nested scroll containers that a manual window.scrollTo would miss.
  async scrollIntoView(target: Locator): Promise<void> {
    await target.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await this.settle(700);
  }

  // A deliberate pause so the viewer can register what happened. Randomised
  // around the base so successive settles don't feel metronomic.
  async settle(baseMs = 480): Promise<void> {
    await sleep(this.scaled(baseMs + wobble(baseMs * 0.25)));
  }

  // Show a caption banner labelling the current scene. Persists until the next
  // caption() replaces it or clearCaption() removes it.
  async caption(text: string): Promise<void> {
    await this.page.evaluate((t) => window.__demoCaption?.(t), text);
    await this.settle(650);
  }

  async clearCaption(): Promise<void> {
    await this.page.evaluate(() => window.__demoCaption?.(null));
  }

  // Walk the pointer from its current position to dest along a bowed Bezier,
  // sampling with eased timing so speed ramps up then down.
  private async glide(dest: Point): Promise<void> {
    const start = this.pos;
    const dx = dest.x - start.x;
    const dy = dest.y - start.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) {
      this.pos = dest;
      return;
    }

    // Bow the path sideways so it arcs instead of tracking a ruler-straight
    // line. The perpendicular offset is a random fraction of the travel
    // distance, with a random sign, and shrinks to nothing on tiny moves.
    const perp: Point = { x: -dy / distance, y: dx / distance };
    const bow =
      clamp(distance * (0.08 + Math.random() * 0.12), 0, 90) * (Math.random() < 0.5 ? -1 : 1);
    const p1: Point = {
      x: start.x + dx * 0.3 + perp.x * bow,
      y: start.y + dy * 0.3 + perp.y * bow,
    };
    const p2: Point = {
      x: start.x + dx * 0.7 + perp.x * bow * 0.6,
      y: start.y + dy * 0.7 + perp.y * bow * 0.6,
    };

    // More steps and more time for longer moves (a loose nod to Fitts's law:
    // longer reaches take longer), clamped so nothing crawls or snaps.
    const steps = Math.round(clamp(distance / 7, 14, 64));
    const duration = this.scaled(clamp(200 + distance * 0.85, 240, 950));

    let prevT = 0;
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps);
      const point = bezier(start, p1, p2, dest, t);
      const jx = i === steps ? 0 : wobble(this.jitter);
      const jy = i === steps ? 0 : wobble(this.jitter);
      await this.page.mouse.move(point.x + jx, point.y + jy);
      await sleep(duration * (t - prevT));
      prevT = t;
    }
    this.pos = dest;
  }

  // Apply the global pace multiplier to a duration.
  private scaled(ms: number): number {
    return ms * this.speed;
  }
}

export function createHuman(page: Page, opts?: HumanOptions): Human {
  return new Human(page, opts);
}

// Injected into every document (as a string - see installCursor). Builds a
// pointer that follows the synthetic mouse events, a ripple on press, and a
// caption banner. Plain JS: it runs in the page, not the Node process.
const CURSOR_INIT_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById("__demo_cursor")) {
      return;
    }

    const cursor = document.createElement("div");
    cursor.id = "__demo_cursor";
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 22 22'>" +
      "<path d='M3 2 L3 17 L7 13 L10 20 L13 19 L10 12 L16 12 Z' fill='white' stroke='black' stroke-width='1.2' stroke-linejoin='round'/>" +
      "</svg>";
    cursor.style.cssText =
      "position:fixed;top:0;left:0;width:22px;height:22px;z-index:2147483647;" +
      "pointer-events:none;margin-left:-3px;margin-top:-2px;" +
      "transition:transform 60ms linear;will-change:transform;" +
      "background-repeat:no-repeat;background-image:url(\\"data:image/svg+xml;utf8," +
      encodeURIComponent(svg) + "\\")";
    document.body.appendChild(cursor);

    const caption = document.createElement("div");
    caption.id = "__demo_caption";
    caption.style.cssText =
      "position:fixed;left:50%;bottom:36px;transform:translateX(-50%) translateY(12px);" +
      "z-index:2147483646;pointer-events:none;opacity:0;transition:opacity 220ms ease,transform 220ms ease;" +
      "max-width:70vw;padding:10px 18px;border-radius:10px;" +
      "font:600 15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "color:#fff;background:rgba(20,20,22,0.86);box-shadow:0 8px 28px rgba(0,0,0,0.35)";
    document.body.appendChild(caption);

    window.addEventListener("mousemove", (e) => {
      cursor.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
    }, true);

    window.addEventListener("mousedown", (e) => {
      const ripple = document.createElement("div");
      ripple.style.cssText =
        "position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;" +
        "width:14px;height:14px;margin-left:-7px;margin-top:-7px;" +
        "left:" + e.clientX + "px;top:" + e.clientY + "px;" +
        "border:2px solid rgba(40,120,255,0.9);background:rgba(40,120,255,0.18);" +
        "animation:__demo_ripple 420ms ease-out forwards";
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 460);
    }, true);

    window.__demoCaption = (text) => {
      if (text) {
        caption.textContent = text;
        caption.style.opacity = "1";
        caption.style.transform = "translateX(-50%) translateY(0)";
      } else {
        caption.style.opacity = "0";
        caption.style.transform = "translateX(-50%) translateY(12px)";
      }
    };

    const style = document.createElement("style");
    style.textContent =
      "@keyframes __demo_ripple{from{transform:scale(0.6);opacity:1}to{transform:scale(3);opacity:0}}";
    document.head.appendChild(style);
  };

  if (document.body) {
    install();
  } else {
    window.addEventListener("DOMContentLoaded", install);
  }
})()`;

declare global {
  interface Window {
    __demoCaption?: (text: string | null) => void;
  }
}
