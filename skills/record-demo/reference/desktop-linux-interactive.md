# Interactive computer-use recording

Use this path only when an automation-capable computer-use surface can control
the real Electron desktop. If it can control only a browser preview, use the
scripted hybrid path instead.

This path is Linux only: it assumes Xvfb, an X11 display, and `xdotool`. On
macOS follow [desktop-macos.md](desktop-macos.md) instead.

## Process

1. Scout the app's renderer source for the requested controls, labels, and
   expected state changes.
2. Prepare the smallest safe fixture under `/tmp` or another disposable folder.
3. Start an isolated Xvfb display, Openbox, and per-run `XDG_CONFIG_HOME`. Record
   every owned PID or process group and reserve the display with an atomic
   `/tmp/desktop-demo-slot-$N` directory.
4. Start ffmpeg `x11grab` before launching Electron. Use 1920x1080 at 30 fps,
   H.264, and `yuv420p`.
5. Open and maximize the app through visible computer use. Perform the flow
   naturally, taking screenshots at uncertain transitions.
6. Rehearse without keeping the take. Reset only the disposable profile and
   fixture, then record the final take.
7. Stop ffmpeg with `SIGINT`, trim only dead time, and preserve the app opening
   plus about three seconds on the final state.
8. Run ffprobe and generate a contact sheet and final frame for inspection.
9. Tear down only the PIDs and process groups owned by this run.

## Input fallback

If the computer-use surface becomes unavailable mid-flow, source
`<skill-dir>/desktop/scripts/demo-helpers.sh`, export the run's `DISPLAY`, and use `move_click`,
`type_text`, and `press_key`. Rehearse each coordinate with a screenshot first.
Do not add application hooks or switch to invisible DOM input.

Native GTK dialogs are outside browser automation. Select visibly named fixture
folders with physical input and confirm the resulting app state before
continuing.

## When to switch paths

Switch to [desktop-linux-scripted.md](desktop-linux-scripted.md) if the take needs repeated attempts, exact
timing, semantic target assertions, or reliable recovery from changing layout.
