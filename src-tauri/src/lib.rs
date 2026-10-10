mod capture;
mod game;
mod ocr;
mod pad;

use base64::{engine::general_purpose::STANDARD, Engine};
use capture::{CaptureOpts, CaptureResult, Rect};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> anyhow::Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
async fn capture_at_cursor(width: u32, height: u32, opts: Option<CaptureOpts>) -> Result<CaptureResult, String> {
    blocking(move || capture::at_cursor(width, height, &opts.unwrap_or_default())).await
}

#[tauri::command]
async fn capture_region(rect: Rect, opts: Option<CaptureOpts>) -> Result<CaptureResult, String> {
    blocking(move || capture::region(rect, &opts.unwrap_or_default())).await
}

#[tauri::command]
async fn capture_monitor(point: Option<(i32, i32)>, opts: Option<CaptureOpts>) -> Result<CaptureResult, String> {
    blocking(move || capture::monitor(point, &opts.unwrap_or_default())).await
}

/// OCR an arbitrary image (base64 PNG/JPEG, optional data: prefix) — used for
/// pasted screenshots and tests.
#[tauri::command]
async fn ocr_image(image: String, scale: Option<f32>) -> Result<ocr::OcrOut, String> {
    blocking(move || {
        let b64 = image.split_once(',').map(|(_, b)| b).unwrap_or(&image);
        let bytes = STANDARD.decode(b64.trim())?;
        let img = image::load_from_memory(&bytes)?.to_rgba8();
        ocr::recognize(&img, scale.unwrap_or(1.0))
    })
    .await
}

#[tauri::command]
fn list_monitors() -> Result<Vec<(String, Rect, bool)>, String> {
    capture::list_monitors().map_err(err)
}

#[tauri::command]
fn cursor_position() -> (i32, i32) {
    capture::cursor_pos()
}

#[tauri::command]
fn game_status() -> game::GameStatus {
    game::current()
}

/// Edit mode makes the overlay clickable so widgets can be dragged; otherwise
/// it is fully click-through so it never steals input from the game.
#[tauri::command]
fn set_overlay_interactive(app: AppHandle, interactive: bool) -> Result<(), String> {
    let ov = app.get_webview_window("overlay").ok_or("overlay window missing")?;
    ov.set_ignore_cursor_events(!interactive).map_err(err)?;
    if interactive {
        let _ = ov.set_focus();
    }
    app.emit("overlay-interactive", interactive).map_err(err)
}

/// Debug switch: let the overlay appear in screenshots again.
#[tauri::command]
fn set_overlay_capturable(app: AppHandle, capturable: bool) -> Result<(), String> {
    let ov = app.get_webview_window("overlay").ok_or("overlay window missing")?;
    ov.set_content_protected(!capturable).map_err(err)
}

/// Judge debug log: <app log dir>/judge-log/<name>.jpg|.json, pruned to the newest ~400 files.
fn judge_log_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(err)?.join("judge-log");
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

#[tauri::command]
fn debug_log_write(app: AppHandle, name: String, image: Option<String>, json: String) -> Result<String, String> {
    let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let dir = judge_log_dir(&app)?;
    if let Some(img) = image {
        let b64 = img.split_once(',').map(|(_, b)| b).unwrap_or(&img);
        let bytes = STANDARD.decode(b64.trim()).map_err(err)?;
        std::fs::write(dir.join(format!("{safe}.jpg")), bytes).map_err(err)?;
    }
    std::fs::write(dir.join(format!("{safe}.json")), json).map_err(err)?;
    // prune oldest
    if let Ok(rd) = std::fs::read_dir(&dir) {
        let mut files: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        if files.len() > 400 {
            files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
            for e in files.iter().take(files.len() - 400) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn debug_log_dir(app: AppHandle) -> Result<String, String> {
    Ok(judge_log_dir(&app)?.to_string_lossy().to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            capture_at_cursor,
            capture_region,
            capture_monitor,
            ocr_image,
            list_monitors,
            cursor_position,
            game_status,
            set_overlay_interactive,
            set_overlay_capturable,
            debug_log_write,
            debug_log_dir,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            if let Some(ov) = app.get_webview_window("overlay") {
                let _ = ov.set_ignore_cursor_events(true);
                // Hide the overlay from screen capture (WDA_EXCLUDEFROMCAPTURE) so our own
                // OCR/vision never reads overlay text, and recordings show only the game.
                let _ = ov.set_content_protected(true);
                // Start covering the primary monitor until the game is found.
                if let Ok(Some(m)) = ov.primary_monitor() {
                    let _ = ov.set_position(*m.position());
                    let _ = ov.set_size(*m.size());
                }
            }

            let show = MenuItem::with_id(app, "show", "Open Companion", true, None::<&str>)?;
            let edit = MenuItem::with_id(app, "edit", "Edit Overlay Layout", true, None::<&str>)?;
            let judge = MenuItem::with_id(app, "judge", "Judge Item Under Cursor", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show, &edit, &judge, &sep, &quit])?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(format!("Diablo IV Companion v{}", app.package_info().version))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "show" => show_main(app),
                    "edit" => {
                        let _ = app.emit("tray-action", "edit-overlay");
                    }
                    "judge" => {
                        let _ = app.emit("tray-action", "judge");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            pad::spawn(handle.clone());
            game::spawn_watcher(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the dashboard hides it to the tray; timers/hotkeys keep running.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
