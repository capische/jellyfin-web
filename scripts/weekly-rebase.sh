#!/usr/bin/env bash
set -euo pipefail

old_master=$(git rev-parse refs/remotes/origin/master)
old_mod=$(git rev-parse refs/remotes/origin/jellyfin-mod)
upstream=$(git rev-parse refs/remotes/upstream/master)
base=$(git merge-base "$old_master" "$old_mod")

git switch --detach "$old_master"
if ! git merge-base --is-ancestor "$upstream" HEAD; then
    git rebase "$upstream"
fi
new_master=$(git rev-parse HEAD)

git switch --detach "$old_mod"
git rebase --onto "$new_master" "$base"
new_mod=$(git rev-parse HEAD)
git merge-base --is-ancestor "$new_master" "$new_mod"
git diff --check "$old_master" "$new_master"
git diff --check "$old_mod" "$new_mod"

{
    echo "old_master=$old_master"
    echo "old_mod=$old_mod"
    echo "upstream=$upstream"
    echo "new_master=$new_master"
    echo "new_mod=$new_mod"
    if [[ "$old_master" == "$new_master" && "$old_mod" == "$new_mod" ]]; then
        echo 'changed=false'
    else
        echo 'changed=true'
    fi
} >> "$GITHUB_OUTPUT"

{
    echo '### Weekly fork rebase'
    echo
    echo "- Upstream: \`$upstream\`"
    echo "- Production master: \`$old_master\` → \`$new_master\`"
    echo "- JellyfinMod: \`$old_mod\` → \`$new_mod\`"
} >> "$GITHUB_STEP_SUMMARY"
