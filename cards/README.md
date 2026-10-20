# 用量卡片（`cards/`）

每个子目录是一款可嵌入的用量卡模板。本目录是**前端 / CLI 的本地事实源**：改这里 → `pnpm cards:build` 生成 `packages/core` 的 Catalog 与模板。服务端内置 Catalog 由服务端仓的 `pnpm sync:juejin` 从本目录 pull 覆盖并重生。

欢迎通过 PR 增加样式。已发布的 `id` **不要改名**（外链与用户已保存的 `templateId` 都依赖它）；要大改就发新 id，删目录 = 下线该样式。

**字段与模板约定以本文为准。** 产品 / API 方案见服务端仓的 `docs/embed-usage-card-design.md`。

> 同步说明：`ai-usage` 的 `apps/server/cards/README.md` 是本文件经 `pnpm sync:juejin` 覆盖后的副本。字段约定改上游；服务端运行时行为见下文「端到端流程」。

---

## 目录约定

```
cards/
  <templateId>/
    card.json      # 元数据 + fields 契约
    template.svg   # 自包含 SVG 模板
  README.md        # 本文
```

| 项 | 要求 |
|----|------|
| `id` | 必须等于目录名，匹配 `^[a-z][a-z0-9-]*$` |
| `label` / `description` / `order` | 面板展示名、简介、排序 |
| `width` / `height` | 画幅；须与 SVG `viewBox="0 0 W H"` 一致 |
| `avatar` | `{ x, y, size }`；`size: 0` 表示该样式无头像位（如 badge） |
| `fields` | 本模板用到的可切换字段（见下） |

`template.svg` **只允许自包含 SVG**：禁止 `<script>` / `foreignObject` / 事件属性 / 外链 `href`·`src`·`url(...)`（`#` 锚点除外）。构建脚本会校验。

---

## 支持的替换字段（全局白名单）

渲染器只认下列 **key**。`card.json` 的 `fields[].key`、SVG 里的 `{{key}}` / `{{#if key}}` 都必须落在此表；未知 key 会令 `cards:build` 失败。

| key | 面板文案 | 渲染含义（服务端已格式化 / 转义） | 典型用途 |
|-----|----------|-----------------------------------|----------|
| `avatar` | 头像 | SVG 片段：用户头像（data URI）或掘金 logo 占位；`avatar.size === 0` 时不渲染 | 多数卡左上 |
| `name` | 昵称 | 缩短后的用户昵称 | 除 badge 外几乎都有；**可选**，默认勾选 |
| `total` | 总 Token | 累计 Token（如 `12.4M`） | 主指标；**可选**，默认勾选 |
| `cost` | 累计费用 | 累计费用 USD（如 `$12.34`） | 次指标；可选，默认勾选 |
| `today` | 今日 Token | 今日 Token | 辅指标；可选，默认勾选 |
| `input` | 输入 Token | 累计输入 Token | `stats-row` |
| `output` | 输出 Token | 累计输出 Token | `stats-row` |
| `inputPct` | 输入占比 | `input/total` 百分比文案 | `stats-row` |
| `outputPct` | 输出占比 | `output/total` 百分比文案 | `stats-row` |
| `totalPct` | 总量占比 | 有总量时为 `100%`，否则 `0%` | `stats-row` |
| `since` | 首次使用 | 有起点时为 `since YYYY-MM-DD`，否则 `暂无用量` | 底栏右侧 |

### `fields` 契约

```json
{
  "key": "cost",
  "required": false,
  "defaultOn": true
}
```

- **`required: true`**：用户面板不能关掉；保存 `showFields` 时服务端会强制带上。
- **`required: false`**：必须同时写 `defaultOn`（新建卡时是否默认勾选）。
- 用户最终勾选的 `showFields` ⊆ 本模板 `fields`；多出来的 key 会被拒。

**当前内置模板里**：无必选字段。`name` / `avatar` / `total` / `cost` / `today` / `since` 等均为可选（默认开）。关掉昵称与头像后顶部身份区消失，指标会上移（`y_metrics`）。`badge` 三字段全可选且无昵称。

文本占位：`{{name}}`、`{{total}}` …（值由渲染器填入，模板里不要自己做数字格式化）。

头像占位：`{{avatar}}`（整段 SVG；关闭头像或 `size: 0` 时为空）。

---

## 条件块与布局收拢

### `{{#if}}`：隐藏时真正去掉节点

可选内容必须包在条件块里，**禁止**靠空字符串「隐形占位」：

```svg
{{#if cost}}
  <g transform="translate({{x_cost}} 0)">
    <text …>{{cost}}</text>
  </g>
{{/if}}
```

未勾选时整段删除；嵌套 `{{#if}}` 由内向外解析。`{{#if}}` / `{{/if}}` 必须成对，构建脚本会检查。

### 布局坐标 `{{x_*}}`（渲染器计算，勿写入 `fields`）

| 占位符 | 作用 |
|--------|------|
| `x_name` | 昵称起点 x（藏头像时左移） |
| `x_total` / `x_cost` / `x_today` | 横向指标列 |
| `x_input` / `x_output` | `stats-row` 列 |
| `y_metrics` | 指标区纵向偏移：关掉昵称+头像（compact 还要无 since）时上移，避免顶部空洞 |

把可藏的指标列放进 `transform="translate({{x_*}} 0)"` 的 `<g>`，隐藏后可见列会左移，避免留白空洞。坐标算法在服务端与前端本地预览保持一致。

---

## `card.json` 示例

```json
{
  "id": "classic-light",
  "label": "Classic Light",
  "description": "浅色经典",
  "order": 0,
  "width": 420,
  "height": 200,
  "avatar": { "x": 24, "y": 20, "size": 32 },
  "fields": [
    { "key": "name", "required": false, "defaultOn": true },
    { "key": "avatar", "required": false, "defaultOn": true },
    { "key": "total", "required": false, "defaultOn": true },
    { "key": "cost", "required": false, "defaultOn": true },
    { "key": "today", "required": false, "defaultOn": true },
    { "key": "since", "required": false, "defaultOn": true }
  ]
}
```

规则摘要：

1. SVG 用到的每个数据 key ⊆ 全局白名单，且必须出现在 `fields`。
2. `fields` 里声明的每个 key 必须在 SVG 中出现（`{{key}}` 或 `{{#if key}}`）。
3. `x_*` 布局占位**不要**写进 `fields`。

---

## 端到端流程（作者 → 面板 → 公开图）

```text
juejin-usage/cards/          # 事实源：改样式、PR
        │  pnpm cards:build
        ▼
packages/core usage-cards    # 前端 / CLI 本地 Catalog + 预览 SVG
        │
        │  ai-usage: pnpm sync:juejin（或 sync:private 接力）
        ▼
apps/server/cards/           # 服务端磁盘副本
        + template-artwork.ts  # 内置兜底 Catalog（编译进进程）
        │
        │  进程启动 configure + 异步 force ensure（不挡 listen）
        │  运行时再按需拉 Gitee→GitHub 远端 overlay
        ▼
服务端内存 Catalog = 内置 ∪ 远端（同 id → 远端覆盖内置）
        │
        ├─ GET …/tud-embed-cards/catalog  → 面板列表
        ├─ POST/PATCH 保存 templateId     → 校验 ∈ 内存 Catalog
        └─ GET /embed/v1/cards/:id.svg    → 公开渲染
```

### 1. 作者侧（本仓）

1. 改 `cards/<id>/` → `pnpm cards:build`（或 `cards:watch`）。
2. Dashboard 开发指到 core **src**，刷新弹窗即可看本地预览。
3. PR 提交 `cards/` + 生成的 `packages/core/src/usage-cards.ts`。

### 2. 服务端内置（ai-usage）

```bash
# 服务端仓根目录
pnpm sync:juejin
# 或：pnpm sync:juejin -- --src /path/to/juejin-usage
```

- `cards/` → `apps/server/cards/`（整目录覆盖，含本 README）
- 重生 `apps/server/src/embed/template-artwork.ts`
- `sync:private` 把已进入私有树的 cards / artwork 当普通产品文件 apply（须先经 `sync:juejin`）

### 3. 服务端运行时 Catalog（内存）

| 层 | 来源 | 同 id |
|----|------|-------|
| 内置 | 启动时 `template-artwork.ts` | — |
| 远端 overlay | Gitee 优先，目录为空或整路失败再试 GitHub | **远端覆盖内置** |

- 默认 repo / path / ref：`juejin-cn/juejin-usage` / `cards` / **`main`**
- **没有 `setInterval`**。刷新策略：
  - **启动**：`configureEmbedCardsRemote` 后立刻 `ensure({ force: true })` 异步拉一次（**不阻塞** `listen`）
  - **按需 TTL**：相关接口里用 `lastFetchedAt` + `EMBED_CARDS_REFRESH_MS`（默认 `3600000` = 1h）；过期则 await 刷新。设为 `0` → 不做 TTL 刷新，但首次拉取 / `force` 仍会拉
  - **Catalog GET**（`GET …/tud-embed-cards/catalog`）：await TTL `ensure`
  - **保存 POST/PATCH**：**不 await** 刷新；仅当 `templateId` 在内存中不存在时 `scheduleEmbedCardsRefreshIfUnknown`（异步 force）。校验仍看当前内存 → 新远端-only id 可能先 400，拉取落地后再保存即可
  - **公开 SVG/JSON**：await TTL `ensure`；若仍 miss → 再异步 force；**本次**响应可能走 fallback / 缺尺寸元数据
- 并发调用共用同一个 in-flight Promise，避免叠拉
- `EMBED_CARDS_REMOTE=0` / `false` / `off` 关掉远端，只留内置

环境变量（见 `apps/server/.env.example`）：

| 变量 | 默认 | 含义 |
|------|------|------|
| `EMBED_CARDS_GITEE_REPO` | `juejin-cn/juejin-usage` | owner/name |
| `EMBED_CARDS_GITEE_PATH` | `cards` | 目录 |
| `EMBED_CARDS_GITEE_REF` | `main` | 分支 / tag；测 feature 才改 |
| `EMBED_CARDS_REFRESH_MS` | `3600000` | 按需缓存 TTL（毫秒）；`0` = 无 TTL |
| `EMBED_CARDS_REMOTE` | 开 | `0`/`false`/`off` 禁用远端 |

一次完整远端刷新墙钟大约 **0.8–0.9s**（目录列举 + 并发拉各卡 `card.json` / `template.svg`）。

### 4. 面板 Catalog（前端合并）

Dashboard「用量卡片」弹窗 = **本地构建 Catalog** ∪ **服务端 Catalog API**：

| 来源 | 内容 |
|------|------|
| 本地 | `USAGE_CARD_CATALOG` / `USAGE_CARD_TEMPLATES`（本目录经 `pnpm cards:build`） |
| 服务端 | `GET …/tud-embed-cards/catalog`（内存 Catalog 元数据；无 SVG 原文） |

**合并规则**（`mergeEmbedCatalog`）：以服务端列表为底，再用本地按 `id` **覆盖** → 同 id **本地优先**（方便改 `cards/` 后立刻调试）。仅本地 / 仅服务端的 id 都会出现；仅服务端有、本机无 SVG 时预览降级为「无法生成本地预览」（不崩）。

- 保存只传 `templateId` + `showFields`（及启用、备注等），**禁止**上传自定义 SVG
- **客户端不配 Gitee URL**；远端模板只经 Catalog API 暴露，合并时本地同 id 仍优先
- 公开 SVG 始终走服务端内存模板，与面板本地预览相互独立

---

## 本地构建命令

在本仓（juejin-usage）根目录：

```bash
pnpm cards:build   # 校验 cards/，生成 packages/core/src/usage-cards.ts，并刷新 dist
pnpm cards:watch   # 改 cards/ 自动 build
```

Dashboard 开发把 `@juejin-opensource/jusage-core/usage-cards` 指到 **src**，故 `cards:build` / `watch` 后刷新弹窗即可；发布仍以 `packages/core/dist` 为准。

提交约定：

- **本仓**：`cards/` + 生成的 `packages/core/src/usage-cards.ts`（及若有的 dist 刷新）
- **服务端仓**：跑完 `pnpm sync:juejin` 后提交指针、`apps/server/cards/`、`template-artwork.ts` 及一并打进的 packages 改动

---

## 公开嵌入地址

图片 / 元数据只认 path 里的 `shareId`（不透明短串）。**字段与模板不在 URL query 里**，改不了别人的卡。

| 形态 | 路径 |
|------|------|
| SVG（主推） | `GET /embed/v1/cards/:shareId.svg` |
| JSON（公开元数据，无敏感 id） | `GET /embed/v1/cards/:shareId.json` |

线上完整示例（网关前缀以现网为准）：

```text
https://api.juejin.cn/aiusage_api/embed/v1/cards/{shareId}.svg
```

旧路径 `/embed/v1/:key/:style.svg`、单用户 `usage_embed_keys` **已废弃**，不要再写进文档或代码。

停用 / 无效 / 限流时仍返回 **HTTP 200** 导流 SVG（README 不裂图），不是 404。

### 缓存

成功响应：

```http
Cache-Control: public, max-age=300, must-revalidate
```

即约 **5 分钟**（SVG 与 JSON 相同）。限流 / 临时失败等走 `no-store`。

---

## 已知注意

- **`main` 上可能还没有 cards**：Gitee/GitHub 默认 `ref=main` 时，若远端 `cards/` 仍空，overlay 为 0 张（只剩内置）。特性联调把 `EMBED_CARDS_GITEE_REF` 指到已有 cards 的 feature 分支即可；空目录会继续试下一 host，两路皆空则保持当前内存 Catalog。
- **保存全新远端-only `templateId`**：保存路径故意不阻塞等待刷新；内存尚无该 id 时会异步 force 拉一次，但**本次**仍按内存校验，可能先 **400 unknown templateId**，拉取完成后再存一次即可。Catalog GET / 公开图会 await TTL，行为更稳。
- **远端拉取失败不推进 `lastFetchedAt`**：失败时保留旧 Catalog；若 TTL 已过期，后续每个会 `ensure` 的请求都可能再试，直到某次成功写入 `lastFetchedAt`（有 in-flight 合并，不会并行叠多路，但仍可能较勤）。
- **完整远端刷新约 0.8–0.9s**：启动与 TTL/force 命中时才会跑；保存路径不 await，故不直接拖慢保存 RT。
- **两套「同 id 谁赢」**：服务端内存是远端覆盖内置；面板合并是**本地覆盖服务端**。本地改样式立刻调预览；线上公开图仍以服务端内存（内置 ∪ 远端）为准。

其余流程（内置 sync、面板合并、公开 URL）目前看齐，无明显缺口。

---

## 新增一款卡的检查清单

1. 建目录 `cards/<id>/`，写好 `card.json` + `template.svg`。
2. 可选指标全部包进 `{{#if}}`，需要收拢的列用 `{{x_*}}`。
3. `pnpm cards:build` 通过；打开用量卡片弹窗，切模板、勾字段、看本地预览是否收拢、无留白。
4. 联调公开 SVG：在服务端仓跑 `pnpm sync:juejin`，提交 `apps/server/cards/` + `template-artwork.ts`。
5. 将 `cards/` 与 `packages/core/src/usage-cards.ts` 一并 PR。
6. （可选）合并进公开仓 `main` 后，线上进程靠启动/TTL/未知 id 异步拉取即可吃到远端 overlay，不必只靠内置 sync。
