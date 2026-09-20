---
"@juejin-opensource/jusage-core": patch
"@juejin-opensource/jusage-desktop": patch
---

修复 zcode 来源的 Token 合计口径：ZCode 上报的 `computed_total_tokens`（= 输入+输出）未计入 reasoning，导致本地面板的「总 Token」与「其它」构成比云端少算 reasoning 部分（面板与云端「其它」对不上，数据校对因只比对五元组明细而无法发现）。现在 zcode 桶的 `total_tokens` 对齐其他解析器的五项和惯例，面板聚合改为按五项明细求和并自愈存量 zcode 桶（详见 #181）。
