# record-demo

An agent skill for recording a demo video of a UI change, to attach to the pull
request that makes it.

A reviewer who can watch a change working learns more than one reading a
description of it. This skill lets a coding agent produce that video itself. The
recording looks like a person using the app - curved cursor paths, typing one key
at a time, deliberate pauses - rather than a script teleporting through the UI,
so it can be watched at normal speed and followed.

It covers two surfaces:

- **Web apps**, through headless Playwright. Nothing appears on your screen.
- **Electron apps**, through a virtual X11 display on Linux (with a bundled
  runner) or single-window capture on macOS (guidance, no runner yet).

The skill is mostly conduct rules learned from takes that went wrong: rehearse
before the take you keep, probe the real control names, wait on controls rather
than the clock, and check the frames before trusting the file. The tooling it
ships does the mechanical part.

## Requirements

- Node.js, `pnpm` and `ffmpeg` on `PATH`.
- A local build of your app running the branch being recorded. The skill does not
  start your app, sign in or seed data; it records whatever state you give it.
- For Electron on Linux: `Xvfb`, `openbox`, `xdotool` and `xdpyinfo`.
- For pushing the video to a PR: the GitHub CLI, `gh` 2.99.0 or later, for
  `--attach`.

## Install

### Claude Code

Install it as a plugin (Claude Code 2.1.275 or later):

```text
/plugin install record-demo --marketplace mikey-relevanceai/record-demo
```

or from a terminal, adding `--scope project` to share it with everyone working in
the current repository:

```bash
claude plugin install record-demo --marketplace mikey-relevanceai/record-demo
```

Alternatively, copy the skill folder in yourself:

```bash
git clone https://github.com/mikey-relevanceai/record-demo.git
mkdir -p ~/.claude/skills
cp -R record-demo/skills/record-demo ~/.claude/skills/   # every project
# or: cp -R record-demo/skills/record-demo <project>/.claude/skills/   # one project
```

### Codex

Codex reads skills from `.agents/skills/` in a repository or `~/.agents/skills/`
for your user:

```bash
git clone https://github.com/mikey-relevanceai/record-demo.git
mkdir -p ~/.agents/skills
cp -R record-demo/skills/record-demo ~/.agents/skills/   # every project
# or: cp -R record-demo/skills/record-demo <project>/.agents/skills/   # one project
```

Codex picks up new skills automatically; restart it if this one does not appear.

### Committing it to a project

The skill folder carries its own `.gitignore`, so the recorders' `node_modules`
and any videos written inside it stay out of your project's history.

## Use

Ask for it in plain words - "record a demo of this change for the PR" - and the
agent picks the skill up. To invoke it explicitly:

| Agent                            | Command                    |
| -------------------------------- | -------------------------- |
| Claude Code, installed as plugin | `/record-demo:record-demo` |
| Claude Code, copied in           | `/record-demo`             |
| Codex                            | `$record-demo`             |

The agent will need a few facts about your app. It looks for them in the project
and asks for anything it cannot find:

- **Web:** the URL the app is running at, e.g. `http://localhost:3000`.
- **Electron:** the directory to launch the app from, the main window's exact
  title, and, if it is not an electron-vite dev server, the command that starts
  the app with remote debugging.

The full rules and mechanics are in
[`skills/record-demo/SKILL.md`](skills/record-demo/SKILL.md) and its
[`reference/`](skills/record-demo/reference) folder.

## Updating

Plugin installs update with `claude plugin update record-demo`, or from `/plugin`. For a copied install, pull this
repository and copy the folder again. If you have run the web recorder's
`install-local.sh`, re-run it too: the copy it installs at `~/.pr-recorder` does
not update itself.
