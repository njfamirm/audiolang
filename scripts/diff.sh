#!/usr/bin/env bash
# Print a clean unified diff of the working tree, excluding noise that wastes
# tokens in AI chats: lockfiles, build output, generated diff artifacts and
# binaries. Also saves the same text to ./ai-diff.patch. Invoke via /diff.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository — nothing to diff." >&2
  exit 0
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

render() {
  echo "=== changed files ==="
  git --no-pager diff --stat -- . "${EXCLUDES[@]}"
  echo
  echo "=== diff ==="
  git --no-pager diff --no-color -- . "${EXCLUDES[@]}"
}

if git --no-pager diff --quiet -- . "${EXCLUDES[@]}"; then
  echo "No changes in tracked source files."
  : > ai-diff.patch
  exit 0
fi

render | tee ai-diff.patch
lines=$(wc -l < ai-diff.patch | tr -d ' ')
echo
echo "(saved to ai-diff.patch — ${lines} lines)"
