#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

TABLE="${SMOKE_TABLE:-events}"

echo "▶ 01b autocomplete — bare alias  [FROM $TABLE e …]"

chgui_send 'keystroke "t" using {command down}'
sleep 0.5
chgui_send "keystroke \"select * from ${TABLE} e WHERE e.\""
sleep 0.3
chgui_send 'key code 49 using {control down}'
sleep 0.6

chgui_shoot "01b_bare_alias.png"

chgui_send 'key code 53'
sleep 0.2
chgui_send 'keystroke "w" using {command down}'
