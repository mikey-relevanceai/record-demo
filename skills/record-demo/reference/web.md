# Recording a web app

The mechanism for recording a **web app**: headless Chromium under Playwright,
with a DOM cursor drawn into the page so the motion is visible. The capture never
touches the operator's screen, so this is the cheapest surface to record on.

Read the conduct rules in [../SKILL.md](../SKILL.md) first. This file assumes them
and covers only what is specific to the browser.

## The tool

The `pr-recorder` tool ships **inside this skill**, in the skill directory's
`web/` folder: a Playwright driver plus a `human.ts` motion layer that injects a
visible cursor, walks eased Bezier mouse paths, types with a human cadence, and
transcodes the captured WebM to MP4 with ffmpeg. The reference and the tool are
one self-contained unit.

Recording runs through a **portable copy** installed at `~/.pr-recorder` with a
`pr-record` command in `~/.local/bin`, so it works from any directory.

**If `pr-record` is missing**, install it from the skill directory -
`.claude/skills/record-demo` for a project skill, `~/.claude/skills/record-demo`
for a personal one:

```bash
bash <skill-dir>/web/install-local.sh
```

Needs pnpm, and ffmpeg on PATH (`brew install ffmpeg`).

The installed copy does not update itself. A stale one can silently lack newer
recorder features, such as the head trim or warmup, and takes then come out full
of load time. Re-run the installer after updating the skill.

## Steps

1. **Have your app running locally** on the branch whose change you're
   recording, e.g. at `http://localhost:3000`. If the flow needs a signed-in
   user, the demo script or the app's own setup must provide that; the recorder
   starts from a fresh browser context.

2. **Write a demo script.** Default-export `async ({ page, human }) => { ... }`.
   Drive controls the way a person does - find them by **visible role/text**
   (`page.getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`), never CSS
   selectors or test-only attributes. Do not add hooks to the frontend for a
   recording; these scripts are throwaway and per-PR. Copy
   `~/.pr-recorder/demo.example.ts` as a starting point.

   `human` helpers: `goto(url, { ready })`, `waitFor(locator)`,
   `moveTo(locator)`, `click(locator)`, `type(locator, text, { clear })`,
   `scrollIntoView(locator)`, `settle(ms?)`, `caption(text)` /
   `clearCaption()`, `moveToPoint(x, y)`.

   **Never wait on the clock.** Pass the first control you'll interact with as
   `goto`'s `ready` locator, or call `human.waitFor(...)` - both continue the
   instant the app is usable and fail loudly (naming the locator) instead of
   driving a half-built page.

   ```ts
   await human.goto("/settings", {
     ready: page.getByRole("button", { name: "Save" }),
   });
   ```

   **Probe the real labels first**, as [../SKILL.md](../SKILL.md) describes. In
   the browser a missing locator is costly: the first `human` call that moves to
   it hangs on `scrollIntoViewIfNeeded` for 30s and then the step fails.

3. **Record.**

   ```bash
   PR_RECORDER_BASE_URL=http://localhost:3000 \
   PR_RECORDER_WARMUP=/settings \
   PR_RECORDER_OUT=./pr-demo.mp4 \
   pr-record ./my-demo.ts
   ```

   The video is **automatically trimmed** back to the moment the first page
   finished loading (less a half-second lead-in), so app boot never reaches the
   viewer. `PR_RECORDER_TRIM_HEAD=<seconds>` overrides that - including `0` to
   keep the load on screen, when the load is what the PR changed.

   `PR_RECORDER_WARMUP` loads pages in a throwaway browser context before
   capture starts, so a dev server's first compile of a route happens off
   camera. Give it a comma-separated list of the paths the demo visits, or `1`
   for just `/`. It saves wall-clock on a freshly started dev server; it does
   **not** speed up the in-page load (fresh context, cold browser cache), so
   it's a complement to `ready`, not a substitute.

   Other useful env: `PR_RECORDER_HEADED=1` to watch while tuning;
   `PR_RECORDER_SPEED` (>1 slower) and `PR_RECORDER_JITTER` to tune the motion
   feel; `PR_RECORDER_KEEP_WEBM=1` to keep the intermediate capture.

   Watch stderr for `[human] waited Ns for <locator> - warm up?`: that's dead
   time you paid, and (if the run was cold) a hint to add the path to
   `PR_RECORDER_WARMUP`.

   On a thrown demo the recorder still flushes the partial video **and exits 1**,
   so a written MP4 is not proof of success. Capture stderr and check for
   `[record] demo threw: <message>` - it names the step that failed (usually a
   locator that matched nothing). Fix the locator and re-run.

4. **Verify it did the right thing.** A clean exit only means the script ran, not
   that the feature worked. Confirm both:
   - **Visual:** extract frames and read the key ones -
     `mkdir -p /tmp/pr-demo-frames && ffmpeg -i pr-demo.mp4 -vf fps=1 /tmp/pr-demo-frames/f_%02d.png` - to check the change is
     on screen (e.g. the right option selected).
   - **Functional:** check the actual persisted state, not just the UI: read it
     from your app's database or API.

   Then check the codec, dimensions and duration with `ffprobe`.

5. **Attach the MP4 to the PR** with `gh pr comment --attach`, per
   [../SKILL.md](../SKILL.md).
