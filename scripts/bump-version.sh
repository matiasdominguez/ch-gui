#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

NEW="${1:-}"
if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: scripts/bump-version.sh <major.minor.patch>" >&2
  exit 1
fi
OLD="$(jq -r '.version' src-tauri/tauri.conf.json)"
if [ "$OLD" = "$NEW" ]; then
  echo "✗ Version is already $NEW." >&2
  exit 1
fi
PKG="$(node -p "require('./package.json').version")"
if [ "$PKG" != "$OLD" ]; then
  echo "✗ package.json says $PKG but tauri.conf.json says $OLD. Make them match by hand first." >&2
  exit 1
fi
echo "▶ Bumping ch-gui $OLD → $NEW"

npm version "$NEW" --no-git-tag-version >/dev/null

# Only the first `version =` line in Cargo.toml belongs to [package].
# perl -i edits in place on macOS, where sed -i needs an extra argument.
perl -pi -e "s/^(  \"version\": )\"\Q$OLD\E\"/\$1\"$NEW\"/" src-tauri/tauri.conf.json
perl -pi -e "\$done ||= s/^version = \"\Q$OLD\E\"/version = \"$NEW\"/" src-tauri/Cargo.toml
perl -pi -e "s/chgui_\Q$OLD\E_aarch64\.dmg/chgui_${NEW}_aarch64.dmg/g" README.md

(cd src-tauri && cargo update --workspace --offline --quiet)

fail() { echo "✗ $1 still lacks $NEW" >&2; exit 1; }
[ "$(jq -r .version package.json)" = "$NEW" ] || fail package.json
[ "$(jq -r '.version, .packages."".version' package-lock.json | sort -u)" = "$NEW" ] || fail package-lock.json
[ "$(jq -r .version src-tauri/tauri.conf.json)" = "$NEW" ] || fail src-tauri/tauri.conf.json
grep -qF "version = \"$NEW\"" src-tauri/Cargo.toml || fail src-tauri/Cargo.toml
grep -A1 '^name = "ch-gui"' src-tauri/Cargo.lock | grep -qF "version = \"$NEW\"" || fail src-tauri/Cargo.lock
grep -qF "chgui_${NEW}_aarch64.dmg" README.md || fail README.md

echo "✓ Bumped to $NEW:"
git status --short package.json package-lock.json src-tauri/tauri.conf.json \
  src-tauri/Cargo.toml src-tauri/Cargo.lock README.md
cat <<MSG

Next:
  1. Prepend an entry for $NEW to src/lib/changelog.json (What's New and the
     updater notes both read it). Write for app users: say what they see
     and where, not how it works.
  2. git commit -am "chore(release): $NEW"
MSG
