#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
shopt -s nullglob
for s in [0-9]*_*.sh; do
  chmod +x "$s"
  ./"$s"
  sleep 0.5
done
echo
echo "✓ Done. Screenshots: ${SMOKE_OUT_DIR:-/tmp/chgui_smoke}"
