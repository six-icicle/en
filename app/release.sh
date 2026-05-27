#!/usr/bin/env bash
# Build a signed + notarized release of en for Apple Silicon.
# Reads APPLE_ID / APPLE_TEAM_ID / APPLE_PASSWORD from app/.env.release.

set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env.release ]]; then
  echo "error: app/.env.release missing. Copy app/.env.release.example to app/.env.release and fill it in." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env.release
set +a

for v in APPLE_ID APPLE_TEAM_ID APPLE_PASSWORD; do
  if [[ -z "${!v:-}" ]]; then
    echo "error: $v is empty in .env.release" >&2
    exit 1
  fi
done

echo "==> building signed + notarized release for aarch64-apple-darwin"
npm run tauri -- build --target aarch64-apple-darwin

echo
echo "==> done. DMG location:"
find src-tauri/target/aarch64-apple-darwin/release/bundle/dmg -name '*.dmg' -print 2>/dev/null || true
