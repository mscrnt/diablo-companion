//! Reads the player's own Diablo IV install: finds the folder, copies the data files we need out
//! of CASC with the cascx sidecar, and keeps the parsed result in the app's cache folder.
//!
//! Account safety, and the rules this file follows:
//!   - the game folder is only ever READ. cascx strips write access from every handle CascLib opens
//!     (see tools/datamine/cascx/cascx.cpp), and nothing here writes, moves or locks a game file.
//!   - the game process is never touched: no OpenProcess, no memory, no handles, no input. The
//!     install path comes from the registry, Battle.net's own product.db, or the player.
//!   - cascx runs at below-normal priority with no console window, so a player can read the game
//!     data while playing.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ------------------------------------------------------------------------------------------------
// install detection

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub dir: String,
    /// where it came from: "registry", "battle.net", "common", "settings"
    pub source: &'static str,
    /// `.build.info` and a Data folder are both there
    pub valid: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Detected {
    /// the first candidate that looks like a real install
    pub dir: Option<String>,
    pub candidates: Vec<Candidate>,
}

/// A Diablo IV install is a folder with a `.build.info` next to a `Data` folder.
pub fn looks_like_install(dir: &Path) -> bool {
    dir.join(".build.info").is_file() && dir.join("Data").is_dir()
}

#[cfg(windows)]
fn reg_string(hive: windows::Win32::System::Registry::HKEY, subkey: &str, value: &str) -> Option<String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ, RRF_SUBKEY_WOW6432KEY, RRF_SUBKEY_WOW6464KEY};
    let sub = HSTRING::from(subkey);
    let val = HSTRING::from(value);
    // the uninstall entry lives in the 32-bit view on a 64-bit Windows, so try both
    for flags in [RRF_RT_REG_SZ | RRF_SUBKEY_WOW6432KEY, RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY, RRF_RT_REG_SZ] {
        let mut len: u32 = 0;
        unsafe {
            if RegGetValueW(hive, PCWSTR(sub.as_ptr()), PCWSTR(val.as_ptr()), flags, None, None, Some(&mut len)).is_err() || len < 4 {
                continue;
            }
            let mut buf = vec![0u16; (len as usize / 2) + 1];
            let mut got = len;
            if RegGetValueW(hive, PCWSTR(sub.as_ptr()), PCWSTR(val.as_ptr()), flags, None, Some(buf.as_mut_ptr() as *mut _), Some(&mut got)).is_err() {
                continue;
            }
            let chars = (got as usize / 2).min(buf.len());
            let s = String::from_utf16_lossy(&buf[..chars]);
            let s = s.trim_end_matches('\0').trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn reg_string(_hive: u32, _subkey: &str, _value: &str) -> Option<String> {
    None
}

/// The uninstall entry Battle.net writes: `InstallLocation` under `...\Uninstall\Diablo IV`.
#[cfg(windows)]
fn from_registry() -> Vec<String> {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let mut out = Vec::new();
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for key in [
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Diablo IV",
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Diablo IV_is1",
        ] {
            if let Some(p) = reg_string(hive, key, "InstallLocation") {
                if !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    out
}

#[cfg(not(windows))]
fn from_registry() -> Vec<String> {
    Vec::new()
}

/// Battle.net's own `product.db` (a small protobuf). We don't decode it: we look for the game's
/// product code ("fenris") and take the install path that follows it. Read-only, and it is fine
/// for this to find nothing.
fn from_battle_net() -> Vec<String> {
    let db = Path::new(r"C:\ProgramData\Battle.net\Agent\product.db");
    let Ok(bytes) = std::fs::read(db) else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    let needle = b"fenris";
    let mut i = 0usize;
    while let Some(at) = find(&bytes[i..], needle) {
        let from = i + at + needle.len();
        let to = (from + 512).min(bytes.len());
        if let Some(p) = first_path(&bytes[from..to]) {
            if !out.contains(&p) {
                out.push(p);
            }
        }
        i = from;
    }
    out
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// The first "X:/..." or "X:\..." run of printable ASCII in a slice, as a Windows path.
fn first_path(buf: &[u8]) -> Option<String> {
    let mut i = 0;
    while i + 3 < buf.len() {
        let c = buf[i];
        if c.is_ascii_alphabetic() && buf[i + 1] == b':' && (buf[i + 2] == b'/' || buf[i + 2] == b'\\') {
            let mut j = i;
            while j < buf.len() && buf[j] >= 0x20 && buf[j] < 0x7f {
                j += 1;
            }
            let s = String::from_utf8_lossy(&buf[i..j]).replace('/', "\\");
            let s = s.trim_end_matches('\\').to_string();
            if s.len() >= 4 {
                return Some(s);
            }
        }
        i += 1;
    }
    None
}

/// Where Battle.net and Steam usually put it, on every fixed drive.
fn common_paths() -> Vec<String> {
    let suffixes = [
        r"Diablo IV",
        r"Blizzard\Diablo IV",
        r"Games\Diablo IV",
        r"Program Files (x86)\Diablo IV",
        r"Program Files\Diablo IV",
        r"Program Files (x86)\Battle.net\Diablo IV",
        r"SteamLibrary\steamapps\common\Diablo IV",
        r"Steam\steamapps\common\Diablo IV",
        r"Program Files (x86)\Steam\steamapps\common\Diablo IV",
    ];
    let mut out = Vec::new();
    for drive in drives() {
        for s in suffixes {
            let p = format!("{drive}{s}");
            if looks_like_install(Path::new(&p)) {
                out.push(p);
            }
        }
    }
    out
}

#[cfg(windows)]
fn drives() -> Vec<String> {
    use windows::Win32::Storage::FileSystem::GetLogicalDrives;
    let mask = unsafe { GetLogicalDrives() };
    (0u32..26)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| format!("{}:\\", (b'A' + i as u8) as char))
        .collect()
}

#[cfg(not(windows))]
fn drives() -> Vec<String> {
    Vec::new()
}

/// Look for the game, cheapest and most reliable source first. `saved` is what Settings remembers.
#[tauri::command]
pub fn gamedata_detect(saved: Option<String>) -> Detected {
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut push = |dir: String, source: &'static str| {
        if candidates.iter().any(|c| c.dir.eq_ignore_ascii_case(&dir)) {
            return;
        }
        let valid = looks_like_install(Path::new(&dir));
        candidates.push(Candidate { dir, source, valid });
    };
    if let Some(s) = saved.filter(|s| !s.is_empty()) {
        push(s, "settings");
    }
    for p in from_registry() {
        push(p, "registry");
    }
    for p in from_battle_net() {
        push(p, "battle.net");
    }
    for p in common_paths() {
        push(p, "common");
    }
    let dir = candidates.iter().find(|c| c.valid).map(|c| c.dir.clone());
    Detected { dir, candidates }
}

/// `.build.info` as text, so the one parser for it stays in TypeScript. Only that one file is read.
#[tauri::command]
pub fn gamedata_build_info(dir: String) -> Result<String, String> {
    let p = Path::new(&dir);
    if !looks_like_install(p) {
        return Err(format!("{dir} does not look like a Diablo IV folder"));
    }
    std::fs::read_to_string(p.join(".build.info")).map_err(err)
}

/// "Choose folder" when the game is somewhere unusual. A plain Windows folder picker.
#[cfg(windows)]
#[tauri::command]
pub async fn gamedata_pick_folder() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(pick_folder_blocking).await.map_err(err)?
}

#[cfg(windows)]
fn pick_folder_blocking() -> Result<Option<String>, String> {
    use windows::core::Interface;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH};
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let out = (|| -> Result<Option<String>, String> {
            let dlg: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).map_err(err)?;
            let opts = dlg.GetOptions().map_err(err)?;
            dlg.SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST).map_err(err)?;
            let _ = dlg.SetTitle(windows::core::w!("Where is Diablo IV installed?"));
            if dlg.Show(None).is_err() {
                return Ok(None); // the player cancelled
            }
            let item = dlg.GetResult().map_err(err)?;
            let pw = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(err)?;
            let s = pw.to_string().map_err(err)?;
            CoTaskMemFree(Some(pw.0 as *const _));
            drop(dlg.cast::<windows::core::IUnknown>());
            Ok(Some(s))
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        out
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn gamedata_pick_folder() -> Result<Option<String>, String> {
    Ok(None)
}

// ------------------------------------------------------------------------------------------------
// the app's cache folder

/// `%LOCALAPPDATA%\com.kenneth.d4companion\gamedata`: the raw copies and the parsed JSON.
fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(err)?.join("gamedata");
    std::fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

/// Resolve a relative path inside the cache folder, refusing anything that climbs out of it.
fn cache_path(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    let root = cache_root(app)?;
    let mut p = root.clone();
    for part in rel.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.contains(':') {
            return Err(format!("bad path: {rel}"));
        }
        p.push(part);
    }
    if !p.starts_with(&root) {
        return Err(format!("bad path: {rel}"));
    }
    Ok(p)
}

#[tauri::command]
pub fn gamedata_cache_dir(app: AppHandle) -> Result<String, String> {
    Ok(cache_root(&app)?.to_string_lossy().into_owned())
}

/// Several cached files in one call, as one buffer:
/// `[u32 count][u32 len per file]...[bytes...]`, with len = 0xFFFFFFFF for a file that isn't there.
/// One call per few hundred files keeps 35 000 meta files down to a couple of hundred round trips.
#[tauri::command]
pub fn gamedata_read_batch(app: AppHandle, rels: Vec<String>) -> Result<tauri::ipc::Response, String> {
    let mut bodies: Vec<Option<Vec<u8>>> = Vec::with_capacity(rels.len());
    let mut total = 0usize;
    for rel in &rels {
        let body = cache_path(&app, rel).ok().and_then(|p| std::fs::read(p).ok());
        total += body.as_ref().map_or(0, |b| b.len());
        bodies.push(body);
    }
    let mut out = Vec::with_capacity(4 + bodies.len() * 4 + total);
    out.extend_from_slice(&(bodies.len() as u32).to_le_bytes());
    for b in &bodies {
        out.extend_from_slice(&b.as_ref().map_or(u32::MAX, |b| b.len() as u32).to_le_bytes());
    }
    for b in bodies {
        if let Some(b) = b {
            out.extend_from_slice(&b);
        }
    }
    Ok(tauri::ipc::Response::new(out))
}

#[tauri::command]
pub fn gamedata_list(app: AppHandle, rel: String) -> Result<Vec<String>, String> {
    let p = cache_path(&app, &rel)?;
    let Ok(rd) = std::fs::read_dir(&p) else { return Ok(Vec::new()) };
    Ok(rd
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect())
}

/// Which game builds the cache holds a finished read for (the folders with a cache.json in them).
#[tauri::command]
pub fn gamedata_builds(app: AppHandle) -> Result<Vec<String>, String> {
    let root = cache_root(&app)?;
    let Ok(rd) = std::fs::read_dir(&root) else { return Ok(Vec::new()) };
    let mut out: Vec<String> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false) && e.path().join("cache.json").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    out.sort();
    Ok(out)
}

#[tauri::command]
pub fn gamedata_write(app: AppHandle, rel: String, text: String) -> Result<(), String> {
    let p = cache_path(&app, &rel)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(err)?;
    }
    std::fs::write(p, text).map_err(err)
}

#[tauri::command]
pub fn gamedata_read_text(app: AppHandle, rel: String) -> Result<Option<String>, String> {
    let p = cache_path(&app, &rel)?;
    Ok(std::fs::read_to_string(p).ok())
}

/// Empty one of OUR folders inside the cache. Never anything in the game install.
#[tauri::command]
pub fn gamedata_clean(app: AppHandle, rel: String) -> Result<(), String> {
    let p = cache_path(&app, &rel)?;
    if p == cache_root(&app)? {
        return Err("refusing to empty the whole cache folder".into());
    }
    if p.is_dir() {
        let _ = std::fs::remove_dir_all(&p);
    }
    std::fs::create_dir_all(&p).map_err(err)
}

/// Delete everything under the cache folder except `keep` (the build we just read).
#[tauri::command]
pub fn gamedata_prune(app: AppHandle, keep: Vec<String>) -> Result<u64, String> {
    let root = cache_root(&app)?;
    let mut freed = 0;
    for e in std::fs::read_dir(&root).map_err(err)?.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().into_owned();
        if keep.contains(&name) {
            continue;
        }
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            freed += dir_size(&e.path());
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
    Ok(freed)
}

fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.filter_map(|e| e.ok())
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

#[tauri::command]
pub fn gamedata_dir_size(app: AppHandle, rel: String) -> Result<u64, String> {
    Ok(dir_size(&cache_path(&app, &rel)?))
}

/// A bundled d4data file (the parser's type definitions, MIT, see resources/d4data/README.md).
/// Bytes, not a string, so the 7.6 MB definitions.json does not go through JSON escaping.
#[tauri::command]
pub fn gamedata_resource(app: AppHandle, rel: String) -> Result<tauri::ipc::Response, String> {
    if rel.contains("..") || rel.contains(':') {
        return Err(format!("bad resource path: {rel}"));
    }
    let base = app.path().resource_dir().map_err(err)?.join("resources/d4data");
    let p = base.join(rel.replace('\\', "/"));
    let mut f = std::fs::File::open(&p).map_err(|e| format!("{}: {e}", p.display()))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(err)?;
    Ok(tauri::ipc::Response::new(buf))
}

// ------------------------------------------------------------------------------------------------
// cascx: the read-only copy out of CASC

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CascOut {
    pub matched: u32,
    pub extracted: u32,
    /// files cascx could not read, normally the ones this build keeps encrypted
    pub failed: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CascArgs {
    /// the game folder
    pub game: String,
    /// where to put the copies, relative to the cache folder
    pub raw: String,
    /// storage names, or globs in "mask" mode
    pub names: Vec<String>,
    pub mode: String,
}

/// Where the sidecar ended up: beside our exe once installed, in the cargo target dir in dev.
fn cascx_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("D4C_CASCX") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
    }
    let exe = std::env::current_exe().map_err(err)?;
    let dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut tries = vec![dir.join("cascx.exe"), dir.join("cascx-x86_64-pc-windows-msvc.exe")];
    if let Ok(r) = app.path().resource_dir() {
        tries.push(r.join("cascx.exe"));
    }
    // `cargo run` / `cargo test` from src-tauri: the committed-out sidecar folder
    if let Some(manifest) = option_env!("CARGO_MANIFEST_DIR") {
        tries.push(Path::new(manifest).join("bin").join("cascx-x86_64-pc-windows-msvc.exe"));
    }
    tries
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| "cascx.exe is missing from this build".to_string())
}

/// Copy files out of the game's CASC storage into the cache folder.
///
/// cascx only ever opens game files for reading, and it runs below normal priority with no console
/// window so a player can keep playing while this works.
#[tauri::command]
pub async fn gamedata_casc(app: AppHandle, args: CascArgs) -> Result<CascOut, String> {
    let raw = cache_path(&app, &args.raw)?;
    let cascx = cascx_path(&app)?;
    if !looks_like_install(Path::new(&args.game)) {
        return Err(format!("{} does not look like a Diablo IV folder", args.game));
    }
    tauri::async_runtime::spawn_blocking(move || run_cascx(&cascx, &args, &raw)).await.map_err(err)?
}

fn run_cascx(cascx: &Path, args: &CascArgs, raw: &Path) -> Result<CascOut, String> {
    use std::process::Command;
    std::fs::create_dir_all(raw).map_err(err)?;
    let mut cmd = Command::new(cascx);
    cmd.arg(&args.game);
    match args.mode.as_str() {
        "mask" => {
            cmd.arg("extract").arg(raw);
            for n in &args.names {
                cmd.arg(n);
            }
        }
        "list" => {
            let list = raw.join("casc-list.txt");
            std::fs::write(&list, args.names.join("\n")).map_err(err)?;
            cmd.arg("extract-list").arg(raw).arg(&list);
        }
        other => return Err(format!("unknown casc mode {other}")),
    }
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
    let out = cmd.output().map_err(|e| format!("could not run cascx: {e}"))?;
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let stats = parse_casc_stats(&stderr);
    // exit code 3 means some files failed, which is normal: this build keeps some of them encrypted
    match out.status.code() {
        Some(0) | Some(3) => stats.ok_or_else(|| format!("cascx said nothing useful: {stderr}")),
        _ => Err(format!("cascx failed: {}", stderr.trim())),
    }
}

/// cascx's summary line, e.g. "matched=120 extracted=118 failed=2".
pub fn parse_casc_stats(stderr: &str) -> Option<CascOut> {
    let at = stderr.rfind("matched=")?;
    let mut out = CascOut::default();
    for part in stderr[at..].split_whitespace() {
        let (k, v) = part.split_once('=')?;
        let v: u32 = v.trim().parse().ok()?;
        match k {
            "matched" => out.matched = v,
            "extracted" => out.extracted = v,
            "failed" => out.failed = v,
            _ => return None,
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_cascx_stats() {
        let s = parse_casc_stats("wanted=5\nmatched=120 extracted=118 failed=2\n").unwrap();
        assert_eq!((s.matched, s.extracted, s.failed), (120, 118, 2));
        assert!(parse_casc_stats("open failed (2): base:meta\\1").is_none());
    }

    #[test]
    fn finds_the_install_path_in_a_product_db_blob() {
        // the shape Battle.net's product.db has: the product code, then the install path
        let mut blob = b"\x08\x01battle.net\x12\x1fC:/Program Files (x86)/Battle.net".to_vec();
        blob.extend_from_slice(b"\x1a\x06fenris\x22\x15G:/Blizzard/Diablo IV\x12\x04enUS");
        let at = find(&blob, b"fenris").unwrap() + 6;
        assert_eq!(first_path(&blob[at..]).unwrap(), r"G:\Blizzard\Diablo IV");
    }

    #[test]
    fn a_path_without_a_drive_letter_is_not_one() {
        assert!(first_path(b"\x12\x04enUS\x00\x00").is_none());
        assert!(first_path(b"xx").is_none());
    }

    #[test]
    fn cache_paths_cannot_climb_out() {
        // the rel-path rules, without an AppHandle: the same split/reject the resolver uses
        for bad in ["../x", "a/../../b", "C:/Windows", "a\\..\\..\\b"] {
            let mut ok = true;
            for part in bad.split(['/', '\\']) {
                if part == ".." || part.contains(':') {
                    ok = false;
                }
            }
            assert!(!ok, "{bad} should be rejected");
        }
        for good in ["3.2.3/raw/base/meta/123", "strings/ui.json", "./a.json"] {
            for part in good.split(['/', '\\']) {
                assert!(part != ".." && !part.contains(':'), "{good} should be allowed");
            }
        }
    }
}
