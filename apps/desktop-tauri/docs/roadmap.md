# Tauri 社区版路线图（2026-10-24 定稿）

> 决策背景：v0.2.2 已功能对齐官方主体并完成独立仓库迁移。当时安装包 44MB，其中 92% 是内嵌 Node 运行时（110MB 原始，Rust 壳仅 10MB）。

## 版本策略

| 阶段 | 版本 | 出口条件 |
|---|---|---|
| 现状 | 0.2.x | 功能对齐 + 自动更新链路可用 ✅ |
| 阶段① | **0.3.0** | 体积瘦身完成（目标 dmg ≤ 30MB） |
| 阶段② | 0.4.x | local-api/store/聚合 Rust 化（parsers 仍在 Node） |
| 阶段③ | 0.5.x~0.9.x | parsers 渐进迁移 |
| **全面 Rust** | **1.0.0** | 数据层全 Rust + 稳定承诺（数据格式、自动更新、三平台经过真实用户验证） |

## 阶段①：快速瘦身 ✅ 已完成（v0.3.0 实际 dmg 33MB，略超 ≤30MB 目标）

实际落地：①-1 staging 剥离（hono types/cjs、yaml browser、sourcemap，-0.5MB）；
①-2 small-icu 自建 node（110→81MB，core 4 处 Intl 均为 formatToParts 构造经
A/B 与 516 测试双跑验证零差异；CI 已缓存）。原计划的 UPX（macOS arm64 有
SIGKILL 风险）与 bun compile 未采用。

<details><summary>原计划存档</summary>

按性价比排序：

1. **清理 staging 冗余**（零风险）
   - dashboard dist 里的孤儿宠物 webp（~1.1MB，web/CLI 构建的 transform 产物，无 JS 引用）
   - dashboard dist 中桌面端用不到的路由 chunk（rank/pricing/downloads/embed——先测后删，确认桌面端零引用）
   - CLI dist 里 desktop-host 用不到的交互式 CLI 文件（service/daemon/args——需验证 import 图后再删，staging 脚本注释明确说过"全树拷贝防静默断裂"，要动就配 import 扫描）
2. **node 二进制 UPX 压缩实验**（110MB → 预期 ~40MB）
   - 在 CI 按平台压缩 staged node；macOS arm64 需实测（Gatekeeper/启动解码开销）；Windows 上注意杀软误报
   - 失败则回退，不阻塞
3. **自定义 small-icu node 构建**（110MB → 预期 ~75-80MB，备选）
   - core 里 Intl 使用需先审计（date-fns 的 zhCN 格式化在 webview 侧，不在 sidecar）
   - CI 从源码构建 node（缓存后每次 ~30min）或用可信的 small-icu 预编译源
   - 若 ①+② 已达标则跳过

</details>

## 阶段②：Rust 重写稳定层

- local-api（hono → axum）：19 个端点 + 订阅路由 + 宠物目录路由
- BucketStore + AggregateCache（jsonl 读写、seal 机制）
- 边界：desktop-host 保留 parsers/sync（Node），通过 Rust↔Node 桥或逐步下沉
- 风险低的原因：纯内部实现替换，契约（/functions/tud-*、envelope 格式）不变，dashboard 零改动

## 阶段③：parsers 渐进迁移

- 30+ 个解析器按稳定性排序逐个迁移（JSONL 类最易 → sqlite/SQLCipher 类最难）
- **注意维护税**：官方每修一个 parser 需手工移植。持续观察官方动向，若官方对 Rust 层有兴趣可转为共同投资
- 全部迁移完成 = 1.0.0 的数据层条件

## 已知未完成项（与 parity-audit.md 互链）

- trae/workbuddy 订阅额度卡（reader 在 Electron 专属层未下沉 core）
- trae 用量采集需要用户手动放置 SQLCipher key（官方设计如此，两版一致）
- Windows 专属代码（单实例/协议注册/宠物拖拽）未经真机验证
- 深链运行中接收仅打包版可测（已随 v0.2.1+ 可测，待用户反馈）
