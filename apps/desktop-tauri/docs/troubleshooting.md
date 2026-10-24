# Tauri 桌面端故障排查手册

按症状查找，每条记录一个已踩过的坑：症状签名 → 诊断 → 根因 → 解法。日期为首次定案时间。

---

## 案例 1：主窗口白屏，webview 永远停在 about:blank（2026-10-24）

**这是本机/macOS 环境级问题，最容易复发，遇到白屏先查这个。**

### 症状签名

任意一条命中即高度疑似：

- 启动日志有 `main navigation: http://127.0.0.1:<port>/...`，但**之后永远不出现** `main page Started/Finished: http://...`（只出现 about:blank 的 Started/Finished）
- sidecar 探针（t+3/6/9/12s）持续输出：
  `"href":"about:blank","ready":"complete","rootKids":-1,"hasTud":true,"hasTudApi":true,"bodyLen":0`
- Web 检查器（右键 → Inspect Element）控制台出现大量
  `ipc://localhost/... 500` + `Unhandled Promise Rejection: Origin header is not a valid URL`
  ——注意这些是**症状不是根因**：页面卡在 about:blank，该文档发出的所有 IPC 都因 origin 非法被拒。
- 日志噪音 `RemoteLayerTreeDrawingAreaProxyMac::scheduleDisplayLink(): page has no displayID`

### 诊断（两步确认）

1. `curl http://127.0.0.1:<port>/...` —— **curl 能通但 webview 卡死** → 即本问题（说明不是服务器没起）。
2. 看探针 `href`：`about:blank` = 导航在 provisional 阶段就没 commit（wry 没有失败日志，`on_navigation` 显示"已放行"具有欺骗性）。

### 根因

**WKWebView 在部分 macOS 环境下，对 `http://127.0.0.1` 回环地址的导航会卡死在 provisional 阶段**：导航策略已 Allow、目标服务器可达（curl 200），但 `didCommitNavigation` 永不触发，webview 停留在初始 `about:blank` 文档。

已验证全部中招的加载方式：

| 加载方式 | 结果 |
|---|---|
| `WebviewUrl::App` + `devUrl`（Vite 1720） | 卡死 |
| `WebviewUrl::External("http://127.0.0.1:.../dashboard/index.html")` | 卡死 |
| 无 `devUrl` 时 tauri CLI 内置静态 dev server（默认端口 1430） | 卡死 |
| `tauri://localhost` 自定义协议（release / `--no-dev-server` dev） | ✅ 正常 |

历史线索：`vite.config.ts` 里「IPv4 显式绑定防 WKWebView 白屏」注释、`lib.rs` 中「8462 回环导航白屏改走内置资源」注释，都是同一个病的不同时期表现。

### 解法（已固化，勿回退）

**dev 与 release 统一走 `tauri://localhost` 自定义协议，彻底绕开回环 HTTP：**

1. `src-tauri/tauri.conf.json` 的 `build` 段**不配置 `devUrl`**；
2. dev 命令必须带 `--no-dev-server`（禁用 CLI 内置的 1430 静态 server），根脚本已固化：
   ```
   pnpm dev:desktop:tauri   # = build:cli + tauri dev --no-dev-server
   ```
3. 代价：**无 HMR**。渲染层改动经 `beforeDevCommand`（dashboard 构建 + copy + vite build）+ cargo 重编译后自动重启生效，一轮约 1 分钟；Rust 改动照常热重启。

### 若未来想恢复 devUrl/HMR

先做一个最小 Tauri demo 验证 WKWebView 能否加载回环页面；排查方向：iCloud Private Relay（Limit IP Tracking）、系统代理、`localhost` 与 `127.0.0.1` 差异、macOS 版本。验证通过前不要动 `tauri.conf.json`。

---

## 案例 2：注入桥事件监听全挂：`transformCallback(...).then is not a function`（2026-10-24）

### 症状签名

- Web 检查器控制台：`TypeError: internals.transformCallback(...).then is not a function`（来自 `user-script`）
- 所有 `window.tud.on*` 事件监听（open-settings、data-synced、theme、auto-update…）静默失效

### 根因

`bridge.rs` 的 `TUD_BRIDGE_INIT_SCRIPT` 手写了 `listen()` 帮助函数（为了零依赖内联进二进制），最初照的是 **v1 时代协议**：`transformCallback()` 返回 Promise、事件命令叫 `tauri://listen`。而 Tauri 2.11 的真实协议是：

- `__TAURI_INTERNALS__.transformCallback(cb)` **同步返回回调 id（数字）**；
- 注册用 `invoke("plugin:event|listen", { event, target, handler: <id> })`，返回 eventId；
- 卸载用 `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId)` + `invoke("plugin:event|unlisten", { event, eventId })`。

### 解法与预防

已照真实协议重写（见 `bridge.rs` 的 `listen()`）。**预防：以后改注入桥前，先读 `node_modules/@tauri-apps/api/core.js` 和 `event.js` 的当前实现**——注入桥是 `@tauri-apps/api` 的手写镜像，每次升级 tauri 都可能漂移。同理 `invoke` 的正确签名是三参 `internals.invoke(cmd, args, options)`。

顺带：about:blank 文档上的 `ipc://localhost/... 500` 属正常现象（origin 非法），页面正常加载后不会再出现。

---

## 排查工具箱

| 工具 | 用法 |
|---|---|
| sidecar 探针日志 | 启动后 t+3/6/9/12s 自动打印 `href/ready/title/rootKids/hasTud/bodyLen`，一眼判断页面死活 |
| Web 检查器 | dev 构建右键 → Inspect Element（看 Console/Network；ipc 500 群发 = 大概率案例 1） |
| 验证二进制新旧 | `strings target/debug/desktop-tauri \| grep "plugin:event\|listen"`（应 ≥1；若怀疑跑了旧二进制） |
| 服务端健康 | `curl http://127.0.0.1:8462/health`（Node sidecar）；`curl .../functions/tud-sync-status` |
| 前端产物 | `apps/desktop-tauri/src/renderer/public/dashboard/`（dev 内嵌资源的实际来源，copy-dashboard.mjs 生成） |
| 单实例锁 | `~/.ai-usage/` 下 `single-instance.lock`；第二个实例只打印提示并退出——排障前确认没有残留实例（托盘退出或 `pkill -f desktop-tauri`） |
