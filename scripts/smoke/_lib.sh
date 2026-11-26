#!/usr/bin/env bash

set -u

OUT_DIR="${SMOKE_OUT_DIR:-/tmp/chgui_smoke}"
mkdir -p "$OUT_DIR"

chgui_require_running() {
  if ! pgrep -x ch-gui >/dev/null; then
    echo "✖ ch-gui is not running. Start it with: npm run tauri dev" >&2
    exit 1
  fi
}

chgui_focus() {
  local g
  g=$(osascript <<'APPLESCRIPT'
    tell application "System Events"
      tell process "ch-gui"
        set frontmost to true
        set p to position of window 1
        set s to size of window 1
        return ((item 1 of p) as string) & "," ¬
             & ((item 2 of p) as string) & "," ¬
             & ((item 1 of s) as string) & "," ¬
             & ((item 2 of s) as string)
      end tell
    end tell
APPLESCRIPT
  )
  IFS=',' read -r CHGUI_X CHGUI_Y CHGUI_W CHGUI_H <<<"$g"
}

chgui_shoot() {
  local name="$1"
  chgui_focus
  sleep 0.3
  screencapture -x -o -R "${CHGUI_X},${CHGUI_Y},${CHGUI_W},${CHGUI_H}" \
    "$OUT_DIR/$name"
  echo "  📸 $OUT_DIR/$name"
}

chgui_press_button() {
  local title="$1"
  osascript <<APPLESCRIPT
    tell application "System Events"
      tell process "ch-gui"
        set frontmost to true
        set all to entire contents of window 1
        repeat with el in all
          try
            if (role of el is "AXButton") and (title of el is "$title") then
              perform action "AXPress" of el
              return "ok"
            end if
          end try
        end repeat
        return "missing:$title"
      end tell
    end tell
APPLESCRIPT
}

chgui_send() {
  local body="$1"
  osascript <<APPLESCRIPT
    tell application "System Events"
      set frontmost of process "ch-gui" to true
    end tell
    delay 0.2
    tell application "System Events"
      $body
    end tell
APPLESCRIPT
}

# The autocomplete popup opened by a typed "." takes later keystrokes, so paste.
chgui_paste() {
  local text="$1"
  local saved
  saved=$(pbpaste 2>/dev/null || true)
  printf %s "$text" | pbcopy
  chgui_send 'keystroke "v" using {command down}'
  sleep 0.1
  printf %s "$saved" | pbcopy
}

chgui_static_text_pos() {
  local v="$1"
  osascript <<APPLESCRIPT
    tell application "System Events"
      tell process "ch-gui"
        set all to entire contents of window 1
        repeat with el in all
          try
            if (role of el is "AXStaticText") and (value of el is "$v") then
              set p to position of el
              set sz to size of el
              return ((item 1 of p) + (item 1 of sz) / 2 as integer) as string ¬
                   & "," & ((item 2 of p) + (item 2 of sz) / 2 as integer) as string
            end if
          end try
        end repeat
        return ""
      end tell
    end tell
APPLESCRIPT
}
