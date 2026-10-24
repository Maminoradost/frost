//! Локальный HTTP-сервер звука для Android.
//!
//! Android WebView повторно применяет `Range` к ответам 206 пользовательских протоколов
//! (tauri-apps/wry#1864): первый кусок трека играет, следующие приходят со сдвигом,
//! и звук обрывается. Ядро отдаёт звук кусками 206 (см. `stream.rs`, `ytaudio.rs`),
//! поэтому на Android те же маршруты обслуживает настоящий HTTP-сервер на 127.0.0.1:
//!
//! * `r/…`, `a/…`, `img/…` передаются в `stream::handle` без изменений;
//! * `l/<base64url(путь)>` отдаёт локальные файлы с поддержкой Range (только из папок,
//!   которые пользователь открыл в медиатеке, см. `extras::local_allow`).
//!
//! Путь начинается с секретного токена: порт виден другим приложениям на телефоне,
//! токен знает только наш WebView. Cleartext разрешён только для 127.0.0.1
//! (`frost_network_security_config.xml` в плагине `frost-mobile`).
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::io::{self, SeekFrom};
use std::net::Ipv4Addr;
use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use http::{header, Method, Request, Response, StatusCode};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

/// Предел на строку запроса и заголовки.
const MAX_HEAD: usize = 16 * 1024;
/// Сколько держим простаивающее keep-alive соединение.
const IDLE: Duration = Duration::from_secs(30);

/// Запускает сервер. Возвращает базовый адрес вида `http://127.0.0.1:PORT/TOKEN/`.
pub fn start(app: AppHandle) -> io::Result<String> {
    let std_listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    std_listener.set_nonblocking(true)?;
    let port = std_listener.local_addr()?.port();
    let token = secret();
    let base = format!("http://127.0.0.1:{port}/{token}/");
    let prefix = format!("/{token}/");

    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::from_std(std_listener) {
            Ok(listener) => listener,
            Err(err) => {
                eprintln!("[frost] loopback: {err}");
                return;
            }
        };
        loop {
            match listener.accept().await {
                Ok((socket, _)) => {
                    let app = app.clone();
                    let prefix = prefix.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = connection(app, socket, prefix).await;
                    });
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
            }
        }
    });
    Ok(base)
}

/// Базовый адрес звука для фронтенда: на Android это локальный сервер, на десктопе `frost://`.
#[tauri::command]
pub fn media_base() -> String {
    crate::stream::base_url().to_string()
}

/// 128 бит случайности: `/dev/urandom`, а если его нет, случайно засеянный `RandomState`.
fn secret() -> String {
    use std::io::Read;
    let mut bytes = [0u8; 16];
    let urandom = std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes));
    if urandom.is_err() {
        use std::hash::{BuildHasher, Hasher};
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        for (i, chunk) in bytes.chunks_mut(8).enumerate() {
            let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
            hasher.write_usize(i);
            hasher.write_u128(nanos);
            hasher.write_u32(std::process::id());
            chunk.copy_from_slice(&hasher.finish().to_le_bytes());
        }
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

struct Head {
    method: String,
    target: String,
    keep_alive: bool,
    content_length: u64,
    range: Option<String>,
    headers: Vec<(String, String)>,
}

async fn connection(app: AppHandle, socket: TcpStream, prefix: String) -> io::Result<()> {
    let _ = socket.set_nodelay(true);
    let (reader, mut writer) = socket.into_split();
    let mut reader = BufReader::new(reader);
    loop {
        let lines = match tokio::time::timeout(IDLE, read_head(&mut reader)).await {
            Ok(Ok(Some(lines))) => lines,
            _ => return Ok(()),
        };
        let Some(head) = parse_head(&lines) else {
            write_simple(&mut writer, StatusCode::BAD_REQUEST, false).await?;
            return Ok(());
        };
        if head.content_length > 0 {
            // Тело нам не нужно, но его надо вычитать, иначе собьётся следующий запрос.
            let mut sink = tokio::io::sink();
            tokio::io::copy(&mut (&mut reader).take(head.content_length), &mut sink).await?;
        }
        let keep = head.keep_alive;
        let path = head.target.split('?').next().unwrap_or_default().to_string();
        let Some(route) = path.strip_prefix(&prefix) else {
            write_simple(&mut writer, StatusCode::NOT_FOUND, keep).await?;
            if keep {
                continue;
            }
            return Ok(());
        };
        let head_only = head.method == "HEAD";

        if head.method == "OPTIONS" {
            write_simple(&mut writer, StatusCode::NO_CONTENT, keep).await?;
        } else if head.method != "GET" && !head_only {
            write_simple(&mut writer, StatusCode::METHOD_NOT_ALLOWED, keep).await?;
        } else if let Some(encoded) = route.strip_prefix("l/") {
            serve_local(&app, encoded, head.range.as_deref(), head_only, keep, &mut writer).await?;
        } else {
            let mut builder = Request::builder().method(Method::GET).uri(format!("/{route}"));
            for (name, value) in &head.headers {
                builder = builder.header(name.as_str(), value.as_str());
            }
            let response = match builder.body(Vec::new()) {
                Ok(request) => crate::stream::handle(&app, request).await,
                Err(_) => {
                    write_simple(&mut writer, StatusCode::BAD_REQUEST, false).await?;
                    return Ok(());
                }
            };
            write_response(&mut writer, response, head_only, keep).await?;
        }
        if !keep {
            return Ok(());
        }
    }
}

async fn read_head<R: AsyncBufRead + Unpin>(reader: &mut R) -> io::Result<Option<Vec<String>>> {
    let mut lines = Vec::new();
    let mut total = 0usize;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            return Ok(None);
        }
        total += n;
        if total > MAX_HEAD {
            return Ok(None);
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            if lines.is_empty() {
                continue;
            }
            return Ok(Some(lines));
        }
        lines.push(line.to_string());
    }
}

fn parse_head(lines: &[String]) -> Option<Head> {
    let mut parts = lines.first()?.split_whitespace();
    let method = parts.next()?.to_ascii_uppercase();
    let target = parts.next()?.to_string();
    let version = parts.next().unwrap_or("HTTP/1.0");
    let mut keep_alive = version.eq_ignore_ascii_case("HTTP/1.1");
    let mut content_length = 0;
    let mut range = None;
    let mut headers = Vec::new();
    for line in &lines[1..] {
        let Some((name, value)) = line.split_once(':') else { continue };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_string();
        match name.as_str() {
            "connection" => {
                let v = value.to_ascii_lowercase();
                if v.contains("close") {
                    keep_alive = false;
                } else if v.contains("keep-alive") {
                    keep_alive = true;
                }
            }
            "content-length" => content_length = value.parse().unwrap_or(0),
            "range" => range = Some(value.clone()),
            _ => {}
        }
        if matches!(name.as_str(), "range" | "accept" | "user-agent" | "if-range") {
            headers.push((name, value));
        }
    }
    Some(Head { method, target, keep_alive, content_length, range, headers })
}

/// Заголовки CORS: страница (`http://tauri.localhost`) и сервер живут на разных origin.
fn cors_lines(out: &mut Vec<u8>) {
    out.extend_from_slice(
        b"Access-Control-Allow-Origin: *\r\n\
          Access-Control-Allow-Headers: *\r\n\
          Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
          Access-Control-Allow-Private-Network: true\r\n\
          Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n",
    );
}

fn status_line(out: &mut Vec<u8>, status: StatusCode) {
    out.extend_from_slice(
        format!("HTTP/1.1 {} {}\r\n", status.as_u16(), status.canonical_reason().unwrap_or("")).as_bytes(),
    );
}

fn connection_line(out: &mut Vec<u8>, keep: bool) {
    let line: &[u8] = if keep { b"Connection: keep-alive\r\n" } else { b"Connection: close\r\n" };
    out.extend_from_slice(line);
}

async fn write_simple<W: AsyncWrite + Unpin>(writer: &mut W, status: StatusCode, keep: bool) -> io::Result<()> {
    let mut out = Vec::with_capacity(256);
    status_line(&mut out, status);
    cors_lines(&mut out);
    out.extend_from_slice(b"Content-Length: 0\r\n");
    connection_line(&mut out, keep);
    out.extend_from_slice(b"\r\n");
    writer.write_all(&out).await?;
    writer.flush().await
}

async fn write_response<W: AsyncWrite + Unpin>(
    writer: &mut W,
    response: Response<Vec<u8>>,
    head_only: bool,
    keep: bool,
) -> io::Result<()> {
    let (parts, body) = response.into_parts();
    let mut out = Vec::with_capacity(512);
    status_line(&mut out, parts.status);
    for (name, value) in parts.headers.iter() {
        if name == header::CONTENT_LENGTH
            || name == header::CONNECTION
            || name == header::TRANSFER_ENCODING
            || name.as_str().starts_with("access-control-")
        {
            continue;
        }
        out.extend_from_slice(name.as_str().as_bytes());
        out.extend_from_slice(b": ");
        out.extend_from_slice(value.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    cors_lines(&mut out);
    out.extend_from_slice(format!("Content-Length: {}\r\n", body.len()).as_bytes());
    connection_line(&mut out, keep);
    out.extend_from_slice(b"\r\n");
    writer.write_all(&out).await?;
    if !head_only {
        writer.write_all(&body).await?;
    }
    writer.flush().await
}

/// Локальный файл медиатеки. Отдаётся потоком с диска, без чтения целиком в память.
async fn serve_local<W: AsyncWrite + Unpin>(
    app: &AppHandle,
    encoded: &str,
    range: Option<&str>,
    head_only: bool,
    keep: bool,
    writer: &mut W,
) -> io::Result<()> {
    let path = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(encoded.trim_end_matches('='))
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(PathBuf::from);
    let Some(path) = path else {
        return write_simple(writer, StatusCode::BAD_REQUEST, keep).await;
    };
    // Только то, что пользователь сам открыл в медиатеке (те же правила, что у asset://).
    if !app.asset_protocol_scope().is_allowed(&path) {
        return write_simple(writer, StatusCode::FORBIDDEN, keep).await;
    }
    let mut file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(_) => return write_simple(writer, StatusCode::NOT_FOUND, keep).await,
    };
    let len = file.metadata().await.map(|m| m.len()).unwrap_or(0);

    let (status, start, end) = match range.and_then(crate::stream::parse_range) {
        Some((start, end)) => {
            let end = end.unwrap_or(u64::MAX).min(len.saturating_sub(1));
            if len == 0 || start >= len || end < start {
                let mut out = Vec::with_capacity(256);
                status_line(&mut out, StatusCode::RANGE_NOT_SATISFIABLE);
                cors_lines(&mut out);
                out.extend_from_slice(format!("Content-Range: bytes */{len}\r\nContent-Length: 0\r\n").as_bytes());
                connection_line(&mut out, keep);
                out.extend_from_slice(b"\r\n");
                writer.write_all(&out).await?;
                return writer.flush().await;
            }
            (StatusCode::PARTIAL_CONTENT, start, end)
        }
        None => (StatusCode::OK, 0, len.saturating_sub(1)),
    };
    let body_len = if len == 0 { 0 } else { end - start + 1 };

    let mut out = Vec::with_capacity(512);
    status_line(&mut out, status);
    cors_lines(&mut out);
    out.extend_from_slice(format!("Content-Type: {}\r\n", mime_for(&path)).as_bytes());
    out.extend_from_slice(b"Accept-Ranges: bytes\r\nCache-Control: no-cache\r\n");
    if status == StatusCode::PARTIAL_CONTENT {
        out.extend_from_slice(format!("Content-Range: bytes {start}-{end}/{len}\r\n").as_bytes());
    }
    out.extend_from_slice(format!("Content-Length: {body_len}\r\n").as_bytes());
    connection_line(&mut out, keep);
    out.extend_from_slice(b"\r\n");
    writer.write_all(&out).await?;
    if !head_only && body_len > 0 {
        file.seek(SeekFrom::Start(start)).await?;
        let mut limited = file.take(body_len);
        tokio::io::copy(&mut limited, writer).await?;
    }
    writer.flush().await
}

fn mime_for(path: &std::path::Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/ogg; codecs=opus",
        "m4a" | "mp4" | "aac" | "alac" => "audio/mp4",
        "wav" => "audio/wav",
        "webm" | "weba" => "audio/webm",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::parse_head;

    #[test]
    fn parses_request_head() {
        let lines = vec![
            "GET /tok/l/abc?x=1 HTTP/1.1".to_string(),
            "Range: bytes=10-".to_string(),
            "Connection: keep-alive".to_string(),
        ];
        let head = parse_head(&lines).unwrap();
        assert_eq!(head.method, "GET");
        assert_eq!(head.target, "/tok/l/abc?x=1");
        assert!(head.keep_alive);
        assert_eq!(head.range.as_deref(), Some("bytes=10-"));
    }

    #[test]
    fn http10_closes_by_default() {
        let head = parse_head(&["GET / HTTP/1.0".to_string()]).unwrap();
        assert!(!head.keep_alive);
    }
}
