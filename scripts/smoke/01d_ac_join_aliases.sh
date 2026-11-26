#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

DB="${SMOKE_DB:-smoke}"
T1="${SMOKE_TABLE:-events}"
T2="${SMOKE_TABLE2:-customers}"

echo "▶ 01d autocomplete — JOIN aliases  [$DB.$T1 x JOIN $DB.$T2 y]"

chgui_send 'keystroke "t" using {command down}'
sleep 0.5
# Paste up to the last ".", because a typed "." opens a popup that takes later keystrokes.
chgui_paste "select * from ${DB}.${T1} x JOIN ${DB}.${T2} y ON x"
sleep 0.3
chgui_send 'keystroke "."'
sleep 0.6
chgui_shoot "01d_join_x.png"

chgui_send 'key code 53'
sleep 0.2
chgui_send 'key code 51'
sleep 0.1
chgui_send 'key code 51'
sleep 0.1
chgui_send 'keystroke "y"'
sleep 0.1
chgui_send 'keystroke "."'
sleep 0.6
chgui_shoot "01d_join_y.png"

chgui_send 'key code 53'
sleep 0.2
chgui_send 'keystroke "w" using {command down}'
