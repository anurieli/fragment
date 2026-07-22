use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Stronghold encrypted vault for API keys and tokens.
      // The salt file lives next to the vault in app local data.
      let data_dir = app
        .path()
        .app_local_data_dir()
        .expect("could not resolve app local data dir");
      std::fs::create_dir_all(&data_dir)
        .expect("could not create app local data dir");
      let salt_path = data_dir.join("stronghold.salt");

      app.handle().plugin(
        tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build(),
      )?;

      // Opener plugin — opens URLs in the system default browser.
      app.handle().plugin(tauri_plugin_opener::init())?;

      // File-system plugin — used for note backup to app data directory.
      app.handle().plugin(tauri_plugin_fs::init())?;

      // HTTP plugin — native (non-WebView) requests for hosts that reject the
      // WKWebView's CORS preflight (e.g. chatgpt.com/backend-api for Codex).
      app.handle().plugin(tauri_plugin_http::init())?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
