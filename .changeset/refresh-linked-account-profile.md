---
"@juejin-opensource/jusage-core": patch
---

修复 Desktop 和 CLI 设置中的关联账号头像、昵称长期不更新的问题，读取账号配置时在后台刷新资料且不阻塞接口，网络异常时保留已有信息。
