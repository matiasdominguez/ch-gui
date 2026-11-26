// Without this, Windows release builds open an extra console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ch_gui_lib::run()
}
