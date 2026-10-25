//! Juejin Usage — Tauri backend (P0: scaffold + data-core command surface).
//!
//! The renderer was copied from the Electron app and still talks to a
//! `window.tud` bridge (see src/renderer/bridge.ts). That bridge translates
//! every member into a Tauri command of the same snake_case name plus Tauri
//! events. This module registers that command surface.
//!
//! P0 implements the commands needed to render the dashboard and to hold the
//! UI's chrome state (theme, dashboard range, window controls). Commands that
//! belong to later phases (sidecar lifecycle, tray, desktop pet, auto-update,
//! deep-link, autostart) are registered with safe defaults so the whole bridge
//! resolves without "command not found"; their real behavior lands in P1+.

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, Window};

mod autostart;
mod bridge;
mod local_api;
mod clipboard;
mod dashboard_range;
mod deeplink;
mod instance;
mod pet;
mod pet_catalog;
mod prefs;
mod sidecar;
mod theme;
mod tray;
mod updater;

/// The shared data directory's pets root (`~/.ai-usage/pets`), matching core
/// `petsDir(DEFAULT_DATA_DIR)` that the sidecar scanner reads.
pub fn pets_root() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".ai-usage").join("pets")
}

use crate::bridge::TUD_BRIDGE_INIT_SCRIPT;
use crate::dashboard_range::DashboardRangeState;
use crate::pet::PetState;
use crate::prefs::PrefsState;
use crate::sidecar::{sidecar_url, SidecarState};
use crate::theme::ThemeState;
use crate::updater::UpdaterState;
use std::sync::Arc;

// ---- platform / version -----------------------------------------------------

/// Last foreground poke-sync, as unix epoch seconds; used to debounce the
/// "restore fast poll + refresh stale data" poke when the main window regains
/// focus (port of Electron's `pokeSyncOnForeground`, 30s debounce).
static LAST_POKE_SYNC: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Create the main dashboard window, explicitly (not via `tauri.conf.json >
/// app.windows`) so we can attach `on_navigation` — any navigation to a
/// non-loopback http(s) URL is suppressed and forwarded to the default
/// browser instead of loading inside the webview. The initial URL is the
/// bundled dashboard dist (`dashboard/index.html`) served by Tauri's own
/// frontend static resources — the same loading mechanism as the tray-popover
/// and desktop-pet windows, which avoids the WKWebView blank-screen failure
/// mode of navigating to the loopback sidecar HTTP server.
fn create_main_window(app: &AppHandle) {
    // Load the dashboard as a Tauri static resource (`App(...)`), exactly like
    // the tray-popover (`index.html?view=tray-popover`) and pet (`pet.html`)
    // windows. The main window no longer navigates to `http://127.0.0.1:8462/`
    // (the Node sidecar's loopback HTTP server): that cross-process load left
    // the WKWebView with no URL (`webview.URL()` → None) and a permanently
    // blank page. Data requests still reach the sidecar, but via the JS
    // `window.tud` bridge (`tud.api.request` → `sidecar_url` → 8462), not as
    // the page origin.
    // Load the dashboard as a Tauri static resource (`App(...)`), exactly like
    // the tray-popover (`index.html?view=tray-popover`) and pet (`pet.html`)
    // windows. The main window never navigates to a loopback HTTP origin:
    // neither the Node sidecar (8462) nor the Vite dev server — on macOS
    // WKWebView those loads can stall at the provisional stage and leave the
    // webview on `about:blank` forever (observed with both `WebviewUrl::App`
    // resolved against `devUrl` and an explicit `WebviewUrl::External` loopback
    // URL, even though `on_navigation` reports the URL as allowed). Dev
    // therefore runs WITHOUT `devUrl` (see `tauri.conf.json`), so `tauri dev`
    // serves the embedded `frontendDist` through the same `tauri://localhost`
    // custom protocol as release builds.
    let initial_webview_url = WebviewUrl::App("dashboard/index.html".into());
    // Inject the Tauri-backed `window.tud` bridge before the dashboard's own
    // scripts run. The dashboard is a standalone build (its own `main.tsx`),
    // so it cannot call `initTudBridge()` itself the way the tray/pet
    // renderers do; the bridge must be provided by the shell. This makes
    // `hasDesktopApi()` true in the dashboard's data layer so its
    // `/functions/tud-*` requests are routed through `tud.api.request` to the
    // sidecar instead of a same-origin fetch that would 404 on the Tauri
    // origin.
    let navigation_app = app.clone();
    let new_window_app = app.clone();
    let builder = WebviewWindowBuilder::new(app, "main", initial_webview_url)
        .title("Juejin Usage")
        // The dashboard is built as an independent app bundle, so it cannot
        // import the shell renderer's `bridge.ts`. Install the Tauri bridge
        // before the dashboard module executes; otherwise its first API
        // request falls back to `/functions/...` on the static Tauri origin
        // and the page stays in a blank/recovering state.
        .initialization_script(TUD_BRIDGE_INIT_SCRIPT)
        .inner_size(1024.0, 780.0)
        .min_inner_size(800.0, 600.0)
        .center()
        .on_page_load(|_, payload| {
            eprintln!(
                "[tud-desktop] main page {:?}: {}",
                payload.event(),
                payload.url()
            );
        })
        // Intercept external http(s) URLs: hand them off to the OS default
        // browser and keep the webview on its own dashboard. Tauri's
        // `on_navigation` callback returns `true` to allow a navigation and
        // `false` to cancel it.
        .on_navigation(move |url| {
            eprintln!("[tud-desktop] main navigation: {url}");
            if is_internal_navigation_url(url) {
                return true;
            }
            if is_http_url(url) {
                if let Err(err) = open_http_url_in_browser(&navigation_app, url) {
                    eprintln!("[tud-desktop] failed to open external URL {url}: {err}");
                }
            }
            false
        })
        // `window.open(url, "_blank")` must follow the same policy as a
        // top-level navigation. Never create a second in-app browser window;
        // open http(s) targets with the OS handler and deny the WebView popup.
        .on_new_window(move |url, _features| {
            if is_http_url(&url) {
                if let Err(err) = open_http_url_in_browser(&new_window_app, &url) {
                    eprintln!("[tud-desktop] failed to open popup URL {url}: {err}");
                }
            }
            tauri::webview::NewWindowResponse::Deny
        });

    match builder.build() {
        Ok(window) => {
            eprintln!(
                "[tud-desktop] main window created (url={})",
                window.url().map(|url| url.to_string()).unwrap_or_else(|_| "<unavailable>".into())
            );
            if has_hidden_arg() {
                if let Err(err) = window.hide() {
                    eprintln!("[tud-desktop] failed to hide main window: {err}");
                }
            }
        }
        Err(err) => {
            eprintln!("[tud-desktop] failed to create main window: {err}");
        }
    }
}

fn unix_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Emit the main window's maximize state on `window:is-maximized` — the
/// channel the renderer's title-bar maximize indicator listens on. Tauri's
/// `WindowEvent` has no "maximized" variant, so we recompute on toggle/resize/
/// focus and re-emit (port of Electron's `maximize`/`unmaximize` handlers).
fn emit_main_maximized(window: &Window) {
    let app = window.app_handle();
    let maximized = window.is_maximized().unwrap_or(false);
    let _ = app.emit("window:is-maximized", maximized);
}

/// Debounced foreground poke-sync: when the main window regains focus and the
/// last poke was >30s ago, kick the sidecar so data catches up (port of
/// Electron's `browser-window-focus` → `pokeSyncOnForeground`).
fn poke_sync_on_foreground(app: &AppHandle) {
    let now = unix_epoch_secs();
    let last = LAST_POKE_SYNC.load(std::sync::atomic::Ordering::SeqCst);
    if now.saturating_sub(last) < 30 {
        return;
    }
    LAST_POKE_SYNC.store(now, std::sync::atomic::Ordering::SeqCst);
    let state = app.state::<SidecarState>();
    sidecar::trigger_sync(&state);
}

/// True when the process was launched with `--hidden` (the autostart
/// tray-only start flag; see `apply_os_autostart`). Port of Electron's
/// `process.argv.includes('--hidden')` `launchHidden` detection.
fn has_hidden_arg() -> bool {
    std::env::args().any(|a| a == "--hidden")
}

fn map_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        _ => "linux",
    }
}

#[tauri::command]
fn platform() -> &'static str {
    map_platform()
}

#[tauri::command]
fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ---- window chrome ----------------------------------------------------------

#[tauri::command]
fn window_minimize(window: Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn window_toggle_maximize(window: Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

/// P0: `window_close` hides to a (not-yet-existing) tray. The real
/// close-to-tray / quit-on-true-exit logic lands in P2 (window.rs).
#[tauri::command]
fn window_close(window: Window) {
    let _ = window.hide();
}

#[tauri::command]
fn window_show_main(app: AppHandle) {
    set_dock_visible(&app, true);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[tauri::command]
fn app_quit(app: AppHandle, sidecar: State<'_, SidecarState>) {
    // Stop the Node sidecar before the app exits so the loopback server goes
    // down with us. (The OS also reaps the child on process exit.)
    sidecar::stop(&sidecar);
    app.exit(0);
}

// ---- external links / clipboard --------------------------------------------

/// Result shape of `open_external`, mirroring Electron's `shell:open-external`
/// IPC (`{ ok, message? }`). The renderer's `openExternal` promise resolves to
/// this object and reads `.ok` — returning a bare `Result<(), String>` would
/// make every success read as `ok: undefined` (falsy).
#[derive(serde::Serialize)]
struct OpenExternalResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn is_http_url(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

fn is_internal_navigation_url(url: &url::Url) -> bool {
    match (url.scheme(), url.host_str(), url.port_or_known_default()) {
        ("tauri", Some("localhost"), _) => true,
        // Tauri's Windows WebView workaround uses this origin instead of the
        // custom `tauri://localhost` scheme.
        ("http" | "https", Some("tauri.localhost"), _) => true,
        // In `tauri dev`, `WebviewUrl::App` is resolved against `devUrl`.
        ("http", Some("127.0.0.1" | "localhost"), Some(1720)) => true,
        ("about", None, None) if url.as_str() == "about:blank" => true,
        _ => false,
    }
}

fn open_http_url_in_browser(app: &AppHandle, url: &url::Url) -> Result<(), String> {
    if !is_http_url(url) {
        return Err("INVALID_PROTOCOL".to_string());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|err| err.to_string())
}

/// Open an http(s) URL in the OS default browser, validating the protocol so
/// `juejin-usage://` or `file://` can't leak through. Mirrors
/// `registerOpenExternalIpc` in Electron's `DesktopWindow.ts`.
#[tauri::command]
fn open_external(url: String, app: AppHandle) -> OpenExternalResult {
    let Ok(parsed) = url::Url::parse(&url) else {
        return OpenExternalResult { ok: false, message: Some("INVALID_URL".to_string()) };
    };
    if !is_http_url(&parsed) {
        return OpenExternalResult { ok: false, message: Some("INVALID_PROTOCOL".to_string()) };
    }
    match open_http_url_in_browser(&app, &parsed) {
        Ok(()) => OpenExternalResult { ok: true, message: None },
        Err(e) => OpenExternalResult { ok: false, message: Some(e.to_string()) },
    }
}

// ---- tray popover -----------------------------------------------------------
// `resize_tray_popover` now lives in `tray.rs` (P2) and is registered below.

// ---- theme ------------------------------------------------------------------
// See crate::theme for the state type + emit helpers.

#[tauri::command]
fn theme_get(state: State<'_, ThemeState>) -> Result<theme::ThemeSnapshot, String> {
    Ok(state.snapshot())
}

#[tauri::command]
fn theme_set(
    app: AppHandle,
    state: State<'_, ThemeState>,
    prefs: State<'_, PrefsState>,
    mode: String,
) {
    if !theme::is_theme_mode(&mode) {
        return;
    }
    let next = state.set_mode(&mode);
    // P2: persist the choice so the next launch restores it.
    let _ = prefs.patch(|p| p.theme_mode = Some(mode.clone()));
    let _ = app.emit("theme:changed", theme::ThemeSnapshot {
        mode: next.mode.clone(),
        resolved: next.resolved.clone(),
    });
}

// ---- dashboard range --------------------------------------------------------

#[tauri::command]
fn dashboard_range_get(state: State<'_, DashboardRangeState>) -> String {
    state.current()
}

#[tauri::command]
fn dashboard_range_set(
    app: AppHandle,
    state: State<'_, DashboardRangeState>,
    prefs: State<'_, PrefsState>,
    range: String,
) -> String {
    let next = state.set(&range);
    // P2: persist so the pet / tray-popover window (separate origin) can follow.
    let _ = prefs.patch(|p| p.dashboard_range = Some(next.clone()));
    let _ = app.emit("dashboard-range:changed", next.clone());
    next
}

// ---- autostart --------------------------------------------------------------
// Login-item management lives in `autostart.rs` (replaces tauri-plugin-
// autostart so the `--hidden` arg follows the launchHidden preference — the
// plugin fixes its args at init). The prefs (open_at_login / launch_hidden)
// persist to `desktop-prefs.json`; the OS registration moves with them so a
// relaunch restores the last choice (mirrors Electron's `autostart.ts`).

/// Apply the OS login item to match `open_at_login` (+ `launch_hidden` arg).
fn apply_os_autostart(
    _app: &AppHandle,
    open_at_login: bool,
    launch_hidden: bool,
) {
    if let Err(err) = autostart::apply(open_at_login, launch_hidden) {
        eprintln!("[tud-desktop] autostart apply failed: {err}");
    }
}

#[tauri::command]
fn autostart_get(app: AppHandle, state: State<'_, PrefsState>) -> bool {
    let prefs = state.get();
    apply_os_autostart(&app, prefs.open_at_login, prefs.launch_hidden);
    prefs.open_at_login
}

#[tauri::command]
fn autostart_set(app: AppHandle, state: State<'_, PrefsState>, enabled: bool) -> bool {
    let next = state.patch(|p| p.open_at_login = enabled);
    apply_os_autostart(&app, next.open_at_login, next.launch_hidden);
    enabled
}

#[tauri::command]
fn autostart_get_hidden(state: State<'_, PrefsState>) -> bool {
    state.get().launch_hidden
}

#[tauri::command]
fn autostart_set_hidden(
    app: AppHandle,
    state: State<'_, PrefsState>,
    hidden: bool,
) -> bool {
    let next = state.patch(|p| p.launch_hidden = hidden);
    apply_os_autostart(&app, next.open_at_login, next.launch_hidden);
    hidden
}

// ---- desktop pet (P3) -------------------------------------------------------
// Real behavior lives in `pet.rs` (transparent always-on-top window + cursor
// follow + Bézier auto-move + prefs sync). The command surface matches the
// `window.tud` bridge; `pet_show_context_menu` is the renderer's right-click
// hook (Tauri's `WebviewEvent` has no context-menu variant, so the pet renderer
// pops the native menu via this command).

// ---- tray usage (macOS menu-bar capsule) ------------------------------------
// Prefs-backed; the capsule itself is refreshed by `tray::refresh_usage_title`
// (sidecar boot / every sync / pref change).

#[tauri::command]
fn tray_usage_get(state: State<'_, PrefsState>) -> bool {
    state.get().show_tray_usage
}

#[tauri::command]
fn tray_usage_set(app: AppHandle, state: State<'_, PrefsState>, enabled: bool) -> bool {
    state.patch(|p| p.show_tray_usage = enabled);
    let _ = app.emit("tray-usage:changed", enabled);
    tray::refresh_usage_title(&app);
    enabled
}

#[tauri::command]
fn tray_usage_mode_get(state: State<'_, PrefsState>) -> String {
    state.get().tray_usage_mode
}

#[tauri::command]
fn tray_usage_mode_set(app: AppHandle, state: State<'_, PrefsState>, mode: String) -> String {
    if !matches!(mode.as_str(), "both" | "tokens" | "cost") {
        return state.get().tray_usage_mode;
    }
    let next = state.patch(|p| p.tray_usage_mode = mode.clone());
    let _ = app.emit("tray-usage-mode:changed", &next.tray_usage_mode);
    tray::refresh_usage_title(&app);
    next.tray_usage_mode
}

/// macOS dock policy: hide the Dock icon while only the tray remains
/// (Electron `app.dock.hide()` parity), restore it whenever the main window
/// is shown again.
#[cfg(target_os = "macos")]
pub(crate) fn set_dock_visible(app: &AppHandle, visible: bool) {
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    if let Err(err) = app.set_activation_policy(policy) {
        eprintln!("[tud-desktop] set_activation_policy failed: {err}");
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_dock_visible(_app: &AppHandle, _visible: bool) {}

// ---- auto update (P4) -------------------------------------------------------
// Real behavior lives in `updater.rs` (tauri-plugin-updater state machine +
// marker rollback + install watchdog). The `auto_update_*` commands and the
// `UpdaterState` are re-exported via `crate::updater` and registered below.

// ---- entry ------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // P4: auto-update + process control (restart after install). The
        // updater reads its endpoint/pubkey from `plugins.updater` in
        // `tauri.conf.json`; process provides `request_restart`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ThemeState::default())
        .manage(DashboardRangeState::default())
        .manage(tray::TrayState::default())
        .manage(PrefsState::default())
        .manage(SidecarState::default())
        .manage(Arc::new(PetState::default()))
        .manage(UpdaterState::default())
        // P3: dispatch the desktop-pet context-menu items (shown via
        // `pet_show_context_menu`).
        .on_menu_event(|app, event| pet::on_pet_menu_event(app, &event))
        .setup(|app| {
            // Single-instance guard: a second launch must not collide with the
            // first on the runtime owner. On failure (another instance holds
            // the lock) log and exit — we are the second instance.
            if let Err(msg) = instance::acquire(app.handle()) {
                eprintln!("[tud-desktop] single-instance: {msg}");
                std::process::exit(0);
            }

            // P2: load the on-disk prefs and hydrate the in-memory theme /
            // dashboard-range state from them (Electron restores the persisted
            // theme mode before any window is registered).
            let prefs = {
                let file = app
                    .path()
                    .resolve("desktop-prefs.json", tauri::path::BaseDirectory::AppConfig)
                    .unwrap_or_default();
                if let Some(dir) = file.parent() {
                    app.state::<PrefsState>().load_from(dir.to_path_buf());
                    app.state::<PrefsState>().get()
                } else {
                    PrefsState::default().get()
                }
            };

            if let Some(mode) = &prefs.theme_mode {
                app.state::<ThemeState>().set_mode(mode);
            }
            if let Some(range) = &prefs.dashboard_range {
                app.state::<DashboardRangeState>().set(range);
            }

            // P2b: create the main window explicitly so we can attach the
            // external-link navigation hook before the dashboard loads.
            create_main_window(app.handle());

            // P1: spawn the Node sidecar (data core). Failures are non-fatal —
            // the frontend shows "recovering" until the sidecar reports its port.
            let state = app.state::<SidecarState>();
            // 阶段②：TUD_API_ENGINE=rust 时，Rust(axum) 先抢占 8462 公开端口，
            // Node 以 8463 作为 admin 端口（写路径 + parsers）。默认 node 引擎，
            // 行为与 0.3.x 完全一致。
            let rust_engine = std::env::var("TUD_API_ENGINE")
                .map(|v| v.trim().eq_ignore_ascii_case("rust"))
                .unwrap_or(false);
            if rust_engine {
                let api_state = local_api::LocalApiState {
                    admin_port: std::sync::Arc::clone(&state.port),
                };
                state.rust_api.store(true, std::sync::atomic::Ordering::SeqCst);
                tauri::async_runtime::spawn(async move {
                    if let Err(err) =
                        local_api::serve(api_state, crate::sidecar::DEFAULT_DESKTOP_PORT).await
                    {
                        eprintln!("[tud-desktop] rust local-api failed: {err}");
                    }
                });
                // 给 axum 一点绑定时间，避免 Node 意外抢占 8462（Node 被固定在 8463）
                std::thread::sleep(std::time::Duration::from_millis(300));
            }
            let handle = app.handle().clone();
            let _ = sidecar::start(&state, handle);

            // P2: create the tray icon + popover (keeps the app alive after the
            // main window closes; quit goes through the tray "退出").
            tray::create(app.handle());

            // P3: reconcile the desktop-pet window with the persisted pref and
            // start the wander (if auto-move is on).
            pet::create(app.handle());

            // P4: restore the completed-update flag from the marker and kick
            // off the initial check (skipped in dev).
            updater::create(app.handle());

            // P5: apply a cold-start `juejin-usage://` process arg (Windows
            // parity); the definitive result is delivered to the renderer on
            // `app:juejin-link-result`.
            deeplink::create(app.handle());

            // P2: `--hidden` (tray-only launch) — the autostart pref launches the
            // app silent. The main window and pet (if enabled) are created
            // before setup finishes, so hide them here to match Electron's
            // `launchHidden` (a real user click on the tray brings the main
            // window back).
            if has_hidden_arg() {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.hide();
                }
                if let Some(pet_win) = app.get_webview_window(pet::PET_LABEL) {
                    let _ = pet_win.hide();
                }
            }

            // Windows: capture the primary monitor scale for the pet drag
            // cursor poll (Win32 GetCursorPos returns physical pixels).
            #[cfg(target_os = "windows")]
            if let Ok(Some(monitor)) = app.primary_monitor() {
                // Windows 后端 scale_factor() 直接返回 f64（macOS 是 Result）；
                // 此块仅 Windows 编译，按 f64 使用。
                let _ = pet::PRIMARY_SCALE.set(monitor.scale_factor());
            }

            // Resolve `system` theme mode against the actual OS appearance once
            // the main window exists (later changes arrive via ThemeChanged).
            if let Some(main) = app.get_webview_window("main") {
                if let Ok(os_theme) = main.theme() {
                    theme::on_os_theme(app.handle(), os_theme);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // OS appearance changed → re-resolve `system` mode and broadcast.
            // Only the main window drives it (all windows share the OS theme).
            if let tauri::WindowEvent::ThemeChanged(theme) = event {
                if window.label() == "main" {
                    theme::on_os_theme(window.app_handle(), *theme);
                }
                return;
            }
            // P0: closing the last window keeps the app alive (tray-resident
            // model). P2 wires the real close-to-tray + quit behavior.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
                if window.label() == "main" {
                    set_dock_visible(window.app_handle(), false);
                }
                return;
            }
            // Only drive maximize/focus emission for the main window (the
            // tray-popover and pet windows never maximize and have no
            // title-bar indicator).
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(true) => {
                    emit_main_maximized(window);
                    if let tauri::WindowEvent::Focused(true) = event {
                        poke_sync_on_foreground(window.app_handle());
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            platform,
            version,
            sidecar_url,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_show_main,
            app_quit,
            open_external,
            clipboard::copy_image_to_clipboard,
            tray::resize_tray_popover,
            bridge::tud_api_request,
            bridge::tud_bridge_ready,
            theme_get,
            theme_set,
            dashboard_range_get,
            dashboard_range_set,
            autostart_get,
            autostart_set,
            autostart_get_hidden,
            autostart_set_hidden,
            tray_usage_get,
            tray_usage_set,
            tray_usage_mode_get,
            tray_usage_mode_set,
            pet::desktop_pet_get,
            pet::desktop_pet_set_enabled,
            pet::desktop_pet_set_selected,
            pet::desktop_pet_set_preferences,
            pet::desktop_pet_set_mouse_ignored,
            pet::desktop_pet_begin_drag,
            pet::desktop_pet_end_drag,
            pet::pet_show_context_menu,
            pet_catalog::desktop_pet_refresh_catalog,
            pet_catalog::desktop_pet_fetch_remote_catalog,
            pet_catalog::desktop_pet_install_remote,
            pet_catalog::open_desktop_pet_directory,
            pet_catalog::desktop_pet_spritesheet_url,
            updater::auto_update_get_state,
            updater::auto_update_check,
            updater::auto_update_install,
            updater::auto_update_ack_completed,
            deeplink::deeplink_apply
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app_handle, event| {
        match event {
            // macOS: `juejin-usage://` delivered by LaunchServices while the
            // app is running (scheme registered via `src-tauri/Info.plist`).
            // The OS activates THIS instance instead of spawning a second one,
            // which is also the macOS half of the single-instance story.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                for url in &urls {
                    if url.scheme() == "juejin-usage" {
                        eprintln!("[tud-desktop] open-url deep link: {url}");
                        let sidecar = app_handle.state::<crate::sidecar::SidecarState>();
                        crate::deeplink::apply(app_handle, &sidecar, &url.to_string());
                    }
                }
            }
            // macOS: Dock icon click / app re-launch → show the main window
            // (Electron `activate` parity; the hidden login launch stays
            // tray-only until the user explicitly opens the window).
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                if !has_visible_windows {
                    set_dock_visible(app_handle, true);
                    if let Some(main) = app_handle.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod navigation_tests {
    use super::{is_http_url, is_internal_navigation_url};

    fn url(value: &str) -> url::Url {
        url::Url::parse(value).unwrap()
    }

    #[test]
    fn bundled_dashboard_navigation_is_internal() {
        assert!(is_internal_navigation_url(&url(
            "tauri://localhost/dashboard/index.html"
        )));
        assert!(is_internal_navigation_url(&url(
            "http://tauri.localhost/dashboard"
        )));
    }

    #[test]
    fn tauri_dev_navigation_is_internal() {
        assert!(is_internal_navigation_url(&url(
            "http://127.0.0.1:1720/dashboard/index.html"
        )));
        assert!(is_internal_navigation_url(&url(
            "http://localhost:1720/dashboard"
        )));
    }

    #[test]
    fn external_web_navigation_is_not_internal() {
        let github = url("https://github.com/juejin-cn/juejin-usage");
        assert!(is_http_url(&github));
        assert!(!is_internal_navigation_url(&github));
        assert!(!is_internal_navigation_url(&url(
            "http://127.0.0.1:8462/"
        )));
    }

    #[test]
    fn non_web_protocols_are_not_external_browser_targets() {
        assert!(!is_http_url(&url("juejin-usage://link?user_id=1")));
        assert!(!is_internal_navigation_url(&url("file:///tmp/index.html")));
    }
}
