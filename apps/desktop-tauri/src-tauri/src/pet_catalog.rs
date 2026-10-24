//! Desktop pet catalog commands — thin proxies over the Node sidecar's
//! `/functions/tud-desktop-pets/*` routes (scanner/installer live in
//! `packages/cli/src/desktop-pets-*.ts`, ported from the Electron app).
//!
//! Responsibilities kept in Rust: merging the built-in trio with the local
//! scan, attaching the current selection from prefs, and handing webviews a
//! loopback spritesheet URL (replaces Electron's `pet-asset://` protocol —
//! local atlases are streamed by the sidecar instead of a custom scheme).

use crate::prefs::PrefsState;
use crate::sidecar::{self, SidecarState};
use tauri::State;

const BUILTIN_PETS: &[(&str, &str, &str)] = &[
    ("hawking", "Hawking", "橙色、锐眼的土星伙伴"),
    ("yoyo", "Yoyo", "蓝色、胸前带星标的伙伴"),
    ("click", "Click", "青绿色、亮眼的克里克伙伴"),
];

fn builtin_entries() -> Vec<serde_json::Value> {
    BUILTIN_PETS
        .iter()
        .map(|(id, name, description)| {
            serde_json::json!({
                "id": id,
                "displayName": name,
                "description": description,
                "glow": { "primary": "#7c8cff", "accent": "#69d4ff" },
                "source": "builtin",
            })
        })
        .collect()
}

fn selected_pet_id(prefs: &PrefsState) -> String {
    prefs
        .get()
        .desktop_pet
        .map(|pref| pref.selected_pet_id)
        .unwrap_or_else(|| "hawking".to_string())
}

fn local_catalog(state: &SidecarState) -> Result<serde_json::Value, String> {
    let (status, body) =
        sidecar::http_call(state, "GET", "/functions/tud-desktop-pets/catalog", None)?;
    sidecar::envelope_data(status, &body)
}

fn push_remote_pets(pets: &mut Vec<serde_json::Value>, remote: &serde_json::Value) -> Option<String> {
    let mut remote_error = None;
    if let Some(error) = remote.get("error").and_then(|e| e.as_str()) {
        remote_error = Some(error.to_string());
    }
    let known: std::collections::HashSet<String> = pets
        .iter()
        .filter_map(|pet| {
            pet.get("id")
                .and_then(|id| id.as_str())
                .map(|id| id.to_string())
        })
        .collect();
    if let Some(entries) = remote.get("pets").and_then(|p| p.as_array()) {
        for entry in entries {
            if let Some(id) = entry.get("id").and_then(|id| id.as_str()) {
                if !known.contains(id) {
                    pets.push(entry.clone());
                }
            }
        }
    }
    remote_error
}

fn build_catalog(state: &SidecarState, prefs: &PrefsState, remote: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let local = local_catalog(state)?;
    let mut pets = builtin_entries();
    if let Some(local_pets) = local.get("pets").and_then(|p| p.as_array()) {
        pets.extend(local_pets.iter().cloned());
    }
    let remote_error = remote
        .as_ref()
        .map(|r| push_remote_pets(&mut pets, r))
        .unwrap_or(None);
    let invalid_pets = local
        .get("invalidPets")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));
    Ok(serde_json::json!({
        "pets": pets,
        "invalidPets": invalid_pets,
        "selectedPetId": selected_pet_id(prefs),
        "remoteError": remote_error,
    }))
}

/// Refresh the local catalog (built-ins + `~/.ai-usage/pets/` scan).
#[tauri::command]
pub fn desktop_pet_refresh_catalog(
    state: State<'_, SidecarState>,
    prefs: State<'_, PrefsState>,
) -> Result<serde_json::Value, String> {
    build_catalog(&state, &prefs, None)
}

/// Refresh + merge the community catalog (Gitee primary, GitHub fallback).
#[tauri::command]
pub fn desktop_pet_fetch_remote_catalog(
    state: State<'_, SidecarState>,
    prefs: State<'_, PrefsState>,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let path = if force.unwrap_or(false) {
        "/functions/tud-desktop-pets/remote?force=1"
    } else {
        "/functions/tud-desktop-pets/remote"
    };
    let (status, body) = sidecar::http_call(&state, "GET", path, None)?;
    // A failed remote fetch still yields a usable local catalog + error note,
    // matching the Electron behavior of surfacing `remoteError`.
    let remote = sidecar::envelope_data(status, &body)
        .unwrap_or(serde_json::json!({ "pets": [], "error": "社区宠物列表加载失败" }));
    build_catalog(&state, &prefs, Some(remote))
}

/// Install one community pet, then return the merged catalog (the settings
/// Select auto-selects the newly installed pet, like Electron).
#[tauri::command]
pub fn desktop_pet_install_remote(
    state: State<'_, SidecarState>,
    prefs: State<'_, PrefsState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({ "id": id }).to_string();
    let (status, response) =
        sidecar::http_call(&state, "POST", "/functions/tud-desktop-pets/install", Some(&body))?;
    sidecar::envelope_data(status, &response)?;
    // Merge with the (now cached) community list for the section below.
    let (r_status, r_body) =
        sidecar::http_call(&state, "GET", "/functions/tud-desktop-pets/remote", None)?;
    let remote = sidecar::envelope_data(r_status, &r_body)
        .unwrap_or(serde_json::json!({ "pets": [] }));
    build_catalog(&state, &prefs, Some(remote))
}

/// Reveal the pets directory in the OS file manager (Electron
/// `shell.openPath`). Best-effort mkdir so Finder opens an existing folder.
#[tauri::command]
pub fn open_desktop_pet_directory(app: tauri::AppHandle) -> Result<(), String> {
    let dir = crate::pets_root();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Loopback spritesheet URL for a locally installed pet (sidecar streams the
/// WebP). Built-ins resolve from the app bundle, so they return `None`.
#[tauri::command]
pub fn desktop_pet_spritesheet_url(
    state: State<'_, SidecarState>,
    id: String,
) -> Result<Option<String>, String> {
    if !valid_pet_id(&id) {
        return Err("无效的宠物 id".to_string());
    }
    if BUILTIN_PETS.iter().any(|(builtin, _, _)| *builtin == id) {
        return Ok(None);
    }
    let port = state
        .port
        .lock()
        .unwrap()
        .unwrap_or(sidecar::DEFAULT_DESKTOP_PORT);
    Ok(Some(format!(
        "http://127.0.0.1:{port}/functions/tud-desktop-pets/spritesheet/{id}"
    )))
}

/// Same shape as upstream `DESKTOP_PET_ID_PATTERN`: lowercase letter first,
/// then 0–63 lowercase letters/digits/hyphens.
pub fn valid_pet_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() => {}
        _ => return false,
    }
    id.len() <= 64 && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Whether `id` is selectable: a built-in, or present in the local scan.
/// Falls back to built-ins only when the sidecar is unreachable.
pub fn is_selectable_pet(state: &SidecarState, id: &str) -> bool {
    if BUILTIN_PETS.iter().any(|(builtin, _, _)| *builtin == id) {
        return true;
    }
    if !valid_pet_id(id) {
        return false;
    }
    local_catalog(state)
        .ok()
        .and_then(|catalog| {
            catalog.get("pets").and_then(|pets| pets.as_array()).map(|pets| {
                pets.iter().any(|pet| {
                    pet.get("id").and_then(|v| v.as_str()) == Some(id)
                        && pet.get("source").and_then(|v| v.as_str()) == Some("local")
                })
            })
        })
        .unwrap_or(false)
}
