---
name: record-demo
description: >-
  Record a human-paced MP4 walkthrough of a UI change, to attach to a PR.
  Covers web apps through headless Playwright, and Electron desktop apps through
  a real display or window capture. Holds the rules for conducting a recording;
  the mechanism for each surface is in reference/.

  TRIGGER when: The user wants to record, capture, or demo a UI change as a video
  or screen recording, show functionality in use for a PR, or make a walkthrough
  clip of their web or Electron app.

  DO NOT TRIGGER when: A static screenshot is enough, the user only wants to run
  tests rather than record a demo, or the clip is a polished film for docs or
  marketing.
---

# Record a demo

Records a walkthrough that looks like a person using the app - curved cursor
paths, per-keystroke typing, deliberate pauses - rather than a machine
teleporting through the UI.

**The rules below apply to every recording, on every surface.** They are here
rather than in the platform references because each one was broken once and cost
a take, and because a rule kept next to only one mechanism is a rule the next
person does not read.

## Pick the surface

- **The web app** - [reference/web.md](reference/web.md). Headless Chromium under
  Playwright with a DOM cursor drawn into the page. Nothing reaches the
  operator's screen, so prefer this whenever the change is visible in a browser.
- **The desktop app** - [reference/desktop.md](reference/desktop.md). Needed when
  the demo requires the real Electron shell: native menus, file dialogs, tray,
  multiple windows, or anything outside the renderer. Linux has a bundled runner;
  macOS records a single window by id and has no runner yet.

If the change is visible on both, record the web app.

## Inputs

Establish these before the first take. Read them from the project where you can
(its README, `package.json` scripts, the Electron main process); ask the user for
anything you cannot find rather than guessing.

- **Web:** the URL of the running app, passed to the recorder as
  `PR_RECORDER_BASE_URL` (e.g. `http://localhost:3000`). The app must already be
  running from the checkout that has the change, uncommitted edits included -
  a fresh checkout of the same branch will not have them, and git refuses to
  check one branch out twice. It must also be in whatever state the demo needs.
  If the flow requires a signed-in user or seeded data, that is the project's
  setup to provide, not the recorder's - but confirm it before capture starts,
  or the take you get is of a sign-in screen.
- **Desktop:**
  - `DEMO_APP_DIR` - the directory the app's launch command runs in.
  - `DEMO_WINDOW_TITLE` - the exact title of the main window, used to find both
    the X11 window and the renderer page.
  - `DEMO_LAUNCH_CMD` - optional. A shell command that starts the app with
    remote debugging on `{port}`. The default,
    `pnpm dev --remoteDebuggingPort {port} --noSandbox`, suits electron-vite.

## Where the skill lives

`<skill-dir>` in these docs means the directory this `SKILL.md` was loaded
from. In Claude Code it is `${CLAUDE_SKILL_DIR}`, which works for project,
personal and plugin installs alike. Elsewhere, use the path the skill was loaded
from - for Codex, a `.agents/skills/record-demo` folder in the repository or
`~/.agents/skills/record-demo`. Resolve it once and use the absolute path; the
scripts never assume where the skill is installed.

## Rehearse before the take that counts

Run the whole flow start to finish before you record the one you will ship. A
demo is discovered, not written: control names are not what you expect, a button
does something other than what it says, and a surface takes longer to settle
than you guessed. Finding that out on camera means the viewer watches you find
it out.

Rehearsal is cheap and re-recording is cheap. Shipping a take with a wrong turn
in it, or asking the reviewer to ignore the middle eight seconds, is not.

## Probe the real control names first

**Never script against a control you have not confirmed exists and does what
its name suggests.** Load the app once, dump the accessible names, and take a
screenshot:

```ts
const names = await page
  .getByRole("button")
  .evaluateAll((els) =>
    els.map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim()).filter(Boolean),
  );
console.log(JSON.stringify(names));
await page.screenshot({ path: "/tmp/probe.png" });
```

Then **read the screenshot**. The dump tells you a name exists; only the picture
tells you what the control is. Four ways this bites:

- **A name that is not what you would guess.** A switcher's accessible name was
  the currently selected item's name, not "Select project".
- **A name that is not what it sounds like.** A `Files` button in a sidebar was
  a section toggle, so clicking it collapsed the section rather than navigating
  anywhere. That shipped into a take.
- **A name that is part of another name.** `getByLabel("First message")` also
  matched a nearby option whose label contained "first message", so the typing
  never reached the field and nothing failed. Pass `exact: true`, or match on
  role as well as name.
- **Something that looks like text but is not.** A picker heading read off a
  screenshot was an input's placeholder, so `getByText` could never match it.
  Confirm a locator resolves before scripting against it.

When several elements share a name - an item appears in the sidebar, the page
header and a breadcrumb - scope with `.first()`.

## Drive it the way a person would

Find controls by visible role or text (`getByRole`, `getByText`, `getByLabel`,
`getByPlaceholder`). Never CSS selectors, never test-only attributes, and never
add a hook to the app so a recording can find something. Demo scripts are
throwaway and per-PR; keep them outside the repository.

**Never modify the app, the skill, or production code for a demo.** If the demo
needs the app to be different, the demo is wrong.

## Never wait on the clock

`waitForTimeout(9000)` to "let the editor load" is the single biggest cause of
watchable-but-boring demos. It always pays the worst case, and every one of
those seconds is in the file. Wait on the thing you are actually waiting for -
the first control you will interact with - so the demo continues the moment the
app is ready and fails loudly, naming the locator, instead of driving a
half-built page.

Fixed pauses are for pacing only: a beat after an action so a viewer can take
in what changed. Seconds, not tens of seconds, and never as a substitute for a
wait.

## A written file is not proof

Recorders flush a partial file when the script throws, and some capture tools
write on exit whatever happened. So the file existing means nothing on its own.
Before you believe a take:

- **Check the exit status and stderr**, and read the error if there is one - it
  usually names the locator that matched nothing.
- **Check for a stale capture already holding the output path.** A capture left
  running from an earlier attempt still owns the filename and will silently
  produce a recording of the wrong thing.
- **Check the frames.** Extract a contact sheet, the final frame, and any
  transition you are unsure of, and look at them.

## Verify the demo, not the script

A clean exit says the script ran, not that the feature worked. Confirm both:

- **Visual** - the change is on screen in the frames, in the state the request
  asked for.
- **Functional** - the persisted state actually changed, read from the database
  or the API rather than inferred from the UI.

When the claim is about layout - two panes side by side, a panel docked to an
edge - assert it from bounding boxes. Elements existing says nothing about
where they are.

Hold the final state for about three seconds so the viewer lands on it, then
verify the output file's codec, dimensions and duration with `ffprobe` before
handing it over.

## Keep the evidence

Keep failure logs, partial takes and screenshots until a take has succeeded.
Delete disposable state only after you have something you would ship. A
discarded intermediate is often the only record of why the take went wrong.

## Do not disturb the machine you are recording on

A local recording runs on a person's actual computer while they are using it.

- Give the app its own disposable profile and never touch the operator's real
  one.
- Seed whatever the demo needs **before** first launch, or first-run screens
  appear in front of them.
- Own every process you start, and stop it when you are done - especially
  captures, which keep running after the script returns.
- Start long-running processes as background tasks you hold a handle to, not
  with a trailing `&` inside a foreground wrapper: when the wrapper exits, it
  takes the server with it.
- Stop a process the way it expects to be stopped. A dev server killed with
  SIGKILL skipped its cleanup trap and left a rewritten env file and a stale port
  file behind. Signal the process you started and let it clean up. Never
  pattern-kill (`pkill -f next`): on a shared machine that takes out other
  people's servers too.
- Check which backend the app under demo talks to. One dev launcher defaulted to
  a production API unless told otherwise, so a demo's clicks would have written
  real data. Point it at a local or development backend before the first take.
- Preflight anything external the demo relies on - a CLI that must be signed
  in, a service that must be up - before taking a display or starting capture,
  so a missing dependency fails in a second rather than mid-take. Never perform
  a side-effecting action, such as sending a message, just to prove a tool
  launched.
- If a take needs their screen, their window manager or their input, say so and
  ask, rather than taking it.

## Getting the file onto a PR

`gh` uploads the video itself, since v2.99.0:

```bash
gh pr comment <number> --body-file ./note.md --attach ./demo.mp4
```

`--attach` also works on `gh pr create`, `gh pr edit`, and the `gh issue`
equivalents. It is repeatable, up to 50 files per command, and uploads to the
`user-attachments` CDN so GitHub renders the video inline.

Four things worth knowing:

- **Alt text is images only.** `'./shot.png#The error state'` sets alt text on an
  image; the same syntax on a video is refused with `cannot set alt text on
video`. Attach videos with a bare path.
- **A body that already references the local path gets rewritten.** Write
  `![alt](./demo.mp4)` where you want it and `gh` swaps in the uploaded URL;
  otherwise the attachment is appended to the end.
- **`gh pr edit --attach` with no body flag keeps the existing body** and appends
  to it, so a demo can be added to a PR description after the fact.
- **Check the version before relying on it.** On `gh` older than 2.99.0 there is
  no `--attach`, and the CDN is not reachable any other way through the API - so
  fall back to giving the person the file path to drag into the PR themselves.
