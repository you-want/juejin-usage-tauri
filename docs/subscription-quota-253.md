# Issue #253：Codex / Qoder 订阅额度分析

基于 `origin/main` 的 `063322e`，修复分支 `fix/desktop/subscription-quota-regression`。

## Codex：HTTP 读取绕过系统代理

`6011a6f` 将 Codex 额度来源从官方 CLI app-server 改为只读本地 `auth.json` 并请求 `https://chatgpt.com/backend-api/wham/usage`。读数请求使用 Node 全局 `fetch`，而不是 Electron 网络栈。套餐名来自本地登录文件，因此网络请求失败时依然能显示 Pro，与 Issue 中的表现一致。

Electron [net 文档](https://github.com/electron/electron/blob/main/docs/api/net.md)明确区分 Chromium 与 Node 网络栈，并说明前者支持系统代理与 PAC。本地 Electron 35.4.0 的隔离测试设置模拟代理后，对同一个 `.invalid` 域名请求：Node `fetch` 失败，Electron 请求通过代理返回 200。该测试证明网络路径存在兼容问题；反馈用户是否确实依赖系统代理，仍需其环境或日志确认。

修复：Codex 使用 Electron `net.fetch`，保留显式 Bearer / Account ID、20 秒超时和拒绝重定向；显式禁用 Cookie。登录文件仍只读，不刷新或持久化令牌。原有账号隔离、合并请求和一分钟缓存继续生效。临时失败和旧读数允许窗口聚焦时重试；认证过期和访问受限仍可手动重试。

## Qoder：新版 App 登录来源缺少适配

`#234` 已记录 Qoder App 0.4.3 登录数据位于 `auth.v1.dat`，而现有实现只读取 `~/.qoder/.auth/user` 或 CLI `qodercli.log` 中的额度响应。`1d67e3a` 增加了 `.qoder-app-status.json` 登录状态识别与错误提示，没有增加 App 额度凭据来源；截图中的“已登录 Qoder，但暂时无法读取订阅额度”正是该路径。

对订阅卡片重构合并提交 `12334d0` 与第一父提交比较，`apps/desktop/src/main/qoder-subscription.ts` 没有改动。共享 mapper 增加了字段和额度池兼容，不负责获取登录凭据。因此当前证据不支持将 Qoder 的问题归因于该卡片重构。

只读检查本机安装的 Qoder `app.asar` 进一步确认：

- `auth.v1.dat` 由 Qoder 自身的 Electron safeStorage 加密；公开 App 状态文件只含登录状态和展示信息，没有额度或访问令牌。
- 当前 App 使用 device token 请求 `/sash/api/v2/me/usage`，区别于旧 CLI 的 `/api/v2/quota/usage`。仅替换请求 URL 不能弥补凭据来源缺失。
- 本次未读取或解密真实账号凭据，也未调用 Qoder 真实账号接口。

Qoder App 实时额度仍需单独适配授权来源。选项是独立设备授权，或经过明确设计的跨平台 App 凭据读取；不能把系统钥匙串访问作为默认前提，也不能承诺现有重试按钮能恢复缺失的凭据。此分支不声称解决 Qoder App 额度获取，不应据此关闭整个 #253。

## 验证方法

- Desktop 类型检查与 Electron Vite 构建。
- Codex reader 与 renderer 状态回归测试。
- Desktop 全量测试。
- `apps/desktop/scripts/test-subscription-network.cjs`：运行真实 Electron 网络栈，通过本地代理与假凭据验证 Codex 读数成功、Cookie 不泄漏、重定向拒绝和 AbortSignal 生效。测试不创建窗口，用户目录隔离。
- 未获得反馈用户机器的网络日志，未在其账号或打包应用中验证。

本地结果：TypeScript 源码/测试编译通过，Electron Vite 构建通过，Desktop 全量测试 **324/324** 通过，Electron 本地代理集成测试通过，`git diff --check` 通过。编译、构建使用仓库现有依赖直接执行对应脚本工具。
