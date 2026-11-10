// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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

    tauri::Builder::default()
        // Opens external links in the system browser (#1020).
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Heirloom");
}
