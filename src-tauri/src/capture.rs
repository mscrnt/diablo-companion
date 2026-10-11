//! Screen capture helpers. Captures are taken with GDI via xcap (works with the
//! game in borderless-windowed mode), optionally OCR'd, downscaled and returned
//! to the frontend as base64 JPEG so they can be shown or sent to a vision LLM.

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, DynamicImage, RgbaImage};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use xcap::Monitor;

use crate::ocr::{self, OcrOut};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    /// base64 JPEG (no data: prefix)
    pub image: String,
    /// encoded image size (after downscale)
    pub width: u32,
    pub height: u32,
    /// absolute screen region that was captured (physical px)
    pub region: Rect,
    pub monitor: Rect,
    pub cursor: (i32, i32),
    pub ocr: Option<OcrOut>,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOpts {
    /// longest edge after downscale (0 = keep)
    #[serde(default)]
    pub max_edge: u32,
    /// JPEG quality 1..100
    #[serde(default)]
    pub quality: u8,
    /// run Windows OCR on the full-res capture
    #[serde(default)]
    pub ocr: bool,
    /// upscale factor applied before OCR (small regions read better at 2x)
    #[serde(default)]
    pub ocr_scale: f32,
    /// max(r,g,b) preprocess before OCR (better for coloured game text)
    #[serde(default)]
    pub ocr_max_channel: bool,
}

pub fn cursor_pos() -> (i32, i32) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
        let mut p = POINT::default();
        if GetCursorPos(&mut p).is_ok() {
            return (p.x, p.y);
        }
    }
    (0, 0)
}

/// Is a mouse button held down (left or right, physical buttons)? Read-only: the same OS state any
/// app can query; nothing is sent to the game. Used to hide map pins while you drag the map.
pub fn mouse_down() -> bool {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
        return (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 || (GetAsyncKeyState(VK_RBUTTON.0 as i32) as u16 & 0x8000) != 0;
    }
    #[allow(unreachable_code)]
    false
}

fn monitor_rect(m: &Monitor) -> anyhow::Result<Rect> {
    Ok(Rect {
        x: m.x()?,
        y: m.y()?,
        w: m.width()?,
        h: m.height()?,
    })
}

fn monitor_at(x: i32, y: i32) -> anyhow::Result<Monitor> {
    match Monitor::from_point(x, y) {
        Ok(m) => Ok(m),
        Err(_) => Monitor::all()?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("no monitors found")),
    }
}

/// Clamp an absolute rect to the monitor and convert to monitor-relative coords.
fn clamp_to_monitor(r: Rect, mon: Rect) -> Rect {
    let x0 = r.x.max(mon.x);
    let y0 = r.y.max(mon.y);
    let x1 = (r.x + r.w as i32).min(mon.x + mon.w as i32);
    let y1 = (r.y + r.h as i32).min(mon.y + mon.h as i32);
    Rect {
        x: x0,
        y: y0,
        w: (x1 - x0).max(1) as u32,
        h: (y1 - y0).max(1) as u32,
    }
}

fn grab(mon: &Monitor, monr: Rect, abs: Rect) -> anyhow::Result<(RgbaImage, Rect)> {
    let r = clamp_to_monitor(abs, monr);
    let img = if r.x == monr.x && r.y == monr.y && r.w == monr.w && r.h == monr.h {
        mon.capture_image()?
    } else {
        // capture_region takes monitor-relative coordinates
        match mon.capture_region((r.x - monr.x) as u32, (r.y - monr.y) as u32, r.w, r.h) {
            Ok(i) => i,
            Err(_) => {
                let full = mon.capture_image()?;
                image::imageops::crop_imm(&full, (r.x - monr.x) as u32, (r.y - monr.y) as u32, r.w, r.h)
                    .to_image()
            }
        }
    };
    Ok((img, r))
}

fn encode(img: RgbaImage, opts: &CaptureOpts) -> anyhow::Result<(String, u32, u32)> {
    let mut dynimg = DynamicImage::ImageRgba8(img);
    if opts.max_edge > 0 {
        let (w, h) = (dynimg.width(), dynimg.height());
        let long = w.max(h);
        if long > opts.max_edge {
            let s = opts.max_edge as f32 / long as f32;
            dynimg = dynimg.resize(
                (w as f32 * s) as u32,
                (h as f32 * s) as u32,
                FilterType::Triangle,
            );
        }
    }
    let rgb = dynimg.to_rgb8();
    let (w, h) = (rgb.width(), rgb.height());
    let mut buf = Cursor::new(Vec::new());
    let q = if opts.quality == 0 { 85 } else { opts.quality.min(100) };
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, q);
    enc.encode_image(&rgb)?;
    Ok((STANDARD.encode(buf.into_inner()), w, h))
}

fn finish(img: RgbaImage, region: Rect, monr: Rect, opts: &CaptureOpts) -> anyhow::Result<CaptureResult> {
    let ocr = if opts.ocr {
        let scale = if opts.ocr_scale > 0.0 { opts.ocr_scale } else { 1.0 };
        ocr::recognize_opts(&img, scale, opts.ocr_max_channel).ok()
    } else {
        None
    };
    let (image, width, height) = encode(img, opts)?;
    Ok(CaptureResult {
        image,
        width,
        height,
        region,
        monitor: monr,
        cursor: cursor_pos(),
        ocr,
    })
}

/// Capture a box centred on the cursor. A `w`/`h` of 0 spans the whole monitor on that axis.
pub fn at_cursor(w: u32, h: u32, opts: &CaptureOpts) -> anyhow::Result<CaptureResult> {
    let (cx, cy) = cursor_pos();
    let mon = monitor_at(cx, cy)?;
    let monr = monitor_rect(&mon)?;
    // 0 = full monitor extent on that axis (tooltips can be taller than any fixed box)
    let (x, ww) = if w == 0 { (monr.x, monr.w) } else { (cx - (w / 2) as i32, w) };
    let (y, hh) = if h == 0 { (monr.y, monr.h) } else { (cy - (h / 2) as i32, h) };
    let abs = Rect { x, y, w: ww, h: hh };
    let (img, r) = grab(&mon, monr, abs)?;
    finish(img, r, monr, opts)
}

/// Capture an absolute screen rectangle.
pub fn region(abs: Rect, opts: &CaptureOpts) -> anyhow::Result<CaptureResult> {
    let mon = monitor_at(abs.x + abs.w as i32 / 2, abs.y + abs.h as i32 / 2)?;
    let monr = monitor_rect(&mon)?;
    let (img, r) = grab(&mon, monr, abs)?;
    finish(img, r, monr, opts)
}

/// Capture the full monitor that contains the given point (or the cursor).
pub fn monitor(point: Option<(i32, i32)>, opts: &CaptureOpts) -> anyhow::Result<CaptureResult> {
    let (x, y) = point.unwrap_or_else(cursor_pos);
    let mon = monitor_at(x, y)?;
    let monr = monitor_rect(&mon)?;
    let img = mon.capture_image()?;
    finish(img, monr, monr, opts)
}

pub fn list_monitors() -> anyhow::Result<Vec<(String, Rect, bool)>> {
    Monitor::all()?
        .iter()
        .map(|m| Ok((m.name()?, monitor_rect(m)?, m.is_primary().unwrap_or(false))))
        .collect()
}
