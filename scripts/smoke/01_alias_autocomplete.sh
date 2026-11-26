#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

DB="${SMOKE_DB:-smoke}"
TABLE="${SMOKE_TABLE:-events}"

echo "▶ 01 alias autocomplete  [$DB.$TABLE]"

chgui_send 'keystroke "t" using {command down}'
sleep 0.5
chgui_send "keystroke \"select * from ${DB}.${TABLE} e WHERE e.\""
sleep 0.3
chgui_send 'key code 49 using {control down}'   # Key code 49 is Space.
sleep 0.6

chgui_shoot "01_alias_autocomplete.png"

chgui_send 'key code 53'
sleep 0.2
chgui_send 'keystroke "w" using {command down}'
