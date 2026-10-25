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
const NATIVE_ROUTES: &[&str] = &[
    "/health",
    "/functions/tud-usage-daily",
    "/functions/tud-usage-hourly",
    "/functions/tud-usage-model-breakdown",
    "/functions/tud-account-usage-summary",
    "/functions/tud-usage-summary",
];

#[derive(Clone)]
pub struct LocalApiState {
    /// Node admin 端口（写路径/未迁移端点的代理目标）。None = Node 未就绪。
    pub admin_port: std::sync::Arc<std::sync::Mutex<Option<u16>>>,
}

/// 启动 axum 服务（绑定 8462）。失败返回 Err（调用方决定是否致命）。
pub async fn serve(state: LocalApiState, port: u16) -> Result<(), String> {
    let app = Router::new()
        .route("/health", get(health))
        .route("/functions/tud-usage-daily", get(daily))
        .route("/functions/tud-usage-hourly", get(hourly))
        .route("/functions/tud-usage-model-breakdown", get(breakdown))
        .route("/functions/tud-account-usage-summary", get(summary))
        .route("/functions/tud-usage-summary", get(summary))
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

/// 原生 /functions/tud-usage-daily —— getDaily 的 Rust 移植。
async fn daily(State(state): State<LocalApiState>, uri: Uri) -> Response {
    let _ = (&state, &uri);
    let days = uri
        .query()
        .and_then(|q| {
            q.split('&').find_map(|kv| {
                let (k, v) = kv.split_once('=')?;
                (k == "days").then(|| v.parse::<u32>().ok())?
            })
        })
        .unwrap_or(90)
        .clamp(1, 365);
    let files = load_day_files();
    // 镜像 Node 的 c.json(ok(...)) 信封 —— local-api 契约的一部分
    let body = serde_json::json!({
        "success": true,
        "message": "ok",
        "data": native_daily(&files, days),
    });
    json_response(StatusCode::OK, &body)
}

/// 原生 /functions/tud-usage-hourly —— getHourly 的 Rust 移植。
async fn hourly(State(state): State<LocalApiState>, uri: Uri) -> Response {
    let _ = (&state, &uri);
    let days = uri
        .query()
        .and_then(|q| {
            q.split('&').find_map(|kv| {
                let (k, v) = kv.split_once('=')?;
                (k == "days").then(|| v.parse::<u32>().ok())?
            })
        })
        .unwrap_or(1)
        .clamp(1, 365);
    let files = load_day_files();
    let body = serde_json::json!({
        "success": true,
        "message": "ok",
        "data": native_hourly(&files, days),
    });
    json_response(StatusCode::OK, &body)
}

/// 原生 /functions/tud-usage-model-breakdown —— getModelBreakdown 移植（默认 30 天）。
async fn breakdown(State(state): State<LocalApiState>, uri: Uri) -> Response {
    let _ = (&state, &uri);
    let days = uri
        .query()
        .and_then(|q| {
            q.split('&').find_map(|kv| {
                let (k, v) = kv.split_once('=')?;
                (k == "days").then(|| v.parse::<u32>().ok())?
            })
        })
        .unwrap_or(30)
        .clamp(1, 365);
    let files = load_day_files();
    let body = serde_json::json!({
        "success": true, "message": "ok",
        "data": native_breakdown(&files, days),
    });
    json_response(StatusCode::OK, &body)
}

/// 原生 /functions/tud-*-usage-summary —— getUsageSummary 移植。
async fn summary(State(state): State<LocalApiState>, uri: Uri) -> Response {
    let _ = (&state, &uri);
    let files = load_day_files();
    let data = native_summary(&files);
    json_response(StatusCode::OK, &data)
}

fn json_response(status: StatusCode, value: &serde_json::Value) -> Response {
    (
        status,
        [(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"))],
        Body::from(serde_json::to_string(value).unwrap_or_default()),
    )
        .into_response()
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


// ---- 阶段②-b：读路径原生实现 ------------------------------------------------
//
// 数据源（Node 写、Rust 读，格式即契约）：
//   <dataDir>/cache/daily-sealed.json  — 昨天及以前的密封天（version 7）
//   <dataDir>/cache/today-live.json    — 今天的活聚合（与密封天同构）
//   <dataDir>/config.json              — statsSince（采集下限）
//
// 组装规则逐一移植自 packages/core/src/aggregate-cache.ts 的
// getDaily/getHourly/getModelBreakdown（窗口过滤 + today 追加 + 排序）；
// 行内容原样透传（serde_json::Value），不做任何字段级重编码。

use serde_json::Value;

fn data_dir() -> std::path::PathBuf {
    if let Ok(override_dir) = std::env::var("TUD_DATA_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            let trimmed = trimmed.strip_prefix("~/").unwrap_or(trimmed);
            let p = std::path::PathBuf::from(trimmed);
            if p.is_absolute() {
                return p;
            }
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_else(|_| ".".to_string());
            return std::path::PathBuf::from(home).join(trimmed);
        }
    }
    crate::pets_root().parent().unwrap().to_path_buf()
}

fn read_json(path: &std::path::Path) -> Option<Value> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// sealed cache 的 timeZone（现网恒为 Asia/Shanghai，UTC+8 无夏令时）。
/// 返回相对 UTC 的固定秒偏移；未知时区回退 +8。
fn tz_offset_seconds(tz: &str) -> i32 {
    match tz {
        "Asia/Shanghai" | "Asia/Urumqi" => 8 * 3600,
        "UTC" => 0,
        other => {
            // 支持 "Etc/GMT-8" 这类固定偏移命名；其余回退 +8
            if let Some(rest) = other.strip_prefix("Etc/GMT-") {
                if let Ok(h) = rest.parse::<i32>() {
                    return h * 3600;
                }
            }
            if let Some(rest) = other.strip_prefix("Etc/GMT+") {
                if let Ok(h) = rest.parse::<i32>() {
                    return -h * 3600;
                }
            }
            8 * 3600
        }
    }
}

/// UTC 毫秒 → 时区内的 `YYYY-MM-DD`（固定偏移时区，无 DST）。
fn local_date(utc_ms: i64, offset_secs: i32) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now_ms = if utc_ms >= 0 {
        utc_ms
    } else {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    };
    let local_secs = now_ms.div_euclid(1000) + offset_secs as i64;
    let days = local_secs.div_euclid(86_400);
    //civil-from-days 算法（Howard Hinnant）
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// statsSince（ISO 字符串或日期）→ 时区内日期；非法输入返回空串（调用方跳过下限过滤）。
fn stats_since_date(stats_since: &str, offset_secs: i32) -> String {
    let s = stats_since.trim();
    if s.is_empty() {
        return String::new();
    }
    if let Ok(ms) = chrono_parse_iso_ms(s) {
        return local_date(ms, offset_secs);
    }
    // 已经是日期
    if s.len() == 10 && s.as_bytes().get(4) == Some(&b'-') {
        return s.to_string();
    }
    // TS localDateAndHour 对 NaN 返回 1970-01-01（等效于无下限）
    "1970-01-01".to_string()
}

/// 极简 ISO-8601 解析（`YYYY-MM-DDTHH:MM:SS(.fff)?(Z|±HH:MM)?`），返回 UTC 毫秒。
fn chrono_parse_iso_ms(s: &str) -> Result<i64, ()> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return Err(());
    }
    let num = |from: usize, to: usize| -> Result<i64, ()> {
        s.get(from..to).ok_or(())?.parse::<i64>().map_err(|_| ())
    };
    let y = num(0, 4)?;
    let mo = num(5, 7)?;
    let d = num(8, 10)?;
    let h = num(11, 13)?;
    let mi = num(14, 16)?;
    let sec = num(17, 19)?;
    // 毫秒（可选）
    let mut ms = 0i64;
    if b.get(19) == Some(&b'.') {
        let mut i = 20;
        while i < b.len() && b[i].is_ascii_digit() && i - 20 < 3 {
            i += 1;
        }
        if i > 20 {
            let frac: i64 = s[20..i].parse().map_err(|_| ())?;
            ms = frac * 10i64.pow(3 - (i - 20) as u32);
        }
    }
    // 时区
    let rest = &s[s.len().saturating_sub(5)..];
    let offset_secs: i64 = if s.ends_with('Z') || s.ends_with('z') {
        0
    } else if (rest.starts_with('+') || rest.starts_with('-')) && rest.as_bytes().get(3) == Some(&b':') {
        let sign = if rest.starts_with('-') { -1 } else { 1 };
        let hh: i64 = rest[1..3].parse().map_err(|_| ())?;
        let mm: i64 = rest[4..6].parse().map_err(|_| ())?;
        sign * (hh * 3600 + mm * 60)
    } else {
        0
    };
    let days = days_from_civil(y, mo, d);
    Ok((days * 86_400 + h * 3600 + mi * 60 + sec) * 1000 + ms - offset_secs * 1000)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

struct DayFiles {
    sealed: Option<Value>,
    today: Option<Value>,
    time_zone: String,
    stats_since: String,
}

/// 读取三份输入文件；任一缺失即降级（sealed 缺 → 空 map；today 缺 → 不追加）。
fn load_day_files() -> DayFiles {
    let dir = data_dir();
    let sealed = read_json(&dir.join("cache/daily-sealed.json"));
    let today = read_json(&dir.join("cache/today-live.json"));
    let time_zone = sealed
        .as_ref()
        .and_then(|s| s.get("timeZone"))
        .and_then(|v| v.as_str())
        .unwrap_or("Asia/Shanghai")
        .to_string();
    let stats_since = read_json(&dir.join("config.json"))
        .and_then(|c| c.get("statsSince").and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_default();
    DayFiles {
        sealed,
        today,
        time_zone,
        stats_since,
    }
}

/// 密封天迭代器：`(date, entry)`，按 date 升序。
fn sealed_days<'a>(files: &'a DayFiles) -> Vec<(&'a str, &'a Value)> {
    let mut out: Vec<(&str, &Value)> = files
        .sealed
        .as_ref()
        .and_then(|s| s.get("days"))
        .and_then(|d| d.as_object())
        .map(|m| m.iter().map(|(k, v)| (k.as_str(), v)).collect())
        .unwrap_or_default();
    out.sort_by_key(|(date, _)| *date);
    out
}

fn local_now_date(files: &DayFiles) -> String {
    let offset = tz_offset_seconds(&files.time_zone);
    local_date(-1, offset) // -1 = 用当前时间
}

/// getDaily 的 Rust 移植：密封天窗口过滤 + today 追加 + 日期排序。
fn native_daily(files: &DayFiles, days: u32) -> Value {
    let offset = tz_offset_seconds(&files.time_zone);
    let today = local_now_date(files);
    let from_date = local_date_days_ago(days, &today);
    let stats_date = stats_since_date(&files.stats_since, offset);

    let mut out: Vec<&Value> = Vec::new();
    for (date, entry) in sealed_days(files) {
        if date < from_date.as_str() || date > today.as_str() || date < stats_date.as_str() || date >= today.as_str() {
            continue;
        }
        if let Some(daily) = entry.get("daily") {
            out.push(daily);
        }
    }
    if today.as_str() >= from_date.as_str() && today.as_str() >= stats_date.as_str() {
        if let Some(daily) = files.today.as_ref().and_then(|t| t.get("daily")) {
            out.push(daily);
        }
    }
    out.sort_by_key(|d| d.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string());
    serde_json::json!({ "days": out })
}

fn local_date_days_ago(days: u32, today: &str) -> String {
    // YYYY-MM-DD 的日历减法：走 UTC 日算术
    let b = today.as_bytes();
    if b.len() != 10 {
        return today.to_string();
    }
    let y: i64 = today[0..4].parse().unwrap_or(1970);
    let m: i64 = today[5..7].parse().unwrap_or(1);
    let d: i64 = today[8..10].parse().unwrap_or(1);
    let base = days_from_civil(y, m, d) - (days.max(1) - 1) as i64;
    civil_from_days(base)
}

/// getHourly 的 Rust 移植：密封小时拼接 + today 追加 + (date,hour,source) 排序。
fn native_hourly(files: &DayFiles, days: u32) -> Value {
    let today = local_now_date(files);
    let from_date = local_date_days_ago(days, &today);
    let stats_date = stats_since_date(&files.stats_since, tz_offset_seconds(&files.time_zone));

    let mut hours: Vec<&Value> = Vec::new();
    for (date, entry) in sealed_days(files) {
        if date < from_date.as_str() || date < stats_date.as_str() || date >= today.as_str() {
            continue;
        }
        if let Some(arr) = entry.get("hourly").and_then(|h| h.as_array()) {
            for row in arr {
                hours.push(row);
            }
        }
    }
    if today.as_str() >= from_date.as_str() && today.as_str() >= stats_date.as_str() {
        if let Some(arr) = files.today.as_ref().and_then(|t| t.get("hourly")).and_then(|h| h.as_array()) {
            for row in arr {
                hours.push(row);
            }
        }
    }
    hours.sort_by(|a, b| {
        let key = |v: &Value, f: &str| v.get(f).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let num = |v: &Value, f: &str| v.get(f).and_then(|x| x.as_i64()).unwrap_or(0);
        key(a, "date")
            .cmp(&key(b, "date"))
            .then(num(a, "hour").cmp(&num(b, "hour")))
            .then(key(a, "source").cmp(&key(b, "source")))
    });
    serde_json::json!({ "hours": hours, "timeZone": files.time_zone })
}

fn civil_from_days(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}


// ---- 阶段②-c：breakdown + summary 原生实现 ---------------------------------
// 移植 mergeModelRows/mergeProjectRows/mergeLocalMetrics/normalizeProjectName
// （packages/core/src/aggregate-cache.ts、aggregate.ts、local-metrics.ts、
// project-label.ts），语义逐条对齐；metrics 以 serde_json::Value 透传合并。

fn round_cost_usd(n: f64) -> f64 {
    (n * 1e8).round() / 1e8
}

fn pct(part: f64, total: f64) -> f64 {
    if total <= 0.0 {
        0.0
    } else {
        (part / total * 1000.0).round() / 10.0
    }
}

/// local-metrics 合并（镜像 mergeLocalMetrics + nullableSum + cacheHitRate 重算）。
/// 缺失数值字段按 0 处理；可空字段（cacheRead/cacheWrite/requestCount）任一为
/// null/缺失 → 结果 null；missingReasons 去重排序；cacheHitRate 由合并后三元重算。
fn merge_metrics(a: &Value, b: &Value) -> Value {
    let get_num = |v: &Value, k: &str| v.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
    let get_nullable = |v: &Value, k: &str| v.get(k).and_then(|x| x.as_i64());
    let nullable_sum = |x: Option<i64>, y: Option<i64>| -> Option<i64> {
        match (x, y) {
            (Some(a), Some(b)) => Some(a + b),
            _ => None,
        }
    };
    let mut uncached = get_num(a, "uncachedInputTokens") + get_num(b, "uncachedInputTokens");
    let cache_read = nullable_sum(get_nullable(a, "cacheReadTokens"), get_nullable(b, "cacheReadTokens"));
    let cache_write = nullable_sum(get_nullable(a, "cacheWriteTokens"), get_nullable(b, "cacheWriteTokens"));
    let output = get_num(a, "outputTokens") + get_num(b, "outputTokens");
    let reasoning = get_num(a, "reasoningOutputTokens") + get_num(b, "reasoningOutputTokens");
    let request_count = nullable_sum(get_nullable(a, "requestCount"), get_nullable(b, "requestCount"));
    let known = get_num(a, "knownRequestCount") + get_num(b, "knownRequestCount");
    let mut reasons: Vec<String> = Vec::new();
    for src in [a, b] {
        if let Some(arr) = src.get("missingReasons").and_then(|x| x.as_array()) {
            for r in arr {
                if let Some(s) = r.as_str() {
                    if !reasons.iter().any(|x| x == s) {
                        reasons.push(s.to_string());
                    }
                }
            }
        }
    }
    reasons.sort();
    // cacheHitRate 重算（cacheHitRate()：cacheRead / (uncached + cacheRead + cacheWrite)）
    let cache_hit_rate = match (cache_read, cache_write) {
        (Some(read), Some(write)) => {
            let input = uncached + read + write;
            if input > 0 {
                serde_json::json!(read as f64 / input as f64)
            } else {
                Value::Null
            }
        }
        _ => Value::Null,
    };
    // uncached 在极旧机器上的 i64 溢出不考虑（数据量级远离上限）
    let _ = &mut uncached;
    serde_json::json!({
        "version": 1,
        "uncachedInputTokens": uncached,
        "cacheReadTokens": cache_read,
        "cacheWriteTokens": cache_write,
        "outputTokens": output,
        "reasoningOutputTokens": reasoning,
        "requestCount": request_count,
        "knownRequestCount": known,
        "cacheHitRate": cache_hit_rate,
        "missingReasons": reasons,
    })
}

/// normalizeProjectName 移植（project-label.ts）。
fn normalize_project_name(project: &str) -> String {
    let decoded = decode_encoded_project_path(project)
        .trim_end_matches(['/', '\\'])
        .to_string();
    if decoded.is_empty() || decoded == "unknown" {
        return "unknown".to_string();
    }
    posix_basename(&decoded)
}

fn posix_basename(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    let name = normalized.rsplit('/').next().unwrap_or("").trim();
    if name.is_empty() { "unknown".to_string() } else { name.to_string() }
}

fn decode_encoded_project_path(raw: &str) -> String {
    let value = unwrap_percent_encoding(raw).trim().to_string();
    strip_file_url(&value).trim().to_string()
}

fn unwrap_percent_encoding(raw: &str) -> String {
    let mut current = raw.to_string();
    for _ in 0..4 {
        if !percent_encoded_octet(&current) {
            return current;
        }
        match percent_decode_utf8(&current) {
            Some(next) if next != current => current = next,
            _ => return current,
        }
    }
    current
}

fn percent_encoded_octet(s: &str) -> bool {
    let b = s.as_bytes();
    for i in 0..b.len().saturating_sub(2) {
        if b[i] == b'%' && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            return true;
        }
    }
    false
}

/// decodeURIComponent 等价：%XX 序列按字节解码后整体 UTF-8 校验，失败返回 None。
fn percent_decode_utf8(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = &s[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).ok()
}

fn strip_file_url(value: &str) -> String {
    if !value.to_ascii_lowercase().starts_with("file:") {
        return value.to_string();
    }
    let mut rest = value["file://".len().min(value.len())..].to_string();
    if rest.len() >= "localhost/".len() && rest.to_ascii_lowercase().starts_with("localhost/") {
        rest = rest["localhost".len()..].to_string();
    }
    if !rest.is_empty() && !rest.starts_with('/') && !rest.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false) {
        rest = format!("/{rest}");
    }
    unwrap_percent_encoding(&rest)
}

/// mergeModelRows 移植：按 source\\0model 分组合并，tokens 降序，pct 计算。
fn merge_model_rows(parts: &[Value]) -> Vec<Value> {
    use std::collections::HashMap;
    let mut by_key: HashMap<String, Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut total_tokens = 0f64;
    for row in parts {
        let source = row.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let model = row.get("model").and_then(|v| v.as_str()).unwrap_or("");
        let key = format!("{source}\u{0}{model}");
        let tokens = row.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let cost = row.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let empty = serde_json::json!({
            "version": 1, "uncachedInputTokens": 0, "cacheReadTokens": 0,
            "cacheWriteTokens": 0, "outputTokens": 0, "reasoningOutputTokens": 0,
            "requestCount": 0, "knownRequestCount": 0, "cacheHitRate": Value::Null,
            "missingReasons": [],
        });
        let existing = by_key
            .entry(key.clone())
            .or_insert_with(|| {
                order.push(key.clone());
                serde_json::json!({
                    "model": model, "source": source, "tokens": 0.0, "costUsd": 0.0,
                    "localMetrics": empty,
                })
            });
        existing["tokens"] = serde_json::json!(existing.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0) + tokens);
        existing["costUsd"] = serde_json::json!(existing.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0) + cost);
        let merged = merge_metrics(existing.get("localMetrics").unwrap_or(&Value::Null), row.get("localMetrics").unwrap_or(&Value::Null));
        existing["localMetrics"] = merged;
        total_tokens += tokens;
    }
    let mut out: Vec<Value> = by_key
        .values()
        .map(|v| {
            let tokens = v.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let mut row = v.clone();
            row["costUsd"] = serde_json::json!(round_cost_usd(v.get("costUsd").and_then(|x| x.as_f64()).unwrap_or(0.0)));
            row["pct"] = serde_json::json!(pct(tokens, total_tokens));
            row
        })
        .collect();
    out.sort_by(|a, b| {
        b.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0)
            .partial_cmp(&a.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// mergeProjectRows 移植：按 normalizeProjectName 分组，嵌套 models 合并，双重排序。
fn merge_project_rows(parts: &[Value]) -> Vec<Value> {
    use std::collections::HashMap;
    let mut by_project: HashMap<String, Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut total_tokens = 0f64;
    for row in parts {
        let project_raw = row.get("project").and_then(|v| v.as_str()).unwrap_or("");
        let project = normalize_project_name(project_raw);
        let tokens = row.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let cost = row.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let empty_metrics = serde_json::json!({
            "version": 1, "uncachedInputTokens": 0, "cacheReadTokens": 0,
            "cacheWriteTokens": 0, "outputTokens": 0, "reasoningOutputTokens": 0,
            "requestCount": 0, "knownRequestCount": 0, "cacheHitRate": Value::Null,
            "missingReasons": [],
        });
        let existing = by_project
            .entry(project.clone())
            .or_insert_with(|| {
                order.push(project.clone());
                serde_json::json!({
                    "project": project, "tokens": 0.0, "costUsd": 0.0,
                    "localMetrics": empty_metrics, "models": [],
                })
            });
        existing["tokens"] = serde_json::json!(existing.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0) + tokens);
        existing["costUsd"] = serde_json::json!(existing.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0) + cost);
        let merged = merge_metrics(existing.get("localMetrics").unwrap_or(&Value::Null), row.get("localMetrics").unwrap_or(&Value::Null));
        existing["localMetrics"] = merged;
        // 嵌套 models 合并（按 source\0model）
        let mut nested: Vec<Value> = existing
            .get("models")
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();
        if let Some(rows) = row.get("models").and_then(|m| m.as_array()) {
            for m in rows {
                let m_source = m.get("source").and_then(|v| v.as_str()).unwrap_or("");
                let m_model = m.get("model").and_then(|v| v.as_str()).unwrap_or("");
                let key = format!("{m_source}\u{0}{m_model}");
                let m_tokens = m.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let m_cost = m.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if let Some(existing_model) = nested
                    .iter_mut()
                    .find(|x| x.get("source").and_then(|v| v.as_str()) == Some(m_source)
                        && x.get("model").and_then(|v| v.as_str()) == Some(m_model))
                {
                    existing_model["tokens"] = serde_json::json!(existing_model.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0) + m_tokens);
                    existing_model["costUsd"] = serde_json::json!(existing_model.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0) + m_cost);
                    let merged = merge_metrics(existing_model.get("localMetrics").unwrap_or(&Value::Null), m.get("localMetrics").unwrap_or(&Value::Null));
                    existing_model["localMetrics"] = merged;
                } else {
                    let mut clone = m.clone();
                    clone["tokens"] = serde_json::json!(m_tokens);
                    clone["costUsd"] = serde_json::json!(m_cost);
                    nested.push(clone);
                }
            }
        }
        existing["models"] = serde_json::json!(nested);
        total_tokens += tokens;
    }
    let mut out: Vec<Value> = by_project
        .values()
        .map(|v| {
            let ptokens = v.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let mut row = v.clone();
            row["costUsd"] = serde_json::json!(round_cost_usd(v.get("costUsd").and_then(|x| x.as_f64()).unwrap_or(0.0)));
            row["pct"] = serde_json::json!(pct(ptokens, total_tokens));
            let mut models: Vec<Value> = v.get("models").and_then(|m| m.as_array()).cloned().unwrap_or_default();
            for m in models.iter_mut() {
                let mt = m.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0);
                m["costUsd"] = serde_json::json!(round_cost_usd(m.get("costUsd").and_then(|x| x.as_f64()).unwrap_or(0.0)));
                m["pct"] = serde_json::json!(pct(mt, ptokens));
            }
            models.sort_by(|a, b| {
                b.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0)
                    .partial_cmp(&a.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            row["models"] = serde_json::json!(models);
            row
        })
        .collect();
    out.sort_by(|a, b| {
        b.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0)
            .partial_cmp(&a.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// getModelBreakdown 移植。
fn native_breakdown(files: &DayFiles, days: u32) -> Value {
    let today = local_now_date(files);
    let from_date = local_date_days_ago(days, &today);
    let stats_date = stats_since_date(&files.stats_since, tz_offset_seconds(&files.time_zone));

    let mut model_parts: Vec<Value> = Vec::new();
    let mut project_parts: Vec<Value> = Vec::new();
    for (date, entry) in sealed_days(files) {
        if date < from_date.as_str() || date < stats_date.as_str() || date >= today.as_str() {
            continue;
        }
        for part in ["models", "projects"] {
            if let Some(arr) = entry.get(part).and_then(|v| v.as_array()) {
                let target = if part == "models" { &mut model_parts } else { &mut project_parts };
                for row in arr {
                    target.push(row.clone());
                }
            }
        }
    }
    if today.as_str() >= from_date.as_str() && today.as_str() >= stats_date.as_str() {
        if let Some(today_entry) = files.today.as_ref() {
            for part in ["models", "projects"] {
                if let Some(arr) = today_entry.get(part).and_then(|v| v.as_array()) {
                    let target = if part == "models" { &mut model_parts } else { &mut project_parts };
                    for row in arr {
                        target.push(row.clone());
                    }
                }
            }
        }
    }
    serde_json::json!({
        "models": merge_model_rows(&model_parts),
        "projects": merge_project_rows(&project_parts),
    })
}

/// getUsageSummary 移植：密封历史折叠 + today 从 today-live 条目推导。
fn native_summary(files: &DayFiles) -> Value {
    let today = local_now_date(files);
    let stats_date = stats_since_date(&files.stats_since, tz_offset_seconds(&files.time_zone));

    use std::collections::HashMap;
    let mut total_tokens = 0f64;
    let mut total_cost = 0f64;
    let mut by_source: HashMap<String, Value> = HashMap::new();

    // 密封历史折叠（entry.models 是 (source, model) 行；src.models 按模型名聚合）
    for (date, entry) in sealed_days(files) {
        if date < stats_date.as_str() || date >= today.as_str() {
            continue;
        }
        if let Some(daily) = entry.get("daily") {
            total_tokens += daily.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
            total_cost += daily.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0);
        }
        if let Some(models) = entry.get("models").and_then(|m| m.as_array()) {
            for m in models {
                fold_source_model(&mut by_source, m);
            }
        }
    }

    // today：从 today-live 条目推导（等价于 aggregateUsageSummary(todayRows)）
    let today_tokens = files
        .today
        .as_ref()
        .and_then(|t| t.get("daily"))
        .and_then(|d| d.get("tokens"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let today_cost = files
        .today
        .as_ref()
        .and_then(|t| t.get("daily"))
        .and_then(|d| d.get("costUsd"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    total_tokens += today_tokens;
    total_cost += today_cost;
    if let Some(models) = files.today.as_ref().and_then(|t| t.get("models")).and_then(|m| m.as_array()) {
        for m in models {
            fold_source_model(&mut by_source, m);
        }
    }

    if total_tokens == 0.0 && today_tokens == 0.0 {
        return serde_json::json!({
            "success": true, "message": "ok",
            "data": {
                "localMetrics": {
                    "version": 1, "uncachedInputTokens": 0, "cacheReadTokens": 0,
                    "cacheWriteTokens": 0, "outputTokens": 0, "reasoningOutputTokens": 0,
                    "requestCount": 0, "knownRequestCount": 0, "cacheHitRate": Value::Null,
                    "missingReasons": [],
                },
                "todayLocalMetrics": {
                    "version": 1, "uncachedInputTokens": 0, "cacheReadTokens": 0,
                    "cacheWriteTokens": 0, "outputTokens": 0, "reasoningOutputTokens": 0,
                    "requestCount": 0, "knownRequestCount": 0, "cacheHitRate": Value::Null,
                    "missingReasons": [],
                },
                "totalTokens": 0, "totalCostUsd": 0,
                "todayTokens": 0, "todayCostUsd": 0,
                "statsSince": files.stats_since, "bySource": [],
            }
        });
    }

    // 响应组装：bySource 按 tokens 降序，models 按 tokens 降序，roundCostUsd + pct
    let mut by_source_rows: Vec<Value> = by_source
        .values()
        .map(|src| {
            let src_tokens = src.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let mut row = src.clone();
            row["costUsd"] = serde_json::json!(round_cost_usd(src.get("costUsd").and_then(|x| x.as_f64()).unwrap_or(0.0)));
            row["pct"] = serde_json::json!(pct(src_tokens, total_tokens));
            let mut models: Vec<Value> = src
                .get("models")
                .and_then(|m| m.as_object())
                .map(|obj| obj.values().cloned().collect())
                .unwrap_or_default();
            for m in models.iter_mut() {
                let mt = m.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0);
                m["costUsd"] = serde_json::json!(round_cost_usd(m.get("costUsd").and_then(|x| x.as_f64()).unwrap_or(0.0)));
                m["pct"] = serde_json::json!(pct(mt, src_tokens));
            }
            models.sort_by(|a, b| {
                b.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0)
                    .partial_cmp(&a.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            row["models"] = serde_json::json!(models);
            row
        })
        .collect();
    by_source_rows.sort_by(|a, b| {
        b.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0)
            .partial_cmp(&a.get("tokens").and_then(|x| x.as_f64()).unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // 总 localMetrics：密封窗口内各天 daily.localMetrics + today 的合并
    let mut overall = empty_metrics_value();
    for (date, entry) in sealed_days(files) {
        if date < stats_date.as_str() || date >= today.as_str() {
            continue;
        }
        let lm = entry
            .get("daily")
            .and_then(|d| d.get("localMetrics"))
            .cloned()
            .unwrap_or_else(|| empty_metrics_value());
        overall = merge_metrics(&overall, &lm);
    }
    let today_metrics = files
        .today
        .as_ref()
        .and_then(|t| t.get("daily"))
        .and_then(|d| d.get("localMetrics"))
        .cloned()
        .unwrap_or_else(|| empty_metrics_value());
    overall = merge_metrics(&overall, &today_metrics);
    let today_local = files
        .today
        .as_ref()
        .and_then(|t| t.get("daily"))
        .and_then(|d| d.get("localMetrics"))
        .cloned()
        .unwrap_or_else(|| empty_metrics_value());

    serde_json::json!({
        "success": true, "message": "ok",
        "data": {
            "localMetrics": overall,
            "todayLocalMetrics": today_local,
            "totalTokens": total_tokens,
            "totalCostUsd": round_cost_usd(total_cost),
            "todayTokens": today_tokens,
            "todayCostUsd": round_cost_usd(today_cost),
            "statsSince": files.stats_since,
            "bySource": by_source_rows,
        }
    })
}

/// 折叠一行 (source, model) 记录进 bySource 折叠表。
fn fold_source_model(by_source: &mut std::collections::HashMap<String, Value>, m: &Value) {
    let source = m.get("source").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let model = m.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let tokens = m.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let cost = m.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let empty_metrics = empty_metrics_value();
    let src = by_source.entry(source.clone()).or_insert_with(|| {
        serde_json::json!({
            "source": source, "tokens": 0.0, "costUsd": 0.0,
            "localMetrics": empty_metrics, "models": {},
        })
    });
    src["tokens"] = serde_json::json!(src.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0) + tokens);
    src["costUsd"] = serde_json::json!(src.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0) + cost);
    let merged = merge_metrics(src.get("localMetrics").unwrap_or(&Value::Null), m.get("localMetrics").unwrap_or(&Value::Null));
    src["localMetrics"] = merged;
    let models_obj = src.get("models").cloned().unwrap_or_else(|| serde_json::json!({}));
    let mut models_map = models_obj.as_object().cloned().unwrap_or_default();
    let existing = models_map.get(&model).cloned().unwrap_or_else(|| {
        serde_json::json!({ "tokens": 0.0, "costUsd": 0.0, "localMetrics": empty_metrics_value() })
    });
    let new_existing = serde_json::json!({
        "tokens": existing.get("tokens").and_then(|v| v.as_f64()).unwrap_or(0.0) + tokens,
        "costUsd": existing.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0) + cost,
    });
    let mut row = existing.clone();
    row["tokens"] = new_existing["tokens"].clone();
    row["costUsd"] = new_existing["costUsd"].clone();
    let merged = merge_metrics(row.get("localMetrics").unwrap_or(&Value::Null), m.get("localMetrics").unwrap_or(&Value::Null));
    row["localMetrics"] = merged;
    models_map.insert(model, row);
    src["models"] = serde_json::json!(models_map);
}

fn empty_metrics_value() -> Value {
    serde_json::json!({
        "version": 1, "uncachedInputTokens": 0, "cacheReadTokens": 0,
        "cacheWriteTokens": 0, "outputTokens": 0, "reasoningOutputTokens": 0,
        "requestCount": 0, "knownRequestCount": 0, "cacheHitRate": Value::Null,
        "missingReasons": [],
    })
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