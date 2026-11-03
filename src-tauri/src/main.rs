#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

// Exports (Fountain, plain text, backups) go wherever the save dialog said.
// The webview cannot write to disk itself, so the frontend hands the text here.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not write {}: {}", path, e))
}

// A link opens in the real browser rather than inside the app's webview, which
// has no way back.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) {
        return Err("Only web links can be opened.".into());
    }
    open::that(&url).map_err(|e| format!("Could not open {}: {}", url, e))
}

// Google Docs import. The webview can't fetch docs.google.com (no CORS), so the
// document is downloaded here as .docx and parsed by the frontend. Only a document
// id is accepted, so this can't be pointed anywhere else.
#[tauri::command]
async fn fetch_google_doc(id: String) -> Result<tauri::ipc::Response, String> {
    if id.is_empty() || id.len() > 200 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("That doesn't look like a Google Docs link.".into());
    }
    let url = format!("https://docs.google.com/document/d/{}/export?format=docx", id);
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let not_shared = "Google wouldn't hand the document over. Set its sharing to \"Anyone with the link\", or download it as a Word file and import that.";
        let mut resp = ureq::get(&url).call().map_err(|e| match e {
            ureq::Error::StatusCode(401 | 403 | 404) => not_shared.to_string(),
            other => format!("Could not reach Google Docs: {}", other),
        })?;
        // a private document answers with the sign-in page instead of a file
        let html = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.contains("text/html"))
            .unwrap_or(false);
        if html {
            return Err(not_shared.to_string());
        }
        resp.body_mut()
            .with_config()
            .limit(50 * 1024 * 1024)
            .read_to_vec()
            .map_err(|e| format!("The download was cut short: {}", e))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

fn main() {
    tauri::Builder::default()
        // Put the window back where it was last closed. Visibility is left out: the
        // window starts hidden so it can be restored before anyone sees it, and the
        // frontend shows it once it has drawn.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![write_text_file, open_url, fetch_google_doc])
        .setup(|app| {
            // If the frontend never gets far enough to show the window, do it anyway
            // so the app is not left running invisibly.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ScriptOS");
}
