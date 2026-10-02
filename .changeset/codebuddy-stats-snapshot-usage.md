---
"@juejin-opensource/jusage-core": patch
"@juejin-opensource/jusage": patch
"@juejin-opensource/jusage-desktop": patch
---

修复 CodeBuddy 用量统计明显偏低的问题：一条回复如果经过多轮工具调用，此前只统计了最后一轮调用的 token，现在按整轮累计统计，与 CodeBuddy 界面显示的用量一致。已经统计过的历史不会重复计算。CLI 与 Desktop 使用同一份采集逻辑。
