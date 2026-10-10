//! Passive XInput reader: lets controller players trigger companion actions with
//! a button chord. Read-only — we never send input to the game.

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Debug)]
pub struct PadEvent {
    pub pad: u32,
    /// names of buttons held right now
    pub held: Vec<&'static str>,
    /// buttons that went down this tick
    pub pressed: Vec<&'static str>,
}

const BUTTONS: [(u16, &str); 14] = [
    (0x0001, "DPadUp"),
    (0x0002, "DPadDown"),
    (0x0004, "DPadLeft"),
    (0x0008, "DPadRight"),
    (0x0010, "Start"),
    (0x0020, "View"),
    (0x0040, "LS"),
    (0x0080, "RS"),
    (0x0100, "LB"),
    (0x0200, "RB"),
    (0x1000, "A"),
    (0x2000, "B"),
    (0x4000, "X"),
    (0x8000, "Y"),
];

fn names(mask: u32) -> Vec<&'static str> {
    let mut v = Vec::new();
    for (bit, name) in BUTTONS.iter() {
        if mask & (*bit as u32) != 0 {
            v.push(*name);
        }
    }
    if mask & 0x10000 != 0 {
        v.push("LT");
    }
    if mask & 0x20000 != 0 {
        v.push("RT");
    }
    v
}

#[cfg(windows)]
fn read(pad: u32) -> Option<u32> {
    use windows::Win32::UI::Input::XboxController::{XInputGetState, XINPUT_STATE};
    unsafe {
        let mut st = XINPUT_STATE::default();
        if XInputGetState(pad, &mut st) != 0 {
            return None;
        }
        let g = st.Gamepad;
        let mut mask = g.wButtons.0 as u32;
        if g.bLeftTrigger > 128 {
            mask |= 0x10000;
        }
        if g.bRightTrigger > 128 {
            mask |= 0x20000;
        }
        Some(mask)
    }
}

#[cfg(not(windows))]
fn read(_pad: u32) -> Option<u32> {
    None
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = [0u32; 4];
        let mut connected = [false; 4];
        let mut tick: u64 = 0;
        loop {
            for pad in 0..4u32 {
                // Probing disconnected pads is slow-ish; only re-probe every ~2s.
                if !connected[pad as usize] && tick % 100 != 0 {
                    continue;
                }
                match read(pad) {
                    Some(mask) => {
                        connected[pad as usize] = true;
                        let prev = last[pad as usize];
                        if mask != prev {
                            let pressed = names(mask & !prev);
                            if !pressed.is_empty() {
                                let _ = app.emit(
                                    "gamepad",
                                    PadEvent { pad, held: names(mask), pressed },
                                );
                            }
                            last[pad as usize] = mask;
                        }
                    }
                    None => {
                        connected[pad as usize] = false;
                        last[pad as usize] = 0;
                    }
                }
            }
            tick = tick.wrapping_add(1);
            std::thread::sleep(Duration::from_millis(20));
        }
    });
}
