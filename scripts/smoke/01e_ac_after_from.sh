#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

echo "▶ 01e autocomplete — after FROM trigger"

chgui_send 'keystroke "t" using {command down}'
sleep 0.5
chgui_send 'keystroke "select * from "'
sleep 0.3
chgui_send 'key code 49 using {control down}'
sleep 0.6
chgui_shoot "01e_after_from.png"

chgui_send 'key code 53'
sleep 0.2
chgui_send 'keystroke "w" using {command down}'
