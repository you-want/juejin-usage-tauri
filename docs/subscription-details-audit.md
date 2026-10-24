# 订阅渠道详情面板：调研与实现

调研日期：2026-10-09。范围：本仓库当前启用的 12 个订阅渠道，以及 yetone/magpie、Magpie 社区插件、CodexBar 的一手源码。未读取真实账户凭证或请求真实账户额度；下文“支持”表示对应字段存在时能解析并展示，不保证每个账号返回所有字段。

## 已实现的交互

- 卡片上方保留额度摘要；右侧独立 ghost 图标按钮负责刷新和展开详情。
- 附加详情默认收起，带高度/透明度动画，并尊重系统减少动画设置；收起区使用 `inert` 和 `aria-hidden`。
- 顶部标题区采用固定高度，顶端视觉留白与底部保持一致。
- 摘要最多显示 3 条，Antigravity 显示 2 个模型，Qoder 只显示个人套餐和加购池；完整数据保留在详情中。
- 详情按额度/模型分区展示绝对量、完整重置/到期时间、订阅等级、地区、数据来源、更新时间、缓存状态和读取提示。
- 剩余比例及分段进度条共享 HeroUI success/warning/danger/muted 颜色：大于 50% 绿色、20–50% 黄色、0–20% 红色、用尽灰色。
- DeepSeek 显示货币余额和余额拆分，去掉没有额度分母的进度条。

## 数据可信度规则

1. 额度百分比不能推导请求次数、Token 数或金额。绝对量仅来自真实数值字段；已有两个绝对量相减可用于验证和计算第三个。
2. 空值、空字符串、布尔值和非有限数值不能转换成“0”；真实 0 必须保留。
3. 不同来源、不同模型或共享额度不相加。Kimi Desktop/Code 单独列出，可能属于不同账号。
4. 读取时间只表示读数时间，不充当额度重置或会员到期时间。
5. 不传递原始响应、Token、Cookie、账号标识或任意认证字段到详情模型。
6. 不知道单位时不补写“次”“Token”或货币符号。Copilot/Kimi 只显示渠道提供的绝对额度数值。

## 当前启用渠道的完整展示能力

| 渠道 | 当前数据获取方式 | 已实现的展开信息 | 当前边界 |
|---|---|---|---|
| Codex | 现有本地 ChatGPT 登录凭证 → `/backend-api/wham/usage` | 5h/7d 剩余比例、完整重置日期、套餐；可选 `credits.balance / unlimited / has_credits`；读数/缓存信息 | Credits 只有余额时也可显示详情；不把其单位假定为美元；API key 模式仍无订阅额度 |
| Claude | 现有 Claude Code CLI 授权状态及 `/usage` 解析 | 5h/7d 剩余比例、完整重置日期、套餐、读数与认证/读取提示 | 当前解析只保留这两种窗口，未承诺模型细分或 extra usage 金额 |
| Cursor | 现有 Cursor dashboard usage summary + 可选 get-sand-usage-status | Auto/API 或旧版 Plan 池、账期开始（有返回时）和结束、独立 Grok Bot 额度与重置/试用到期时间、套餐、更新时间 | 不根据不明单位的 `used/limit` 展示美元或次数；不新增网页登录和消费明细抓取 |
| Copilot | 现有 Copilot internal entitlement | 已保留类别的剩余比例、`entitlement` 总额度、`quota_remaining/remaining` 剩余额度、无限/耗尽状态、完整重置日期 | 无限基础 Chat/Completions 仍按原逻辑隐藏；无限 Premium 保留；组织共享池不伪造个人分母 |
| Grok | 现有 Grok Build CLI ACP `_x.ai/billing` | 所有已识别且去重后的周期、各自比例、周期开始/结束、套餐与读数 | 取消最多 2 条的解析截断；保留按周期类别去重；不增加未验证的账单金额 |
| Kimi | Code `/usages`，Desktop `GetSubscription` | Desktop/Code 独立分区，各自套餐、比例、状态、时间；Code 可选总量/已用/剩余原始数值 | 支持 `limit + remaining` 的短窗口；保留全部去重窗口；Desktop 的 `expireTime` 标成到期；不合并两来源账号 |
| ZCode | 现有 Z.ai / BigModel Coding Plan quota + 套餐信息 | 5h/7d 和摘要中隐藏的 MCP 额度、完整重置时间、国内/国际服务商、套餐及读数 | 当前只有比例，未承诺 MCP 绝对次数 |
| Antigravity（标题 Gemini） | 现有本机 Language Server，失败时 Cloud Code 模型接口 | 全部返回且有有效额度的模型、各自剩余比例/重置时间、套餐、读数 | 取消 mapper 只留 2 个模型的截断；摘要仍留 2 个；模型池不相加 |
| Qoder | 现有 `/user/plan` + `/quota/usage`，或官方 CLI 缓存 | 个人 Credits、Add-on、组织共享及专属包；可选总量/已用/剩余、名称与单位、响应中的到期日期、缓存提示 | 支持新插件 `qoderUsage` envelope 和 `cap/remaining`；没有迁移到插件的 device-token 登录接口；所有池不相加 |
| MiniMax | 现有 Coding Plan key `/v1/token_plan/remains`，或 OAuth account membership + remains_percent | 全部模型组的 5h/7d 窗口、无限/耗尽状态、有效次数、完整重置日期、地区/套餐 | 修复 key 路径实际 `model_remains` 响应的解析；摘要优先 general；OAuth 接口不返回次数时不会显示次数 |
| OpenCode | 现有 Go `/zen/go/v1/usage` | 已保留窗口比例、完整重置时间、套餐、读数/缓存信息 | 不把本地 Token 日志当作远端订阅用量，不新增账户账单 |
| DeepSeek | 现有 `/user/balance` | CNY 当前总余额、赠送余额、充值余额、`is_available` 状态、读数信息 | 当前总余额不是累计额度；不显示百分比；详细 Token/消费需要独立 Platform session，尚未接入 |

以上不是所有第三方项目功能的复制。实现复用了本项目已有认证，在响应存在相关字段时增强解析，并用同一 Cursor session 增加可选 Grok Bot 额度请求；没有把一种渠道凭证发送给另一种授权接口。

## 甄别 Magpie / 周边项目后采用的细节

### Qoder

Magpie 主仓库的一部分 Qoder 逻辑已迁移到社区插件。插件使用 device token 请求 `openapi.../sash/api/v2/me/usage`，读取 `qoderUsage` 内的 `userQuota`、`addOnQuota`、`orgResourcePackage`、`dedicatedResourcePackages`。桶中可能含 `total/cap`、`used/remaining`、`name/unit`；两种百分比及绝对量结构都需兼容。

本次吸收字段解析和分池展示方式，保留当前接口与官方 CLI 缓存路径。新的 endpoint 需要对应 device-token 授权；当前凭证不能仅因为域名相近就直接复用。

证据：[社区 Qoder 插件 parseUsage](https://github.com/magpie-community/plugins/blob/5189b287e7aedd413a3332ef3c5da247a48193a0/packages/qoder/index.mjs)。

### MiniMax

Magpie 同时区分窗口比例和次数；`current_interval_status/current_weekly_status` 的 3 为无限，2 为耗尽。实际 `model_remains` 包含不同模型组，不能只提取第一个响应项。

`usage_count` 在某些响应版本表示剩余次数。实现会将它作为“已用”或“剩余”两种候选，与独立百分比核对，误差不超过 1 个百分点才展示次数；无法匹配时隐藏次数。`total_count = 0` 不用作次数分母。其他模型组全保留在详情，general 池用于摘要。

证据：[Magpie MiniMax reader 与 miniMaxCount](https://github.com/yetone/magpie/blob/acdaa28aa10cf4835b42070327efa96713f85db2/internal/provider/planquota.go)、[社区 MiniMax 插件](https://github.com/magpie-community/plugins/blob/5189b287e7aedd413a3332ef3c5da247a48193a0/packages/minimax/index.mjs)。

### Kimi / ZCode / OpenCode

Magpie 的 plan reader 明确区分 Kimi 周额度与滚动短窗口，支持 `detail.limit + detail.remaining`；ZCode MCP 属于独立额度，不代表模型池耗尽；OpenCode Go 使用服务端周期状态。这里据此保留不同额度语义，Kimi Desktop/Code 仍使用本仓库现有独立读数。

证据：[Magpie planquota.go](https://github.com/yetone/magpie/blob/acdaa28aa10cf4835b42070327efa96713f85db2/internal/provider/planquota.go)。

### Codex

同一个 `/wham/usage` 响应可包含 `credits`，不需要额外请求。只保留余额、无限状态、Credits 可用状态；不从其余额推算 5h/7d 次数。

证据：[Magpie subscription_usage.go](https://github.com/yetone/magpie/blob/acdaa28aa10cf4835b42070327efa96713f85db2/internal/provider/subscription_usage.go)。

### Copilot

本项目已有按 SKU、计费模式、无限/组织额度处理的逻辑，本次保留该逻辑并透传原先被丢弃的额度绝对量。CodexBar 也提醒 seat Credits 与多个类别可能指向同一池，因此不求和、不从 `credits_used` 伪造剩余分母。

证据：[Magpie Copilot reader](https://github.com/yetone/magpie/blob/acdaa28aa10cf4835b42070327efa96713f85db2/internal/provider/copilot_usage.go)、[CodexBar Copilot 数据源说明](https://github.com/steipete/CodexBar/blob/94fd089e06e49cf69f1b14f4138f91a444dd77e4/docs/copilot.md)。

### Cursor / DeepSeek

Cursor 的额度、按需消费、事件明细分属不同字段/请求；现有 summary 不能默认当作完整账单。DeepSeek balance API 只提供余额和余额构成，Platform 的 Token/消费详情要求网站 session；API key 本身不能替代。

证据：[CodexBar Cursor](https://github.com/steipete/CodexBar/blob/94fd089e06e49cf69f1b14f4138f91a444dd77e4/docs/cursor.md)、[CodexBar DeepSeek](https://github.com/steipete/CodexBar/blob/94fd089e06e49cf69f1b14f4138f91a444dd77e4/docs/deepseek.md)。

## 尚未接入的扩展

| 扩展 | 需要的进一步工作 |
|---|---|
| Qoder 新插件 device-token 实时接口 | 独立设备登录、国内/国际/企业 host 选择、账号关联与授权生命周期；不能仅换 URL |
| MiniMax 插件的 Platform 详细接口 | 对应平台凭证和 group/workspace 选择；现有 OAuth remains_percent 未必提供次数 |
| Claude 模型细分、额外付费额度 | 扩展当前 CLI 输出契约或增加经确认的官方响应解析 |
| Cursor 消费/事件明细 | 各自接口、账号隔离、单位和账期验证（Grok Bot 附加额度已接入） |
| DeepSeek 按日/按模型 Token 与消费 | 独立 Platform session 授权及其与 API key 账号的显式关联 |
| Copilot 网站预算/组织预算 | 不同于个人 entitlement，需额外权限与独立来源标记 |

这些扩展需要新的认证或账户契约，未混入本次详情面板。

## 未启用渠道

TRAE / WorkBuddy 的现有组件也接入了通用详情展示（额度、地区、时间与读数）。两者目前不在默认启用列表；WorkBuddy 的请求主机白名单仍为空，不能据此宣称已能实时读取额度。

## 实现位置与验证

- 通用卡片：`apps/desktop/src/renderer/components/SubscriptionUsageCard.tsx`。
- 明确字段白名单的详情模型：`apps/desktop/src/renderer/lib/subscription-details.ts`。
- 原始绝对量校验：`apps/desktop/src/shared/subscription-amounts.ts`。
- 12 个渠道组件、各自 shared mapper 与必要的主进程映射同步接通。Dashboard 当前没有这些订阅组件的同名副本。
- 单元测试覆盖空值/零值、无限/耗尽、MiniMax 次数字段歧义、Kimi remaining-only 窗口、Qoder 新 envelope/组织池、Codex Credits、完整模型/周期保留、余额语义、精确时间与主题颜色边界。
- 未进行自动浏览器操作；真实账户与实际窗口视觉效果仍需本地查看。

验证结果：Desktop 类型检查、Electron Vite 构建通过；Desktop 全量单元测试通过（288 项）。构建与测试不代表真实账户接口或视觉验收已完成。

## 官方额度名称对齐（2026-10-09）

- GitHub Copilot：卡片标题使用完整产品名称；额度文案与 VS Code 官方实现一致：按量计费为 `Credits`，旧版为 `Chat messages` / `Premium requests`，补全为 `Inline Suggestions`。不把旧版请求额度混写成 Credits。
- Cursor：按用户指定使用 `Auto`、`API`、`Grok Bot`，分别映射 `autoPercentUsed`、`apiPercentUsed` 和独立 Grok Bot 响应。当前 Cursor 文档把前两池称为 Cursor Models / Other Models；此处保留用户指定的短名称，并保持 API 字段映射正确。
- Grok Bot 使用同一 session 向 `https://cursor.com/api/dashboard/get-sand-usage-status` 发出 POST `{}`；请求超时上限 5 秒，失败或账号未获额度时隐藏该项，保留 Auto/API。正式额度重置与试用到期分开处理，不能把试用到期写成账期结束。
- Qoder 的兜底池名称使用 `Credits` / `Add-on Credits` / `Shared Credits` / `Dedicated Credits`，服务端提供的原始名称优先。
- Antigravity 模型名称按原始读数完整显示，去除前端裁剪 Gemini 前缀的处理。5h、7d 等现有周期标签不变。

命名依据：[VS Code Copilot 官方额度界面源码](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/browser/chatStatus/chatStatusDashboard.ts)、[GitHub Copilot billing](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-billing)、[Cursor Usage and limits](https://cursor.com/help/models-and-usage/usage-limits)、[Cursor Grok Bot](https://cursor.com/docs/grok-bot)。接口兼容参考：[CodexBar CursorSandUsage](https://github.com/steipete/CodexBar/blob/94fd089e06e49cf69f1b14f4138f91a444dd77e4/Sources/CodexBarCore/Providers/Cursor/CursorSandUsage.swift)。未请求真实账户接口。

## 2026-10-11：详情平铺与 ZCode 重置卡

详情 label/value 统一为 13px / 20px 行高、6px 行距；不再单列周期标题。摘要中已有的比例不重复，时间行直接标注「会话重置时间」「每周重置时间」。摘要隐藏的 MCP 比例保留为「MCP 剩余额度」，并展示接口返回的重置时间。模型名和绝对额度保留在行标签中；移除数据来源/读数元信息区。

事实依据：

- [ZCode 官方使用统计文档](https://zcode.z.ai/cn/docs/usage-stats)确认 MCP 每月额度、5 小时/每周重置卡、卡片有效期，以及只有登录并关联 Coding Plan 的用户才会收到卡。
- 只读检查本机 `/Applications/ZCode.app/Contents/Resources/app.asar`：`out/renderer/assets/styles-C4MhEMbW.js` 将 `TIME_LIMIT / unit=5 / number=1` 标为月度 MCP 额度；`out/host/index.js` 的 `getCodingPlanResetStatus` 定义 GET `/api/v1/coding-plan/reset/status`，双凭证请求头为 `Authorization: Bearer <zcode JWT>` 和 `X-Bigmodel-Authorization: <当前平台 token>`，个人套餐使用 `Bigmodel-Target-Type: PERSONAL`。
- 成功响应为 `code: 0`，`data.available_five_hour_resets[]` / `data.available_week_resets[]` 每项含 `expire_at`。实现只保留这两个数组的有效到期时间，分别显示未过期卡数量及最近到期时间；未知或失败时隐藏，不伪造 0 张。当前新增查询仅针对个人账号，不接入团队上下文。
- 没有接入 `/opportunity`、`/use`、`/history/read` 等写操作，也未调用真实账户接口。MCP 目前只显示响应中的比例与时间，不从百分比推算调用次数。

验证：类型检查；模拟响应覆盖只读 GET、双凭证、缺少凭证、网络失败、空数组、非法过期时间及非月度池过滤。

## 统一去重规则补充

摘要与详情通过内部 `poolKey`（渠道/来源、模型、额度池 ID）关联，避免依赖展示标题。只有实际显示的前 3 条摘要参与去重；5h/7d 的用量行不重复，其他池保留摘要尚未表达的绝对用量。Kimi 双来源、MiniMax 同周期不同模型及 Qoder 独立池不互相去重。同池、同语义、同显示值的日期只保留一次，不合并独立池的时间。

DeepSeek 去除与摘要重复的总余额及正常 API 状态，保留余额拆分与不可用提示。Codex 未返回的时间/余额不再显示占位；Credits 余额不补写未经声明的货币单位，重置卡仍保留。所有真实零值保留；不加行数上限或第二层展开。

验证：Desktop 类型检查；21 项展示与模拟数据测试覆盖全部 12 个启用渠道，以及来源/模型隔离、摘要截断、同池时间去重、隐藏池状态和真实零值。未调用真实账号接口或操作浏览器。

## 进度条扩展展示

Gemini 全模型、Qoder 全 Credits 池、MiniMax 全模型周期启用不限条数的进度条展示；其他卡片保持默认最多 3 条。Gemini 不再提供详情折叠入口。Qoder 详情仅展示主套餐到期时间，缺少主套餐时间时显示最近的有效到期时间；各池自身时间仍在对应进度条旁提示。Qoder 有绝对量时在进度条上方合并显示已用/总量 Credits。

MiniMax 按通用、图片、视频顺序排列；图片/视频分组标题带图标与「图片剩余」「视频剩余」文案。已知次数显示剩余/总量 次，进度比例采用实际次数比值；没有次数时使用原始比例，无限状态保持独立。进度条采用额度池标识作为 key，避免不同模型的 5h/7d 行发生冲突。

### 折叠预览规则调整

Gemini 默认只展示前 3 个有效模型，超过 3 个时通过卡片展开按钮显示全部进度条。MiniMax 默认仅展示文本（general 或无模型分类）额度，展开后显示全部模型；图片/视频图标直接放在每一条 5h/7d 标签前，不再单列分组标题。Qoder 保持全部 Credits 池进度条及单个到期时间。展开按钮同时控制额外进度条和已有日期详情。
