# @juejin-opensource/jusage-core

AI Agent Token 用量采集与本地 API 核心库。提供 parsers、sync、hooks、pricing、local-api、upload 等能力，供 CLI 与 Desktop 复用。

一般用户请安装 [`@juejin-opensource/jusage`](https://www.npmjs.com/package/@juejin-opensource/jusage)，无需直接依赖本包。

## 安装

需要 Node.js >= 20（ESM only）。

```bash
npm i @juejin-opensource/jusage-core
```

## 能力概览

| 模块 | 说明 |
|------|------|
| parsers | Claude / Codex / Cursor 本地用量解析 |
| sync | 增量同步、写桶、信号刷新 |
| hooks | Claude / Codex Hook 注册与状态 |
| pricing | Token 计价 |
| local-api | 本地面板 HTTP API（Hono） |
| upload | 增量 / 对账上报云端 |

## 简短示例

```ts
import {
  loadConfig,
  syncAll,
  createLocalApiApp,
  createHttpServer,
  listenServer,
  BucketStore,
} from '@juejin-opensource/jusage-core';

const { dir, config } = await loadConfig();
await syncAll(dir, config);

const bucketStore = new BucketStore();
await bucketStore.reload(dir, config.statsSince);

const app = createLocalApiApp({
  dataDir: dir,
  getConfig: () => config,
  bucketStore,
  getHookStatus: () => ({ claude: false, codex: false }),
  onConfigChange: () => {},
});

const server = createHttpServer({
  honoApp: app,
  staticDir: './dashboard',
  port: 8452,
});
await listenServer(server, '127.0.0.1', 8452);
```

## License

MIT
