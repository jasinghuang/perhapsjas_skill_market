# audio-transcribe 转录进度显示（短设计）

日期：2026-11-07
状态：待确认

## 意图 / 为什么

转录 1 小时的视频时，现有脚本只在文件开始时打印 `[3/8] 文件名`，之后静默数分钟，用户无法判断任务是在正常跑、卡住还是快结束。希望转录过程中能持续看到「当前到哪、还剩多少」。

## 目标

- 每个文件开始时打印 `[i/N] 文件名（总时长 mm:ss）`
- 转录中每 ~2 秒打印一行：`42.1% 12:30 / 29:13`
- 完成时打印 `100.0% 29:13 / 29:13`
- 终端里实时可见；输出重定向到日志文件时也能看到历史进度行（换行而非 `\r` 覆盖）
- Mac（MLX-Whisper）和 Windows（Faster-Whisper）两个后端都支持

## 非目标

- 不弹出独立 Terminal 窗口
- 不改变转录结果、分段、输出格式
- 不做「预估进度」（必须是真实解码进度）

## 约束

- 不改 `mlx_whisper` 自身源码，只在本 skill 内适配；库内部若变更导致适配失效，必须静默回退到「无进度」，不能影响转录
- 不新增第三方依赖

## 方案对比

1. **拦截 mlx_whisper 内部的 tqdm 帧进度（选用）**
   - 库内部用 `with tqdm.tqdm(total=content_frames) as pbar`，每解码一个窗口调用 `pbar.update(segment_size)`；100 frames = 1 秒
   - 在 backend 调用期间临时替换 `tqdm.tqdm` 为轻量包装类，把帧数换算成秒并回调；结束后恢复
   - 真实进度、可算百分比、换行输出；约 40–60 行
2. `verbose=True` 打印逐段时间戳和文本
   - 改动 1 行，但只有时间戳没有百分比，长视频输出量大，且与 tqdm 进度条互斥
3. 起线程按墙钟打印 `elapsed / 预估总时长`
   - 不用改库，但进度是估算的，遇到慢机器或变速会明显不准，违背「让用户知道真实进度」的目的

选 1：只有它能同时给出准确百分比、当前/总时长，并且在日志里可读。

## 设计

- `skill_main.transcribe()` 增加 `show_progress=True` 参数，创建 `ProgressReporter(total_seconds, label)`，打印文件头并传给 backend
- 新增 `progress.py`：`ProgressReporter.update(seconds)` 按 2 秒节流打印 ` 42.1% 12:30 / 29:13`；`finish()` 打印 100%
- `mlx_backend.transcribe(audio_path, language, on_progress=None)`：调用 `mlx_whisper.transcribe` 前临时包装 `tqdm.tqdm`，`update(n)` 时以 `frames/100` 秒回调 `on_progress`；`finally` 恢复；任何异常回退为无进度
- `faster_whisper_backend.transcribe(..., on_progress=None)`：改为遍历 segment 生成器，按 `segment.end / info.duration` 回调
- CLI 增加 `--no-progress`（默认开启）；`--format/--output` 等行为不变

## 测试

- 单元测试 `tests/test_progress.py`：节流间隔、百分比与时间格式、100% 收尾、total 未知时不报错
- 冒烟：用 ffmpeg 生成 5 秒测试音频，分别跑通「有进度 / `--no-progress`」两条路径，确认 SRT 输出不变
- 兼容性：模拟 tqdm 包装失败，确认转录仍成功

## 留给实现者

- 进度行输出到 stdout 还是 stderr（当前脚本统一 stdout；跟随现状）
- 节流间隔是否做成常量/参数（先常量 2 秒）
- 是否在 `run.py` 透传 `--no-progress`（需要，参数解析在 skill_main）
