// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::Write;
use tauri::ipc::{InvokeBody, Request};
use tauri::Manager;

/// A backup file name the app made: `heirloom-backup-…hlbak`, nothing that
/// could reach outside the Downloads folder.
fn safe_backup_name(name: &str) -> bool {
    name.starts_with("heirloom-backup-")
        && name.ends_with(".hlbak")
        && name.len() <= 80
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.contains("..")
}

/// Saves a backup's bytes to the Downloads folder before an update (#24), so
/// the app knows the file is there before it installs anything. The bytes come
/// as the raw request body and the file name in the `x-name` header. An existing
/// file is never overwritten: a number is added instead. Returns the file name.
#[tauri::command]
fn save_backup_to_downloads(app: tauri::AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("the backup must be sent as bytes".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .filter(|n| safe_backup_name(n))
        .ok_or("a backup file name is required")?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let stem = name.trim_end_matches(".hlbak");
    for n in 0..100 {
        let file = if n == 0 { name.to_string() } else { format!("{stem} ({n}).hlbak") };
        let path = dir.join(&file);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                let written = f.write_all(bytes).and_then(|_| f.sync_all());
                if let Err(e) = written {
                    // A half-written backup is worse than none: take it away.
                    let _ = std::fs::remove_file(&path);
                    return Err(e.to_string());
                }
                return Ok(file);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("too many backups with this name in Downloads".into())
}

fn main() {
    // WebKitGTK's compositing mode flashes an overlay dark, clear, then dark
    // again the first time each kind of dialog or the lightbox opens (#1260).
    // Without it, scrolling measured the same 60 fps and CPU, and WebGL (the
    // Places map) still works; the DMABuf-renderer switch also stops the flash
    // but cut scrolling to ~25 fps. Set before GTK starts, and only when unset,
    // so WEBKIT_DISABLE_COMPOSITING_MODE=0 turns compositing back on.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    let context = tauri::generate_context!();
    // The in-app updater (#24) runs on Windows, and only in a build whose
    // configuration carries the updater's public key (the release workflow adds
    // it once the signing secrets exist). Without it the app still finds new
    // releases and sends people to the release page, as the Flatpak does.
    let updater = cfg!(target_os = "windows")
        && context
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|u| u.get("pubkey"))
            .and_then(|k| k.as_str())
            .is_some_and(|k| !k.trim().is_empty());

    let mut builder = tauri::Builder::default()
        // Opens external links in the system browser (#1020).
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![save_backup_to_downloads]);
    if updater {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder.run(context).expect("error while running Heirloom");
}

#[cfg(test)]
mod tests {
    use super::safe_backup_name;

    #[test]
    fn only_app_backup_names_are_saved() {
        assert!(safe_backup_name("heirloom-backup-2026-11-25.hlbak"));
        assert!(!safe_backup_name("../heirloom-backup-x.hlbak"));
        assert!(!safe_backup_name("heirloom-backup-x/../../a.hlbak"));
        assert!(!safe_backup_name("heirloom-backup-x.exe"));
        assert!(!safe_backup_name("other.hlbak"));
    }
}
