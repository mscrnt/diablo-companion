//! Windows.Media.Ocr wrapper — the OCR engine built into Windows 10/11.
//! Fast (tens of ms), offline, good enough for tooltips and HUD numbers.

use image::{imageops::FilterType, DynamicImage, RgbaImage};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct OcrLine {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// colour class of the icon just left of the line (Diablo tooltip bullets):
    /// greater | tempered | enchanted | masterwork | normal | none
    pub bullet: &'static str,
}

/// Classify the tooltip bullet icon left of a text line, from the SAME frame the text
/// was read from (measured on real tooltips): greater = large orange/peach star,
/// tempered = large pale-white glyph, enchanted = small blue ring,
/// masterwork = large purple-blue square, normal = small grey diamond.
pub fn classify_bullet(img: &RgbaImage, x: f32, y: f32, h: f32) -> &'static str {
    let h = h.max(8.0);
    let x0 = (x - 1.7 * h).max(0.0) as u32;
    let x1 = (x - 0.15 * h).max(0.0) as u32;
    let y0 = (y - 0.1 * h).max(0.0) as u32;
    let y1 = ((y + 1.1 * h) as u32).min(img.height());
    if x1 <= x0 + 3 || y1 <= y0 + 3 || x1 > img.width() {
        return "none";
    }
    let (mut bright, mut orange, mut blue, mut white) = (0u32, 0u32, 0u32, 0u32);
    for yy in y0..y1 {
        for xx in x0..x1 {
            let p = img.get_pixel(xx, yy);
            let (r, g, b) = (p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0);
            let max = r.max(g).max(b);
            let min = r.min(g).min(b);
            if max <= 0.45 {
                continue;
            }
            bright += 1;
            let s = if max == 0.0 { 0.0 } else { (max - min) / max };
            let mut hue = if max == min {
                0.0
            } else if max == r {
                60.0 * (((g - b) / (max - min)) % 6.0)
            } else if max == g {
                60.0 * ((b - r) / (max - min) + 2.0)
            } else {
                60.0 * ((r - g) / (max - min) + 4.0)
            };
            if hue < 0.0 {
                hue += 360.0;
            }
            if hue > 10.0 && hue < 50.0 && s > 0.3 {
                orange += 1;
            }
            if hue > 180.0 && hue < 290.0 && s > 0.3 {
                blue += 1;
            }
            if s < 0.22 && max > 0.7 {
                white += 1;
            }
        }
    }
    if bright == 0 {
        return "none";
    }
    let area = ((x1 - x0) * (y1 - y0)) as f32;
    let fb = bright as f32 / area;
    let bf = bright as f32;
    if blue as f32 / bf > 0.5 {
        return if fb > 0.18 { "masterwork" } else { "enchanted" };
    }
    if fb > 0.2 && orange as f32 / bf > 0.12 {
        return "greater";
    }
    if fb > 0.2 && (orange as f32 / bf) < 0.05 && white as f32 / bf > 0.5 {
        return "tempered";
    }
    if fb > 0.04 {
        "normal"
    } else {
        "none"
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct OcrOut {
    pub text: String,
    pub lines: Vec<OcrLine>,
}

#[cfg(windows)]
pub fn recognize(img: &RgbaImage, scale: f32) -> anyhow::Result<OcrOut> {
    recognize_opts(img, scale, false)
}

/// `max_channel`: replace each pixel by max(r,g,b) before OCR. Diablo's coloured
/// tooltip text (orange/yellow/blue on dark) reads much better this way.
#[cfg(windows)]
pub fn recognize_opts(img: &RgbaImage, scale: f32, max_channel: bool) -> anyhow::Result<OcrOut> {
    use windows::core::HSTRING;
    use windows::Globalization::Language;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    unsafe {
        // Ignore the result: already-initialised threads return S_FALSE/RPC_E_CHANGED_MODE.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let mut src = img.clone();
    if max_channel {
        for px in src.pixels_mut() {
            let m = px[0].max(px[1]).max(px[2]);
            px[0] = m;
            px[1] = m;
            px[2] = m;
        }
    }
    let max_dim = OcrEngine::MaxImageDimension().unwrap_or(10000) as f32;
    let mut s = if scale > 0.0 { scale } else { 1.0 };
    let long = src.width().max(src.height()) as f32;
    if long * s > max_dim {
        s = max_dim / long;
    }
    if (s - 1.0).abs() > 0.01 {
        // resize_exact: `resize` keeps the aspect ratio and can land a pixel off the
        // requested size, and SoftwareBitmap then rejects the buffer (OCR silently fails)
        src = DynamicImage::ImageRgba8(src)
            .resize_exact(
                ((img.width() as f32 * s) as u32).max(1),
                ((img.height() as f32 * s) as u32).max(1),
                FilterType::CatmullRom,
            )
            .to_rgba8();
    }

    // always describe the bitmap with the buffer's real size
    let (w, h) = (src.width() as i32, src.height() as i32);
    let s = src.width() as f32 / img.width() as f32;

    // RGBA -> BGRA for SoftwareBitmap
    let mut bgra = src.into_raw();
    for px in bgra.chunks_exact_mut(4) {
        px.swap(0, 2);
    }

    let writer = DataWriter::new()?;
    writer.WriteBytes(&bgra)?;
    let buffer = writer.DetachBuffer()?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h)?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .or_else(|_| OcrEngine::TryCreateFromLanguage(&Language::CreateLanguage(&HSTRING::from("en-US"))?))?;
    let result = engine.RecognizeAsync(&bitmap)?.get()?;

    let mut lines = Vec::new();
    for line in result.Lines()? {
        let text = line.Text()?.to_string();
        let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for word in line.Words()? {
            let r = word.BoundingRect()?;
            x0 = x0.min(r.X);
            y0 = y0.min(r.Y);
            x1 = x1.max(r.X + r.Width);
            y1 = y1.max(r.Y + r.Height);
        }
        // report coordinates in the original (unscaled) image space
        let (lx, ly, lw, lh) = (x0 / s, y0 / s, (x1 - x0) / s, (y1 - y0) / s);
        lines.push(OcrLine {
            text,
            x: lx,
            y: ly,
            w: lw,
            h: lh,
            bullet: classify_bullet(img, lx, ly, lh),
        });
    }
    let text = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n");
    Ok(OcrOut { text, lines })
}

#[cfg(not(windows))]
pub fn recognize(_img: &RgbaImage, _scale: f32) -> anyhow::Result<OcrOut> {
    anyhow::bail!("OCR is only implemented on Windows")
}

#[cfg(not(windows))]
pub fn recognize_opts(_img: &RgbaImage, _scale: f32, _max_channel: bool) -> anyhow::Result<OcrOut> {
    anyhow::bail!("OCR is only implemented on Windows")
}

#[cfg(all(test, windows))]
mod probe {
    /// Manual check: OCR an image both ways. `OCR_PROBE=path cargo test --lib ocr_probe -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn ocr_probe() {
        let path = std::env::var("OCR_PROBE").expect("set OCR_PROBE to an image path");
        let img = image::open(&path).unwrap().to_rgba8();
        for mc in [true, false] {
            let out = super::recognize_opts(&img, 1.3, mc).unwrap();
            println!("== max_channel={mc}: {} lines", out.lines.len());
            for l in out.lines.iter().take(12) {
                println!("   {:>4},{:>4}  {}", l.x as i32, l.y as i32, l.text);
            }
        }
    }
}
