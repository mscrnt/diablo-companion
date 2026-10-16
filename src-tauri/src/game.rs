//! Watches which window is in the foreground so the overlay only draws while
//! Diablo IV is focused, and keeps the overlay window glued to the game window.
//! Only window titles and rects are read — never game memory or process handles.

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    /// Diablo IV window exists
    pub running: bool,
    /// Diablo IV is the foreground window
    pub focused: bool,
    /// one of our own windows is in the foreground
    pub companion_focused: bool,
    /// the game is on screen: focused, or the focused window is elsewhere (another
    /// monitor) and doesn't cover it — e.g. typing in a chat on a second screen
    pub visible: bool,
    pub rect: Option<(i32, i32, u32, u32)>,
    pub foreground_title: String,
}

pub static STATUS: Mutex<Option<GameStatus>> = Mutex::new(None);

#[cfg(windows)]
fn window_info(hwnd: windows::Win32::Foundation::HWND) -> (String, u32, Option<(i32, i32, u32, u32)>) {
    // Title, owning PID and rect only. We deliberately never OpenProcess() the
    // game: no handles to Diablo IV at all, so nothing for anti-cheat to flag.
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, GetWindowTextW, GetWindowThreadProcessId};
    unsafe {
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let mut r = RECT::default();
        let rect = if GetWindowRect(hwnd, &mut r).is_ok() {
            Some((r.left, r.top, (r.right - r.left).max(0) as u32, (r.bottom - r.top).max(0) as u32))
        } else {
            None
        };
        (title, pid, rect)
    }
}

/// The game's picture on screen: its client area, without the border and title bar a windowed (not
/// borderless) game has. Overlays and screen reading were placed on the outer window, 8 px left and a
/// title bar too high (2026-10-15 player report). Borderless: the same as the window rect.
#[cfg(windows)]
fn client_rect(hwnd: windows::Win32::Foundation::HWND) -> Option<(i32, i32, u32, u32)> {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowInfo, WINDOWINFO};
    unsafe {
        let mut wi = WINDOWINFO { cbSize: std::mem::size_of::<WINDOWINFO>() as u32, ..Default::default() };
        GetWindowInfo(hwnd, &mut wi).ok()?;
        let c = wi.rcClient;
        let (w, h) = ((c.right - c.left).max(0) as u32, (c.bottom - c.top).max(0) as u32);
        (w > 0 && h > 0).then_some((c.left, c.top, w, h))
    }
}

#[cfg(windows)]
fn poll() -> GameStatus {
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetForegroundWindow, IsIconic};
    unsafe {
        let game = FindWindowW(None, w!("Diablo IV")).ok().filter(|h| !h.is_invalid());
        let fg = GetForegroundWindow();
        let (title, pid, fg_rect) = window_info(fg);
        let focused = title == "Diablo IV";
        let own = pid == std::process::id();
        let rect = if focused {
            client_rect(fg).or(fg_rect)
        } else {
            game.and_then(|h| client_rect(h).or(window_info(h).2))
        };
        let minimized = game.map(|h| IsIconic(h).as_bool()).unwrap_or(false);
        let overlaps = |a: (i32, i32, u32, u32), b: (i32, i32, u32, u32)| {
            let (ax1, ay1) = (a.0 + a.2 as i32, a.1 + a.3 as i32);
            let (bx1, by1) = (b.0 + b.2 as i32, b.1 + b.3 as i32);
            let ix = (ax1.min(bx1) - a.0.max(b.0)).max(0) as i64;
            let iy = (ay1.min(by1) - a.1.max(b.1)).max(0) as i64;
            // "covers" = more than 15% of the game window
            ix * iy > (b.2 as i64 * b.3 as i64) * 15 / 100
        };
        let visible = focused
            || (game.is_some()
                && !minimized
                && match (fg_rect, rect) {
                    (Some(f), Some(g)) => own || !overlaps(f, g),
                    _ => false,
                });
        GameStatus {
            running: game.is_some() || focused,
            focused,
            companion_focused: own,
            visible,
            rect,
            foreground_title: title,
        }
    }
}

#[cfg(not(windows))]
fn poll() -> GameStatus {
    GameStatus::default()
}

pub fn current() -> GameStatus {
    STATUS.lock().unwrap().clone().unwrap_or_else(poll)
}

/// Window mode facts for test mode: outer rect, client size and frame style.
/// Window-manager queries only (same as above): no process handle, nothing in the game.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameWindow {
    pub rect: (i32, i32, u32, u32),
    pub client: (u32, u32),
    /// has a title bar (windowed mode)
    pub caption: bool,
    pub maximized: bool,
}

#[cfg(windows)]
pub fn window_details() -> Option<GameWindow> {
    use windows::core::w;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetClientRect, GetWindowLongPtrW, IsZoomed, GWL_STYLE, WS_CAPTION};
    unsafe {
        let hwnd = FindWindowW(None, w!("Diablo IV")).ok().filter(|h| !h.is_invalid())?;
        let rect = window_info(hwnd).2?;
        let mut c = RECT::default();
        let client = if GetClientRect(hwnd, &mut c).is_ok() { ((c.right - c.left).max(0) as u32, (c.bottom - c.top).max(0) as u32) } else { (rect.2, rect.3) };
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        Some(GameWindow { rect, client, caption: style & WS_CAPTION.0 == WS_CAPTION.0, maximized: IsZoomed(hwnd).as_bool() })
    }
}

#[cfg(not(windows))]
pub fn window_details() -> Option<GameWindow> {
    None
}

fn fit_overlay(app: &AppHandle, rect: (i32, i32, u32, u32)) {
    if let Some(ov) = app.get_webview_window("overlay") {
        let (x, y, w, h) = rect;
        if w < 200 || h < 200 {
            return; // minimised or bogus
        }
        let _ = ov.set_position(PhysicalPosition::new(x, y));
        let _ = ov.set_size(PhysicalSize::new(w, h));
    }
}

pub fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<GameStatus> = None;
        let mut last_emit = Instant::now();
        loop {
            let s = poll();
            let changed = last.as_ref() != Some(&s);
            if changed || last_emit.elapsed() > Duration::from_secs(5) {
                if changed {
                    if let Some(r) = s.rect {
                        if last.as_ref().and_then(|l| l.rect) != Some(r) {
                            fit_overlay(&app, r);
                        }
                    }
                }
                let _ = app.emit("game-status", &s);
                *STATUS.lock().unwrap() = Some(s.clone());
                last = Some(s);
                last_emit = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(350));
        }
    });
}
