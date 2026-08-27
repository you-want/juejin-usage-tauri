# @juejin-opensource/jusage

## 0.1.5

### Patch Changes

- 桌面端在线时 CLI 进入观察模式，不抢占 sync/上报 runtime。
- Updated dependencies
  - @juejin-opensource/jusage-core@0.1.5

## 0.1.4

### Patch Changes

- 定价覆盖层启动时等待首次拉取并落盘缓存，刷新后重建本地聚合缓存。
- Updated dependencies
  - @juejin-opensource/jusage-core@0.1.4

## 0.1.3

### Patch Changes

- 拿不到 `tud-sync-status` 水位时，历史补报按本地 90 天窗继续上报，避免队列一直 hold。
- Updated dependencies
  - @juejin-opensource/jusage-core@0.1.3

## 0.1.2

### Patch Changes

- 本地采集与上报窗口扩到 90 天；历史补报在拿不到服务端地板时留队，避免误标已上报。
- Updated dependencies
  - @juejin-opensource/jusage-core@0.1.2

## 0.1.1

### Patch Changes

- 改进 `jusage service start` 的启动可靠性，修复 PID 时间戳误判和写盘时序问题，并增加 `/health` 兜底检查。
- 新增排行榜相关能力，便于在本地端配合最新看板功能使用。
- 升级内部依赖至 `@juejin-opensource/jusage-core@0.1.1`，并合并 beta 阶段的稳定性修复后发布正式版。

## 0.1.1-beta.9

### Patch Changes

- fix: `jusage service start` 不再因 PID 时间戳误判 / 写盘过晚而报超时，并以 `/health` 作为就绪兜底
- fix: cli 启动检测失败问题
- Updated dependencies
- Updated dependencies
  - @juejin-opensource/jusage-core@0.1.1-beta.9

## 0.1.1-beta.8

### Patch Changes

- fix: some bugs
- Updated dependencies
  - @juejin-opensource/tud-core@0.1.1-beta.8

## 0.1.1-beta.7

### Patch Changes

- fix: some bugs
- Updated dependencies
  - @juejin-opensource/tud-core@0.1.1-beta.7

## 0.1.1-beta.6

### Patch Changes

- fix: reefresh
- Updated dependencies
  - @juejin-opensource/tud-core@0.1.1-beta.6

## 0.1.1-beta.5

### Patch Changes

- feat: ranks
- Updated dependencies
  - @juejin-opensource/tud-core@0.1.1-beta.5

## 0.1.1-beta.4

### Patch Changes

- chore: update
- Updated dependencies
  - @juejin-opensource/tud-core@0.1.1-beta.4

## 0.1.1-beta.3

### Patch Changes

- fix: some bugs
- Updated dependencies
  - @juejin-opensource/tud-core@0.1.1-beta.3

## 0.1.1-beta.2

### Patch Changes

- fix: some bugs
- Updated dependencies
  - @juejin-opensource/tud-core@0.1.1-beta.2

## 0.1.1-beta.1

### Patch Changes

- chore: init
- Updated dependencies
  - @juejin-opensource/tud-core@0.1.1-beta.1

## 0.1.1-beta.0

### Patch Changes

- chore: init
- Updated dependencies
  - @juejin-opensource/tud-core@0.1.1-beta.0
