<p align="center">
  <img src="./assets/icon.png" alt="Juejin Usage logo" width="200">
</p>

<h1 align="center">Juejin Usage · Tauri 社区版</h1>

<p align="center">
  AI 编码工具 Token 用量追踪的 Tauri 桌面客户端（社区维护版）。<br>
  本地记录、云端同步、桌面宠物、菜单栏实时用量。
</p>

<p align="center">
  <a href="https://github.com/K-H-N-L/juejin-usage/releases">
    <img src="https://img.shields.io/github/v/release/K-H-N-L/juejin-usage?include_prereleases&style=flat-square" alt="release">
  </a>
  <a href="https://github.com/K-H-N-L/juejin-usage/issues">
    <img src="https://img.shields.io/github/issues/K-H-N-L/juejin-usage?style=flat-square" alt="issues">
  </a>
</p>

## 这是什么

本仓库 fork 自官方 [juejin-cn/juejin-usage](https://github.com/juejin-cn/juejin-usage)（官方桌面端为 Electron），独立维护 **Tauri 版桌面客户端**：

- 渲染层直接复用官方 dashboard 构建产物，数据层复用同一套 core local-api 契约——和官方版看到的是同一块面板
- 壳层为 Rust（Tauri 2）+ Node sidecar（`jusage desktop-host`），架构说明见 [apps/desktop-tauri/README.md](apps/desktop-tauri/README.md)
- 与官方版功能对齐进行中，逐项进度见[功能对齐清单](apps/desktop-tauri/docs/parity-audit.md)

**分支模型**：`feat/desktop-tauri-v2`（默认分支）是社区版开发线；`main` 仅与上游保持镜像同步，不接受本地提交。

## 安装

- **Tauri 社区版**：安装包发布于 [Releases](https://github.com/K-H-N-L/juejin-usage/releases)（发版基建准备中，当前可按下方「开发」本地构建运行）
- **官方 Electron 版 / CLI**：见官方[下载页](https://juejin.cn/aiusage/download)与 [juejin-cn/juejin-usage](https://github.com/juejin-cn/juejin-usage)

首次启动会自动采集本机已产生的 AI 编码工具用量；面板展示费用、Token、请求数和趋势。macOS 可从菜单栏查看今日用量，Windows 从托盘进入。

### 桌面宠物

在「设置 → 桌面宠物」开启，内置 3 只可选：

|            Click             |            Yoyo            |             Hawking              |
| :--------------------------: | :------------------------: | :------------------------------: |
| ![Click](./assets/click.png) | ![Yoyo](./assets/yoyo.png) | ![Hawking](./assets/hawking.png) |

社区宠物目录与自定义宠物包（`~/.ai-usage/pets/`）支持对齐中，见[对齐清单](apps/desktop-tauri/docs/parity-audit.md)。

### 登录掘金（可选）

「设置 → 掘金登录」绑定账号后可多设备合并用量、参与 [AI 使用排行榜](https://juejin.cn/aiusage/rank)。

## 🔒 用户隐私

本产品采用本地优先架构，数据默认仅存储于您的设备。

- 📊 **本地采集**：Token 用量、模型名称、来源渠道（仅本机存储）
- 🚫 **绝不收集**：对话内容、Prompt 文本、主机名、项目名、API Key
- ☁️ **云端同步**：需您主动开启，仅上报脱敏的 Token 计数与匿名设备标识
- 🎛️ **您的控制**：随时可开关云端同步，或删除本地数据目录清除全部记录

## 🛠️ 开发

需要 Node.js >= 20 与 Rust 工具链。克隆后先在仓库根执行 `pnpm install`（若卡在 electron postinstall，见 [AGENTS.md](./AGENTS.md) 的镜像配置）。

```bash
pnpm dev:desktop:tauri    # 开发运行（已内置 --no-dev-server，原因见故障手册）
pnpm build:desktop:tauri  # 打包
```

> ⚠️ 不要给 `tauri.conf.json` 加回 `devUrl`：WKWebView 在部分 macOS 环境无法加载回环 HTTP（永久白屏），dev 必须走 `tauri://localhost`。详见[故障排查手册](apps/desktop-tauri/docs/troubleshooting.md)。

同步上游（`main` 只做镜像，更新单向合入开发线）：

```bash
git fetch upstream
git checkout main && git merge --ff-only upstream/main && git push origin main
git checkout feat/desktop-tauri-v2 && git merge main && git push
```

## 📚 文档

- [apps/desktop-tauri/README.md](apps/desktop-tauri/README.md) — Tauri 端架构与命令
- [功能对齐清单](apps/desktop-tauri/docs/parity-audit.md) — 与官方 Electron 版的逐项对照与路线
- [故障排查手册](apps/desktop-tauri/docs/troubleshooting.md) — 白屏等已踩坑案例
- [FAQ](./FAQ.md) / [CLI 使用说明](./CLI.md)

## 🤝 反馈与贡献

- Tauri 社区版问题/想法：[本仓库 issues](https://github.com/K-H-N-L/juejin-usage/issues)
- 通用功能（解析器、面板、CLI）欢迎直接向 [官方仓库](https://github.com/juejin-cn/juejin-usage) 提交，社区版会定期同步

## 🙏 鸣谢

本项目基于 [juejin-cn/juejin-usage](https://github.com/juejin-cn/juejin-usage) 构建，感谢上游团队与[所有贡献者](https://github.com/juejin-cn/juejin-usage/graphs/contributors)。

## 📚 参考项目

- [Token Tracker](https://github.com/xiufengsun/TokenTracker): 自动采集 30 款 AI 编码工具 的 token 用量，用一套漂亮的 Dashboard 看真实成本与趋势。
- [vibe-usage](https://github.com/vibe-cafe/vibe-usage): Token 使用量统计工具（CLI）
- [OpenUsage](https://github.com/robinebers/openusage): The Only AI Usage Tracker That's Truly Yours
- [models.dev](https://models.dev): 模型 Token 计价数据源，内置计价表由此增量同步

## License

MIT
