//! Ploots Click desktop shell.
//!
//! The app itself is the web app in `../dist` (built by `desktop/build_dist.py`
//! with every library, font and icon bundled), shown in a WebView2 window.
//! Nothing is hosted: files you open stay on this computer.
//!
//! Native command:
//!   `kobo_get(url, token)`  reads the KoboToolbox API. A web page cannot
//!   (Kobo sends no CORS headers for other sites), so the web version needs
//!   `tools/kobo_proxy.py`; the desktop app does the request here instead.
//!   Only GET requests to `/api/v2/` are allowed and the token is not stored.

use std::io::Read;
use std::time::Duration;

#[derive(serde::Serialize)]
struct HttpReply {
    status: u16,
    body: String,
}

/// Largest Kobo response read (a page of 1000 submissions is well below it).
const MAX_BODY: u64 = 256 * 1024 * 1024;

fn kobo_request(url: &str, token: Option<&str>) -> Result<HttpReply, String> {
    let u = url::Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    if !matches!(u.scheme(), "https" | "http") || !u.path().starts_with("/api/v2/") {
        return Err("Only KoboToolbox API v2 URLs (…/api/v2/…) are allowed.".into());
    }
    let host = u.host_str().unwrap_or("the server").to_string();
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .user_agent(concat!("PlootsClick/", env!("CARGO_PKG_VERSION")))
        .build();
    let mut req = agent.get(u.as_str()).set("Accept", "application/json");
    if let Some(t) = token.map(str::trim).filter(|t| !t.is_empty()) {
        req = req.set("Authorization", &format!("Token {t}"));
    }
    let resp = match req.call() {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(format!("Could not reach {host}: {e}")),
    };
    let status = resp.status();
    let mut body = String::new();
    resp.into_reader()
        .take(MAX_BODY)
        .read_to_string(&mut body)
        .map_err(|e| format!("Could not read the reply from {host}: {e}"))?;
    Ok(HttpReply { status, body })
}

#[tauri::command]
async fn kobo_get(url: String, token: Option<String>) -> Result<HttpReply, String> {
    tauri::async_runtime::spawn_blocking(move || kobo_request(&url, token.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![kobo_get])
        .run(tauri::generate_context!())
        .expect("error while running Ploots Click");
}
