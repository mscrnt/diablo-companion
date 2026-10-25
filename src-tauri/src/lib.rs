mod capture;
mod game;
mod gamedata;
mod ocr;
mod pad;

use base64::{engine::general_purpose::STANDARD, Engine};
use capture::{CaptureOpts, CaptureResult, Rect};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

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
fn mouse_down() -> bool {
    capture::mouse_down()
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

fn safe_name(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect()
}

/// Debug logs live in <app log dir>/<folder>: "judge-log" (every judgment, newest ~400 files)
/// or a sibling such as "test-mode" (a recorded play session, capped by the caller).
fn judge_log_dir(app: &AppHandle, folder: Option<&str>) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_log_dir().map_err(err)?.join(safe_name(folder.unwrap_or("judge-log")));
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

#[tauri::command]
fn debug_log_write(
    app: AppHandle,
    name: String,
    image: Option<String>,
    json: String,
    folder: Option<String>,
    max_files: Option<usize>,
    max_mb: Option<u64>,
) -> Result<String, String> {
    let safe = safe_name(&name);
    let dir = judge_log_dir(&app, folder.as_deref())?;
    if let Some(img) = image {
        let b64 = img.split_once(',').map(|(_, b)| b).unwrap_or(&img);
        let bytes = STANDARD.decode(b64.trim()).map_err(err)?;
        std::fs::write(dir.join(format!("{safe}.jpg")), bytes).map_err(err)?;
    }
    std::fs::write(dir.join(format!("{safe}.json")), json).map_err(err)?;
    // prune oldest: by file count, then by total size
    let max_files = max_files.unwrap_or(400);
    let max_bytes = max_mb.map(|mb| mb * 1024 * 1024).unwrap_or(u64::MAX);
    if let Ok(rd) = std::fs::read_dir(&dir) {
        let mut files: Vec<_> = rd
            .filter_map(|e| e.ok())
            .filter_map(|e| e.metadata().ok().filter(|m| m.is_file()).map(|m| (e.path(), m.len(), m.modified().ok())))
            .collect();
        files.sort_by_key(|f| f.2);
        let mut total: u64 = files.iter().map(|f| f.1).sum();
        let mut count = files.len();
        for (path, len, _) in &files {
            if count <= max_files && total <= max_bytes {
                break;
            }
            if std::fs::remove_file(path).is_ok() {
                count -= 1;
                total = total.saturating_sub(*len);
            }
        }
    }
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn debug_log_dir(app: AppHandle, folder: Option<String>) -> Result<String, String> {
    Ok(judge_log_dir(&app, folder.as_deref())?.to_string_lossy().to_string())
}

// ---- debug system: <app log dir>/debug (state.json, events-*.jsonl, marks/) --------------

/// Top-level folders under the app log dir that the debug commands may read. Only "debug" is writable.
const LOG_READABLE: [&str; 3] = ["debug", "judge-log", "test-mode"];

/// Resolve a relative path such as "debug/marks/2026-10-10T12-00-00" under the app log dir,
/// segment by segment: plain names only (letters, digits, '-', '_', '.'), no "..", no drive letters.
fn log_path(app: &AppHandle, rel: &str, write: bool) -> Result<std::path::PathBuf, String> {
    let segs: Vec<&str> = rel.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    let top = *segs.first().ok_or("empty path")?;
    if !LOG_READABLE.contains(&top) || (write && top != "debug") {
        return Err(format!("path not allowed: {rel}"));
    }
    let mut p = app.path().app_log_dir().map_err(err)?;
    for s in &segs {
        let plain = s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
        if !plain || s.starts_with('.') {
            return Err(format!("path not allowed: {rel}"));
        }
        p.push(s);
    }
    Ok(p)
}

/// The last `tail` bytes of a file (starting at a line break), or all of it.
fn read_tail(p: &std::path::Path, tail: Option<u64>) -> std::io::Result<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(p)?;
    let len = f.metadata()?.len();
    let cut = matches!(tail, Some(t) if len > t);
    if let Some(t) = tail.filter(|_| cut) {
        f.seek(SeekFrom::Start(len - t))?;
    }
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    if cut {
        if let Some(i) = buf.iter().position(|&b| b == b'\n') {
            buf.drain(..=i);
        }
    }
    Ok(buf)
}

/// Write text or a base64 image under <app log dir>/debug. Whole files are written atomically
/// (temp file, then rename) so a reader never sees half a file; `append` adds to the end instead.
#[tauri::command]
fn debug_file_write(app: AppHandle, path: String, text: Option<String>, base64: Option<String>, append: Option<bool>) -> Result<String, String> {
    use std::io::Write;
    let p = log_path(&app, &path, true)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    let bytes = match (text, base64) {
        (Some(t), _) => t.into_bytes(),
        (None, Some(b)) => {
            let b64 = b.split_once(',').map(|(_, x)| x).unwrap_or(&b);
            STANDARD.decode(b64.trim()).map_err(err)?
        }
        _ => return Err("nothing to write".into()),
    };
    if append.unwrap_or(false) {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&p).map_err(err)?;
        f.write_all(&bytes).map_err(err)?;
    } else {
        let mut tmp = p.clone().into_os_string();
        tmp.push(".tmp");
        std::fs::write(&tmp, &bytes).map_err(err)?;
        if let Err(e) = std::fs::rename(&tmp, &p) {
            let _ = std::fs::remove_file(&tmp);
            return Err(err(e));
        }
    }
    Ok(p.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
struct LogEntry {
    name: String,
    size: u64,
    /// unix ms
    modified: u64,
    dir: bool,
}

#[derive(serde::Serialize)]
struct LogListing {
    dir: String,
    entries: Vec<LogEntry>,
}

/// List a folder under the app log dir (debug, judge-log or test-mode). A missing folder lists as empty.
#[tauri::command]
fn debug_list(app: AppHandle, path: String) -> Result<LogListing, String> {
    let p = log_path(&app, &path, false)?;
    let mut entries = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&p) {
        for e in rd.flatten() {
            let Ok(m) = e.metadata() else { continue };
            let modified = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
            entries.push(LogEntry { name: e.file_name().to_string_lossy().to_string(), size: m.len(), modified, dir: m.is_dir() });
        }
    }
    Ok(LogListing { dir: p.to_string_lossy().to_string(), entries })
}

/// Read a text file under the app log dir (the last `max_bytes`, 1 MB by default).
#[tauri::command]
fn debug_file_read(app: AppHandle, path: String, max_bytes: Option<u64>) -> Result<String, String> {
    let p = log_path(&app, &path, false)?;
    let bytes = read_tail(&p, Some(max_bytes.unwrap_or(1024 * 1024))).map_err(err)?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

/// Delete a file or folder inside <app log dir>/debug (never the debug folder itself).
#[tauri::command]
fn debug_remove(app: AppHandle, path: String) -> Result<(), String> {
    if path.split(['/', '\\']).filter(|s| !s.is_empty()).count() < 2 {
        return Err("refusing to remove the debug folder".into());
    }
    let p = log_path(&app, &path, true)?;
    let res = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
    match res {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

/// Open a folder under the app log dir in Explorer (created if missing).
#[tauri::command]
fn open_log_folder(app: AppHandle, path: String) -> Result<String, String> {
    let p = log_path(&app, &path, false)?;
    std::fs::create_dir_all(&p).map_err(err)?;
    let s = p.to_string_lossy().to_string();
    app.opener().open_path(s.clone(), None::<&str>).map_err(err)?;
    Ok(s)
}

#[derive(serde::Deserialize)]
struct ReportEntry {
    /// path inside the zip
    zip: String,
    /// inline contents, or
    text: Option<String>,
    /// a file under the app log dir ("judge-log/x.json"), optionally only its last `tail` bytes
    src: Option<String>,
    tail: Option<u64>,
}

/// Where a report waits to be uploaded (inside the app's log folder, never anywhere else).
fn report_staging(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_log_dir().map_err(err)?.join("report-staging"))
}

/// Build the debug report zip and return its path: in Downloads (or Desktop) to keep, or with
/// `staging` in the app's own folder, to upload with `debug_report_upload`.
#[tauri::command]
async fn debug_report(app: AppHandle, name: String, entries: Vec<ReportEntry>, staging: Option<bool>) -> Result<String, String> {
    let staging = staging.unwrap_or(false);
    let out_dir = if staging {
        let dir = report_staging(&app)?;
        // leftovers from an earlier upload that never finished
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
        dir
    } else {
        app.path().download_dir().or_else(|_| app.path().desktop_dir()).or_else(|_| app.path().app_log_dir()).map_err(err)?
    };
    enum Body {
        Text(String),
        File(std::path::PathBuf, Option<u64>),
    }
    let mut items = Vec::new();
    for e in entries {
        let zip_name: String = e
            .zip
            .split(['/', '\\'])
            .filter(|s| !s.is_empty() && *s != "." && *s != "..")
            .map(safe_name_dot)
            .collect::<Vec<_>>()
            .join("/");
        let body = match (e.text, e.src) {
            (Some(t), _) => Body::Text(t),
            (None, Some(src)) => Body::File(log_path(&app, &src, false)?, e.tail),
            _ => continue,
        };
        items.push((zip_name, body));
    }
    let base = safe_name(&name);
    blocking(move || {
        use std::io::Write;
        std::fs::create_dir_all(&out_dir)?;
        let mut path = out_dir.join(format!("{base}.zip"));
        let mut n = 1;
        while path.exists() {
            path = out_dir.join(format!("{base}-{n}.zip"));
            n += 1;
        }
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path)?);
        let deflate = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (zip_name, body) in items {
            let bytes = match body {
                Body::Text(t) => t.into_bytes(),
                // a file pruned since it was listed is skipped
                Body::File(p, tail) => match read_tail(&p, tail) {
                    Ok(b) => b,
                    Err(_) => continue,
                },
            };
            let lower = zip_name.to_ascii_lowercase();
            let opts = if lower.ends_with(".jpg") || lower.ends_with(".jpeg") || lower.ends_with(".png") { stored } else { deflate };
            zip.start_file(zip_name, opts)?;
            zip.write_all(&bytes)?;
        }
        zip.finish()?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
}

/// The upload endpoint (a Cloudflare Worker that stores the zip; the app holds no storage keys).
const REPORT_URL: &str = "https://reports.mscrnt.com/report";
const REPORT_MAX_BYTES: u64 = 25 * 1024 * 1024;

/// "windows-11" from build 22000 up, "windows-10" below, "windows" if the build can't be read.
fn windows_os() -> &'static str {
    #[cfg(windows)]
    {
        use windows::core::w;
        use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
        let mut buf = [0u16; 32];
        let mut len = (buf.len() * 2) as u32;
        let ok = unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"), w!("CurrentBuildNumber"), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut len)) };
        if ok.is_ok() {
            let s = String::from_utf16_lossy(&buf[..(len as usize / 2).saturating_sub(1)]);
            if let Ok(build) = s.trim().parse::<u32>() {
                return if build >= 22000 { "windows-11" } else { "windows-10" };
            }
        }
    }
    "windows"
}

/// Upload a staged report and return the report ID the server gave it. Only zips in the staging
/// folder can be sent, and only to REPORT_URL. The staged file is deleted after a successful upload.
#[tauri::command]
async fn debug_report_upload(app: AppHandle, path: String, screenshots: bool) -> Result<String, String> {
    let staging = report_staging(&app)?.canonicalize().map_err(err)?;
    let file = std::path::PathBuf::from(&path).canonicalize().map_err(err)?;
    if file.parent() != Some(staging.as_path()) || file.extension().and_then(|e| e.to_str()) != Some("zip") {
        return Err("only a staged debug report can be sent".into());
    }
    let len = std::fs::metadata(&file).map_err(err)?.len();
    if len > REPORT_MAX_BYTES {
        return Err(format!("the report is {} MB, over the {} MB limit", len / 1024 / 1024, REPORT_MAX_BYTES / 1024 / 1024));
    }
    let bytes = std::fs::read(&file).map_err(err)?;
    let v = app.package_info().version.clone();
    // "0.2.0" or a pre-release like "0.2.0-rc.1" (the server accepts both)
    let meta = serde_json::json!({ "version": v.to_string(), "os": windows_os(), "screenshots": screenshots }).to_string();
    let client = tauri_plugin_http::reqwest::Client::builder().timeout(std::time::Duration::from_secs(90)).build().map_err(err)?;
    let res = client
        .post(REPORT_URL)
        .header("content-type", "application/zip")
        .header("x-report-meta", meta)
        .header("user-agent", format!("SanctuaryToolkit/{v}"))
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("couldn't reach the report service ({e})"))?;
    let status = res.status();
    let body: serde_json::Value = serde_json::from_str(&res.text().await.unwrap_or_default()).unwrap_or(serde_json::Value::Null);
    // rate limited, by the zone's WAF rule (not JSON) or the Worker's own caps
    if status.as_u16() == 429 {
        let msg = body.get("error").and_then(|m| m.as_str()).unwrap_or("too many reports right now");
        return Err(format!("{msg} (HTTP 429)"));
    }
    if !status.is_success() {
        let msg = body.get("error").and_then(|m| m.as_str()).unwrap_or("unknown error");
        return Err(format!("{msg} (HTTP {})", status.as_u16()));
    }
    let id = body.get("id").and_then(|i| i.as_str()).ok_or("the report service sent no report ID")?.to_string();
    let _ = std::fs::remove_file(&file);
    Ok(id)
}

/// Shared judgements (opt-in in the app) go to the same Worker; nothing else is ever sent there.
const SHARE_URL: &str = "https://reports.mscrnt.com/judgements";
const SHARE_DELETE_URL: &str = "https://reports.mscrnt.com/judgements/delete";
const SHARE_MAX_BYTES: usize = 8 * 1024 * 1024;

async fn share_post(app: &AppHandle, url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let text = body.to_string();
    if text.len() > SHARE_MAX_BYTES {
        return Err("the batch is too large".into());
    }
    let v = app.package_info().version.clone();
    let client = tauri_plugin_http::reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build().map_err(err)?;
    let res = client
        .post(url)
        .header("content-type", "application/json")
        .header("user-agent", format!("SanctuaryToolkit/{v}"))
        .body(text)
        .send()
        .await
        .map_err(|e| format!("couldn't reach the server ({e})"))?;
    let status = res.status();
    let reply: serde_json::Value = serde_json::from_str(&res.text().await.unwrap_or_default()).unwrap_or(serde_json::Value::Null);
    if !status.is_success() {
        let msg = reply.get("error").and_then(|m| m.as_str()).unwrap_or("unknown error");
        return Err(format!("{msg} (HTTP {})", status.as_u16()));
    }
    Ok(reply)
}

/// Send one batch of shared judgements: `{ install, items }` from the app, stamped here with the app
/// version and OS. Returns how many items the server stored.
#[tauri::command]
async fn share_send(app: AppHandle, install: String, items: serde_json::Value) -> Result<u64, String> {
    if !items.is_array() {
        return Err("items must be a list".into());
    }
    let body = serde_json::json!({ "v": 1, "install": install, "version": app.package_info().version.to_string(), "os": windows_os(), "items": items });
    let reply = share_post(&app, SHARE_URL, body).await?;
    Ok(reply.get("items").and_then(|n| n.as_u64()).unwrap_or(0))
}

/// "Delete my data": ask the server to delete everything sent under this install id.
#[tauri::command]
async fn share_delete(app: AppHandle, install: String) -> Result<(), String> {
    share_post(&app, SHARE_DELETE_URL, serde_json::json!({ "v": 1, "install": install })).await.map(|_| ())
}

fn safe_name_dot(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' }).collect()
}

#[derive(serde::Serialize)]
struct MonitorInfo {
    name: String,
    rect: (i32, i32, u32, u32),
    scale: f64,
    primary: bool,
}

#[derive(serde::Serialize)]
struct DisplayInfo {
    monitors: Vec<MonitorInfo>,
    game: Option<game::GameWindow>,
}

/// Monitors (with their DPI scale) and the game window's frame, for test-mode context.
#[tauri::command]
fn display_info(app: AppHandle) -> Result<DisplayInfo, String> {
    let primary = app.primary_monitor().map_err(err)?.map(|m| *m.position());
    let monitors = app
        .available_monitors()
        .map_err(err)?
        .iter()
        .map(|m| MonitorInfo {
            name: m.name().cloned().unwrap_or_default(),
            rect: (m.position().x, m.position().y, m.size().width, m.size().height),
            scale: m.scale_factor(),
            primary: primary == Some(*m.position()),
        })
        .collect();
    Ok(DisplayInfo { monitors, game: game::window_details() })
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            capture_at_cursor,
            capture_region,
            capture_monitor,
            ocr_image,
            list_monitors,
            cursor_position,
            mouse_down,
            game_status,
            set_overlay_interactive,
            set_overlay_capturable,
            debug_log_write,
            debug_log_dir,
            debug_file_write,
            debug_list,
            debug_file_read,
            debug_remove,
            open_log_folder,
            debug_report,
            debug_report_upload,
            share_send,
            share_delete,
            display_info,
            gamedata::gamedata_detect,
            gamedata::gamedata_build_info,
            gamedata::gamedata_pick_folder,
            gamedata::gamedata_cache_dir,
            gamedata::gamedata_read_batch,
            gamedata::gamedata_list,
            gamedata::gamedata_builds,
            gamedata::gamedata_write,
            gamedata::gamedata_read_text,
            gamedata::gamedata_clean,
            gamedata::gamedata_prune,
            gamedata::gamedata_dir_size,
            gamedata::gamedata_resource,
            gamedata::gamedata_casc,
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

            let show = MenuItem::with_id(app, "show", "Open Sanctuary Toolkit", true, None::<&str>)?;
            let edit = MenuItem::with_id(app, "edit", "Edit Overlay Layout", true, None::<&str>)?;
            let judge = MenuItem::with_id(app, "judge", "Judge Item Under Cursor", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&show, &edit, &judge, &sep, &quit])?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(format!("Sanctuary Toolkit v{}", app.package_info().version))
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

#[cfg(test)]
mod report_tests {
    #[test]
    fn os_is_one_the_server_accepts() {
        let os = super::windows_os();
        assert!(["windows-10", "windows-11", "windows"].contains(&os));
        #[cfg(windows)]
        assert_ne!(os, "windows", "the build number should be readable on Windows");
        println!("os = {os}");
    }
}
