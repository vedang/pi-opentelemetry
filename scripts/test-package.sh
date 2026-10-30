#!/usr/bin/env bash
set -Eeuo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$repo"
pnpm pack --pack-destination "$work"
archive="$(find "$work" -maxdepth 1 -name '*.tgz' -print)"
[[ -n "$archive" && -f "$archive" ]]
while IFS= read -r file; do
  case "$file" in
    package/src/*|package/package.json|package/README.md|package/CHANGELOG.md) ;;
    *) printf 'Unexpected packed file\n' >&2; exit 1 ;;
  esac
done < <(tar -tzf "$archive")
mkdir "$work/installed"
printf '{"private":true,"type":"module"}\n' > "$work/installed/package.json"
# No network fallback or global installation. Uses the store populated by frozen install.
pnpm --dir "$work/installed" add --offline --ignore-scripts --save-exact "$archive" @earendil-works/pi-coding-agent@1.4.0
node "$repo/__tests__/fixtures/package-load.ts" "$work/installed"
printf 'Isolated tarball install/load passed\n'
