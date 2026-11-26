#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

echo "▶ 03 tab management"
chgui_shoot "03a_initial.png"

chgui_send 'keystroke "t" using {command down}'
sleep 0.4
chgui_shoot "03b_new_tab.png"

chgui_send 'keystroke "w" using {command down}'
sleep 0.4
chgui_shoot "03c_after_close.png"

if ! pgrep -x ch-gui >/dev/null; then
  echo "  ✖ Cmd+W closed the whole window — regression!"
  exit 1
fi
