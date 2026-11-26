#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

echo "▶ 04 query execute  (numbers(3))"

chgui_send 'keystroke "t" using {command down}'
sleep 0.4
chgui_send 'keystroke "select  1   as n ,2 as m from numbers(3)"'
sleep 0.3
chgui_send 'keystroke "l" using {command down, shift down}'
sleep 0.6
chgui_shoot "04a_formatted.png"

chgui_send 'key code 36 using {command down}'   # Key code 36 is Return.
sleep 2.5
chgui_shoot "04b_results.png"

chgui_send 'keystroke "w" using {command down}'
