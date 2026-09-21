# 常见问题

### 本地 90 天用量和线上对不上，怎么强制同步？

需要 Node.js 20+。桌面端和 CLI 共用 `~/.ai-usage`。

```bash
npx @juejin-opensource/jusage@latest upload --force --reconcile
```

### 数据校对提示 `reconcile failed: HTTP 422 INVALID_USAGE_EVENT`？

已知服务端问题（详见 #178）：`/v1/model-usage/reconcile` 在校验事件前会先把 `occurred_at` 做 +8 小时归一化，再检查是否落在目标日期的覆盖窗口内，导致北京时间 16:00 及以后的事件全部被拒。含晚间用量的日期基本必然校准失败，普通自动同步（ingest）不受影响。

报错信息里已附上失败的具体日期与窗口，便于定位和反馈。服务端修复前无法完成「以本地为准覆盖」，可先跳过校对，等修复后在「设置 → 云端同步 → 数据校对」重试。

### 客户端提示 `LOCAL_RUNTIME_NOT_READY` 怎么办？

关窗口不会退出（会留在托盘）。先从托盘点 **退出**，再按下面的 case 排查。

**Case 1：刚启动 / 刚自动更新**

等 2 秒，从托盘退出后重开。不要在更新过程中刷新。

- macOS：菜单栏图标 → 右键 **退出**
- Windows：任务栏右下角托盘（可能在 `^` 里）→ **退出**

**Case 2：同时开着 CLI**

```bash
npx @juejin-opensource/jusage@latest service stop
```

然后重开桌面端。

**Case 3：`config.json` 格式坏了（parse 失败）**

```bash
# macOS / Linux
python3 -m json.tool ~/.ai-usage/config.json
# 修不好则备份后让应用重建（需重新登录）
mv ~/.ai-usage/config.json ~/.ai-usage/config.json.bak
```

```powershell
# Windows
python -m json.tool $env:USERPROFILE\.ai-usage\config.json
Move-Item $env:USERPROFILE\.ai-usage\config.json $env:USERPROFILE\.ai-usage\config.json.bak
```

修好或改名后，托盘退出再打开。

**Case 4：残留进程 / 锁文件**

```bash
# macOS / Linux
killall "Juejin Usage" 2>/dev/null; pkill -f jusage || true
rm -f ~/.ai-usage/tud.pid
```

```powershell
# Windows（任务管理器结束 Juejin Usage / jusage 后）
Remove-Item $env:USERPROFILE\.ai-usage\tud.pid -ErrorAction SilentlyContinue
```

然后重开。日志：macOS / Linux `~/.ai-usage/logs/`，Windows `%USERPROFILE%\.ai-usage\logs\`。

### Linux 上 `jusage service start` 失败？

CLI 后台服务在 Linux 上走 systemd 用户服务。若提示 `systemctl --user` 不可用，可改用前台运行：

```bash
jusage start
```

WSL 需先启用 systemd。在 `/etc/wsl.conf` 写入：

```
[boot]
systemd=true
```

然后执行 `wsl --shutdown`，再打开发行版。

排障：

```bash
journalctl --user -u jusage
# 以及
less ~/.ai-usage/logs/daemon.log
```
