# Recording on macOS

The bundled runner is Linux only: it needs Xvfb and `xdotool`, neither of which
exists here. macOS does not need them, because it can record **a single window
by id** rather than a display. This file is the groundwork for that path.
There is no macOS runner in this skill; the approach below has been driven
end to end against a real Electron app, within the limits noted below.

## How to read this file

Claims are one of three things, and they are marked:

- **[proven]** - run on a Mac against a real Electron app and the result
  inspected. Where it was proven on a **TextEdit** window instead, it says so,
  because Electron may differ.
- **[from source]** - read out of source code (Electron's, Chromium's or the
  app's own) and not run. Treat as a strong lead, not a tested recipe.
- Unmarked prose is ordinary platform background.

The path has been run end to end against a packaged app: launched with an
isolated profile, recorded by window id, driven over CDP, and transcoded to a
1920x1080 MP4. Dev builds of a branch have since been recorded the same way on
a DeskPad display, including typed input **[proven]**. Native panels are still
untested.

## Display isolation

macOS has no Xvfb, no public API for creating a Space or moving a window to
one, and no built-in virtual display. That should not matter, because
`screencapture -v -l<windowid>` records a window's own contents wherever it is.

Spaces are not as closed as the public surface suggests, though. SkyLight ships
a private Objective-C operation-class hierarchy that works from an ordinary
third-party process **with SIP enabled** - `SLSBridgedSpaceCreateOperation`,
`SLSBridgedSpaceDestroyOperation`, and, the one that matters here,
`SLSBridgedMoveWindowsToManagedSpaceOperation` (`-initWithWindows:spaceID:`).
Measured end to end on macOS 26.6. The three findings below decide whether
this is usable:

- **The legacy C functions everyone cites are dead.** `SLSSpaceCreate`,
  `SLSMoveWindowsToManagedSpace` and `SLSAddWindowsToSpaces` still resolve
  through `dlsym`, still return without error, and do nothing. That is where
  the received wisdom of "you must disable SIP" comes from, and it is out of
  date.
- **The caller must be a real GUI app.** In a plain CLI binary every bridged
  operation is inert, failing exactly like success. It needs
  `NSApplicationLoad()`, `TransformProcessType(kProcessTransformToForegroundApplication)`
  and `[NSApplication sharedApplication]`.
- **Accessibility is not required**, and the read side needs no permission at
  all. `CGWindowListCopyWindowInfo` with option `0` enumerates windows on
  desktops you are not currently viewing, so a window stays addressable after
  it moves.

What this would buy a recorder is somewhere to put the demo window that is not
the operator's current desktop, which is the one problem window capture does
not solve on its own. It needs a small GUI helper - Electron's main process
could only reach these classes through a native addon, and the skill does not
modify the app for a demo.

**It does not work, and that closes the idea [proven].** A window moved to
another desktop records as **pure black**: max luma 16 (the video-range black
floor) for the whole take, against 244 for the same window on the active
desktop. The app was driven over CDP during the capture and did transition from
its welcome screen to a workspace, so the renderer was live throughout - the
window server simply does not hand pixels to `screencapture` for a window on an
inactive desktop. `CGWindowListCopyWindowInfo` still lists the window, so this
fails as a black recording rather than as an error.

So Spaces are reachable, and reaching them does not help: use them to park a
window and you record nothing. Keeping the window off the operator's screen has
to be solved on the active desktop instead, which is what the off-screen result
below is for.

Two properties **[proven, TextEdit]** on macOS 26.6:

- **Occlusion is ignored.** A window completely covered by another recorded its
  own content, with its native title bar, rounded corners and shadow, over
  black. No part of the covering window appeared in the frame.
- **Being pushed off the display is ignored.** The same window was asked to
  move to `{-3000, 2000}`; macOS clamped it to `-660,1297`, which is past the
  bottom of a 1117pt-tall display. It still recorded in full. How much of it
  remained visible was not checked.

**What this does not buy you.** Capture stops the operator's other windows
entering the frame, and that much held. It does **not** keep the demo out of
their way: in the one attempt made, the launched window joined the operator's
tiling layout, displaced a window they were using, and raised a permissions
prompt in front of them. Solve window placement separately from capture.

## Record on a virtual display (recommended, not required)

**Recording works without this.** The window sits on a real display and records
perfectly well there, whether it is occluded or pushed out to the screen edge.
What it costs is that the window is in the operator's way for the length of the
take, and their window manager treats it like any other window. On an unattended
machine, or when nobody is using the screen, that costs nothing and this section
can be skipped.

Install a virtual display when someone is working on the machine. It is the only
place a window can sit genuinely out of the way and still capture: Spaces record
black (above), and off-screen leaves the window in the tiling layout.

`brew install --cask deskpad` creates a virtual display - a real display as far
as the window server is concerned, with no panel behind it. Measured: a window
moved there records with **max luma 242-247**, against 16 on an inactive Space,
and a change driven over CDP mid-capture appears in the frames, so the capture
is live rather than a still.

Set it to a **1:1 1920x1080 mode** and the delivery format needs no scaling at
all. Enumerate modes with `CGDisplayCopyAllDisplayModes` and pick the one whose
logical size equals its `pixelWidth`/`pixelHeight`, then apply it with
`CGDisplaySetDisplayMode` under `CGBeginDisplayConfiguration` /
`CGCompleteDisplayConfiguration(.forSession)` - `forSession`, because this must
not outlive the recording. A display capture of that display then comes out
natively 1920x1080 h264 **[proven]**.

Four things about it that will cost time otherwise:

- **`screencapture -D` takes an index, not a `CGDirectDisplayID`.** Find it by
  capturing a still from each index and matching the dimensions.
- **Restarting DeskPad changes everything.** The display gets a new id, the `-D`
  index can move, and the mode reverts. Re-derive all three on every start
  rather than caching them.
- **DeskPad's own Screen Recording permission is not needed** and is better left
  ungranted **[proven]** - captures worked throughout with its prompt
  unanswered. Granted, it mirrors the virtual display into an ordinary window;
  ungranted, that window stays blank and the display is genuinely invisible.
- **Dialogs land there and nobody sees them.** A system permission prompt and a
  System Settings window both opened on the virtual display during setup, where
  they were invisible to the operator. If something seems to be waiting, look
  for windows whose origin falls inside the virtual display's bounds.

Display capture includes the **menu bar**, which is the operator's own. Capture
the window by id instead if that matters, at the cost of the exact dimensions.

## Launching an instance to record

A pull request's demo needs that branch's code, so launch a dev build from the
branch's checkout. Run your app's dev launch command from the app's directory
(the Linux runner calls these `DEMO_LAUNCH_CMD` and `DEMO_APP_DIR`). For
electron-vite **[proven]**:

```bash
./node_modules/.bin/electron-vite dev --remoteDebuggingPort <port> -- \
  --user-data-dir=<short disposable dir>
```

Everything after `--` reaches Electron. A wrapper command that forwards no
extra arguments cannot pass the profile or the port, so check yours before
relying on it. Keep `--user-data-dir` short: see the socket landmine below.

The installed app launches the same way, for a take that needs no unmerged code
**[proven]**:

```bash
/Applications/<App>.app/Contents/MacOS/<App> \
  --user-data-dir=<disposable> --remote-debugging-port=<port>
```

A second instance ran alongside one the operator was already using, and CDP
answered on `/json/version` about two seconds after launch **[proven]**. The
reason is presumably that Electron's single-instance lock keys on the user data
directory; a launch without `--user-data-dir` was not attempted, so treat the
flag as required until someone checks.

**Seed the profile before the first launch, not after.** A fresh user data
directory opens on whatever the app shows on first run, so write any state the
demo depends on into it before the app starts.

**The disposable profile is not the whole story.** State the app writes outside
its user data directory survives wiping the profile, so a demo that depends on
an empty state passes on the first run and fails on the second **[proven]**.
Clear the artefacts a previous take created between takes, and never assume the
profile is the only state.

**Pass resolved paths.** `/tmp` is a symlink to `/private/tmp`. The app stored a
path as written while git reported the resolved one, so a repository created
under `/tmp` came straight back as missing **[proven]**. Pass `realpath` output.

**Seeded window bounds did not place the window.** Seeded bounds were ignored by
a dev build **[proven]**. Move the window once it is open and confirm the result
from the window list.

An app with helper windows exposes each as its own page over CDP. Select the
main window deliberately - the Linux runner takes the page whose title is
exactly `DEMO_WINDOW_TITLE` and whose URL has no `#` fragment; apply the same
test here: picking a helper window silently yields a tiny viewport,
460x120 on the first try here **[proven]**.

## Finding the window id

`screencapture -l` takes a `CGWindowID`, which `CGWindowListCopyWindowInfo`
supplies. Filter to `kCGWindowLayer == 0`, and match on `kCGWindowOwnerPID`
rather than `kCGWindowOwnerName` - an operator running their own copy of the
app gives two processes with the same name **[proven]**.

```swift
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as! [[String: Any]]
```

`swiftc` was present at `/usr/bin/swiftc` on a machine with full Xcode.

## Capture

```bash
screencapture -v -l<windowid> -V <seconds> -x <out.mov>
```

`-V` bounds the take and `-x` silences the shutter **[proven]**. `-C` (cursor)
and `-k` (click highlights) are documented in `screencapture --help` but were
never confirmed to do anything under `-v -l`, and `-C`'s own help text scopes
it to non-interactive modes. `-D<display>` and `-R<x,y,w,h>` record a display
or a rect instead.

`ffmpeg -f avfoundation -capture_cursor 1 -i "<index>:none"` records a whole
display **[proven]**, and its device list numbers displays after the cameras.
ffmpeg exposes no window option, so single-window capture is `screencapture`
only.

Window capture returns backing pixels and includes the shadow: a 700x450 point
window came back 1536x1036 in one take and 2192x1022 in another, and that
difference is unexplained **[proven]**. Do not assume the capture matches the
window's reported geometry - read the real dimensions off the file and scale
from those. macOS gives three coordinate spaces where X11 gives two: CSS
points, accessibility points, and capture pixels.

Prefer window capture over display capture, which records whatever else is on
that screen. The trade is that **the app opening cannot be filmed**: a window id
exists only once the window does, so capture cannot start before the app opens.
Use a display capture for a take that must show the app launching.

## Finishing the take

`screencapture` writes a `.mov` at backing-pixel size, which is neither the
container nor the dimensions the skill delivers. Convert and verify before
handing anything over:

```bash
ffmpeg -y -i <take.mov> \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,\
pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart <out.mp4>
```

Then run the same ffprobe check and visual inspection the Linux path uses - see
"A written file is not proof" and "Verify the demo, not the script" in
[SKILL.md](../SKILL.md).

## Input

A parked or buried window cannot receive a real pointer, so drive the renderer
over CDP and draw the cursor into the page. The web recorder's `human.ts`
(`../web/human.ts`) supplies the motion - eased Bezier paths, human typing cadence - and its
`click`, `type` and `settle` work unchanged here **[proven]**. Keep real CGEvent
input (`cliclick`) for a window deliberately left on-screen and frontmost;
that combination has not been tried.

**`human.installCursor()` does not work in Electron [proven].** It registers the
cursor through `page.addInitScript`, which only runs at the start of the _next_
navigation. The Electron renderer is already loaded and never navigates, so the
script never executes and the recording has no cursor in it - while every click
still lands, so nothing fails and the loss is invisible until you watch the
video back. Evaluate an equivalent overlay straight into the live document
instead: a fixed-position element on `document.documentElement` at a high
z-index, moved from a capturing `mousemove` listener, which is what CDP's
synthetic events dispatch.

**This deliberately overrides the skill's rule against invisible DOM input**
(as stated in [desktop-linux-scripted.md](desktop-linux-scripted.md) and
[desktop-linux-interactive.md](desktop-linux-interactive.md)). That rule exists
because Playwright's synthetic events do not move the X11 pointer that
`x11grab` records, so the video would show no cursor.
Here the cursor is drawn into the page instead, which is visible in the
recording, and a real pointer is unavailable anyway once the window is parked.
Keep real input for a window left on-screen and frontmost.

## Native panels

**[proven, TextEdit]** with another app frontmost throughout: TextEdit's
`File > Open...` panel was a window of **TextEdit's own process**, carrying its
own window id and appearing in its accessibility tree. Its full button list and
enabled states were readable, and its Cancel button was pressed through an
accessibility action - the panel closed and focus never moved.

**This may not transfer to an Electron app, and it is the first thing to
test.** Electron's `dialog.showOpenDialog(parentWindow, ...)` attaches the panel
to its parent, which on macOS presents as a **sheet** rather than a separate
window. If the app's panel is a sheet, two things change: it is addressed as
`sheet 1 of window` rather than as a window, and `screencapture`'s `-a` flag ("do not include
windows attached to selected windows") implies a sheet is captured **by
default**, so the single-window capture may already contain it.

What was **not** established either way: navigating a panel to a chosen folder.
Selecting a row from the background left the Open button disabled, but the
27-row outline in question was probably the panel's sidebar rather than its
file list, so that is an inconclusive result and not a negative one.

Before driving a panel at all, look for a route around it: a command-line
argument or seeded profile state that lands in the same place. A folder argument
skipped a first-run gate, and a second launch against the same profile handed
the folder to the running instance without a panel **[proven]**.

## Landmines

- **A long profile path breaks a Unix socket bound under it [proven].** macOS
  caps a Unix socket path at 104 bytes including its terminating byte. An app
  binding a socket inside a profile under a session scratchpad (200-208 bytes)
  failed with a bare `listen EINVAL`. A dev build with no `--user-data-dir`,
  run from a checkout whose folder name is long, is over the cap too (132 bytes
  measured). A short symlink does not help: Chromium resolves `--user-data-dir`
  to its real path. Use a short real directory such as `/tmp/demo-ud`.
  Chromium's own `SingletonSocket` is unaffected; it is a symlink to a socket
  under `$TMPDIR`.
- **A locked screen records black [proven].** While the session is locked,
  `screencapture` writes black frames and the window and display lists come back
  empty, so the take fails as a wrong recording or a missing window rather than
  an error. Check before a take, and wait for an unlock in a background loop
  rather than retrying:

  ```python
  # exits 0 while the screen is locked, 1 once it is unlocked
  import ctypes, ctypes.util
  q = ctypes.cdll.LoadLibrary(ctypes.util.find_library("ApplicationServices"))
  cf = ctypes.cdll.LoadLibrary(ctypes.util.find_library("CoreFoundation"))
  q.CGSessionCopyCurrentDictionary.restype = ctypes.c_void_p
  cf.CFDictionaryGetValue.restype = ctypes.c_void_p
  cf.CFDictionaryGetValue.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
  cf.CFStringCreateWithCString.restype = ctypes.c_void_p
  cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
  cf.CFBooleanGetValue.argtypes = [ctypes.c_void_p]
  d = q.CGSessionCopyCurrentDictionary()
  v = cf.CFDictionaryGetValue(d, cf.CFStringCreateWithCString(None, b"CGSSessionScreenIsLocked", 0x08000100))
  raise SystemExit(0 if (bool(v) and bool(cf.CFBooleanGetValue(v))) else 1)
  ```

- **A blank window is a crashed renderer, not a slow one [proven].** A window
  showing only its title-bar buttons, with `document.readyState` `complete` and
  an empty root element, has stopped. Enable `Runtime` over CDP, which replays the
  exceptions already thrown, and read them rather than waiting for a control to
  appear. `Module "node:crypto" has been externalized for browser compatibility`
  means renderer code imported a Node-only module; typecheck, lint and
  Node-side tests can all pass that.
- **Text drawn to a canvas is not queryable.** Check how a pane renders before
  waiting on its text over CDP.
- **A live-updating pane can record as solid black [proven].** It stayed black in
  the capture while it was running, and the cause was not isolated. Check the
  frames for that pane before trusting the take.
- **Probably never reload while capturing.** An app that answers
  `will-prevent-unload` with `showMessageBoxSync` raises a blocking box that
  CDP cannot dismiss **[from source]**. The hang has not been observed.
- **The capture does not stop when the driver does [proven].** `screencapture
-v` runs until its `-V` ceiling or a signal, so the take keeps rolling through
  however long the script leaves the app idle. Stopping it early
  with a signal is unreliable from a script: a capture started with `&` ignored
  SIGINT, and SIGTERM ended it before it had written the file **[proven]**. A
  non-interactive shell starts background jobs with SIGINT ignored, which is the
  likely cause. Size `-V` to the flow, let it end on its own, and trim to the
  action rather than shipping the tail.
- **Get the capture's pid from `pgrep -n -x screencapture`, not the shell's
  `$!` [proven].** `$!` gave the wrong pid here, so the stop signal missed. A
  capture left running from an earlier attempt is worse than a stray process:
  it still owns the output path, so the next take silently produces a recording
  of the previous, now-dead window. Check for strays before starting.
- **Name buttons carefully.** A sidebar label can be a section toggle rather
  than a destination, and clicking it collapses the section on camera. Confirm
  what a control does in a rehearsal before it goes in a take.
- **`window.confirm` is not a native dialog.** It is a Chromium dialog
  **[from source]**, so it should be drivable with
  `Page.javascriptDialogOpening` and `Page.handleJavaScriptDialog`.
- **A tiling window manager silently wins.** With Amethyst running, `set size`
  and `set position` returned no error and had no effect, and the window stayed
  where it had been tiled **[proven]**; the operator reported a window of
  theirs being displaced when the demo instance appeared. Give the app a float
  rule before a take, and read a geometry set that does nothing as the window
  manager rather than a bad script. On a DeskPad display, separate `position`
  and `size` sets took effect with Amethyst still running **[proven]**.
- **A combined AppleScript geometry set failed.** Setting `{position, size}` as
  one record returned `-10003` while setting `position` and `size` separately
  worked **[proven]**. Whether the cause is AppleScript or the window manager
  was not isolated.
- **The screen grant is cached per process until relaunch**, and under
  `electron-vite dev` it attaches to the unsigned Electron dev binary rather
  than to the app **[from source]**. That is the dev build the launch recipe above
  starts.

## Prerequisites and safety

The bundled runner's own dependencies are not needed on macOS; nothing here uses
them. `screencapture`, `osascript` and `swiftc` ship with the system.

- **Required:** `ffmpeg`, for trimming and inspecting the take.
- **Recommended:** `brew install --cask deskpad`, so the demo window can live
  somewhere the operator is not looking. Skip it on an unattended machine, or
  when nobody minds a window appearing for the length of the take.

**Never seed, edit, or delete the operator's real profile.** The operator may
be signed in and using their own instance at the same time. Every launch gets a
disposable `--user-data-dir`, and any seeding applies to that directory only.
On macOS the real profile is under `~/Library/Application Support/<App>`, not
the `~/.config/<App>` path the Linux safety rules name.

## Permissions

Screen Recording and Accessibility are both required, and both are granted once
through System Settings against the process that runs the recorder. On the
machine used here both were **already granted**, so the granting flow was never
exercised.

Probe them before a take rather than discovering it mid-recording **[proven,
both returned real data]**:

```bash
screencapture -x -t png -D 1 /tmp/probe.png   # Screen Recording
osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'   # Accessibility
```
