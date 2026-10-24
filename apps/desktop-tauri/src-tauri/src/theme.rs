//! Theme state + helpers. P0 keeps the mode in-memory (default `system`).
//! P2 moves it to `desktop-prefs.json`.

use serde::Serialize;
use std::sync::Mutex;

/// Accepted theme modes — mirrors `shared/theme.ts` (`isThemeMode`).
pub fn is_theme_mode(mode: &str) -> bool {
    matches!(mode, "system" | "light" | "dark")
}

/// Snapshot emitted as the `theme:changed` payload and returned by `theme_get`.
#[derive(Serialize, Clone)]
pub struct ThemeSnapshot {
    pub mode: String,
    pub resolved: String,
}

pub struct ThemeState(Mutex<ThemeSnapshot>);

impl Default for ThemeState {
    fn default() -> Self {
        Self(Mutex::new(ThemeSnapshot {
            mode: "system".to_string(),
            // In `system` mode the real OS appearance is unknown at P0; default
            // to light. P2/P3 resolve against the OS appearance.
            resolved: "light".to_string(),
        }))
    }
}

impl ThemeState {
    pub fn snapshot(&self) -> ThemeSnapshot {
        self.0.lock().unwrap().clone()
    }

    /// Update the stored mode. `resolved` equals `mode` unless `mode` is
    /// `system`, in which case it tracks the OS appearance via
    /// [`ThemeState::set_os_resolved`].
    pub fn set_mode(&self, mode: &str) -> ThemeSnapshot {
        let mut state = self.0.lock().unwrap();
        state.mode = mode.to_string();
        if mode != "system" {
            state.resolved = mode.to_string();
        }
        state.clone()
    }

    /// Re-resolve `system` mode against the OS appearance. Returns the new
    /// snapshot when the resolved value actually changed (caller broadcasts),
    /// `None` otherwise (mode is explicit, or the OS theme didn't change).
    pub fn set_os_resolved(&self, resolved: &str) -> Option<ThemeSnapshot> {
        let mut state = self.0.lock().unwrap();
        if state.mode != "system" || state.resolved == resolved {
            return None;
        }
        state.resolved = resolved.to_string();
        Some(state.clone())
    }
}

/// Apply an OS appearance change (`WindowEvent::ThemeChanged` / startup probe):
/// update `system`-mode resolution and broadcast `theme:changed` to all
/// webviews when it flipped.
pub fn on_os_theme(app: &tauri::AppHandle, theme: tauri::Theme) {
    let resolved = match theme {
        tauri::Theme::Dark => "dark",
        _ => "light",
    };
    use tauri::Manager as _;
    let state = app.state::<ThemeState>();
    if let Some(snapshot) = state.set_os_resolved(resolved) {
        eprintln!(
            "[tud-desktop] os appearance changed -> resolved={resolved} (mode={})",
            snapshot.mode
        );
        use tauri::Emitter as _;
        let _ = app.emit("theme:changed", &snapshot);
    }
}
