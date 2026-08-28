#!/usr/bin/env bash
set -Eeuo pipefail

workspace=${1:-.}
output_directory=${2:-.}

workspace=$(cd -- "$workspace" && pwd -P)
mkdir -p -- "$output_directory"
output_directory=$(cd -- "$output_directory" && pwd -P)

release_root="$output_directory/release-root"
roundtrip_root="$output_directory/release-roundtrip"
archive="$output_directory/mcap-finance-linux-x64.tgz"
checksum="$output_directory/mcap-finance-linux-x64.tgz.sha256"
manifest="$output_directory/mcap-finance-linux-x64.manifest.json"

for output in "$release_root" "$roundtrip_root" "$archive" "$checksum" "$manifest"; do
  test ! -e "$output" || {
    printf 'release output already exists: %s\n' "$output" >&2
    exit 1
  }
done

source_date_epoch=${SOURCE_DATE_EPOCH:-}
if test -z "$source_date_epoch"; then
  source_date_epoch=$(git -C "$workspace" show -s --format=%ct HEAD)
fi
case "$source_date_epoch" in
  ''|*[!0-9]*) printf 'SOURCE_DATE_EPOCH must be a non-negative integer\n' >&2; exit 1 ;;
esac
export SOURCE_DATE_EPOCH="$source_date_epoch"

node "$workspace/scripts/release/create-release.mjs" \
  --source "$workspace" --output "$release_root" >&2
node "$workspace/scripts/release/verify-release.mjs" --root "$release_root" >&2

tar --sort=name --mtime="@${SOURCE_DATE_EPOCH}" --owner=0 --group=0 \
  --numeric-owner --format=gnu -cf - -C "$release_root" . \
  | gzip -n -9 > "$archive"
cp -- "$release_root/release-manifest.json" "$manifest"

mkdir -- "$roundtrip_root"
tar -xzf "$archive" -C "$roundtrip_root"
node "$roundtrip_root/scripts/release/verify-release.mjs" --root "$roundtrip_root" >&2
(
  cd -- "$roundtrip_root/apps/api"
  npx --yes prisma@7.9.1 validate
) >&2

(
  cd -- "$output_directory"
  sha256sum "$(basename -- "$archive")" > "$(basename -- "$checksum")"
  sha256sum --check "$(basename -- "$checksum")" >&2
)

printf 'archive_sha256=%s\nmanifest_sha256=%s\n' \
  "$(sha256sum "$archive" | awk '{print $1}')" \
  "$(sha256sum "$manifest" | awk '{print $1}')"
