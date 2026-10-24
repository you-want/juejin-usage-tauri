# Tauri 版 ↔ Electron 版功能对齐对照清单

> 基准分支 `feat/desktop-tauri-v2`（2026-10 快照）。
> 目标：Tauri 社区版功能对齐官方 Electron 版（`apps/desktop`），在 K-H-N-L/juejin-usage 独立发版。
> 状态含义：✅ 已有（对齐或等价实现）｜🟡 部分（核心在但有关键缺口）｜❌ 缺失。

## 0. 架构对照（先读这个）

| 维度 | Electron（官方） | Tauri（本分支） |
|---|---|---|
| 进程模型 | 主进程内嵌 Core（sync + BucketStore + 内存 Hono local-api，不占端口），sync 跑 utilityProcess | Rust 壳 spawn Node sidecar（`jusage desktop-host`），Core 全在 sidecar 进程内，local-api 监听 `127.0.0.1:8462` |
| 主窗口内容 | 自有 renderer（dashboard 的同构分叉 + 桌面增强） | 内嵌 dashboard dist（`packages/dashboard build:tauri` 构建产物，静态资源加载） |
| 桥 | preload `contextBridge` 暴露 `window.tud`（65 channel） | 渲染前注入脚本 `bridge.rs TUD_BRIDGE_INIT_SCRIPT` 复刻 `window.tud` 全表面；数据走 `tud_api_request` 代理到 8462 |
| 桌面专属 UI | 全在自有 renderer | `packages/desktop-ui` 共享层（目前仅 Tauri 消费；Electron 未用） |

架构差异本身不是缺口：Electron 的 utilityProcess sync-worker 在 Tauri 里由 Node sidecar 单进程等价承担，`tud.pid` 抢占/CLI 驱逐已移进 `desktop-host`（`packages/cli/src/desktop-host.ts:169-195`）。真正要补的是下面清单里的功能点。

## 1. 数据面 / 运行时

| 功能点 | Electron | Tauri | 状态 | 说明 |
|---|---|---|---|---|
| local-api 契约（`/functions/tud-*` 19 端点） | 内存 Hono + IPC 直调 | sidecar HTTP 8462 + Rust 代理 | ✅ | 同一 `createLocalApiApp`，契约天然一致（`packages/core/src/server/local-api.ts:250`） |
| sync（采集/上传/退避轮询） | main + utilityProcess | sidecar 进程内 | ✅ | 轮询退避 1/2/5min、信号驱动同步均已移植（`desktop-host.ts:197-319`） |
| 心跳（`tud.heartbeat` 30s/90s） | 主进程 watchdog 续期 + owner 易主 recover | 每个轮询回合 touch | 🟡 | 续期有；**watchdog「owner 易主自动 recover」未移植**（`local-runtime.ts:568-619` 对照） |
| sidecar 崩溃自愈 | 崩溃重启 ≤5 次 + 回退主进程 | ✅（2026-10-24，monitor 线程 + 指数退避 0.5–8s + 稳定 60s 重置预算；实测 kill -9 后 500ms 恢复） | ✅ | |
| CLI 互斥（停 CLI 抢 owner + 驱逐 CLI 自启） | main 进程内 | desktop-host 内 | ✅ | launchd/计划任务/systemd 全覆盖（`packages/cli/src/evict-cli-autostart.ts`） |
| 定价覆盖刷新 / 损坏配置恢复通知 | ✅ | ✅ | ✅ | `RUNTIME_NOTICE=CONFIG_RESET:` 已转发为 `app:runtime-notice` |
| 前台聚焦 poke-sync | ✅ 30s 去抖 | ✅ | ✅ | `lib.rs:157-169` |
| CLI 工具 PATH 补全（GUI 启动找不到 node/claude 等） | `cli-runtime.ts` prependGuiNodePaths | 未见等价 | ❌ | 订阅解析器移植时必须一并解决（spawn `claude`/`codex`/`grok` 依赖 PATH） |

## 2. 订阅解析器（12 共享 channel + Electron 专属 trae/workbuddy）——主窗已通（2026-10-24）

**上游 v0.1.15 已完成大部分工作**：13 个解析器从 Electron 主进程下沉到 `packages/core/src/subscription/`（`e7f4a7c`），local-api 新增 `GET /functions/tud-subscription/:channel` 子路由（`subscription-api.ts`，带回环 Origin 门禁），dashboard 主页在 CLI 后端模式渲染 `SubscriptionUsageGrid`（12 张卡，channel 可见性存 localStorage）；claude reader 改用 `claude -p /usage` 安全命令、不再读 Keychain（凭据确认问题消失）；`prependGuiNodePaths`（GUI PATH 补全）也进了 core readers；新增 copilot channel。

**本仓库补的两个小修复**（2026-10-24，已验证 12 channel 端到端全通）：
1. `packages/dashboard/src/lib/subscription-api.ts` 增加 `bridgeAwareFetcher`——Tauri 主窗 origin 是 `tauri://localhost`，裸相对 fetch 必 404，有 `window.tud` 桥时改走 `tud.api.request`（Rust 代理无 Origin 头，天然通过服务端回环门禁）；
2. `sidecar.rs` 修复 dev 解析顺序——`target/debug/node-app/` 里的旧 staging 会劫持 `tauri dev`（详见 troubleshooting 案例 3），dev 现在优先用 repo 的 `packages/cli/dist`。

| 功能点 | Electron | Tauri | 状态 |
|---|---|---|---|
| 主窗订阅卡（12 channel：claude/codex/cursor/copilot/grok/kimi/minimax/opencode/qoder/zcode/antigravity/deepseek） | ✅ | ✅（走 core 共享 + 桥） | ✅ |
| trae / workbuddy（双 region）订阅 | ✅（Electron 专属 reader，未进 core） | ❌ | ❌ 待上游下沉或自行搬进 sidecar |
| 托盘 popover 订阅卡 | ✅ | ❌（desktop-ui popover 无卡；注意 popover 直连 8462 fetch 会被服务端 Origin 门禁拒，需走 invoke 代理） | ❌ |
| 渲染层凭据访问确认（claude Keychain） | 不再需要（改用安全 CLI 命令） | 不再需要 | ✅ |

## 3. 壳层 UI（主窗 / 设置 / 更新 / 分享）

| 功能点 | Electron | Tauri | 状态 | 说明 |
|---|---|---|---|---|
| 主窗基础（1024×780、自绘标题栏、最大化状态、close-to-tray、外链转系统浏览器） | ✅ | ✅ | ✅ | `lib.rs:52-138,510-531` |
| `--hidden` 静默启动（手动路径） | ✅ | ✅ | ✅ | `lib.rs:171-176` |
| **桌面设置面板（pet/sync/app/about 4 tab，1651 行）** | `SettingsPanel.tsx` | ✅（2026-10-24 移植） | ✅ | `packages/desktop-ui` 新增 `SettingsModal.tsx` + `DesktopShell.tsx`；dashboard 经 `VITE_DESKTOP_SHELL` 门控懒加载（web/CLI 构建无该 chunk）；宠物开关/选择/偏好、自启/静默启动、更新操作、设备信息、关于页全部可用。托盘「设置」死按钮同步修复（注入桥转发 `app:open-settings` → DOM 事件） |
| 更新横幅 / 手动检查 / 安装按钮 | AppShell 内 | ✅ 设置面板内 | 🟡 | 更新操作入口在「应用」tab（`AutoUpdateSettings` 卡片）+ 更新完成 toast（`AutoUpdateNotice`）；Electron 式顶部横幅未做（P2） |
| 分享卡片复制到剪贴板（20MB PNG 校验） | ✅ | ✅ | ✅ | `clipboard.rs`（RGBA 解码 + arboard） |
| 掘金登录 consent / deep-link 结果 toast | ✅ | ✅（2026-10-24） | ✅ | 注入桥转发 `app:juejin-link-result` → DOM 事件，`DesktopShell` 弹 toast 并刷新关联 chrome；设置弹窗打开时由面板内 toast 接管 |
| 运行时通知（config-reset）toast | ✅ | ✅（2026-10-24） | ✅ | 注入桥转发 `app:runtime-notice` → `DesktopShell` toast |
| 主窗后台同步后自动刷新 | ✅ | ✅（2026-10-24 修复） | ✅ | 此前 dashboard dist 无人桥接 `onDataSynced` → DOM 事件，主窗同步后不刷新；注入桥现已转发 `tud:data-synced` |
| data-synced → 宠物庆祝 payload | `local-api-ipc.ts` 附 addedTokens/isDailyRecord/streakDays | `SYNCED` 裸标记 | 🟡 | `desktop-host.ts:88`；宠物气泡庆祝链路断 |
| macOS Dock accessory 切换（关窗藏 Dock / 显示恢复） | ✅ `app.dock.hide/show` + 竞态防护 | 未实现 | ❌ | 需验证 Tauri `set_activation_policy` 等价能力 |
| macOS activate（点击 Dock 图标）不误建窗 | ✅ | 未见处理 | ❌ | |

### 已知环境问题：WKWebView 拒绝加载回环 HTTP（2026-10-24 定案）

> 完整症状签名、诊断步骤与排查工具见 [troubleshooting.md](troubleshooting.md) 案例 1。

这台开发机上 WKWebView 会**卡死在任何 `http://127.0.0.1:*` 导航的 provisional 阶段**（`on_navigation` 已放行、curl 可达、但 `didCommit` 永不发生，webview 停留 about:blank）——Vite devUrl(1720)、显式 External URL、tauri CLI 内置静态 server(1430) 全部中招；这也是前任在 vite.config 留下「防 WKWebView 白屏」注释的同一问题。**解法：dev 一律走与 release 相同的 `tauri://localhost` 自定义协议**——`tauri.conf.json` 移除 `devUrl`，`tauri dev --no-dev-server`（已固化进根 `dev:desktop:tauri` 脚本）。代价：无 HMR，渲染层改动经 `beforeDevCommand` 重建 + cargo 重编译生效（约 1 分钟）。同时修复了注入桥 `listen()` 的 v1 时代错误协议（`tauri://listen` → `plugin:event|listen`，`transformCallback` 同步返回），此前任何事件监听注册即抛 `then is not a function`。

## 4. 托盘

| 功能点 | Electron | Tauri | 状态 | 说明 |
|---|---|---|---|---|
| 托盘图标 + 右键菜单（显示/同步/设置/退出） | ✅ | ✅ | ✅ | `tray.rs:174-226`，菜单项与 Electron 一致 |
| macOS 左键 popover、右键菜单；Win/Linux setContextMenu | ✅ | ✅ | ✅ | `tray.rs:233-283` |
| popover 窗口（无边框/置顶/失焦隐藏/高度自适应 200-700） | ✅ | ✅ | ✅ | `tray.rs:64-140` + `resize_tray_popover` |
| **popover 锚定到真实托盘图标位置** | `positionPopoverNearTray` + workArea 钳制 | 固定主屏右上角 | 🟡 | Tauri 托盘无 getBounds，需平台方案（macOS 可读状态项位置） |
| popover 按主题设置窗口背景色 | ✅ | 无 | 🟡 | 小项，dark 模式闪白问题 |
| **macOS 菜单栏实时用量胶囊**（tray-usage:get/set + mode both/tokens/cost + 系统唤醒刷新） | ✅ | 无 | ❌ | 数据端点 `/functions/tud-usage-summary` 在 sidecar 已可用，只差胶囊本体与偏好 |
| 托盘内订阅卡（popover 里 13 张卡） | ✅ | 无 | ❌ | 随 §2 一并补 |

## 5. 桌面宠物

| 功能点 | Electron | Tauri | 状态 | 说明 |
|---|---|---|---|---|
| 内置 3 只（hawking/yoyo/click）+ 精灵动画（idle/run-l/run-r + 镜像修复） | ✅ | ✅ | ✅ | `pet.rs` + desktop-ui `DesktopPetView` |
| 窗口属性（透明/置顶/全 Space/不抢焦点/Win 关圆角） | ✅ | ✅ | 🟡 | macOSPrivateApi 已开 |
| 贝塞尔自动漫游（1-120min、1.6-5.2s、方向动画、位置持久化 + workArea 钳制） | ✅ | ✅ | ✅ | 全套移植 `pet.rs:190-378` |
| 拖拽（主进程轮询光标，8ms，免 IPC） | ✅ 全平台 | 仅 macOS | 🟡 | `global_cursor` 非 macOS 返回 None；Win/Linux 需补（Win 可用 GetCursorPos） |
| 点击穿透（sprite alpha < 16 忽略） | ✅ forward:true 保持 mousemove | alpha 检测已移植 | 🟡 | **Tauri `set_ignore_cursor_events` 无 forward 语义，忽略后能否恢复捕获需实测**（可能需 Rust 侧光标轮询兜底） |
| 右键菜单（显示/同步/设置(pet tab)/退出宠物） | ✅ | ✅ | ✅ | 渲染层上报坐标 + 原生菜单 `pet.rs:518-562` |
| 偏好（scale 0.35-0.75 / 帧 120-320ms / autoMove / 庆祝开关时长） | ✅ | ✅ | ✅ | `prefs.rs` + clamp 一致 |
| 同步庆祝气泡（token 增量 / 破纪录 / 连续天数） | ✅ | 断链 | 🟡 | 见 §3 SYNCED payload |
| **本地宠物目录扫描**（`~/.ai-usage/pets/` + pet.json/spritesheet 校验 + invalidPets 报告） | `desktop-pet-scanner.ts` | ✅（2026-10-24，scanner 移植进 sidecar `/functions/tud-desktop-pets/catalog`） | ✅ | |
| **远程社区宠物目录 + 安装**（Gitee/GitHub 列目录、staging 原子安装、per-id 锁、自动选中） | `desktop-pet-remote.ts` | ✅（2026-10-24，remote/install 移植进 sidecar；实测安装 rimuru 成功） | ✅ | |
| 本地宠物图集加载协议（`pet-asset://`） | ✅ | ✅（等价方案：sidecar 回环 URL 流式返回 WebP，`desktop_pet_spritesheet_url` 命令） | ✅ | |
| 选中宠物白名单 | 内置 | ✅ 放宽为「内置 ∪ 本地目录」（sidecar 校验） | ✅ | |
| 选中宠物被删自动回落 hawking | ✅ | 无 | ❌ | 随目录扫描一并做 |
| 快速开关串行化（防 loadURL/destroy 竞态） | ✅ | ✅（gen 计数） | ✅ | |

## 6. 自动更新

| 功能点 | Electron | Tauri | 状态 | 说明 |
|---|---|---|---|---|
| 更新状态机（8 态 + camelCase 对齐渲染层契约） | ✅ | ✅ | ✅ | `updater.rs:32-63` |
| 启动即查 + **每 6 小时周期查** | ✅ | 仅启动查 + 手动 | 🟡 | 补周期任务 |
| 下载进度事件 / 自动下载安装 / 重启 | ✅ | ✅ | ✅ | `request_restart` + 30s 看门狗 + marker 回滚 |
| 安装前释放 runtime（停托盘/标记退出/停 sidecar） | ✅ | ✅（app_quit 停 sidecar） | ✅ | |
| 新版首启完成提示 + ack | ✅ | ✅ | ✅ | marker 机制一致 |
| **更新 UI** | AppShell 横幅 | 无渲染位置 | ❌ | 见 §3；需要给 dashboard dist 注入层或 popover 加入口 |
| **签名与更新源** | electron-updater + Gitee yml feed（已运营） | **pubkey 占位符**；endpoint 指向**官方** Gitee `latest.json` | ❌ | 社区版必须：生成 minisign 密钥对、endpoint 指向 K-H-N-L 仓库、CI 产出 `latest.json` |
| dev 不检查 | ✅ | ✅ | ✅ | |

## 7. 自启动 / 单实例 / deep link / 主题

| 功能点 | Electron | Tauri | 状态 | 说明 |
|---|---|---|---|---|
| 开机自启注册（打包后） | `app.setLoginItemSettings` | tauri-plugin-autostart | ✅ | |
| **launch-hidden 参数接线**（登录项带 `--hidden` 静默启动） | ✅ | ❌ `let _ = launch_hidden;` 未接线 | ❌ | `lib.rs:366`；插件 init 未传 args |
| 自启首次默认开启 | ✅ | 未见等价 | ❌ | 小项随设置面板补 |
| App 单实例锁 | `requestSingleInstanceLock` 全平台 | flock **仅 Unix；Windows no-op** | 🟡 | `instance.rs:100-105` |
| 第二实例 → 通知首实例聚焦/转发深链 | ✅ second-instance | ❌ 直接退出 | ❌ | 需用 tauri 单实例插件的事件转发 |
| **deep link OS 级注册与接收**（`juejin-usage://`，macOS open-url / Win 协议分发） | ✅ | ❌ 无 scheme 注册、无接收钩子 | ❌ | 解析/应用/结果上报管线已就绪，仅剩冷启动 argv 一条触发路径（`deeplink.rs:13-20` 自标 release-time） |
| 主题三态 + 持久化 + 广播 | ✅ | ✅ | ✅ | `theme.rs` |
| **跟随 OS 外观**（system 模式实时 resolved） | ✅ nativeTheme 监听 | ❌ system 恒 resolved light | ❌ | `theme.rs:25-47` |

## 8. 发版 / CI / 版本管理（社区版上线必备）

| 功能点 | 现状 | 状态 |
|---|---|---|
| GitHub Actions Tauri 多平台构建（mac arm64/x64 dmg、win nsis、可选 linux） | 无任何 Tauri workflow（仅 ci.yml 测试 + sync-release.yml 同步 Gitee） | ❌ |
| 签名流水线（`TAURI_SIGNING_PRIVATE_KEY` → latest.json + 产物签名） | 全仓库无引用 | ❌ |
| 更新源指向自己仓库 | 指向官方 Gitee | ❌ |
| 版本号统一管理 | desktop-tauri 不在 changesets 内；2026-10-24 已将 Cargo.toml 对齐 0.1.9（与 tauri.conf.json / package.json 一致），后续仍需脚本化或纳入 changesets | 🟡 |
| 打包 node 运行时按目标 arch 准备（stage-node-app.mjs 依赖 TUD_NODE_BIN） | 脚本已就绪，但 release 需按矩阵准备各平台 node 二进制 | 🟡 |
| Windows 代码签名 / macOS 公证 | Electron 版亦未签（Win 待补、mac notarize 已配） | 🟡 对齐官方现状即可，先不阻塞 |
| README / 架构文档 | `apps/desktop-tauri/README.md` 仍是官方模板 stub | ❌ |
| 死代码 / 过期注释 | `src/renderer/pets.ts` 死代码；main.tsx/bridge.ts/sidecar.rs 头注释过期（仍说 8462 导航/占位端口） | 🟡 |
| CLI/Web dist 体积 | `VITE_DESKTOP_SHELL` 门控后 DesktopShell JS chunk 已被 tree-shake；但 Vite transform 阶段仍会发射 3 张宠物 webp 孤儿资源（~1.1MB，无 JS 引用）进所有 dashboard 构建 | 🟡 P3 打包时过滤 |
| capabilities ACL | default capability 仅 `windows:["main"]`，tray-popover / desktop-pet 未列入 | 🟡 需验证并补齐 |

## 9. 上游 v0.1.15 刷新（2026-10-24，区间 `3edaea4..cda5330`，223 提交）

除订阅大重构外，与对齐相关的上游变化：

**自动获得（sidecar 跑 core，零成本继承）**
- 6 个新数据源解析器 + tool-catalog/paths 注册：deveco、teleagent、wps-comate、minimax-code、kinetaios、command-code 上架；codebuddy/cline/opencode/codex/dsh 解析增强
- local-metrics：概览卡新增「请求数 + 缓存命中率」角标（CLI 后端模式自动生效，Tauri 主窗同享）
- `GET /functions/tud-config` 增强：后台异步回填掘金 userName/avatar（响应 shape 不变）
- 定价表多轮同步；runtime-pid 增加 IDE helper 进程误驱逐防护

**Electron 新行为（行为参照，按需对齐）**
- 启动时序重排：先开主窗、后台起 runtime（`main-window-launcher.ts`），IPC 提前注册防竞态
- sync worker 硬看门狗（主线程 5 分钟卡死 → SIGKILL）+ Windows SIGTRAP 防死循环（`native-crash-signals.ts`）
- 便携版（PORTABLE_EXECUTABLE_FILE）不再自动下载更新
- `dev:desktop:mock` mock 模式（跳过真实 runtime，渲染层出样卡）

**构建/依赖注意**
- core `package.json` 新增 exports 子路径（`./subscription`、`./usage-cards`、`./local-metrics` 等），build 前置 `scripts/build-usage-cards.mjs`——stage-node-app 按 dist 整树拷贝，无需改动
- dashboard 依赖：lucide-react → ^1.54.0，新增 date-fns、@lobehub/icons；core 新增 fzstd、yaml
- deep-link / 托盘 TrayPopover / 宠物四件套 / DesktopWindow：上游零提交，本清单原状态继续有效

## 10. 建议实施顺序

**P0 —— 用户可感知的功能核心（不做完不能叫对齐）**
1. 桌面设置面板进 desktop-ui（pet/sync/app/about 4 tab），主窗注入层挂载；连带解决：宠物开关、自启/静默启动开关、更新操作入口、关于页。
2. ~~订阅解析器~~ ✅ 2026-10-24 完成：上游 v0.1.15 已把 12 个 reader 下沉 core + dashboard 出卡；本仓库补桥 fetcher 与 sidecar dev 解析，12 channel 端到端验证全通。余项：trae/workbuddy（Electron 专属）、托盘 popover 订阅卡，移入 P2。
3. 宠物本地目录扫描 + 远程目录安装 + 本地图集协议加载 + 选中回落。
4. ~~sidecar 崩溃自愈~~ ✅ 2026-10-24 完成。**P0 阶段全部收官**。

**P1 —— OS 集成收尾**
5. tauri-plugin-deep-link：scheme 注册 + macOS open-url + Windows 二实例转发。
6. 单实例：Windows 守卫 + 第二实例聚焦/深链转发。
7. launch-hidden 登录项参数接线。
8. 主题跟随 OS 外观。
9. SYNCED 附宠物庆祝 payload；popover 按主题背景色。

**P2 —— 体验打磨**
10. macOS 菜单栏用量胶囊（数据端点现成）。
11. 托盘 popover 锚定真实托盘位置。
12. 更新 6 小时周期检查；更新/深链结果 toast 在主窗的呈现。
13. 宠物拖拽 Win/Linux 补齐；点击穿透 forward 语义实测与兜底。
14. macOS Dock accessory 切换与 activate 行为。

**P3 —— 社区版发版基建**
15. minisign 密钥对 + updater endpoint 切到自己仓库。
16. GitHub Actions：多平台构建 + 签名 + Release + latest.json；node 运行时矩阵准备。
17. 版本号三处统一（脚本化或纳入 changesets）。
18. README / 架构文档 / CHANGELOG；清理死代码与过期注释。

**P4 —— 找官方推荐前**
19. 与官方 Electron 版并跑对照测试（同机双装不行——tud.pid 互斥，需分时或双机/双用户）。
20. 整理对比材料（体积/内存/启动速度 + 功能矩阵本文档）。

---
*行号引用均基于 `feat/desktop-tauri-v2` 分支当前快照，后续代码移动请以符号名为准。*
