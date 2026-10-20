# 用量卡片（`cards/`）

每个子目录是一款可嵌入的用量卡模板。本目录是**事实源**：改这里 → `pnpm cards:build` 进前端 core；服务端由 **ai-usage** 的 `pnpm sync:juejin` pull 覆盖 `apps/server/cards/` 并重生内置 Catalog。

欢迎通过 PR 增加样式。已发布的 `id` **不要改名**（外链与用户已保存的 `templateId` 都依赖它）；要大改就发新 id，删目录 = 下线该样式。

更完整的产品 / API 方案见兄弟仓 `ai-usage/docs/embed-usage-card-design.md`。**字段与模板约定以本文为准。**

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

把可藏的指标列放进 `transform="translate({{x_*}} 0)"` 的 `<g>`，隐藏后可见列会左移，避免留白空洞。坐标算法在服务端 `templates.ts` 与前端 `embed-usage.ts` 保持一致。

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

## 本地构建与同步

**方向：服务端 pull，不再从本仓 push。**

在 **juejin-usage** 根目录（前端 Catalog）：

```bash
# 校验 cards/，生成 packages/core/src/usage-cards.ts（前端 / CLI Catalog + 模板）
pnpm cards:build

# 监听 cards/，改完自动 cards:build（不同步后端）
pnpm cards:watch
```

在兄弟仓 **ai-usage** 根目录（服务端内置 Catalog）：

```bash
# 将上游 juejin-usage 的 product 树 diff 打进本仓，并：
#   cards/ → apps/server/cards/（整目录覆盖）
#   重生 apps/server/src/embed/template-artwork.ts
pnpm sync:juejin
# 或：pnpm sync:juejin -- --src /path/to/juejin-usage
```

`sync:private`（GitHub 私有仓 → 内网 Codebase）会把已进入私有树的 `apps/server/cards/` 与 `template-artwork.ts` 当普通产品文件自动 apply；它们须先经由 `sync:juejin` 写入 GitHub 私有仓。

提交约定：

- **juejin-usage**：提交 `cards/` + 生成的 `packages/core/src/usage-cards.ts`。
- **ai-usage**：在跑完 `pnpm sync:juejin` 后，提交指针文件、`apps/server/cards/`、`template-artwork.ts` 以及一并打进来的 packages 改动。

面板预览走前端本地模板（`USAGE_CARD_TEMPLATES` + 演示数据），不依赖公开 SVG；公开图仍由服务端按用户 `showFields` 渲染。

> 注意：`cards:build` / `cards:watch` 只刷新 `packages/core/src/usage-cards.ts`。Dashboard 若从包的 **dist** 引用，本地预览需再跑一次 `pnpm --filter @juejin-opensource/jusage-core build`，否则可能看到旧字段契约。

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

## 使用方

| 侧 | 来源 |
|----|------|
| 前端 / CLI | `@juejin-opensource/jusage-core` → `USAGE_CARD_CATALOG` / `USAGE_CARD_TEMPLATES`（由 `cards:build` 生成） |
| 后端 | `apps/server/src/embed/template-artwork.ts` 内置 Catalog；运行时内存 Map（Gitee 远端覆盖为后续能力，尚未接上） |

面板保存只传 `templateId` + `showFields`（及启用、备注等），**禁止**上传自定义 SVG 原文。

---

## 新增一款卡的检查清单

1. 建目录 `cards/<id>/`，写好 `card.json` + `template.svg`。
2. 可选指标全部包进 `{{#if}}`，需要收拢的列用 `{{x_*}}`。
3. `pnpm cards:build` 通过（需要时再 `pnpm --filter @juejin-opensource/jusage-core build` 刷新 dist）。
4. 本地打开用量卡片弹窗，切模板、勾字段、看预览是否收拢、无留白。
5. 联调后端：在 **ai-usage** 跑 `pnpm sync:juejin`，提交 `apps/server/cards/` + `template-artwork.ts`。
6. 将 `cards/` 与 `packages/core/src/usage-cards.ts` 一并 PR（juejin-usage）。
