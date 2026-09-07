---
"@juejin-opensource/jusage-core": patch
---

修正 GPT-6 Astra 的定价：补上缓存读取（$1 / 百万 Token）与缓存写入（$12.5 / 百万 Token）单价，命中缓存的输入 Token 不再按 0 计费，Codex 等来源的费用不再明显偏低。
