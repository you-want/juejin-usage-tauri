//! System tray icon + macOS tray popover window (P2).
//!
//! Mirrors the Electron `TrayPopover.ts`: a menu-bar/tray icon keeps the app
//! alive after the main window is closed (see `lib.rs`'s close-to-tray), and
//! a left-click toggles a borderless "popover" `WebviewWindow` that loads the
//! same renderer at `index.html?view=tray-popover`. The tray menu is
//! 显示主窗口 / 同步数据 / 设置 / 退出.
//!
//! The popover is created lazily (first toggle) and stays resident while
//! hidden, like Electron's. `resize_tray_popover` (called by the renderer as
//! its content height changes) re-anchors it under the top-right corner of the
//! primary monitor's work area — Tauri's tray has no `getBounds()` equivalent,
//! so we anchor to the monitor corner instead.

use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Size, WebviewUrl,
    WebviewWindowBuilder,
};

use crate::sidecar;

/// Fixed logical width of the popover, matching `TrayPopoverView`'s caps.
const POPOVER_WIDTH: u32 = 420;
const POPOVER_MIN_HEIGHT: u32 = 200;
const POPOVER_MAX_HEIGHT: u32 = 700;
/// Initial height; the renderer reports its real content height on first paint.
const POPOVER_INITIAL_HEIGHT: u32 = POPOVER_MIN_HEIGHT;
const POPOVER_MARGIN: f64 = 6.0;
const POPOVER_LABEL: &str = "tray-popover";

/// Latest content height reported by the popover's renderer.
static POPOVER_HEIGHT: Mutex<Option<u32>> = Mutex::new(None);

/// The live tray handle, kept so the usage capsule (`set_title`) and the
/// popover anchor (`rect()`) can reach it after `create` returns.
pub struct TrayState(pub Mutex<Option<tauri::tray::TrayIcon>>);

impl Default for TrayState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

/// Electron parity for `shared/tray-usage.ts` — compact token/cost strings for
/// the macOS menu-bar capsule.
fn format_compact_tokens(tokens: f64) -> String {
    let fmt = |v: f64, unit: &str| {
        let s = format!("{v:.1}");
        let s = s.strip_suffix(".0").unwrap_or(&s).to_string();
        format!("{s}{unit}")
    };
    if tokens >= 1_000_000_000.0 {
        fmt(tokens / 1_000_000_000.0, "B")
    } else if tokens >= 1_000_000.0 {
        fmt(tokens / 1_000_000.0, "M")
    } else if tokens >= 1_000.0 {
        fmt(tokens / 1_000.0, "K")
    } else {
        format!("{}", tokens.round() as u64)
    }
}

fn format_tray_usage(today_tokens: f64, today_cost_usd: f64, mode: &str) -> String {
    let token_text = format!("{} Token", format_compact_tokens(today_tokens));
    let cost_text = if today_cost_usd > 0.0 && today_cost_usd.is_finite() {
        if today_cost_usd < 0.01 {
            "<$0.01".to_string()
        } else {
            format!("${today_cost_usd:.2}")
        }
    } else {
        "$0.00".to_string()
    };
    match mode {
        "tokens" => token_text,
        "cost" => cost_text,
        _ => format!("{token_text} · {cost_text}"),
    }
}

/// Refresh the macOS menu-bar usage capsule from the sidecar's summary.
/// No-op (and title cleared) elsewhere or when the pref is off. Called on
/// sidecar boot, every sync, and whenever the prefs change.
pub fn refresh_usage_title(app: &AppHandle) {
    let prefs = app.state::<crate::prefs::PrefsState>().get();
    let Some(tray) = app.state::<TrayState>().0.lock().unwrap().clone() else {
        return;
    };
    if !prefs.show_tray_usage {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let _ = tray.set_title(None::<String>);
        return;
    }
    let sidecar = app.state::<crate::sidecar::SidecarState>();
    let Ok((status, body)) =
        crate::sidecar::http_call(&sidecar, "GET", "/functions/tud-usage-summary", None)
    else {
        return;
    };
    let Ok(data) = crate::sidecar::envelope_data(status, &body) else {
        return;
    };
    let tokens = data.get("todayTokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let cost = data.get("todayCostUsd").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let title = format_tray_usage(tokens, cost, &prefs.tray_usage_mode);
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let _ = tray.set_title(Some(title));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = title;
}

/// Resolve the tray icon. Release builds read it from the bundled resource;
/// dev falls back to the file on disk next to the crate. Try the resource
/// first and fall back to the crate path so the icon loads in both modes.
fn tray_icon_image(app: &AppHandle) -> Result<Image<'static>, String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(resource) = app
        .path()
        .resolve("icons/juejinTemplate@2x.png", tauri::path::BaseDirectory::Resource)
    {
        candidates.push(resource);
    }
    let crate_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    candidates.push(crate_dir.join("icons/juejinTemplate@2x.png"));

    let mut last_err = String::from("no tray icon candidate resolved");
    for candidate in candidates {
        match Image::from_path(candidate) {
            Ok(image) => return Ok(image),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(last_err)
}

/// Lazily create (or fetch) the tray-popover webview window.
fn get_or_create_popover(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(POPOVER_LABEL) {
        return Ok(existing);
    }

    let initial = POPOVER_HEIGHT
        .lock()
        .unwrap()
        .unwrap_or(POPOVER_INITIAL_HEIGHT);

    let window = WebviewWindowBuilder::new(
        app,
        POPOVER_LABEL,
        WebviewUrl::App("index.html?view=tray-popover".into()),
    )
    .title("Juejin Usage")
    .inner_size(POPOVER_WIDTH as f64, initial as f64)
    .min_inner_size(POPOVER_WIDTH as f64, POPOVER_MIN_HEIGHT as f64)
    .max_inner_size(POPOVER_WIDTH as f64, POPOVER_MAX_HEIGHT as f64)
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    // Hide on blur (matches Electron `popover.on('blur', hide)`).
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            if let Some(w) = handle.get_webview_window(POPOVER_LABEL) {
                let _ = w.hide();
            }
        }
    });

    Ok(window)
}

/// Position the popover under the top-right corner of the primary monitor's
/// work area.
fn anchor_popover(app: &AppHandle) {
    // Prefer anchoring under/over the real tray icon rect (Electron parity);
    // fall back to the work-area top-right corner when unavailable.
    if let Some(tray) = app.state::<TrayState>().0.lock().unwrap().clone() {
        if let Ok(Some(rect)) = tray.rect() {
            if let Some(monitor) = app.primary_monitor().ok().flatten() {
                let scale = monitor.scale_factor();
                let wa = monitor.work_area();
                let (work_x, work_y) = (wa.position.x as f64 / scale, wa.position.y as f64 / scale);
                let (work_w, work_h) = (wa.size.width as f64 / scale, wa.size.height as f64 / scale);
                // Normalize the icon rect (physical or logical) to logical.
                let (icon_cx, icon_bottom) = match (&rect.position, &rect.size) {
                    (tauri::Position::Physical(p), tauri::Size::Physical(s)) => (
                        (p.x as f64 + s.width as f64 / 2.0) / scale,
                        (p.y as f64 + s.height as f64) / scale,
                    ),
                    (tauri::Position::Logical(p), tauri::Size::Logical(s)) => {
                        (p.x + s.width / 2.0, p.y + s.height)
                    }
                    _ => {
                        // Mixed variants never occur in practice; fall through
                        // to the corner anchor below.
                        0.0..=0.0;
                        corner_anchor(app);
                        return;
                    }
                };
                let h = POPOVER_HEIGHT.lock().unwrap().unwrap_or(POPOVER_INITIAL_HEIGHT) as f64;
                let mid_screen = work_y + work_h / 2.0;
                let x = (icon_cx - POPOVER_WIDTH as f64 / 2.0)
                    .clamp(work_x, work_x + work_w - POPOVER_WIDTH as f64);
                let y = if icon_bottom < mid_screen {
                    icon_bottom + POPOVER_MARGIN
                } else {
                    (icon_bottom - h - POPOVER_MARGIN).max(work_y)
                };
                if let Some(w) = app.get_webview_window(POPOVER_LABEL) {
                    let _ = w.set_position(tauri::LogicalPosition::new(x, y));
                    let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(POPOVER_WIDTH as f64, h)));
                }
                return;
            }
        }
    }
    corner_anchor(app);
}

/// Fallback anchor: work-area top-right corner (the old behavior).
fn corner_anchor(app: &AppHandle) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let wa = monitor.work_area();
    // Monitor geometry is physical; convert to logical for `set_position`.
    let work_x = wa.position.x as f64 / scale;
    let work_y = wa.position.y as f64 / scale;
    let work_w = wa.size.width as f64 / scale;

    let h = POPOVER_HEIGHT.lock().unwrap().unwrap_or(POPOVER_INITIAL_HEIGHT) as f64;
    let x = work_x + work_w - POPOVER_WIDTH as f64 - POPOVER_MARGIN;
    let y = work_y + POPOVER_MARGIN;

    if let Some(w) = app.get_webview_window(POPOVER_LABEL) {
        let _ = w.set_position(LogicalPosition::new(x, y));
        // Keep the height in sync too so a re-shown popover is not stale.
        let _ = w.set_size(Size::Logical(LogicalSize::new(POPOVER_WIDTH as f64, h)));
    }
}

/// Show or hide the popover (left-click toggle).
fn toggle_popover(app: &AppHandle) {
    let Ok(window) = get_or_create_popover(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    anchor_popover(app);
    let _ = window.show();
    let _ = window.set_focus();
}

/// `#[tauri::command]`: the renderer reports its measured content height; we
/// clamp it and re-anchor so a growing popover stays pinned to the monitor
/// corner instead of drifting.
#[tauri::command]
pub fn resize_tray_popover(app: AppHandle, height: f64) {
    if !height.is_finite() {
        return;
    }
    let clamped = (POPOVER_MIN_HEIGHT as f64)
        .max(height.min(POPOVER_MAX_HEIGHT as f64))
        .round();
    *POPOVER_HEIGHT.lock().unwrap() = Some(clamped as u32);

    if let Some(w) = app.get_webview_window(POPOVER_LABEL) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.set_size(Size::Logical(LogicalSize::new(POPOVER_WIDTH as f64, clamped)));
            anchor_popover(&app);
        }
    }
}

/// Create the tray icon + its menu, and wire the left-click popover toggle.
/// No-op if a tray was already created.
pub fn create(app: &AppHandle) {
    let icon = match tray_icon_image(app) {
        Ok(image) => image,
        Err(e) => {
            eprintln!("[tud-desktop] tray icon load failed: {e}");
            return;
        }
    };

    let item_show = match MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>) {
        Ok(item) => item,
        Err(e) => {
            eprintln!("[tud-desktop] menu item build failed: {e}");
            return;
        }
    };
    let item_sync = match MenuItem::with_id(app, "tray-sync", "同步数据", true, None::<&str>) {
        Ok(item) => item,
        Err(e) => {
            eprintln!("[tud-desktop] menu item build failed: {e}");
            return;
        }
    };
    let item_settings =
        match MenuItem::with_id(app, "tray-settings", "设置", true, None::<&str>) {
            Ok(item) => item,
            Err(e) => {
                eprintln!("[tud-desktop] menu item build failed: {e}");
                return;
            }
        };
    let item_quit = match MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>) {
        Ok(item) => item,
        Err(e) => {
            eprintln!("[tud-desktop] menu item build failed: {e}");
            return;
        }
    };
    let separator = match PredefinedMenuItem::separator(app) {
        Ok(item) => item,
        Err(e) => {
            eprintln!("[tud-desktop] separator build failed: {e}");
            return;
        }
    };

    let menu = match Menu::with_items(
        app,
        &[
            &item_show,
            &item_sync,
            &item_settings,
            &separator,
            &item_quit,
        ],
    ) {
        Ok(menu) => menu,
        Err(e) => {
            eprintln!("[tud-desktop] menu build failed: {e}");
            return;
        }
    };

    let tray = match tauri::tray::TrayIconBuilder::new()
        .tooltip("Juejin Usage")
        .icon(icon)
        .menu(&menu)
        // Left-click must NOT open the menu; it drives our custom popover
        // toggle instead. Right-click (default) still shows the menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event: MenuEvent| {
            match event.id().as_ref() {
                "tray-show" => {
                    crate::set_dock_visible(app, true);
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
                "tray-sync" => {
                    let state = app.state::<crate::sidecar::SidecarState>();
                    sidecar::trigger_sync(&state);
                }
                "tray-settings" => {
                    crate::set_dock_visible(app, true);
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                    let _ = app.emit("app:open-settings", serde_json::json!({}));
                }
                "tray-quit" => {
                    let state = app.state::<crate::sidecar::SidecarState>();
                    sidecar::stop(&state);
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)
    {
        Ok(tray) => tray,
        Err(e) => {
            eprintln!("[tud-desktop] tray build failed: {e}");
            return;
        }
    };

    // Keep a handle for the usage capsule + popover anchor before the event
    // closure takes ownership of the instance.
    {
        let handle = tray.clone();
        *app.state::<TrayState>().0.lock().unwrap() = Some(handle);
    }
    refresh_usage_title(app);

    // Left-click toggles the popover. The per-tray handler receives the
    // `TrayIcon`, from which we reach the `AppHandle` via `app_handle()`.
    tray.on_tray_icon_event(move |_tray: &TrayIcon, event: TrayIconEvent| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            let app = _tray.app_handle().clone();
            toggle_popover(&app);
        }
    });
}
