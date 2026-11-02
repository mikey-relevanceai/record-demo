#!/usr/bin/env bash
# Installs pr-recorder to a stable location outside any git worktree, so you can
# record demos from any project without the skill being checked out there.
# Re-run any time to update the installed copy. Run it from wherever the skill
# is installed:
#
#   bash <skill-dir>/web/install-local.sh
#
# Overridable:
#   PR_RECORDER_HOME     install dir   (default ~/.pr-recorder)
#   PR_RECORDER_BIN_DIR  wrapper dir   (default ~/.local/bin)
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${PR_RECORDER_HOME:-$HOME/.pr-recorder}"
BIN_DIR="${PR_RECORDER_BIN_DIR:-$HOME/.local/bin}"

echo "pr-recorder: installing $SRC -> $DEST"
mkdir -p "$DEST/demos"

# Copy the tool source only - never node_modules, captured video, or a local
# demo.ts (those are per-checkout / throwaway).
for f in record.ts human.ts demo.example.ts package.json tsconfig.json pnpm-lock.yaml README.md; do
  cp "$SRC/$f" "$DEST/"
done
if [ -d "$SRC/demos" ]; then
  cp -R "$SRC/demos/." "$DEST/demos/"
fi

echo "pr-recorder: installing dependencies + Chromium"
(cd "$DEST" && pnpm install --frozen-lockfile --ignore-workspace && pnpm exec playwright install chromium)

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "pr-recorder: WARNING - ffmpeg not found on PATH. Install it (brew install ffmpeg) or the WebM->MP4 step will fail."
fi

# A wrapper you can run from any project. It resolves a demo path argument
# against your current directory before handing off (the tool runs from $DEST,
# so a bare relative path would otherwise be looked up there).
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/pr-record" <<EOF
#!/usr/bin/env bash
set -euo pipefail
DEST="$DEST"
if [ "\$#" -ge 1 ] && [ -f "\$1" ]; then
  PR_RECORDER_DEMO="\$(cd "\$(dirname "\$1")" && pwd)/\$(basename "\$1")"
  export PR_RECORDER_DEMO
  shift
fi
exec pnpm --dir "\$DEST" record "\$@"
EOF
chmod +x "$BIN_DIR/pr-record"

echo
echo "pr-recorder: installed."
echo "  wrapper: $BIN_DIR/pr-record"
case ":$PATH:" in
  *":$BIN_DIR:"*) : ;;
  *) echo "  NOTE: $BIN_DIR is not on your PATH - add it, or call the wrapper by full path." ;;
esac
echo
echo "Record a flow against your running app:"
echo "  PR_RECORDER_BASE_URL=http://localhost:3000 \\"
echo "  PR_RECORDER_OUT=./pr-demo.mp4 \\"
echo "  pr-record ./my-demo.ts"
