use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;
use tauri_plugin_store::StoreExt;
use keyring::Entry;

const NATIVE_ACTION_EVENT: &str = "native-action";
const KEYRING_SERVICE: &str = "com.daaihang.stagepilot";

#[tauri::command]
fn secure_get(key: String) -> Result<Option<String>, String> {
    Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?.get_password().map(Some).or_else(|e| {
        if e.to_string().to_lowercase().contains("no entry") { Ok(None) } else { Err(e.to_string()) }
    })
}

#[tauri::command]
fn secure_set(key: String, value: String) -> Result<(), String> {
    Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_delete(key: String) -> Result<(), String> {
    Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?.delete_credential().map_err(|e| e.to_string())
}

fn devtools_pref<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.store("stagepilot.json")
        .ok()
        .and_then(|store| store.get("devtools"))
        .and_then(|value| value.as_bool())
        .unwrap_or(true)
}

fn create_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("StagePilot")
        .inner_size(800.0, 600.0)
        .min_inner_size(720.0, 480.0)
        .devtools(devtools_pref(app));
    #[cfg(windows)]
    {
        builder = builder
            .decorations(false)
            .background_color(tauri::utils::config::Color(255, 255, 255, 255));
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.title_bar_style(TitleBarStyle::Overlay).hidden_title(true);
    }
    builder.build()?;
    Ok(())
}

#[cfg(any(debug_assertions, feature = "devtools"))]
fn try_open_devtools(window: &tauri::WebviewWindow) -> bool {
    window.open_devtools();
    true
}

#[cfg(not(any(debug_assertions, feature = "devtools")))]
fn try_open_devtools(_window: &tauri::WebviewWindow) -> bool {
    false
}

#[tauri::command]
fn set_devtools(window: tauri::WebviewWindow, enabled: bool) -> bool {
    if enabled {
        try_open_devtools(&window)
    } else {
        false
    }
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let _ = window.hide();
        } else {
            focus_main_window(app);
        }
    }
}

fn emit_native_action<R: Runtime>(app: &AppHandle<R>, action: &str) {
    focus_main_window(app);
    let _ = app.emit(NATIVE_ACTION_EVENT, action);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle-window", "显示 / 隐藏窗口", true, None::<&str>)?;
    let open_file =
        MenuItem::with_id(app, "open-file", "选择文件…", true, None::<&str>)?;
    let open_folder =
        MenuItem::with_id(app, "open-folder", "选择文件夹…", true, None::<&str>)?;
    let copy_path =
        MenuItem::with_id(app, "copy-path", "复制当前路径", true, None::<&str>)?;
    let toggle_theme =
        MenuItem::with_id(app, "toggle-theme", "切换主题", true, None::<&str>)?;
    let notify = MenuItem::with_id(app, "notify", "发送测试通知", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "关于", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &PredefinedMenuItem::separator(app)?,
            &open_file,
            &open_folder,
            &copy_path,
            &toggle_theme,
            &notify,
            &PredefinedMenuItem::separator(app)?,
            &about,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().expect("no default window icon").clone())
        .tooltip("StagePilot")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle-window" => toggle_main_window(app),
            "quit" => app.exit(0),
            action => emit_native_action(app, action),
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["ctrl+shift+space"])
                .expect("invalid global shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        focus_main_window(app);
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            create_main_window(app.handle())?;
            build_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![quit_app, set_devtools, secure_get, secure_set, secure_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
