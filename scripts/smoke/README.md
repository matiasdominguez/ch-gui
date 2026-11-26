# ch-gui UI smoke tests

These tests drive the running Tauri app through AppleScript and the
macOS accessibility API, and save a screenshot of each step. They depend
on the machine's state: they need a running `ch-gui` process, and tests
01, 04, 05, and 06 also need a working ClickHouse connection.

## One-time setup

1. In **System Settings → Privacy & Security**, give the app that runs
   these scripts (Terminal, iTerm, or another) two permissions:
   - **Accessibility**, so `osascript` can send keystrokes and read the
     accessibility tree.
   - **Screen Recording**, so `screencapture` can capture the app's
     window. Without it, screenshots show only the desktop.

2. Start the app with `npm run tauri dev`. The process must be named
   `ch-gui`; check with `pgrep -x ch-gui`.

3. Open a connection that has the test schema. By default the tests
   expect a `smoke` database with an `events` table, plus a `customers`
   table for the JOIN test. To use other names:
   ```
   SMOKE_DB=my_db SMOKE_TABLE=my_table SMOKE_TABLE2=other_table \
     ./run_all.sh
   ```

## Run

```
./scripts/smoke/run_all.sh          # every test, in order
./scripts/smoke/02_theme_toggle.sh  # one test
```

Screenshots go to `/tmp/chgui_smoke/`, or to `SMOKE_OUT_DIR` if set.
The scripts check nothing in the images; open the PNGs after each run
and compare them with the table below.

## Tests

| # | Script | What the screenshots should show | Needs loaded schema? |
|---|---|---|---|
| 01  | `01_alias_autocomplete.sh` | `<db>.<table> e WHERE e.` lists the table's columns, each labeled `<db>.<table> : <type>` | no |
| 01b | `01b_ac_bare_alias.sh` | `FROM <table> e WHERE e.` (no database in `FROM`) lists the same columns, found by searching the loaded schema of every database | **yes** |
| 01c | `01c_ac_db_table_col.sh` | `FROM <db>.<table>.` lists the columns (three-part name, no alias) | no |
| 01d | `01d_ac_join_aliases.sh` | In a JOIN with two aliases, `x.` and `y.` list *different* columns, each labeled with its own table | no |
| 01e | `01e_ac_after_from.sh` | `FROM ` and Ctrl+Space list `<db>.<table>` entries, each labeled with its engine | **yes** |
| 02  | `02_theme_toggle.sh` (switches Light/Dark in Settings) | `02b` and `02c` (after a Cmd+R reload) match; `02d` matches `02a` | — |
| 03  | `03_tab_management.sh` | `03b` has one more Query N tab than `03a`; `03c` matches `03a`; the window stays open | — |
| 04  | `04_query_execute.sh` | `04a` shows formatted SQL on several lines; `04b` shows 3 rows, "3 ROWS", and Export CSV | — |
| 05  | `05_schema_browser.sh` | `05a` shows the tables under the database; `05b` shows the columns and their types under the table | — |
| 06  | `06_column_resize.sh` | `06b` differs from `06a`: a double-click on the first column's header grip changes its width | — |

> **Needs loaded schema** means the test reads tables the app has
> already fetched. Run `05_schema_browser.sh` first, or expand the
> database in the app, before 01b and 01e. Without that, the popup shows
> few entries or only keywords.

## Known limitations

- Monaco handles `Cmd+1..9` (go to tab N) while the editor has focus,
  so these tests do not cover those shortcuts. To add one, click the
  tab's `AXStaticText` at its coordinates; see `chgui_static_text_pos`
  in `_lib.sh`.
- The tests assume a single `ch-gui` window.
- `entire contents of window 1` reads the whole accessibility tree,
  which takes about a second, so keep the `sleep` calls long enough.
- These tests do not run in CI, because they need macOS permissions
  and a visible window. Run them by hand to catch UI regressions.

## Writing tests

`_lib.sh` provides:

- `chgui_require_running`: exit if `ch-gui` is not running.
- `chgui_focus`: bring the app to the front and set `CHGUI_X/Y/W/H`.
- `chgui_shoot <name>`: save a PNG to `$OUT_DIR/<name>`.
- `chgui_press_button <title>`: press the button with this exact title.
- `chgui_send <applescript-body>`: run an AppleScript snippet
  (`keystroke`, `key code`, `click at {x,y}`) with the app in front.
- `chgui_paste <text>`: paste a string with Cmd+V through the
  clipboard. Use it for any query with a `.` in the middle. With
  `keystroke`, the autocomplete popup opens at the `.` and takes the
  keystrokes that follow, so characters go missing. A paste is one
  input event, so the popup opens once, at the end.
- `chgui_static_text_pos <value>`: the center of a static-text element.
  Tabs are not buttons, so click them at this point.

Accessibility names the app exposes:

- Theme toggle: `"Switch to light"` / `"Switch to dark"` (AXButton)
- Schema rows: `"<name>"` (AXButton). The title is the same when the row
  is collapsed or expanded, and pressing the row toggles it.
- Result views: `"Results"` / `"Chart"` (AXRadioButton, by title)
- Tabs: `"Query N"` (AXStaticText, by value; click at its coordinates)
