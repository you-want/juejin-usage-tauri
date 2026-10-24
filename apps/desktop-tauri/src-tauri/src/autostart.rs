//! OS login-item management — replaces `tauri-plugin-autostart`, whose args
//! are fixed at plugin init. Electron parity needs the login item to carry
//! `--hidden` only when the launchHidden preference is on, so registration is
//! performed here with full control over the arguments:
//!
//! - macOS: LaunchAgent plist `~/Library/LaunchAgents/com.juejin.tud.desktop.plist`
//!   (the same mechanism the CLI uses; `evict-cli-autostart` only evicts the
//!   CLI's own labels, never this one)
//! - Windows: `HKCU\...\Run` via `reg.exe` (no admin needed)
//! - Linux: `~/.config/autostart/juejin-usage.desktop`
//!
//! `is_enabled` reports the actual registration (file/registry presence), so
//! the settings toggle reflects reality even if the entry was removed out of
//! band.

use std::path::PathBuf;

const LABEL: &str = "com.juejin.tud.desktop";

fn home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn plist_path() -> PathBuf {
    home().join("Library/LaunchAgents").join(format!("{LABEL}.plist"))
}

#[cfg(target_os = "macos")]
fn plist_contents(launch_hidden: bool) -> String {
    let hidden = if launch_hidden {
        "\n    <string>--hidden</string>"
    } else {
        ""
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe}</string>{hidden}
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
"#,
        exe = exe_path(),
        hidden = hidden,
    )
}

#[cfg(target_os = "linux")]
fn desktop_path() -> PathBuf {
    home().join(".config/autostart/juejin-usage.desktop")
}

/// Register / unregister the login item. Best-effort: errors are logged by the
/// caller (the prefs already changed; the OS entry self-heals on next toggle).
pub fn apply(open_at_login: bool, launch_hidden: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let path = plist_path();
        if open_at_login {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&path, plist_contents(launch_hidden)).map_err(|e| e.to_string())?;
        } else if path.exists() {
            // Best-effort unload so a running agent stops immediately.
            let uid = users_uid();
            let _ = std::process::Command::new("launchctl")
                .args(["bootout", &format!("gui/{uid}/{LABEL}")])
                .status();
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let path = desktop_path();
        if open_at_login {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let exec = if launch_hidden {
                format!("Exec={} --hidden\n", exe_path())
            } else {
                format!("Exec={}\n", exe_path())
            };
            let contents = format!(
                "[Desktop Entry]\nType=Application\nName=Juejin Usage\n{exec}X-GNOME-Autostart-enabled=true\n"
            );
            std::fs::write(&path, contents).map_err(|e| e.to_string())?;
        } else if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        const RUN_KEY: &str = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        const VALUE: &str = "JuejinUsage";
        if open_at_login {
            let quoted = format!("\"{}\"", exe_path());
            let data = if launch_hidden {
                format!("{quoted} --hidden")
            } else {
                quoted
            };
            std::process::Command::new("reg")
                .args(["add", RUN_KEY, "/v", VALUE, "/t", "REG_SZ", "/d", &data, "/f"])
                .output()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("reg")
                .args(["delete", RUN_KEY, "/v", VALUE, "/f"])
                .output()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (open_at_login, launch_hidden);
    }
    Ok(())
}

/// Whether the login item is currently registered (OS state, not the pref).
pub fn is_enabled() -> bool {
    #[cfg(target_os = "macos")]
    {
        plist_path().exists()
    }
    #[cfg(target_os = "linux")]
    {
        desktop_path().exists()
    }
    #[cfg(target_os = "windows")]
    {
        const RUN_KEY: &str = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
        std::process::Command::new("reg")
            .args(["query", RUN_KEY, "/v", "JuejinUsage"])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
fn users_uid() -> String {
    std::process::Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "501".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_plist_carries_hidden_arg_only_when_requested() {
        let with = plist_contents(true);
        assert!(with.contains("<string>--hidden</string>"));
        let without = plist_contents(false);
        assert!(!without.contains("--hidden"));
        assert!(without.contains("RunAtLoad"));
        assert!(without.contains(LABEL));
    }
}
