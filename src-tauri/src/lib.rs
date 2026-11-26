pub mod clickhouse;
mod commands;
mod error;
mod keychain;
mod pool;
mod state;

use state::AppState;
use tauri::{
    menu::{AboutMetadata, MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder},
    Emitter, WindowEvent,
};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // rustls 0.23 panics when both aws-lc-rs and ring are compiled in and no provider is installed.
    // A transitive `rustls-tls` feature can enable both.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,ch_gui_lib=debug".into()),
        )
        .init();

    let migrations = vec![
        Migration {
            version: 1,
            description: "create connections and history",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create saved_queries",
            sql: include_str!("../migrations/002_saved_queries.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add pinned column to query_history",
            sql: include_str!("../migrations/003_history_pinned.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add cluster_name column to connections",
            sql: include_str!("../migrations/004_connection_cluster.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add cluster_fanout column to connections",
            sql: include_str!("../migrations/005_connection_cluster_fanout.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:chgui.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // The default macOS menu binds Cmd+W to `Close Window`, which fires `CloseRequested` like the red
        // close button. This menu omits that item so the frontend can bind Cmd+W to close a tab.
        .menu(|handle| {
            let settings = MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?;
            let app_menu = SubmenuBuilder::new(handle, "chgui")
                .about(Some(AboutMetadata::default()))
                .separator()
                .item(&settings)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let action = |id: &str, text: &str, accelerator: &str| {
                MenuItem::with_id(handle, id, text, true, Some(accelerator))
            };
            let file_menu = SubmenuBuilder::new(handle, "File")
                .item(&action("new-tab", "New Tab", "CmdOrCtrl+T")?)
                .item(&action(
                    "reopen-tab",
                    "Reopen Closed Tab",
                    "CmdOrCtrl+Shift+T",
                )?)
                .item(&action("close-tab", "Close Tab", "CmdOrCtrl+W")?)
                .separator()
                .item(&action("save", "Save", "CmdOrCtrl+S")?)
                .build()?;
            let query_menu = SubmenuBuilder::new(handle, "Query")
                .item(&action("run", "Run", "CmdOrCtrl+Enter")?)
                .item(&action("run-all", "Run All", "CmdOrCtrl+Shift+Enter")?)
                .item(&action("cancel", "Cancel", "CmdOrCtrl+.")?)
                .separator()
                .item(&action("format", "Format", "CmdOrCtrl+Shift+L")?)
                .build()?;
            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(handle, "Window").minimize().build()?;
            let help_menu = SubmenuBuilder::new(handle, "Help")
                .text("show_welcome", "Welcome…")
                .text("keyboard_shortcuts", "Keyboard Shortcuts")
                .separator()
                .text("whats_new", "What's New…")
                .text("check_for_updates", "Check for Updates…")
                .build()?;
            MenuBuilder::new(handle)
                .items(&[
                    &app_menu,
                    &file_menu,
                    &edit_menu,
                    &query_menu,
                    &window_menu,
                    &help_menu,
                ])
                .build()
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                let _ = app.emit("app:settings", ());
            }
            "show_welcome" => {
                let _ = app.emit("help:show-welcome", ());
            }
            "keyboard_shortcuts" => {
                let _ = app.emit("help:keyboard-shortcuts", ());
            }
            "whats_new" => {
                let _ = app.emit("help:whats-new", ());
            }
            "check_for_updates" => {
                let _ = app.emit("help:check-for-updates", ());
            }
            id @ ("new-tab" | "reopen-tab" | "close-tab" | "save" | "run" | "run-all"
            | "cancel" | "format") => {
                let _ = app.emit("app:menu-action", id);
            }
            _ => {}
        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::test_connection,
            commands::run_query,
            commands::fetch_query_profile,
            commands::fetch_table_details,
            commands::fetch_column_stats,
            commands::fetch_column_distribution,
            commands::fetch_parts_summary,
            commands::fetch_active_merges,
            commands::fetch_dependency_graph,
            commands::list_running_queries,
            commands::can_kill_others,
            commands::list_server_history,
            commands::list_server_history_grouped,
            commands::list_server_errors,
            commands::list_mv_failures,
            commands::list_functions,
            commands::list_changed_settings,
            commands::version_info,
            commands::error_pulse,
            commands::list_pending_mutations,
            commands::list_replica_queue,
            commands::list_kafka_tables,
            commands::list_kafka_consumers,
            commands::kafka_pulse,
            commands::kill_running_query,
            commands::cancel_query,
            commands::cancel_scan,
            commands::introspect_databases,
            commands::introspect_tables,
            commands::introspect_columns,
            commands::format_sql,
            commands::save_password,
            commands::load_password,
            commands::delete_password,
        ])
        // The frontend closes the window with `destroy()`, which bypasses this handler.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.emit("app-close-requested", ());
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
