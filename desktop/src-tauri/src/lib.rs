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
//!   `kobo_token(server, username, password)`  signs in: asks the server's
//!   `/token/` endpoint (Basic auth) for the account's API token. The
//!   password is used for that one request and never kept.

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

/// Standard base64 (for the Basic authorization header).
fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn kobo_token_request(server: &str, username: &str, password: &str) -> Result<HttpReply, String> {
    let s = url::Url::parse(server).map_err(|e| format!("Invalid server: {e}"))?;
    if !matches!(s.scheme(), "https" | "http") {
        return Err("The server must be an http(s) address.".into());
    }
    let host = s.host_str().unwrap_or("the server").to_string();
    let u = s.join("/token/?format=json").map_err(|e| e.to_string())?;
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("PlootsClick/", env!("CARGO_PKG_VERSION")))
        .build();
    let auth = format!("Basic {}", base64(format!("{username}:{password}").as_bytes()));
    let resp = match agent.get(u.as_str()).set("Accept", "application/json").set("Authorization", &auth).call() {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(format!("Could not reach {host}: {e}")),
    };
    let status = resp.status();
    let mut body = String::new();
    resp.into_reader()
        .take(1024 * 1024)
        .read_to_string(&mut body)
        .map_err(|e| format!("Could not read the reply from {host}: {e}"))?;
    Ok(HttpReply { status, body })
}

#[tauri::command]
async fn kobo_token(server: String, username: String, password: String) -> Result<HttpReply, String> {
    tauri::async_runtime::spawn_blocking(move || kobo_token_request(&server, &username, &password))
        .await
        .map_err(|e| e.to_string())?
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
        .invoke_handler(tauri::generate_handler![kobo_get, kobo_token])
        .run(tauri::generate_context!())
        .expect("error while running Ploots Click");
}
