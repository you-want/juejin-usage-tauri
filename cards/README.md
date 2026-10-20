# 用量卡片

每个目录是一款卡片，公开维护，欢迎通过 PR 增加样式。

## 目录约定

- `card.json`：稳定标识 `id`、名称、简介、排序、SVG 尺寸、头像位置、**字段契约 `fields`**。
- `template.svg`：可编辑的 SVG。只允许自包含 SVG，不使用脚本、事件、外链资源或 `foreignObject`。

`id` 必须等于目录名，且匹配 `^[a-z][a-z0-9-]*$`。已发布的 id 不要改名（外链与配置都依赖它）。

## 字段与占位符

全局白名单：`avatar`、`name`、`total`、`cost`、`today`、`input`、`output`、`since`、`subtitle`、`inputPct`、`outputPct`、`totalPct`。

在 `card.json` 里声明本模板用到的字段，例如：

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
    { "key": "name", "required": true },
    { "key": "avatar", "required": false, "defaultOn": true },
    { "key": "total", "required": true },
    { "key": "cost", "required": false, "defaultOn": true },
    { "key": "today", "required": false, "defaultOn": true },
    { "key": "since", "required": false, "defaultOn": true }
  ]
}
```

- 文本占位：`{{name}}`、`{{total}}` …（服务端已转义 / 格式化）
- 头像占位：`{{avatar}}`（服务端生成的 SVG 片段；`avatar.size` 为 0 时不渲染）
- **可选块必须用条件块真正藏掉**（不允许靠空字符串留白）：

```svg
{{#if cost}}
  <text …>{{cost}}</text>
{{/if}}
```

用户在面板勾选的展示字段 ⊆ 本模板 `fields`；`required: true` 不能关。

## 本地构建与同步

```bash
# 生成 packages/core/src/usage-cards.ts（前端 / CLI）
pnpm cards:build

# 覆盖同步到兄弟仓 ai-usage 的 server（cards/ 目录 + template-artwork.ts）
pnpm cards:sync-server
```

开发时可：

```bash
pnpm cards:watch
```

改 `cards/` 后自动重建 core 产物。需要联调后端时再跑一次 `cards:sync-server`（或给 watch 配上同步，见根目录 scripts）。

将 `cards/` 目录与生成的 `packages/core/src/usage-cards.ts` 一起提交；同步进 `ai-usage` 的产物在对应仓提交。

## 使用方

- 前端：`@juejin-opensource/jusage-core/usage-cards`
- 后端：内置 `template-artwork.ts` + 运行时内存 Catalog（内置 ⊕ Gitee，同 id 远端覆盖）
