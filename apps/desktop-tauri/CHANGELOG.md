# Tauri 社区版更新日志

本文件只记录 Tauri 社区版（`feat/desktop-tauri-v2` 分支）相对上游的增量；上游自身功能变化见其 CHANGELOG。

## 0.2.0（社区版首个功能完整版，2026-10-24）

### 功能对齐（对照 Electron 官方版）

- **桌面设置面板**：宠物 / 云端同步 / 应用 / 关于 四 tab（`packages/desktop-ui` 共享层，dashboard 经 `VITE_DESKTOP_SHELL` 门控挂载，web/CLI 构建零引入）
- **订阅额度卡**：主窗 12 个 channel（上游 v0.1.15 已下沉 core；社区版补桥 fetcher 绕开 `tauri://localhost` origin 的相对 fetch 404）
- **桌面宠物目录**：本地 `~/.ai-usage/pets/` 扫描 + Gitee/GitHub 社区宠物下载安装 + 图集回环流式加载（sidecar 实现，替代 Electron 的 `pet-asset://` 协议）；选中宠物被删自动回落 hawking；同步庆祝气泡（Token 增量 / 今日新高 / 连续天数）
- **macOS 菜单栏用量胶囊**：今日 Token / 费用，显示方式可切（both/tokens/cost），同步后即时刷新
- **深链**：`juejin-usage://` 系统注册（Info.plist + `RunEvent::Opened`），掘金登录回跳直达
- **托盘 popover**：锚定真实托盘图标位置；新增订阅额度摘要区
- **主题**：跟随系统外观实时切换
- **自启动**：`--hidden` 参数随「静默启动」偏好（自写 LaunchAgent / 注册表 / .desktop，弃用 autostart 插件）
- **稳定性**：sidecar 看门狗（崩溃 0.5–8s 指数退避自愈，连续 5 次熔断）；自动更新 6 小时周期检查 + 完成提示
- **Windows 补齐**（代码就绪，待真机验证）：单实例具名互斥体、协议注册表注册、宠物拖拽光标轮询

### 基建

- 自动更新源指向本仓库 Releases（minisign 签名公钥已内嵌）；`release-tauri` CI 多平台构建 + 签名 + latest.json 合并
- 版本号三处统一（`sync-version.mjs`）
- 故障排查手册（`docs/troubleshooting.md`）：WKWebView 回环白屏、注入桥事件协议、staging 劫持 dev 三个已定案案例
- 功能对齐审计（`docs/parity-audit.md`）

### 已知边界

- 安装包 44MB：92% 是内嵌 Node 运行时（架构代价，详见 README「体积构成」节；官方 Electron 版 100MB+）

- Windows 专属代码未经真机验证；Linux 桌面未覆盖（拖拽/胶囊）
- 深链运行中接收需打包后的 app（dev 无法路由）；点击穿透的 forward 语义需长期观察
- 托盘 popover 的订阅区为摘要版（完整卡片在主窗）
