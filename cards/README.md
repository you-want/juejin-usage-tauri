# 用量卡片（`cards/`）

每个子目录是一款可嵌入的用量卡模板。本目录是**本仓的本地事实源**：改这里 → `pnpm cards:build` 生成 `packages/core` 的 Catalog 与模板，Dashboard / CLI 本地预览直接用。

欢迎通过 PR 增加样式。已发布的 `id` **不要改名**（外链与用户已保存的 `templateId` 都依赖它）；要大改就发新 id，删目录 = 下线该样式。

服务端会从本仓公开托管的 `cards/` 拉取远端模板（内置同步与运行时细节见服务端仓文档）。**字段与模板约定以本文为准。**

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

| key | 面板文案 | 渲染含义（已格式化 / 转义） | 典型用途 |
|-----|----------|------------------------------|----------|
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

- **`required: true`**：用户面板不能关掉；保存 `showFields` 时会强制带上。
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

把可藏的指标列放进 `transform="translate({{x_*}} 0)"` 的 `<g>`，隐藏后可见列会左移，避免留白空洞。本地预览与线上渲染的坐标算法保持一致。

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

## 本地构建

在本仓根目录：

```bash
pnpm cards:build   # 校验 cards/，生成 packages/core/src/usage-cards.ts，并刷新 dist
pnpm cards:watch   # 改 cards/ 自动 build
```

Dashboard（`packages/dashboard`）把 `@juejin-opensource/jusage-core/usage-cards` **alias 到 core src**，因此 `cards:build` / `watch` 后刷新用量卡片弹窗即可看本地预览，不必先跑完整 `jusage-core` tsc。发布仍以 `packages/core/dist` 为准。

提交本仓时带上：`cards/` + 生成的 `packages/core/src/usage-cards.ts`（及若有的 dist 刷新）。

---

## 面板 Catalog（前端合并）

Dashboard「用量卡片」弹窗 = **本地构建 Catalog** ∪ **服务端 Catalog API**：

| 来源 | 内容 |
|------|------|
| 本地 | `USAGE_CARD_CATALOG` / `USAGE_CARD_TEMPLATES`（本目录经 `pnpm cards:build`） |
| 服务端 | `GET …/tud-embed-cards/catalog`（元数据；无 SVG 原文） |

**合并规则**（`mergeEmbedCatalog`，见 `packages/dashboard/src/lib/embed-usage.ts`）：以服务端列表为底，再用本地按 `id` **覆盖** → 同 id **本地优先**（方便改 `cards/` 后立刻调试）。仅本地 / 仅服务端的 id 都会出现；仅服务端有、本机无 SVG 时预览降级为「无法生成本地预览」（不崩）。

- 保存只传 `templateId` + `showFields`（及启用、备注等），**禁止**上传自定义 SVG
- 客户端不直接拉 Git 托管上的 `cards/`；远端模板只经 Catalog API 暴露，合并时本地同 id 仍优先

---

## 开发 / 测试步骤

贡献者可以只在本仓完成样式开发与本地验证：

1. **改或新增模板**：在 `cards/<id>/` 编辑 / 新建 `card.json` + `template.svg`（新 id 须满足目录约定）。
2. **可选字段包进条件块**：凡可关掉的指标用 `{{#if key}}…{{/if}}`；需要横向/纵向收拢的列用 `{{x_*}}` / `{{y_metrics}}`。
3. **构建校验**：根目录跑 `pnpm cards:build`（开发中可用 `pnpm cards:watch`），确认无报错并生成 `packages/core/src/usage-cards.ts`。
4. **本地预览**：另开终端 `pnpm dev:dashboard`（或 `pnpm dev:web` / `dev:cli` 等现有 Dashboard 入口），打开用量卡片设置弹窗：切模板、勾选/取消字段，确认布局收拢、无留白、头像与昵称对齐符合预期。
5. **合并行为（可选）**：若当前连着服务端 Catalog，确认同 id 时本地改动能盖住远端列表项；仅远端有的 id 会出现在列表，但无本地 SVG 时预览会降级提示。
6. **提交 PR**：带上 `cards/` 与生成的 `packages/core/src/usage-cards.ts`（及必要的 dist）。勿改已发布 `id` 的目录名。

公开 SVG 的联调与服务端内置同步不在本仓文档范围；字段约定仍以本文为准。

---

## 新增一款卡的检查清单

1. 建目录 `cards/<id>/`，写好 `card.json` + `template.svg`。
2. 可选指标全部包进 `{{#if}}`，需要收拢的列用 `{{x_*}}`。
3. `pnpm cards:build` 通过；打开用量卡片弹窗，切模板、勾字段、看本地预览是否收拢、无留白。
4. 将 `cards/` 与 `packages/core/src/usage-cards.ts` 一并 PR。
