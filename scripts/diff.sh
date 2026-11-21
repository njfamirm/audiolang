#!/usr/bin/env bash
# Collect a clean unified diff of the working tree into ./ai-diff.patch,
# excluding noise that wastes tokens in AI chats: lockfiles, build output,
# generated diff artifacts and binaries.
#
# Default: write the file and print only a one-line summary (safe to inject
# into an agent prompt). Pass --print to also dump the full diff to stdout.
set -euo pipefail
cd "$(dirname "$0")/.."

PRINT=0
[[ "${1:-}" == "--print" ]] && PRINT=1
OUT=ai-diff.patch

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository — nothing to diff." >&2
  exit 1
fi

# Make untracked (non-ignored) files visible to `git diff`.
git add -A -N -- . >/dev/null 2>&1 || true

EXCLUDES=(
  ':(exclude)package-lock.json'
  ':(exclude)yarn.lock'
  ':(exclude)pnpm-lock.yaml'
  ':(exclude)bun.lockb'
  ':(exclude)*.lock'
  ':(exclude)audiolang.diff'
  ':(exclude)ai-diff.patch'
  ':(exclude)*.min.js'
  ':(exclude)*.map'
  ':(exclude)web/dist/**'
  ':(exclude).opencode/PROGRESS.md'
)

if git --no-pager diff --quiet -- . "${EXCLUDES[@]}"; then
  : > "$OUT"
  echo "$OUT: no changes"
  exit 0
fi

{
  echo "=== changed files ==="
  git --no-pager diff --stat -- . "${EXCLUDES[@]}"
  echo
  echo "=== diff ==="
  git --no-pager diff --no-color -- . "${EXCLUDES[@]}"
} > "$OUT"

files=$(grep -c '^diff --git ' "$OUT" || true)
lines=$(wc -l < "$OUT" | tr -d ' ')

if [[ $PRINT -eq 1 ]]; then
  cat "$OUT"
else
  echo "$OUT: ${files} file(s) changed, ${lines} lines"
fi
