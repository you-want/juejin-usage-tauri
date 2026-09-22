# Codex ledger 总量权威

关联：issue #159 / PR #160（互斥兜底，2026-09-22 仍 OPEN，head 在 `Chengyunlai/juejin-usage`）。本方案把记账模型收成 **ledger 管 lifetime 总量，JSONL 只做明细 enrichment**，从结构上消除双计。

分支（从 `main` 开）：`fix/cli/codex-ledger-authority`  
范围：`packages/core`（Desktop / CLI 共用 parser；不改 Web UI）

现状（已核对 `main` @ `12e1dae`）：`packages/core` 没有 `codex-ledger.ts`，`cursors.codex` 也没有 `ledgerTotals` / `dbMtimes`。本分支一次性落地「读账本 + 权威模型」，PR 正文写明 supersede #160。读库、列探测、snapshot、坏库不阻断等基建按 #160 的 `codex-ledger.ts` 移植，不要重发明 sqlite 读取。

## 稳定性（现有功能不能变）

JSONL 扫描的分支、入桶、去重、fork 重放跳过、`statsSince` 过滤保持现在的行为。账本只允许**加**「JSONL 从未见过的线程」或「文件里根本没有的尾差」，不能改已经入桶的半小时 / 模型 / 拆分。

具体锁死：

- 没有 `state_*.sqlite` 时，不给 `cursors.codex` 写入 `ledgerTotals` / `dbMtimes`，`parseCodexIncremental` 的 buckets 与今天一致。
- 账本读失败只记 error，不抛出，不回滚本轮已经扫完的 JSONL 游标。
- 文件里已经出现过的 token 不算缺口。`statsSince` 之前被跳过的事件、fork 重放被跳过的事件，都算「JSONL 见过」，不能靠 `tokens_used - 本轮入桶数` 补回来。否则老会话第一次对着账本跑，会把窗口外的历史灌进 `recency` 那一个半小时，现有面板数字会涨。
- 已有 file cursor 的线程：第一次只播种水位，不入 ledger 桶。升级后重跑 sync，已有队列不变。
- 用户可见的新增只有一类：游标里从未出现、rollout 也不在的线程（安装前已删）。这是 #159 要补的洞，不改已采会话。

---

## 目标模型

每个 Codex thread 只认一个 lifetime 总量权威：`state_*.sqlite.threads.tokens_used`。

```text
水位[threadId] = cursors.codex.ledgerTotals[threadId].tokens
                 // 已对外报过的 lifetime 上界，不是「上次见到的 tokens_used」

本轮入桶 = 本轮新写入精确桶的 total_tokens
         // 不变文件（offset 已到 EOF）为 0；历史已计部分靠水位，不靠本轮重放

本轮文件已解释 = 本轮扫到的 max(total_token_usage.total_tokens)
               // 含 statsSince 之外、fork 重放、重复快照这些「见过但没入桶」的量
               // 文件没扫到则为 0。没有 cumulative 字段时，退化为本轮解析到的 delta 之和（含被跳过的）

isReset = tokens_used > 0 && tokens_used < 水位
budget  = isReset ? tokens_used : max(0, tokens_used - 水位)
已解释  = max(水位, 本轮文件已解释)
没见过  = max(0, tokens_used - 已解释)
gap     = max(0, min(budget, 没见过) - (本轮文件已解释 > 0 ? 0 : 本轮入桶))
         // 文件给出了 lifetime 时，缺口只是账本超出文件的尾差
         // 文件没扫到时，才用「本轮入桶」从 budget 里扣，避免增量轮双计

gap > 0 且时间戳在窗口内 → 差额进 codex-ledger 桶
否则不写 ledger 桶

水位更新（与是否入桶无关）：
  isReset → max(tokens_used, 本轮 JSONL 贡献)
  否则    → max(tokens_used, 水位 + 本轮 JSONL 贡献)
```

水位仍按「本轮入桶」往上加，不要加「文件已解释」的 lifetime，否则增量轮会把水位乘上去。对外新增的账本 token 只来自 `gap`。文件里已有的量（包括窗口外）不算缺口。

无 rollout、且游标里也没有这个文件（安装前已删）：本轮 JSONL 贡献 = 0，整段 `budget` 进 codex-ledger 桶。

---

## 怎么改

### 1. 游标 / 类型（`packages/core/src/types.ts`）

保留（或新增，若 main 尚无）：

- `cursors.codex.ledgerTotals: Record<threadId, { tokens: number }>`
- `cursors.codex.dbMtimes: Record<dbPath, number>`

语义是「该 thread 已向队列贡献过的 lifetime 上界」（精确桶 + ledger 补差都算）。老游标兼容：缺字段当 `{}`。

不要加 `rolloutAttributed`。历史 JSONL 不重放，靠下面的一次性播种把已有 file cursor 折进水位。

### 2. 账本读取（`packages/core/src/parsers/codex-ledger.ts`）

保留 / 移植自 #160：

- `codexLedgerDbPaths()` / `readCodexLedgerThreads()` / snapshot 读
- 列缺失自适应、`recency_at_ms` → `created_at_ms` 回退

**删掉或改掉**的互斥逻辑：

- 去掉「`countedRolloutNames.has(basename(rollout_path))` → 只抬水位不 emit」作为唯一防重
- 改为导出更纯的原语，例如：

```ts
// 读账本 + 按 mtime 跳过未变化的库。跳过不等于本轮可以不碰水位：
// 见下方「mtime 跳过时仍要计入本轮 JSONL」。
export function loadCodexLedgerThreads(opts: {
  dbMtimes: Record<string, number>;
}): { threads: CodexLedgerThread[]; filesProcessed: number; error?: string }

export function reconcileCodexLedgerThread(
  thread: CodexLedgerThread,
  opts: {
    ledgerTotals: Record<string, { tokens: number }>;
    /** 本轮新写入精确桶的 total_tokens。水位按这个加，不是按 lifetime。 */
    jsonlEmitted: number;
    /**
     * 本轮文件给出的 lifetime（max total_token_usage.total_tokens）。
     * 0 表示这轮没扫到该文件。含窗口外 / fork 重放，用来防止把它们补进 gap。
     */
    jsonlAccounted: number;
    /**
     * rollout basename 已在 cursors.codex.files 里（含已删但游标还在）。
     * 只表示「历史 JSONL 已经计过」，播种与否还要看水位表里有没有这条。
     */
    alreadyCounted: boolean;
    sinceMs: number;
    bucketState: BucketAccumulator;
  },
): boolean // 是否写了 ledger 桶
```

`reconcile` 内：

```text
seen = id in ledgerTotals
previous = ledgerTotals[id]?.tokens ?? 0

若 alreadyCounted && !seen:
  ledgerTotals[id] = { tokens: tokens_used }
  不入桶
  return

isReset = tokens_used > 0 && tokens_used < previous
budget  = isReset ? tokens_used : max(0, tokens_used - previous)
explained = max(previous, jsonlAccounted)
unseen  = max(0, tokens_used - explained)
gap     = max(0, min(budget, unseen) - (jsonlAccounted > 0 ? 0 : jsonlEmitted))
若 gap > 0 且 timestamp 在窗口内 → accumulateBucket(..., CODEX_LEDGER_COLLECTOR)
ledgerTotals[id] = {
  tokens: isReset
    ? max(tokens_used, jsonlAccounted || jsonlEmitted)
    : max(tokens_used, previous + jsonlEmitted)
}
```

播种条件是「file cursor 已有 **且** 水位表里没有这个 threadId」。不能改成 `previous === 0`：新线程第一轮水位也是 0，那一轮必须正常报。

ledger 桶字段（移植 #160，不要省）：

- `model`：`thread.model`，空则 `unknown`
- `project`：`thread.cwd` 走 `resolveProjectName`，空则 `unknown`
- 时间：`recency_at_ms`，缺失回退 `created_at_ms`，都没有则不入桶但仍更新水位
- 拆分：整段 gap 记 `input_tokens`，其余 token 字段为 0（与 `warp.ts` 无拆分总量一致）
- `conversation_count`：该 thread 第一次入账或 reset 时为 1，之后增量补差为 0
- 不写 `local_metrics`（账本行不是请求证据，避免概览把补差算进请求数）
- `collector` 必须是 `codex-ledger`。`alignUnknownIntoDominant` 的分组键含 collector，漏了会和精确桶揉到一起

### 3. 接入点（`packages/core/src/parsers/codex.ts`）

`parseCodexIncremental` 流程改为：

1. 照旧扫 rollout JSONL → 精确桶（半小时、拆分不变）。
2. **建立 thread 归属**：rollout basename / `sessionId` ↔ ledger `threads.id` / `rollout_path`。  
   - 优先：`basename(thread.rollout_path)` 对上本轮或游标里的文件路径。  
   - 次选：session meta 的 id 与 `threads.id` 一致（若 Codex 一致；不一致则只靠 path）。
3. 每个 rollout 记两笔，账本加载后再按 basename 归到 thread：  
   - `jsonlEmitted`：`accumulateBucket` 成功写入的 `total_tokens`。  
   - `jsonlAccounted`：扫到的 `max(total_token_usage.total_tokens)`；没有 cumulative 时用本轮解析出的 delta 之和，**包含** `statsSince` 之前 `continue` 的、fork 重放跳过的。不要为了这个去重读历史文件。  
   - 本轮因 inode/offset 未变而整文件 `continue` 的：两笔都是 0。
4. 调 `loadCodexLedgerThreads` + 对每个 thread `reconcileCodexLedgerThread`。
5. `alreadyCounted` = rollout basename 出现在 `cursors.codex.files` 的 key 里（含已删但游标还在的路径）。`countedRolloutNames` 不再用来静默跳过；它只决定要不要做一次性播种。
6. 无 JSONL 贡献、且没有 file cursor 的 thread：`jsonlContributed = 0` 且不播种 → 全额 gap（「安装前已删」主场景）。

**mtime 跳过时仍要计入本轮 JSONL。** 账本文件 mtime 没变就可以不重读 sqlite，但本轮仍可能有精确桶增量（账本滞后）。这些 thread 即使没有新的 `tokens_used`，水位也要执行 `水位 += 本轮 JSONL 贡献`。否则下一轮账本追上时，`gap` 会把 JSONL 已经报过的增量再补一遍。

### 4. 边界约定（写进代码注释 + 测试）

| 情况 | 行为 |
|------|------|
| 升级：file cursor 已有、`ledgerTotals` 无此 thread | 播种水位 = `tokens_used`，本轮不入 ledger 桶。已有队列不变 |
| 文件仍在，lifetime 里有 `statsSince` 之前的量 | 精确桶与今天相同；这些量算进 `jsonlAccounted`，不进 ledger 桶 |
| 文件仍在，`tokens_used` 大于文件 lifetime | 只补这个尾差；已入桶的行不动 |
| 账本滞后于本轮 JSONL（`tokens_used` &lt; 水位 + 本轮贡献） | `gap = 0`；水位升到 `水位 + 本轮 JSONL 贡献`，不是停在 `tokens_used` |
| 下一轮账本追上先前的 JSONL 超前 | `budget` 被抬高后的水位吃掉，不再补那一段 |
| 先 JSONL 采完再删文件 | 水位已覆盖当时已报总量；再 reconcile 时 budget=0 |
| tokens_used 回缩 | reset：`budget = tokens_used`，水位 = `max(tokens_used, 本轮 JSONL 贡献)`，不用旧水位做 `max` |
| 无 `recency`/`created`，或落在 `statsSince` 外 | 跳过入桶，但仍更新水位，避免窗口扩大后双计 |
| 账本损坏 / 锁 | 不阻断 JSONL；返回 error 字符串即可。本轮 JSONL 贡献仍要加进已有水位 |
| 同一 thread 出现在多个 `state_*.sqlite` | 只认 schema 版本号最大的那一个库，避免两份库各补一次 |

### 5. Changeset

`.changeset/codex-ledger-authority.md`：用户可见文案强调「总量以 Codex 线程账本为准；有历史文件时仍按文件拆分，缺口由账本补齐」。

### 6. 不改

- Dashboard / Desktop renderer UI（可选 follow-up：标注 `codex-ledger` 估算区间）
- 上传事件映射：沿用现有 `collector` 字段即可
- 其它 parser

---

## 怎么验证

### 单元测试（`packages/core/test/codex-ledger.test.ts`）

在 #160 用例基础上改断言语义，并新增：

1. **已删无游标**：只出 `codex-ledger` 桶，tokens = `tokens_used`。
2. **同一轮文件仍在**：精确桶与不接账本时一致。`tokens_used` 等于文件 lifetime 时无 ledger 桶；只大于文件 lifetime 时补尾差。
3. **先采后删**：第二轮 buckets 为空；`ledgerTotals` 已对齐。
4. **权威补差**：无文件 lifetime（已删）时 ledger=1000、本轮入桶 0 → ledger 桶 +1000。有文件且 lifetime=600、ledger=1000、本轮入桶 600 → ledger 桶 +400；水位=1000。
4b. **窗口外不回灌**：文件 lifetime=10000，其中 8000 早于 `statsSince` 未入桶，本轮入桶 2000，ledger=10000 → 无 ledger 桶，精确桶仍是 2000，水位=10000。
5. **只报一次 + 增长**：不变再扫 events=0；`tokens_used` 增大只报增量。
6. **窗口外**：不入桶但写水位。
7. **时间戳回退 / 坏库 / 无 Codex**：与 #160 相同期望。
8. **上传映射**：`bucketToIngestEvent` 带上 `codex-ledger` collector。
9. **升级播种**：`files` 里已有该 rollout、`ledgerTotals` 没有这条、本轮 JSONL 贡献 0（offset 已到 EOF）→ buckets 无 ledger 行，水位被种成 `tokens_used`。之后 ledger 再涨、JSONL 只贡献一部分时，只补差额。
10. **JSONL 超前后账本追上**：本轮 JSONL 1000、ledger 994 → 无 ledger 桶，水位=1000。下一轮 ledger=1000、JSONL 贡献 0 → 仍无 ledger 桶。若下一轮 ledger=1080 且本轮 JSONL 又贡献 50 → ledger 桶 +30，水位=1080。
11. **mtime 未变**：sqlite 不重读，但本轮 JSONL 有增量 → 水位加上该增量；之后账本 mtime 变化、`tokens_used` 只追上这段增量时 gap=0。

跑：

```bash
pnpm --filter @juejin-opensource/jusage-core exec tsc --noEmit
pnpm --filter @juejin-opensource/jusage-core exec node --test test/codex-ledger.test.ts
pnpm --filter @juejin-opensource/jusage-core test
```

（忽略与本改动无关的既有 `runtime-pid` 失败，若环境无 `ps`。）

### 本机对照（有 Codex 数据时）

1. 备份 `~/.ai-usage/cursors.json`。
2. 在临时配置 / 空 cursors 下跑一次 sync（或调用 `parseCodexIncremental`）。
3. 对比 `state_*.sqlite`：`history_mode=legacy` 且 rollout 不存在的线程，面板/队列里应能看到对应总量（半小时落在 `recency_at_ms`）。
4. 抽样仍存在的 rollout：精确桶 + ledger 补差 ≤ 该 thread 的 `tokens_used`（允许账本略滞后时精确路径单独偏大——见边界表）。
5. 再跑一轮 sync：无新活动时不应重复累加。

### CI

PR 目标 `main`；ubuntu / macOS / windows 构建测试全绿。

---

## 实现顺序

1. 从 `main` 切 `fix/cli/codex-ledger-authority`
2. 落地 / 移植账本读写 + 类型字段
3. 实现 `reconcile` 权威公式；改 `parseCodexIncremental` 接线
4. 测试按上表改满
5. changeset
6. 自测通过后开 PR；若 #160 仍 open，在 PR 正文写明 supersede 关系并 @ 作者

---

## 完成标准

- [ ] 无 rollout、且游标从未见过的历史线程能按账本恢复总量
- [ ] 已有 file cursor 的线程升级后不把 lifetime 再记一遍；无账本时 buckets / 游标与现在一致
- [ ] 有 rollout 时不双计；窗口外用量不回灌；缺口只补文件里没有的尾差；JSONL 超前不会在账本追上时再补
- [ ] 游标增量：静止会话多轮 sync 不重复累加
- [ ] core 相关单测通过；changeset 已加
- [ ] PR 说明含精度损失（无 I/O/cache 拆分、时间归 `recency` 半小时），并写明 supersede #160
