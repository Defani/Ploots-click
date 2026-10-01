//! GIS Consultant Studio desktop shell.
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
//!   `google_signin(client_id, client_secret, scopes)`  Google sign-in in the
//!   default browser (Chrome…), the OAuth way for installed apps: a one-time
//!   listener on 127.0.0.1 receives the code, PKCE protects it, and the code
//!   is exchanged for tokens here. Google refuses its sign-in page inside an
//!   app window, so this is how Earth Engine signs in on the desktop.
//!   `google_refresh(client_id, client_secret, refresh_token)`  a new access
//!   token when the old one expires (about an hour), without the browser.
//!   `native_pick / native_open / native_close / native_feature`  the native
//!   vector engine (src/native_vec.rs): big shapefiles opened in place and
//!   drawn as vector tiles through the `gcs` URI scheme, as QGIS reads them.
//!   `ee_local_token()`  as GeoLibre and geemap: the Earth Engine sign-in
//!   already on this computer (`earthengine authenticate` / ee.Authenticate(),
//!   kept by the earthengine-api Python package) gives a fresh access token
//!   through that package, so no OAuth client has to be set up. Run only
//!   when the user presses Connect; the token goes to the app, nowhere else.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

mod native_vec;

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

/// Base64url without padding (PKCE verifier and challenge).
fn b64url(data: &[u8]) -> String {
    base64(data).trim_end_matches('=').replace('+', "-").replace('/', "_")
}

fn google_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("GISConsultantStudio/", env!("CARGO_PKG_VERSION")))
        .build()
}

fn google_token(form: &[(&str, &str)]) -> Result<HttpReply, String> {
    let resp = match google_agent().post("https://oauth2.googleapis.com/token").send_form(form) {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(format!("Could not reach Google: {e}")),
    };
    let status = resp.status();
    let mut body = String::new();
    resp.into_reader().take(1024 * 1024).read_to_string(&mut body).map_err(|e| e.to_string())?;
    Ok(HttpReply { status, body })
}

const SIGNED_IN_PAGE: &str = "<!doctype html><meta charset=utf-8><title>GIS Consultant Studio</title><body style=\"font:16px system-ui;display:grid;place-items:center;height:90vh;color:#2c3a2e\"><div style=\"text-align:center\"><h2 style=\"color:#4e8a2e\">Signed in</h2><p>You can close this tab and go back to GIS Consultant Studio.</p></div>";

fn google_signin_blocking(client_id: &str, client_secret: &str, scopes: &str) -> Result<HttpReply, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Could not open a local port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let mut rnd = [0u8; 64];
    getrandom::getrandom(&mut rnd).map_err(|e| e.to_string())?;
    let verifier = b64url(&rnd[..48]);
    let state = b64url(&rnd[48..]);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let mut auth = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    auth.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", scopes)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    tauri_plugin_opener::open_url(auth.as_str(), None::<&str>).map_err(|e| format!("Could not open the browser: {e}"))?;

    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
                let u = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
                let get = |k: &str| u.query_pairs().find(|(a, _)| a == k).map(|(_, v)| v.to_string());
                let (code, err) = (get("code"), get("error"));
                if code.is_none() && err.is_none() {
                    // favicon and the like
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }
                let page = if err.is_some() { SIGNED_IN_PAGE.replace("Signed in", "Sign-in cancelled") } else { SIGNED_IN_PAGE.to_string() };
                let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", page.len(), page).as_bytes());
                if let Some(e) = err { return Err(format!("Google sign-in: {e}")); }
                if get("state").as_deref() != Some(state.as_str()) { return Err("Google sign-in: the reply did not match this sign-in (state).".into()); }
                let code = code.unwrap();
                let mut form = vec![("code", code.as_str()), ("client_id", client_id), ("redirect_uri", redirect.as_str()), ("grant_type", "authorization_code"), ("code_verifier", verifier.as_str())];
                if !client_secret.is_empty() { form.push(("client_secret", client_secret)); }
                return google_token(&form);
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline { return Err("Google sign-in timed out (5 minutes). Press Connect again.".into()); }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Python that asks the installed earthengine-api for a fresh token from the
/// saved Earth Engine sign-in, and prints it with the saved project.
const EE_LOCAL_PY: &str = r#"
import json, sys
try:
    import ee.oauth as o
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
except Exception as e:
    print(json.dumps({"error": "noee", "detail": str(e)})); sys.exit(0)
try:
    a = o.get_credentials_arguments()
    c = Credentials(None, **a)
    c.refresh(Request())
    try:
        project = json.load(open(o.get_credentials_path())).get("project")
    except Exception:
        project = None
    print(json.dumps({"access_token": c.token, "expires_in": 3300, "project": project}))
except FileNotFoundError:
    print(json.dumps({"error": "nologin"}))
except Exception as e:
    print(json.dumps({"error": "refresh", "detail": str(e)[:300]}))
"#;

fn ee_local_blocking() -> Result<HttpReply, String> {
    let mut last = String::from("Python was not found.");
    for (exe, pre) in [("python", vec![]), ("py", vec!["-3"]), ("python3", vec![])] {
        let mut cmd = std::process::Command::new(exe);
        cmd.args(&pre).arg("-c").arg(EE_LOCAL_PY);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // no console window
        }
        match cmd.output() {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if text.starts_with('{') {
                    if text.contains("\"error\": \"noee\"") { last = text; continue; }
                    return Ok(HttpReply { status: if text.contains("\"access_token\"") { 200 } else { 400 }, body: text });
                }
                last = String::from_utf8_lossy(&out.stderr).chars().take(300).collect();
            }
            Err(e) => last = e.to_string(),
        }
    }
    Ok(HttpReply { status: 400, body: serde_json::json!({ "error": "nopython", "detail": last }).to_string() })
}

#[tauri::command]
async fn ee_local_token() -> Result<HttpReply, String> {
    tauri::async_runtime::spawn_blocking(ee_local_blocking).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn google_signin(client_id: String, client_secret: Option<String>, scopes: String) -> Result<HttpReply, String> {
    tauri::async_runtime::spawn_blocking(move || google_signin_blocking(&client_id, client_secret.as_deref().unwrap_or(""), &scopes))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn google_refresh(client_id: String, client_secret: Option<String>, refresh_token: String) -> Result<HttpReply, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let secret = client_secret.unwrap_or_default();
        let mut form = vec![("client_id", client_id.as_str()), ("refresh_token", refresh_token.as_str()), ("grant_type", "refresh_token")];
        if !secret.is_empty() { form.push(("client_secret", secret.as_str())); }
        google_token(&form)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Native vector engine (src/native_vec.rs): pick a big file, open it in
/// place, describe one feature, close it. Its tiles come through the `gcs`
/// URI scheme registered in run().
#[tauri::command]
async fn native_pick() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Open a big vector file (native engine)")
            .add_filter("Shapefile", &["shp"])
            .pick_file()
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn native_open(path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || native_vec::open_json(&path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn native_close(id: u32) {
    native_vec::close(id);
}

#[tauri::command]
async fn native_feature(id: u32, fid: u64) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || native_vec::feature_json(id, fid)).await.map_err(|e| e.to_string())?
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
        // Vector tiles of the native engine, cut on their own threads.
        .register_asynchronous_uri_scheme_protocol("gcs", |_ctx, request, responder| {
            std::thread::spawn(move || {
                let uri = request.uri();
                let (status, ctype, body) = native_vec::handle(uri.path(), uri.query().unwrap_or(""));
                let resp = tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", ctype)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Cache-Control", "no-cache")
                    .body(body)
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()));
                responder.respond(resp);
            });
        })
        .invoke_handler(tauri::generate_handler![kobo_get, kobo_token, google_signin, google_refresh, ee_local_token, native_pick, native_open, native_close, native_feature])
        .run(tauri::generate_context!())
        .expect("error while running GIS Consultant Studio");
}
