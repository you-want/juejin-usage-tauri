//! Node sidecar lifecycle (P1 — the data core).
//!
//! The Tauri app spawns a Node process running the compiled CLI desktop-host
//! entry (`packages/cli/dist/desktop-host.js`, embedded in the CLI package
//! `@juejin-opensource/jusage`). That process owns the local
//! Core runtime (owner `kind: 'desktop'`) and serves the loopback local-api
//! (`/health` + `/functions/tud-*`). This module only manages the process:
//!
//!   - spawn: node binary + sidecar script
//!   - stdout: read `PORT=<n>` (bound port) and `SYNCED` / `RUNTIME_NOTICE=` markers
//!   - on `SYNCED`: emit `tud:data-synced` to every webview
//!   - on `RUNTIME_NOTICE=CONFIG_RESET:<bool>`: emit `app:runtime-notice`
//!     (`{ kind: "config-reset", tokenSalvaged }`) — the UI toast for a corrupt
//!     config that had to be recovered (port of Electron's `broadcastConfigResetNotice`)
//!   - on exit: kill the child
//!
//! Dev-time path resolution is wired through env so `tauri dev` works out of
//! the box:
//!   - `TUD_NODE_BIN`       node executable (default: `node` on PATH)
//!   - `TUD_SIDECAR_SCRIPT` path to the compiled sidecar entry
//!
//! Bundling the Node binary as a resource for release builds is a later step;
//! the command surface (`sidecar_url`) is identical either way.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};

/// Default desktop sidecar port (CLI owns 8452, so we use 8462).
pub const DEFAULT_DESKTOP_PORT: u16 = 8462;

/// Shared, managed across Tauri. `port` is an `Arc` so the stdout-reading
/// thread and the Tauri state can both observe it; `child` is an `Arc` so the
/// monitor thread can watch it without borrowing the managed state.
pub struct SidecarState {
    /// The port the sidecar actually bound, once its `PORT=` line has been read.
    pub port: Arc<Mutex<Option<u16>>>,
    /// The live child handle, used to kill it on app exit.
    pub child: Arc<Mutex<Option<Child>>>,
    /// Guards against double-spawn.
    pub started: AtomicBool,
    /// Set by `stop()`; the monitor thread stops respawning once it sees this.
    pub shutting_down: Arc<AtomicBool>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            port: Arc::new(Mutex::new(None)),
            child: Arc::new(Mutex::new(None)),
            started: AtomicBool::new(false),
            shutting_down: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Resolve the Node executable to spawn.
///
/// Priority: the `TUD_NODE_BIN` env (dev / testing a specific runtime), then
/// the app-sibling `node-app/node/node` (a staged runtime next to the binary,
/// see `scripts/stage-node-app.mjs`), then the bundled `node-app/node/node`
/// resource (packaged `.app`), then `node` on the PATH (last resort).
///
/// The app-sibling slot exists because Tauri `resolve(..., BaseDirectory::Resource)`
/// on macOS walks up from the *main binary* to find the app bundle — if the
/// binary lives outside a `.app` (e.g. a bare `target/release` build in dev)
/// it resolves to a directory that lacks `Resources/node-app`, while a
/// *staged* sibling copy may well exist. Checking the sibling first keeps both
/// layouts working with one path.
fn node_bin(app: &AppHandle) -> Option<String> {
    if let Ok(custom) = std::env::var("TUD_NODE_BIN") {
        return Some(custom);
    }
    if let Some(candidate) = app_sibling_runtime("node-app/node/node") {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    if let Ok(bundled) = app.path().resolve("node-app/node/node", BaseDirectory::Resource) {
        if bundled.exists() {
            return Some(bundled.to_string_lossy().into_owned());
        }
    }
    Some("node".to_string())
}

/// Locate a staged runtime file in `node-app/` next to the *current executable*
/// (i.e. `<exe-dir>/node-app/...`). Returns `None` when the file is absent or
/// the exe dir is unresolvable.
fn app_sibling_runtime(rel: &str) -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    Some(exe_dir.join(rel))
}

/// Resolve the compiled sidecar entry to run.
///
/// Priority: the `TUD_SIDECAR_SCRIPT` env (override), then — in dev — the
/// repo's live CLI build (`packages/cli/dist/desktop-host.js`) so `tauri dev`
/// always runs current code, then the app-sibling `node-app/app/dist/index.js`
/// (see `node_bin`), then the bundled resource copy, then the repo-relative
/// fallback.
///
/// The dev-first order matters: `tauri dev`'s exe dir IS `target/debug`, which
/// can also hold a stale `node-app/` staging from an earlier
/// `pnpm build:desktop:tauri`. Without the dev branch that staging silently
/// hijacks dev runs (observed: subscription routes missing after an upstream
/// merge because the staged sidecar was weeks old).
fn sidecar_script(app: &AppHandle) -> Option<String> {
    if let Ok(custom) = std::env::var("TUD_SIDECAR_SCRIPT") {
        return Some(custom);
    }
    // Dev: prefer the repo's live CLI build over any stale staging.
    if cfg!(dev) {
        let repo_host = repo_cli_entry()?;
        if std::path::Path::new(&repo_host).exists() {
            return Some(repo_host);
        }
    }
    if let Some(candidate) = app_sibling_runtime("node-app/app/dist/index.js") {
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    if let Ok(bundled) = app.path().resolve("node-app/app/dist/index.js", BaseDirectory::Resource) {
        if bundled.exists() {
            return Some(bundled.to_string_lossy().into_owned());
        }
    }
    // Dev fallback (repo CLI entry missing): let the spawn fail loudly below.
    repo_cli_entry()
}

/// `<repo>/packages/cli/dist/desktop-host.js`, resolved from the cargo crate
/// dir (CARGO_MANIFEST_DIR = <repo>/apps/desktop-tauri/src-tauri).
fn repo_cli_entry() -> Option<String> {
    let crate_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = crate_dir
        .parent() // apps/desktop-tauri
        .and_then(|d| d.parent()) // apps
        .and_then(|a| a.parent()); // <repo>
    let path = repo_root?.join("packages/cli/dist/desktop-host.js");
    Some(path.to_string_lossy().into_owned())
}

/// Spawn the sidecar and hand it to the monitor thread. No-op if already
/// started. The monitor owns the whole lifecycle: unexpected exits are
/// restarted with capped backoff (port of Electron's sync-worker crash
/// recovery), `stop()` tears everything down once.
pub fn start(state: &SidecarState, app: AppHandle) -> Result<(), String> {
    if state.started.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    // Fail fast on an obviously missing build so `tauri dev` reports it
    // immediately; the monitor re-resolves on every (re)spawn, so a later
    // `pnpm build:cli` is picked up without an app restart.
    let script = sidecar_script(&app)
        .ok_or_else(|| "could not resolve a sidecar script path".to_string())?;
    if !std::path::Path::new(&script).exists() {
        state.started.store(false, Ordering::SeqCst);
        return Err(format!(
            "sidecar script not found at {script} (build it with `pnpm build:cli`)"
        ));
    }

    let child = Arc::clone(&state.child);
    let port = Arc::clone(&state.port);
    let shutting_down = Arc::clone(&state.shutting_down);
    std::thread::spawn(move || {
        monitor_loop(child, port, shutting_down, app);
    });
    Ok(())
}

/// Repeatedly spawn the sidecar and watch it. Crashes restart with exponential
/// backoff; the budget is ≤5 consecutive crashes (reset after 60s of stable
/// uptime), mirroring Electron's `MAX_WORKER_RESTARTS` sync-worker policy.
fn monitor_loop(
    child_ref: Arc<Mutex<Option<Child>>>,
    port: Arc<Mutex<Option<u16>>>,
    shutting_down: Arc<AtomicBool>,
    app: AppHandle,
) {
    const MAX_CONSECUTIVE_CRASHES: u32 = 5;
    const STABLE_UPTIME_RESET: std::time::Duration = std::time::Duration::from_secs(60);
    let mut consecutive_crashes: u32 = 0;
    loop {
        if shutting_down.load(Ordering::SeqCst) {
            return;
        }
        let spawn_time = std::time::Instant::now();
        if let Err(err) = spawn_once(&child_ref, &port, &app) {
            eprintln!("[tud-desktop] sidecar spawn failed: {err}");
            consecutive_crashes += 1;
            if consecutive_crashes >= MAX_CONSECUTIVE_CRASHES {
                eprintln!(
                    "[tud-desktop] sidecar spawn failed {consecutive_crashes}x in a row — giving up (data/sync offline until app restart)"
                );
                return;
            }
            std::thread::sleep(backoff_for(consecutive_crashes));
            continue;
        }

        // Poll for exit without holding the child lock — `stop()` needs it to kill.
        let exit = loop {
            if shutting_down.load(Ordering::SeqCst) {
                return; // stop() owns teardown
            }
            let status = {
                let mut guard = child_ref.lock().unwrap();
                match guard.as_mut() {
                    Some(child) => child.try_wait(),
                    None => break None, // taken away (e.g. by stop's kill path)
                }
            };
            match status {
                Ok(Some(status)) => break Some(status),
                Ok(None) => {}
                Err(_) => break None,
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        };

        let uptime = spawn_time.elapsed();
        let code_desc = exit
            .map(|status| {
                format!(
                    "code={}",
                    status
                        .code()
                        .map(|n| n.to_string())
                        .unwrap_or_else(|| "signal".to_string())
                )
            })
            .unwrap_or_else(|| "no status".to_string());
        if uptime >= STABLE_UPTIME_RESET {
            consecutive_crashes = 0;
        }
        consecutive_crashes += 1;
        if consecutive_crashes >= MAX_CONSECUTIVE_CRASHES {
            eprintln!(
                "[tud-desktop] sidecar exited ({code_desc}) after {uptime:.0?}; {consecutive_crashes} consecutive crashes — giving up (data/sync offline until app restart)"
            );
            return;
        }
        let backoff = backoff_for(consecutive_crashes);
        eprintln!(
            "[tud-desktop] sidecar exited ({code_desc}) after {uptime:.0?}; restarting in {backoff:.0?} (attempt {consecutive_crashes}/{MAX_CONSECUTIVE_CRASHES})"
        );
        std::thread::sleep(backoff);
    }
}

fn backoff_for(attempt: u32) -> std::time::Duration {
    // 0.5s, 1s, 2s, 4s, 8s (capped) — attempt is always ≥1 here.
    let shift = (attempt - 1).min(4);
    std::time::Duration::from_millis(500u64.saturating_mul(1 << shift))
}

/// Spawn one sidecar instance and wire its stdout reader. Returns Err when the
/// process could not even be started.
fn spawn_once(
    child_ref: &Arc<Mutex<Option<Child>>>,
    port: &Arc<Mutex<Option<u16>>>,
    app: &AppHandle,
) -> Result<(), String> {
    let script = sidecar_script(app)
        .ok_or_else(|| "could not resolve a sidecar script path".to_string())?;
    if !std::path::Path::new(&script).exists() {
        return Err(format!(
            "sidecar script not found at {script} (build it with `pnpm build:cli`)"
        ));
    }

    let node = node_bin(app).ok_or_else(|| "no Node runtime resolvable".to_string())?;
    let mut child = Command::new(&node)
        .arg(&script)
        // Pin the port up-front so the main window (created by Tauri from
        // tauri.conf.json before `setup` runs) can be addressed by a static
        // URL. `resolveDesktopHostPort()` in desktop-host.ts still honors
        // `TUD_SIDECAR_PORT` if the caller wants a different value; only the
        // Tauri-hosted case hardcodes the DEFAULT_DESKTOP_PORT so
        // `http://127.0.0.1:{DEFAULT_DESKTOP_PORT}/` always resolves to this
        // child — the random-port fallback (only hit on bind failure) is a
        // separate edge case we surface via the `PORT=` line as before.
        .env("TUD_SIDECAR_PORT", DEFAULT_DESKTOP_PORT.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn node sidecar ({node} {script}): {e}"))?;

    // Pull the pipes out first (leaving the child with `None` fields), then
    // store the child itself for `kill()`. `kill` only needs the pid, so the
    // child stays a valid process handle even after its pipes are taken.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout from sidecar".to_string())?;
    let stderr = child.stderr.take();
    *child_ref.lock().unwrap() = Some(child);

    // The stdout thread shares the port with the Tauri state via the Arc.
    let port = Arc::clone(port);
    let app = app.clone();
    std::thread::spawn(move || {
        read_stdout(stdout, stderr, port, app);
    });

    Ok(())
}

/// Read stdout line-by-line: capture `PORT=`, emit on `SYNCED`; drain stderr.
fn read_stdout(
    stdout: std::process::ChildStdout,
    stderr: Option<std::process::ChildStderr>,
    port: Arc<Mutex<Option<u16>>>,
    app: AppHandle,
) {
    if let Some(se) = stderr {
        // Drain stderr so the pipe never fills and blocks the child.
        std::thread::spawn(move || {
            for _ in BufReader::new(se).lines() {
                // Dev: swallow. Later: forward to the tauri logger.
            }
        });
    }

    for line in BufReader::new(stdout).lines().flatten() {
        if let Some(p) = line.strip_prefix("PORT=") {
            if let Ok(n) = p.trim().parse::<u16>() {
                *port.lock().unwrap() = Some(n);
                eprintln!("[tud-desktop] sidecar bound to PORT={n}");
                // Verify the main webview (now the bundled dashboard, not the
                // loopback sidecar) actually mounted: probe its URL, the
                // injected `window.tud` bridge, and whether the dashboard
                // `#root` has children. Done a few seconds after the sidecar
                // binds so the dashboard's first data fetch has fired.
                let app_probe = app.clone();
                std::thread::spawn(move || {
                    use tauri::Manager as _;
                    for i in 1..=4u32 {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        let secs = i as u64 * 3;
                        match app_probe.get_webview_window("main") {
                            Some(win) => {
                                let js = r#"JSON.stringify({
  href: location.href,
  ready: document.readyState,
  title: document.title,
  rootKids: document.getElementById("root") ? document.getElementById("root").children.length : -1,
  hasTud: typeof window.tud !== "undefined",
  hasTudApi: !!(window.tud && window.tud.api && window.tud.api.request),
  bodyLen: document.body ? document.body.innerText.length : -1
})"#;
                                match win.eval_with_callback(js, move |out| {
                                    eprintln!("[tud-desktop] main-webview(t+{secs}s): {out}")
                                }) {
                                    Ok(()) => {}
                                    Err(e) => {
                                        eprintln!("[tud-desktop] main-webview(t+{secs}s): eval failed: {e}")
                                    }
                                }
                            }
                            None => {
                                eprintln!("[tud-desktop] main-webview(t+{}s): main window gone", secs)
                            }
                        }
                    }
                });
            }
        } else if line.trim() == "SYNCED" {
            let _ = app.emit("tud:data-synced", ());
        } else if let Some(p) = line.strip_prefix("RUNTIME_NOTICE=") {
            // `CONFIG_RESET:<true|false>` — a corrupt config was recovered.
            // Forward to the webviews as `app:runtime-notice`; the renderer's
            // `onRuntimeNotice` filters to `kind: 'config-reset'`.
            let payload = parse_runtime_notice(p);
            if let Some(payload) = payload {
                let _ = app.emit("app:runtime-notice", &payload);
            }
        }
    }
}

/// Turn a `RUNTIME_NOTICE=` payload (currently only `CONFIG_RESET:<bool>`) into
/// the camelCase `app:runtime-notice` detail the renderer expects. Returns
/// `None` for unknown notice kinds so a future marker never misfires the UI.
fn parse_runtime_notice(payload: &str) -> Option<serde_json::Value> {
    let (kind, token_salvaged) = match payload {
        p if p.starts_with("CONFIG_RESET:") => {
            ("config-reset", p["CONFIG_RESET:".len()..].trim() == "true")
        }
        _ => return None,
    };
    Some(serde_json::json!({ "kind": kind, "tokenSalvaged": token_salvaged }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_config_reset_notice() {
        let v = parse_runtime_notice("CONFIG_RESET:true").unwrap();
        assert_eq!(v["kind"], "config-reset");
        assert_eq!(v["tokenSalvaged"], true);

        let v = parse_runtime_notice("CONFIG_RESET:false").unwrap();
        assert_eq!(v["tokenSalvaged"], false);
    }

    #[test]
    fn unknown_notice_kinds_return_none() {
        assert!(parse_runtime_notice("SOMETHING_ELSE").is_none());
        assert!(parse_runtime_notice("").is_none());
        // A bare `CONFIG_RESET:` prefix with no value is still a valid notice
        // (no token salvaged), just with the flag defaulting to false.
        let v = parse_runtime_notice("CONFIG_RESET:").unwrap();
        assert_eq!(v["tokenSalvaged"], false);
    }
}

/// Kill the sidecar child on app exit and stop the monitor from respawning.
pub fn stop(state: &SidecarState) {
    state.shutting_down.store(true, Ordering::SeqCst);
    let mut child = state.child.lock().unwrap();
    if let Some(c) = child.as_mut() {
        let _ = c.kill();
    }
    *child = None;
}

/// Return the loopback URL of the sidecar. Uses the bound port once known,
/// otherwise the desktop default — the frontend bridge falls back the same way
/// so the dashboard shows "recovering" until the sidecar reports its port.
#[tauri::command]
pub fn sidecar_url(state: State<'_, SidecarState>) -> String {
    let port = state.port.lock().unwrap().unwrap_or(DEFAULT_DESKTOP_PORT);
    format!("http://127.0.0.1:{port}")
}

/// Fire a sync on the sidecar (tray "同步数据" menu item → `POST /functions/tud-trigger-sync`).
///
/// Uses a raw loopback TCP connection with a minimal hand-written HTTP/1.1
/// request body rather than an HTTP client crate, so this stays dependency-free
/// (and works in the offline build). Failures are swallowed: the sync is
/// fire-and-forget from a menu click, exactly like Electron's `triggerSync`.
pub fn trigger_sync(state: &SidecarState) {
    let port = state.port.lock().unwrap().unwrap_or(DEFAULT_DESKTOP_PORT);
    let addr = std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port);
    std::thread::spawn(move || {
        use std::io::{Read, Write};
        let mut stream = match std::net::TcpStream::connect_timeout(
            &addr,
            std::time::Duration::from_secs(2),
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        let req = format!(
            "POST /functions/tud-trigger-sync HTTP/1.1\r\n\
             Host: 127.0.0.1:{port}\r\n\
             Content-Type: application/json\r\n\
             Content-Length: 2\r\n\
             Connection: close\r\n\r\n\
             {{}}"
        );
        if stream.write_all(req.as_bytes()).is_err() {
            return;
        }
        // Drain the response so the server can close cleanly.
        let mut _resp = [0u8; 4096];
        let _ = stream.read(&mut _resp);
    });
}

/// Blocking GET/POST to the sidecar's local-api over raw loopback TCP
/// (dependency-free, like `trigger_sync`). Returns `(status, body_text)`.
/// Used by the pet-catalog proxy commands.
pub fn http_call(
    state: &SidecarState,
    method: &str,
    path: &str,
    body: Option<&str>,
) -> Result<(u16, String), String> {
    use std::io::{Read, Write};
    let port = state.port.lock().unwrap().unwrap_or(DEFAULT_DESKTOP_PORT);
    let addr = std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port);
    let body_bytes: &[u8] = body.map(|b| b.as_bytes()).unwrap_or(&[]);
    let mut stream = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(5))
        .map_err(|e| format!("connect sidecar {addr}: {e}"))?;
    let req = format!(
        "{method} {path} HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body_bytes.len(),
    );
    stream
        .write_all(req.as_bytes())
        .and_then(|_| stream.write_all(body_bytes))
        .map_err(|e| format!("write sidecar request: {e}"))?;
    let mut buf = Vec::new();
    stream
        .read_to_end(&mut buf)
        .map_err(|e| format!("read sidecar response: {e}"))?;
    let raw = String::from_utf8_lossy(&buf).into_owned();
    let (head, body_text) = match raw.find("\r\n\r\n") {
        Some(i) => (raw[..i].to_string(), raw[i + 4..].to_string()),
        None => (raw.clone(), String::new()),
    };
    let status = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);
    Ok((status, body_text))
}

/// Unwrap a sidecar `{success, message, data}` envelope; errors carry the
/// server's message so the UI can surface it verbatim.
pub fn envelope_data(status: u16, body: &str) -> Result<serde_json::Value, String> {
    if status >= 400 {
        return Err(format!("sidecar HTTP {status}"));
    }
    let parsed: serde_json::Value = if body.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(body).map_err(|e| format!("parse sidecar response: {e}"))?
    };
    if parsed.get("success").and_then(|v| v.as_bool()) == Some(true) {
        Ok(parsed.get("data").cloned().unwrap_or(serde_json::Value::Null))
    } else {
        Err(parsed
            .get("message")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "SIDECAR_REQUEST_FAILED".to_string()))
    }
}
