#!/usr/bin/env bash
set -euo pipefail

branch="${1:-historical-illustration-backfill}"
if git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null 2>&1; then
  echo "Refusing to overwrite existing branch $branch" >&2
  exit 1
fi
git switch --create "$branch"
