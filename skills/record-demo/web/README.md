# pr-recorder

Records a **human-paced** browser walkthrough of a UI change and writes an MP4
to attach to a PR. Built for background/automated coding agents (and local agent
runs) to show what a change looks like in use, not just describe it.

The point is that the recording should look like a person using the app - a
cursor that glides along curved paths, clicks that land with a ripple, typing
with a natural cadence - rather than a machine teleporting through the UI. That
motion layer lives in [`human.ts`](./human.ts); [`record.ts`](./record.ts)
launches the browser, runs your demo, and transcodes to MP4.

## What you write

A **demo script** that default-exports `async ({ page, human }) => { ... }`. Drive
the app the way a person does - find controls by their visible role and text:

```ts
import type { DemoContext } from "./record.ts";

export default async function demo({ page, human }: DemoContext) {
  await human.goto("/home", { ready: page.getByRole("link", { name: "Files" }) });
  await human.caption("Opening the editor");
  await human.click(page.getByRole("link", { name: "Files" }));
  await human.type(page.getByPlaceholder("Untitled"), "Quarterly report");
  await human.click(page.getByRole("button", { name: "Create" }));
}
```

`getByRole` / `getByText` / `getByLabel` / `getByPlaceholder` - never CSS
selectors or test-only attributes. **Do not add hooks to the frontend for a
recording.** These scripts are throwaway and per-PR; keep them out of the app.

### The `human` helpers

| Method                             | What it does                                              |
| ---------------------------------- | --------------------------------------------------------- |
| `goto(url, { ready })`             | Navigate, keep the cursor where it was, wait for `ready`  |
| `waitFor(locator)`                 | Block until a control is visible - never `waitForTimeout` |
| `moveTo(locator)`                  | Glide the pointer to a control along a curved, eased path |
| `click(locator)`                   | Move, then press with a visible ripple                    |
| `type(locator, text, { clear })`   | Focus and type with a human cadence                       |
| `scrollIntoView(locator)`          | Smooth-scroll a control into view                         |
| `settle(ms?)`                      | Pause so a viewer can follow                              |
| `caption(text)` / `clearCaption()` | Show/hide a scene label                                   |
| `moveToPoint(x, y)`                | Move to an absolute coordinate (canvas gestures)          |

Pace is tunable per run: `PR_RECORDER_SPEED` (>1 slower), `PR_RECORDER_JITTER`.

### Keeping demos tight

A demo that opens on ten seconds of nothing is a demo nobody watches. Three
things keep the dead air out, in the order they matter:

1. **Wait on the app, not the clock.** `goto(url, { ready })` and `waitFor` both
   continue the moment the control exists. A `page.waitForTimeout(9000)` pays the
   worst case every single run and films it.
2. **The head is trimmed automatically** back to the first loaded page, less a
   half-second lead-in. `PR_RECORDER_TRIM_HEAD=<seconds>` overrides it; `0` keeps
   the load on screen for when the load is the point.
3. **`PR_RECORDER_WARMUP=<paths>`** loads pages in a throwaway context before
   capture starts, so a dev server's first route compile happens off camera. It
   buys wall-clock on a cold stack, not in-page speed - the recording context has
   its own cold cache either way.

## Setup

Run from `<skill-dir>/web`, where `<skill-dir>` is the directory holding the
skill's `SKILL.md`:

```bash
pnpm install
pnpm install-browser   # downloads the Chromium build Playwright drives
# ffmpeg must be on PATH (brew install ffmpeg).
```

## Install for use anywhere

To record from any project, install a portable copy:

```bash
bash <skill-dir>/web/install-local.sh
```

This copies the tool to `~/.pr-recorder` (with its own deps + Chromium) and
drops a `pr-record` wrapper in `~/.local/bin`. From then on, from any project,
with your app running locally:

```bash
PR_RECORDER_BASE_URL=http://localhost:3000 \
PR_RECORDER_OUT=./pr-demo.mp4 \
pr-record ./my-demo.ts
```

Override `PR_RECORDER_HOME` / `PR_RECORDER_BIN_DIR` to change locations. Re-run
the script to update the installed copy. Watch it happen with
`PR_RECORDER_HEADED=1` while tuning a script.

The recorder starts from a fresh browser context. If the flow needs a signed-in
user, the demo script or the app's own setup must provide that.

## Getting the MP4 onto the PR

Attach it with `gh pr comment --attach`; see `SKILL.md` in the skill directory.

## How the natural motion works

Stock Playwright teleports an **invisible** cursor (the OS pointer is never in
the captured frame) and fires clicks instantly. `human.ts` fixes all three:

1. **Visible cursor** - an init script injects a DOM pointer + click ripple that
   follows the synthetic mouse events, re-installed on every navigation.
2. **Curved, eased motion** - `moveTo` walks a bowed cubic Bezier with
   `easeInOutCubic` timing and step counts/durations that scale with distance
   (a nod to Fitts's law), plus a slightly off-centre target and light tremor.
3. **Human pacing** - per-keystroke delay jitter with longer beats after spaces
   and punctuation, and deliberate `settle` pauses between actions.
