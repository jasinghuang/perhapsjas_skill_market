# 迁移说明（v2 行为变化）

本次优化（2026-11）有意改变了以下默认行为。旧命令如果依赖这些行为，需要按
下表调整；其余参数与产物命名保持兼容。

| 变化 | 旧行为 | 新行为 | 迁移 |
| --- | --- | --- | --- |
| 时间模式 | 先压缩到字幕槽位、再溢出空档 | `--timing-mode natural`（默认）优先原速，允许结束时间延伸到下一组前（留安全间隔） | 想要旧的严格对齐：`--timing-mode strict_slot` |
| 放不下时 | 加速到上限后**截断**，任务仍报成功（退出码 0） | `--overflow-policy error`（默认）：标记 needs_attention、保存完整原生音频与恢复清单、退出码 1，不出伪完整成品 | 确实要有损成品：显式 `--overflow-policy truncate`（记录裁剪秒数，退出码 3） |
| 导出采样率 | 固定 24 kHz | 制作与导出默认 48000（模型原生 24 kHz 真实重采样） | 需要 24 kHz：`--master-sample-rate 24000` |
| dry-run | 配合 `--merge-plan` 时会写 `<out>.dub.srt` | 不写任何文件；预览计划用显式 `--write-plan`（写 `plan.json` + `plan.srt`） | 检查半句切断改看 `<out>.plan.srt` 或正式运行后的 `<out>.dub.srt`（实际配音时间） |
| 覆盖成品 | 默认覆盖（ffmpeg `-y`） | 默认**拒绝**覆盖已有 `.dub.wav` / `.dub.mp4` | 显式 `--overwrite`，或换 `--out` |
| 裁剪退出码 | 截断只记 warning，退出码 0 | 显式 truncate 且实际裁剪 → `completed_with_warnings`，**退出码 3** | 上游脚本把 3 当「有损成功」处理，不要当普通成功 |
| 重试 | provider 内 3 次 × 引擎外 2 次（最多 6 次） | 统一预算：每组最多 `--max-attempts`（默认 3）次提交；提交后超时标记 `submission_unknown` 不自动重提 | — |
| 缓存 | 字符串拼接键；克隆按参考音频**路径** | 结构化键（SHA-256）；克隆按参考音频**内容哈希** | 旧缓存自动不命中（不删除）；同路径换过参考音频的任务请重跑一次以刷新缓存 |
| 块级字幕时间 | 复制计划窗口 | `dub.srt` 使用实际配音起止（natural 延长 / 变速后的真实结束时间） | — |
| 短音频判定 | < 0.2s 一律无效 | ≤ 4 字的极短语气词放宽到 0.05s | — |
| 静音豁免 | 50ms 内裁剪不算截断 | 仅 ≤ 1ms 取整修正；更长越界按 overflow 处理 | — |
| 产物 | 报告需 `--json-report` | `<out>.report.json` + `<out>.job.json` 默认生成（原子写入） | `--json-report` 仍可改报告路径 |
| 恢复 | 无 | `--resume <out>.job.json`：改单组文本只重合成该组；改时间窗 / 制作采样率复用全部原生音频 | — |
| 环境安装 | 在多个全局解释器间循环 pip（mac 用 `--break-system-packages`） | 专用 venv + 锁定依赖文件；只在 venv 里安装 | 已有可用的解释器仍直接复用；装新依赖只进 `~/.cache/video-tts/venv` |
| Windows 本地 | 可尝试选 local（必然失败） | 直接拒绝并提示在线 | — |

## 产物清单（新）

```text
<out>.dub.wav        配音整轨（master 采样率，默认 48 kHz）
<out>.dub.mp4        成片（有 --video 且未 --track-only；AAC 同采样率）
<out>.dub.srt        块级字幕（实际配音起止时间）
<out>.report.json    机器可读报告（schema v2）
<out>.job.json       恢复清单（--resume 入口）
<out>.plan.json      预览计划（--write-plan）
<out>.plan.srt       预览计划字幕（--write-plan）
segments/            逐组 wav（--keep-segments）
```

## 状态与退出码

状态：`planned / preparing / synthesizing / processing / exporting /
complete / completed_with_warnings / needs_attention / partial / failed /
cancelled / submission_unknown`。

- `0`：完整成功（含无内容裁剪的加速警告）。
- `1`：失败 / partial / needs_attention / submission_unknown / cancelled。
- `2`：参数、输入或计划错误。
- `3`：显式允许裁剪且实际发生内容裁剪（有损成品，不能当普通成功）。
