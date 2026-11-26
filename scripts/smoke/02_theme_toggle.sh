#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

echo "▶ 02 theme toggle"
chgui_shoot "02a_initial.png"

flip_theme() {
  chgui_send 'keystroke "," using {command down}'
  sleep 0.5
  local r
  r=$(osascript <<'APPLESCRIPT'
    tell application "System Events"
      tell process "ch-gui"
        set all to entire contents of window 1
        repeat with el in all
          try
            if (role of el is "AXRadioButton") and (title of el is "Light" or title of el is "Dark") and (value of el is 0) then
              perform action "AXPress" of el
              return "ok"
            end if
          end try
        end repeat
        return "missing"
      end tell
    end tell
APPLESCRIPT
  )
  chgui_send 'key code 53'
  [[ "$r" == "ok" ]] && return 0
  echo "  ✖ theme control not found in Settings"
  return 1
}

flip_theme || exit 1
sleep 0.4
chgui_shoot "02b_flipped.png"

chgui_send 'keystroke "r" using {command down}'
sleep 2
chgui_shoot "02c_after_reload.png"

flip_theme
sleep 0.4
chgui_shoot "02d_restored.png"
