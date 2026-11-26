#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

DB="${SMOKE_DB:-smoke}"
TABLE="${SMOKE_TABLE:-events}"

echo "▶ 05 schema browser  [$DB / $TABLE]"

r=$(chgui_press_button "${DB}")
if [[ "$r" != "ok" ]]; then
  echo "  ✖ database row not found: $r"; exit 1
fi
sleep 1.2
chgui_shoot "05a_db_expanded.png"

r=$(chgui_press_button "${TABLE}")
if [[ "$r" != "ok" ]]; then
  echo "  ✖ table row not found: $r"; exit 1
fi
sleep 1.2
chgui_shoot "05b_table_expanded.png"

chgui_press_button "${TABLE}" >/dev/null
sleep 0.3
chgui_press_button "${DB}" >/dev/null
