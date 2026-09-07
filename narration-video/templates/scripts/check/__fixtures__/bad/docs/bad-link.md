# 坏链接夹具（#15 文档死链负样本）

本文件被测试复制进临时仓库的 references/ 目录（定位保留文件名 bad-link.md）；
链接目标按 references/ 相对解析。

- [死链一](missing-target.md)——目标不存在 → 文档死链 warning
- [协议外链](https://example.com/docs) 豁免（对照项，不报）

角括号死链 <references/ghost.md> 也不存在 → warning
