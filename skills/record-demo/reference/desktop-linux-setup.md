# Setup for desktop demo recording

## Platform

Use x86_64 Linux with X11 tooling. The recorder creates a dedicated Xvfb
display and runs Openbox so Electron and native GTK dialogs have stable window
geometry. Wayland is not supported by this runner.

macOS needs none of this setup: there a window is recorded by id rather than a
display. That path has no runner yet, and [desktop-macos.md](desktop-macos.md) holds the
groundwork for it. The rest of this file is Linux only.

Install missing system packages:

```bash
sudo apt-get update
sudo apt-get install -y xvfb x11-utils openbox xdotool ffmpeg
```

Electron may also require GTK, NSS, GBM, and ALSA libraries. If launch reports a
missing shared library, run `ldd` on the Electron binary and install the package
providing that library.

## Dependencies

Install your app's dependencies, then the recorder's. `<skill-dir>` is the skill
directory: `.claude/skills/record-demo` in a project, or
`~/.claude/skills/record-demo` for a personal install.

```bash
pnpm --dir <skill-dir>/desktop install --ignore-workspace
```

The recorder's Playwright package connects to Electron over CDP; it does not
download or launch a separate browser. The runner starts the app with
`DEMO_LAUNCH_CMD`, which must open a remote debugging port. The default,
`pnpm dev --remoteDebuggingPort {port} --noSandbox`, suits an electron-vite
project; set your own otherwise. The inputs are listed in
[desktop-linux-scripted.md](desktop-linux-scripted.md).

## Sandbox

Ubuntu 24.04 can block Electron's Chromium sandbox through its unprivileged
user-namespace policy. For this isolated development recording only, the runner
sets `ELECTRON_DISABLE_SANDBOX=1` for the app, and the default launch command
also passes electron-vite's `--noSandbox`. Do not change the host sysctl or
packaged app security settings for a demo.

## State

The app receives a per-run `XDG_CONFIG_HOME` under `/tmp`. Electron's default
profile location follows it, so unless the app overrides that path, the normal
desktop profile, saved login, and preferences remain untouched. Never copy
production credentials into the demo module or logs.

## Native folder chooser

The GTK directory chooser is outside CDP. Prefer a short, visibly named fixture
such as `demo-workspace`. On the standard dialog, select Home, click the folder
row, then click Open. A Ctrl+L path is unreliable in directory-selection mode:
completion can append a trailing slash without selecting the folder.

`xdotool getwindowgeometry` reports GTK client-area coordinates, excluding the
title decoration. Measure offsets from that client origin and confirm them from
a rehearsal frame. Do not reuse absolute screen coordinates after changing the
display size.

## Audio

The runner records video only. An app that needs microphone input on the
headless display needs a separate PulseAudio or PipeWire virtual source. A
minimal fake source:

```bash
sudo apt-get install -y pulseaudio
pactl load-module module-null-sink sink_name=virtmic
pactl load-module module-virtual-source master=virtmic.monitor
```

Rehearse audio on its own, and if the demo depends on it, check with `ffprobe`
that the file the app saved actually contains an audio stream.

## Delivery

The runner leaves the MP4 and evidence under `/tmp`. Getting it onto a PR is in
[../SKILL.md](../SKILL.md).
