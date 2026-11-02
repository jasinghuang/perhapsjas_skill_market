# 合法相对链接夹具（#15 false-positive）

本文件被测试复制进临时仓库的 references/ 目录，链接目标均真实存在：

- [真实目标](real-target.md)——目标存在 → 不报
- [子目录文件](sub/README.md)——目标存在 → 不报
- [目录目标](sub)——目录存在 → 不报（v1 只查路径存在性）
- [锚点](#section)——纯锚点 → 不报
- [协议外链](https://example.com/docs)——协议链接 → 不报
- 角括号 <sub/README.md>——目标存在 → 不报
