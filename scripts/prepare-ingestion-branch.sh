#!/usr/bin/env bash
set -euo pipefail

edition_id=${1:?usage: prepare-ingestion-branch.sh EDITION_ID}
branch="automated-edition/$edition_id"
remote_ref="refs/heads/$branch"

# Always base a retry on the current remote main, rather than on a potentially
# stale checkout or on files left behind by an earlier workflow attempt.
git fetch --no-tags origin main
main_sha=$(git rev-parse refs/remotes/origin/main)
push_lease=

if remote_line=$(git ls-remote --exit-code --heads origin "$remote_ref"); then
  remote_sha=${remote_line%%[[:space:]]*}
  # The explicit refspec and lease constrain the force update to this one
  # deterministic automation branch. In particular, main cannot be updated.
  git push \
    --force-with-lease="$remote_ref:$remote_sha" \
    origin "$main_sha:$remote_ref"
  push_lease=$main_sha
fi

git switch -C "$branch" "$main_sha"

if [[ -n ${GITHUB_OUTPUT:-} ]]; then
  printf 'branch=%s\npush_lease=%s\n' "$branch" "$push_lease" >> "$GITHUB_OUTPUT"
fi
