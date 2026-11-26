#!/usr/bin/env bash

cd "$(dirname "$0")" && source ./_lib.sh
chgui_require_running

echo "▶ 06 column resize / auto-fit"

chgui_focus
editor_click_x=$(( CHGUI_X + CHGUI_W / 2 ))
editor_click_y=$(( CHGUI_Y + CHGUI_H * 30 / 100 ))
osascript <<APPLESCRIPT
tell application "System Events"
  set frontmost of process "ch-gui" to true
  delay 0.3
  click at {$editor_click_x, $editor_click_y}
end tell
APPLESCRIPT
sleep 0.4

chgui_send 'keystroke "a" using {command down}'
sleep 0.2
chgui_send 'key code 51'
sleep 0.2
chgui_paste $'SELECT number AS n, repeat(\'x\', 120) AS wide FROM numbers(4)'
sleep 0.6
chgui_send 'key code 36 using {command down}'
sleep 3

chgui_focus
echo "  window @ ${CHGUI_X},${CHGUI_Y}  (${CHGUI_W}x${CHGUI_H})"

chgui_shoot "06a_initial.png"

# WKWebView hides grid headers from accessibility, so clicks use fixed coordinates.
HEADER_Y_PCT=${HEADER_Y_PCT:-55}
header_y=$(( CHGUI_Y + CHGUI_H * HEADER_Y_PCT / 100 ))

col1_right=$(( CHGUI_X + 320 + 180 - 2 ))
col2_right=$(( CHGUI_X + 320 + 360 - 2 ))
echo "  header_y=${header_y}  col1_grip=${col1_right}  col2_grip=${col2_right}"

dblclick_at() {
  local x="$1" y="$2"
  osascript <<APPLESCRIPT
tell application "System Events"
  set frontmost of process "ch-gui" to true
  delay 0.2
  click at {$x, $y}
  delay 0.08
  click at {$x, $y}
end tell
APPLESCRIPT
  sleep 0.4
}

# Click the wide column first, because resizing the n column moves the wide column's grip.
dblclick_at "$col2_right" "$header_y"
chgui_shoot "06b_after_dblclick_wide.png"

dblclick_at "$col1_right" "$header_y"
chgui_shoot "06c_after_dblclick_n.png"

sha_a=$(shasum "$OUT_DIR/06a_initial.png" | awk '{print $1}')
sha_b=$(shasum "$OUT_DIR/06b_after_dblclick_wide.png" | awk '{print $1}')
sha_c=$(shasum "$OUT_DIR/06c_after_dblclick_n.png" | awk '{print $1}')
echo ""
echo "  06a sha: $sha_a"
echo "  06b sha: $sha_b  $( [[ "$sha_a" == "$sha_b" ]] && echo "(identical → click did nothing)" || echo "(DIFFERS → something changed)" )"
echo "  06c sha: $sha_c  $( [[ "$sha_b" == "$sha_c" ]] && echo "(identical → col1 click did nothing)" || echo "(DIFFERS → col1 also resized)" )"

chgui_send 'keystroke "w" using {command down}'
