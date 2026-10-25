//! 阶段②：Rust 本地 API —— 绞杀者模式（strangler fig）。
//!
//! 目标架构：Rust(axum) 接管公开端口 8462，逐端点原生实现读路径；
//! 未迁移端点透明代理给 Node sidecar 的 admin 端口（写路径 + parsers 保留在 Node）。
//!
//! 引擎开关：`TUD_API_ENGINE`
//! - `node`（默认）：本模块不启动，Node 照旧绑 8462 —— 现有行为零变化
//! - `rust`：Rust 先绑 8462，Node 以 `TUD_SIDECAR_PORT=8463` 拉起作为 admin
//!
//! 迁移纪律：每个端点原生实现前，必须先用 capture-golden 工具抓取 Node 的
//! 真实响应做金样本；实现后 A/B diff 逐字节一致才算迁移完成。

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use std::net::SocketAddr;

/// 本模块原生已实现的端点（精确匹配）；其余一律代理。
/// 迁移新端点时：实现 handler + 把路径加进这里 + golden diff 通过。
#[allow(dead_code)] // 迁移进度清单：每原生实现一个端点就勾一条
const NATIVE_ROUTES: &[&str] = &["/health"];

#[derive(Clone)]
pub struct LocalApiState {
    /// Node admin 端口（写路径/未迁移端点的代理目标）。None = Node 未就绪。
    pub admin_port: std::sync::Arc<std::sync::Mutex<Option<u16>>>,
}

/// 启动 axum 服务（绑定 8462）。失败返回 Err（调用方决定是否致命）。
pub async fn serve(state: LocalApiState, port: u16) -> Result<(), String> {
    let app = Router::new()
        .route("/health", get(health))
        .fallback(proxy)
        .with_state(state);
    let addr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), port);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("rust local-api bind {addr}: {e}"))?;
    eprintln!("[tud-desktop] rust local-api listening on {addr}");
    axum::serve(listener, app)
        .await
        .map_err(|e| format!("rust local-api serve: {e}"))
}

/// 原生 /health —— 与 Node `{"ok":true}` 逐字节同形。
async fn health() -> Response {
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"))],
        Body::from("{\"ok\":true}"),
    )
        .into_response()
}

/// 回退代理：把请求原样转发给 Node admin 端口，响应原样返回。
/// 请求体（POST/PUT）与响应体都完整透传，不解析不改写。
async fn proxy(State(state): State<LocalApiState>, uri: Uri, req: Request) -> Response {
    let Some(port) = *state.admin_port.lock().unwrap() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"))],
            Body::from("{\"success\":false,\"message\":\"LOCAL_ADMIN_NOT_READY\",\"data\":null}"),
        )
            .into_response();
    };

    // 重建请求行 + 透传头 + 透传体
    let (parts, body) = req.into_parts();
    let path_and_query = uri
        .path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| uri.path().to_string());
    let body_bytes = match axum::body::to_bytes(body, 32 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => return internal_error(format!("read request body: {e}")),
    };

    let mut req_builder = admin_request(&parts.method.as_str().to_uppercase(), port, &path_and_query);
    for (name, value) in parts.headers.iter() {
        // Host 由我们重写；其余透传（含 subscription 路由的 Origin 门禁所需头）。
        // host 由我们重写；origin 剥离（webview 的 tauri://localhost 会触发
        // 订阅路由的回环门禁 403，旧代理同样不带 Origin）；connection 逐跳头。
        if name.as_str().eq_ignore_ascii_case("host")
            || name.as_str().eq_ignore_ascii_case("connection")
            || name.as_str().eq_ignore_ascii_case("origin")
        {
            continue;
        }
        if let Ok(v) = value.to_str() {
            req_builder = req_builder.set_header(name.as_str(), v);
        }
    }
    // 标注经过 Rust 代理（Node 侧日志可观测流量来源）
    req_builder = req_builder.set_header("x-tud-proxy", "rust");

    match req_builder
        .send_body(body_bytes.to_vec())
    {
        Ok(resp) => convert_response(resp).await,
        Err(e) => internal_error(format!("proxy to admin:{port}: {e}")),
    }
}

/// 轻量 HTTP 客户端（复用手写 TCP 方式，避免引入重型依赖；离线构建约束同 sidecar.rs）。
fn admin_request(
    method: &str,
    port: u16,
    path_and_query: &str,
) -> std_http::Request {
    std_http::Request::new(method.to_string(), port, path_and_query.to_string())
}

mod std_http {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};

    pub struct Request {
        pub method: String,
        pub port: u16,
        pub path: String,
        pub headers: Vec<(String, String)>,
    }

    impl Request {
        pub fn new(method: String, port: u16, path: String) -> Self {
            Self {
                method,
                port,
                path,
                headers: Vec::new(),
            }
        }
    }

    impl Request {
        pub fn set_header(mut self, k: &str, v: &str) -> Self {
            self.headers.push((k.to_string(), v.to_string()));
            self
        }

        pub fn send_body(self, body: Vec<u8>) -> Result<Response, String> {
            let addr = SocketAddr::new(
                std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
                self.port,
            );
            let mut stream = TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(5))
                .map_err(|e| format!("connect admin {addr}: {e}"))?;
            let mut head = format!(
                "{} {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Length: {}\r\nConnection: close\r\n",
                self.method,
                self.path,
                self.port,
                body.len()
            );
            for (k, v) in &self.headers {
                head.push_str(&format!("{k}: {v}\r\n"));
            }
            head.push_str("\r\n");
            stream
                .write_all(head.as_bytes())
                .and_then(|_| stream.write_all(&body))
                .map_err(|e| format!("write admin request: {e}"))?;
            let mut buf = Vec::new();
            stream
                .read_to_end(&mut buf)
                .map_err(|e| format!("read admin response: {e}"))?;
            Ok(Response { raw: buf })
        }
    }

    pub struct Response {
        pub raw: Vec<u8>,
    }
}

/// 解析手写 HTTP 客户端的原始响应（含 chunked 解码）为 axum Response。
async fn convert_response(resp: std_http::Response) -> Response {
    let raw = resp.raw;
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| (raw[..i].to_vec(), raw[i + 4..].to_vec()));
    let Some((head_bytes, mut body)) = split else {
        return internal_error("malformed admin response".into());
    };
    let head = String::from_utf8_lossy(&head_bytes).into_owned();
    let mut lines = head.lines();
    let status_line = lines.next().unwrap_or_default();
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(502);
    let mut content_type: Option<HeaderValue> = None;
    let mut chunked = false;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim().to_ascii_lowercase();
            let v = v.trim();
            if k == "content-type" {
                content_type = HeaderValue::from_str(v).ok();
            } else if k == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            }
        }
    }
    if chunked {
        body = dechunk(body);
    }
    let mut builder = Response::builder().status(StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY));
    if let Some(ct) = content_type {
        builder = builder.header(axum::http::header::CONTENT_TYPE, ct);
    }
    builder.body(Body::from(body)).unwrap()
}

/// RFC 7230 chunked 解码。
fn dechunk(mut body: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len());
    loop {
        let Some(line_end) = find_crlf(&body) else { break };
        let size_str = String::from_utf8_lossy(&body[..line_end]).into_owned();
        let size_hex = size_str.split(';').next().unwrap_or("").trim().to_string();
        let Ok(size) = usize::from_str_radix(&size_hex, 16) else { break };
        body = body[line_end + 2..].to_vec();
        if size == 0 {
            break;
        }
        if body.len() < size {
            break;
        }
        out.extend_from_slice(&body[..size]);
        body = body[size..].to_vec();
        // 吃掉块后的 CRLF
        if body.starts_with(b"\r\n") {
            body = body[2..].to_vec();
        }
    }
    out
}

fn find_crlf(buf: &[u8]) -> Option<usize> {
    buf.windows(2).position(|w| w == b"\r\n")
}

fn internal_error(message: String) -> Response {
    eprintln!("[tud-desktop] local_api proxy error: {message}");
    (
        StatusCode::BAD_GATEWAY,
        [(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"))],
        Body::from("{\"success\":false,\"message\":\"LOCAL_PROXY_ERROR\",\"data\":null}"),
    )
        .into_response()
}