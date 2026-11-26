#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

DB="${SMOKE_DB:-smoke}"
TABLE="${SMOKE_TABLE:-events}"

echo "▶ 01c autocomplete — db.table.col  [$DB.$TABLE.]"

chgui_send 'keystroke "t" using {command down}'
sleep 0.5
chgui_send "keystroke \"select ${DB}.${TABLE}.\""
sleep 0.5   # The typed "." opens the popup, so this test sends no Ctrl+Space.
chgui_shoot "01c_db_table_col.png"

chgui_send 'key code 53'
sleep 0.2
chgui_send 'keystroke "w" using {command down}'
