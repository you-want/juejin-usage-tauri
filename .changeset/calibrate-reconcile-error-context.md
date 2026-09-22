---
"@juejin-opensource/jusage-core": patch
"@juejin-opensource/jusage-desktop": patch
---

数据校对（「以本地为准覆盖」）失败时，报错信息现在会带上失败的具体日期、本地事件数与请求的服务端窗口，便于定位是哪一天被服务端拒绝（如 HTTP 422 INVALID_USAGE_EVENT，详见 #178）。
