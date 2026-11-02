# Scripted hybrid recording

The bundled runner captures X11 with ffmpeg, resolves renderer controls through
Playwright/CDP, and sends all visible input through scoped `xdotool`. It creates
an isolated display, CDP port, and `XDG_CONFIG_HOME`, owns every child process,
and retains diagnostic artifacts after failures.

## Scout

Search the app's renderer source for visible labels and aria labels. Classify
each action:

- Renderer control: pass a Playwright locator to `demo.click()`.
- Native window: use `waitForNativeWindow()`, `activateWindow()`, and measured
  dialog-relative `nativeClick()` calls.
- Canvas or terminal: locate its accessible input or a stable surrounding
  control before sending physical input.

Do not use Playwright mouse or keyboard calls; they do not move the cursor
recorded by `x11grab`. Do not use coordinate clicks for renderer controls.

## Write a temporary scenario

Create a request-specific module under `/tmp`, starting from
`<skill-dir>/desktop/scripts/demo.example.mjs`:

```js
export default async function runDemo({ demo, page }) {
  await demo.click(page.getByRole("button", { name: "Settings" }), "Open Settings");
  await page.getByRole("heading", { name: "Settings" }).waitFor({ state: "visible" });
  await demo.screenshot("settings-open");
}
```

The labels are placeholders; replace them with your app's real accessible names.

The default export receives `{ demo, fixturePath, page, runDir }`. Available
helpers include:

- `click(locator, label, options)`, `key(chord, label)`, and
  `type(text, label, options)` for visible physical input;
- `waitForNativeWindow()`, `waitForNativeWindowToClose()`, `activateWindow()`,
  and `nativeClick()` for native dialogs;
- `screenshot()`, `pause()`, and `marker()` for evidence and edit markers.

Keep the scenario outside the repository unless the user explicitly asks for a
reusable committed example.

## Rehearse and record

Run the scenario once as a rehearsal, from `<skill-dir>/desktop` (`<skill-dir>` is
defined in [../SKILL.md](../SKILL.md)):

```bash
DEMO_APP_DIR=/path/to/my-app DEMO_WINDOW_TITLE="My App" \
  pnpm record /tmp/my-desktop-demo.mjs /tmp/my-desktop-demo-rehearsal.mp4
```

- `DEMO_APP_DIR` (required) is the directory the launch command runs in. Give
  absolute paths; relative ones resolve against `<skill-dir>/desktop`.
- `DEMO_WINDOW_TITLE` (required) is the main window's exact title. The runner
  uses it to find the window with `xdotool` and to pick the renderer page over
  CDP.
- `DEMO_LAUNCH_CMD` (optional) is run with `sh -c` in `DEMO_APP_DIR` and must
  contain `{port}`, which becomes the run's remote debugging port. The default,
  `pnpm dev --remoteDebuggingPort {port} --noSandbox`, suits electron-vite.

Any other environment the app needs is inherited from your shell.

Inspect the reported run directory's `contact-sheet.png`, `final-frame.png`,
`ffprobe.json`, markers, and key screenshots. Correct timing or targeting in the
temporary scenario, not in the skill or application.

After rehearsal succeeds, rerun with a UTC-stamped descriptive output name, or
omit it to get `/tmp/<timestamp>-<demo name>.mp4`. The runner trims from 1.5
seconds before `app_visible` through three seconds after `demo_complete`,
verifies the stream, and writes visual evidence. On failure it
keeps the partial take, logs, markers, screenshots, and disposable profile.

## CDP fallback

If CDP cannot connect, do not expose it by changing production Electron code.
Either use [desktop-linux-interactive.md](desktop-linux-interactive.md) or source `<skill-dir>/desktop/scripts/demo-helpers.sh`
and rehearse physical coordinates with screenshots. Retain the same isolation,
PID ownership, evidence, and cleanup rules.
