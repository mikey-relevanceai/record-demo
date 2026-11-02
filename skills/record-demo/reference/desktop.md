# Recording the desktop app

The mechanism for recording an Electron app. Use this rather than
[web.md](web.md) when the demo needs the real desktop shell: native file
dialogs, menus, the tray, or anything outside the renderer.

Read the conduct rules in [../SKILL.md](../SKILL.md) first. This file assumes them
and covers only what is specific to desktop apps.

## Pick a platform first

- **Linux** has the bundled runner: a dedicated Xvfb display captured with
  ffmpeg `x11grab` and driven with physical `xdotool` input. Start at
  [desktop-linux-setup.md](desktop-linux-setup.md), then choose between
  [desktop-linux-interactive.md](desktop-linux-interactive.md) and
  [desktop-linux-scripted.md](desktop-linux-scripted.md).
- **macOS** has no runner and no headless display. A single window is recorded
  by id instead, which needs none of the Linux setup.
  [desktop-macos.md](desktop-macos.md) is the groundwork, and marks what has
  been proven on a Mac against what has only been read out of the app's source.

`desktop/scripts/record.mjs` refuses to start off Linux, so a macOS attempt fails with a
message rather than somewhere inside `xdotool`.

## Choosing a Linux approach

Both produce the same verified MP4. Choose per request:

- **Interactive computer use:** best for short, exploratory, or one-off flows
  when an automation-capable computer-use surface can control the real Electron
  desktop. It needs less preparation and adapts to unexpected UI state.
- **Scripted hybrid:** best for polished, long, fragile, repeated, or
  assertion-heavy flows. Generate a request-specific module under `/tmp`; the
  stable runner uses semantic CDP locators and physical X11 input.

Start interactive when either is suitable. Switch to scripted if rehearsal
exposes targeting, timing, or repeatability problems. The temporary scenario is
input to the skill, not a modification of it, and must remain uncommitted.

## macOS preflight

`ffmpeg` is the only requirement; `screencapture`, `osascript` and `swiftc` ship
with the system. `brew install --cask deskpad` is recommended but optional - it
gives the demo window a virtual display to live on so it stays out of the
operator's way. Skip it when nobody is using the machine.

## Linux preflight

`<skill-dir>` is the skill directory: `.claude/skills/record-demo` in a project,
or `~/.claude/skills/record-demo` for a personal install.

```bash
for command in Xvfb openbox xdotool xdpyinfo ffmpeg ffprobe pnpm; do
  command -v "$command" >/dev/null || echo "MISSING: $command"
done
pnpm --dir <skill-dir>/desktop install --ignore-workspace
pnpm --dir <skill-dir>/desktop check
```

Install your app's dependencies before the first take.

## Platform-specific safety

These are in addition to the conduct rules, not instead of them.

- Never remove the app's normal profile directory. Electron's default is
  `~/.config/<app name>` on Linux and `~/Library/Application Support/<app name>`
  on macOS.
- Never use `pkill` for Electron, Xvfb, ffmpeg, or the window manager.
- Keep `--user-data-dir` short if the app creates a Unix socket inside it: a
  socket path is capped at 104 bytes on macOS and 108 on Linux, and a path under
  a session scratchpad is over that.
- Scope every X11 command to the recording display.
- Never assume CSS pixels equal X11 pixels, or that a macOS window's reported
  geometry matches its capture dimensions.
- Treat `/tmp/desktop-demo-slot-*` as locks. Remove a stale lock only after
  confirming its owner PID, display, and port are unused.

## Things to check in your app

Each of these came up while recording one Electron app, either during a take or
from reading its source. Your app may not have the same problem, but each is
cheap to rule out before the first take.

- **Where it writes outside its profile.** A settings value pointing at an
  absolute path, a default folder in `$HOME`, a directory shared between
  profiles: a disposable `--user-data-dir` isolates none of these. Find them,
  and redirect them to scratch before the first launch rather than cleaning up
  after. If the demo performs git actions, give it a throwaway one-commit
  repository as its fixture.
- **What it accepts at launch.** A command-line argument skipped a first-run
  folder gate that could not otherwise be dismissed, and a second launch against
  the same profile handed its arguments to the running instance instead of
  opening a native panel. Read the app's main process for flags and
  single-instance handling before driving a gate or a dialog.
- **Which file it actually reads.** Reading the source showed one profile file
  was a projection the app regenerated from other state, so seeding it would do
  nothing. Seed the source the
  app reads, and confirm on first launch that the seed took.
- **What has no route around it.** Reading the source, Save As dialogs, tray and
  Dock menus and OS permission prompts had no argument or seed equivalent. Plan those for a
  surface that can drive them, or leave them out of the demo.
- **Whether a signed-out mode covers the flow.** Where the app had one, it was
  enough for the demo and took sign-in out of the take entirely.
- **Trust prompts.** Accept a "trust this folder" prompt only for a fresh
  fixture with no `.git` and no files you did not create.
- **Live-updating panes.** A pane that redraws continuously recorded as solid
  black while it ran, and the cause was not found. Check the frames for those
  panes specifically.
