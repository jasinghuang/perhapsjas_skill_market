# 模型能力与配音优化（video-tts）

## 模型表

| 用途 | 默认模型 | 说明 |
| --- | --- | --- |
| 本地预设音色 | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16` | 9 音色 + `--instruct` |
| 本地自由音色设计 | `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16` | `--design` 描述生成音色 |
| 本地参考克隆 | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16` | `--ref-audio` / `--ref-text` |
| 在线旗舰 | `qwen-audio-3.1-tts-plus` | 4 个 v3.1 音色，支持 `--instruct` |
| 在线其他 | `qwen3-tts-flash` | 12 音色，不支持 `--instruct` |

规则：不因性能不足自动换 0.6B / 其他模型 / 在线 provider。音色与模型的
互斥校验在 CLI 参数阶段完成（退出码 2）：`--voice` 不能配 VoiceDesign /
Base 模型；`--design` 只能配 VoiceDesign；`--ref-audio` 只能配 Base 族；
在线 `--model` 只能重述所选音色组的模型。新量化配置需独立验证后开放。

原生采样率：Qwen3-TTS 语音 tokenizer 输出 24000 Hz（[官方配置](
https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice/blob/main/speech_tokenizer/config.json)）。
skill 统一在制作层升到 48 kHz（真实重采样，不是改文件头）；provider 采样率
以实际输出元数据为准，未来 48 kHz 模型可直接接入。

## 在线配音优化（百炼）

- `--rate` / `--pitch` / `--volume`：仅在线生效（0.5–2.0 / 0.5–2.0 / 0–100）。
- `--seed`：固定在线采样，帮助跨段稳定；同一 seed + 文本 + 音色更易复现。
- `--instruct`：仅旗舰组；可同时指定语种、语速、情绪、角色，例
  `"请用粤语说，语速稍慢，语气温柔"`。Qwen-TTS 组会忽略并警告。
- 情感 / 拟声标签：旗舰组支持 `[excited]`、`[sad]`、`[laughing]` 等直接写进
  文本；Qwen-TTS 组不支持。
- `--enable-ssml`：旗舰组可用 `<break time="300ms"/>` 等控制停顿；provider
  自动包裹 `<speak>`（已包裹不重复）。普通文本不要默认开启。
- `--lang`：旗舰组走 `language_hints`，Qwen-TTS 走 `language_type`；粤语
  音色不发送语言字段。
- `--hotfix-file`：专名发音纠正 / 文本替换，仅旗舰组；强制 HTTP 兜底，需
  `DASHSCOPE_API_KEY` + `--tts-endpoint`：

  ```json
  {"pronunciation": [{"重庆": "chong2 qing4"}], "replace": [{"今天": "金天"}]}
  ```

以上风格参数全部进入缓存键：改参数 = 重新合成。

## 本地一致性（采样波动）

本地 `generation_config` 默认 `temperature=0.9, top_p=1.0, top_k=50`，逐组
独立采样；长片会有情绪 / 节奏波动。压制手段按优先级：

```bash
--temperature 0.6 --top-p 0.9 --top-k 40 --seed 42
```

- temperature 降到 0.6–0.7 最有效；过低会变平。
- `--instruct` 全片同一句，不要逐组换风格。
- 超长 / 被加速的组是波动主要来源：优先精简这些组的文本，其次才调 `--max-speed`。

## Base 克隆（本地，音色最稳）

从用户媒体截 3–10 秒、单说话人、无背景音乐的参考：

```bash
ffmpeg -ss <start> -t <duration> -i <media> -vn -ac 1 -ar 24000 ref.wav
```

```bash
python3 <skill>/run.py --srt video.srt --provider local \
  --ref-audio ref.wav --ref-text "参考音频的原语言准确文本" \
  --temperature 0.6 --top-p 0.9 --top-k 40 --seed 42
```

- `--ref-text` 必须与参考音频逐字一致（原语言，不是翻译后的中文）；没有
  原文字幕时先对参考片段做 ASR。
- 与 `--voice` / `--design` / `--instruct` 互斥；不传 `--model` 自动用 Base。
- 缓存身份是**参考音频内容哈希**：同路径换内容会重新合成，同内容换路径可复用。
- Base 推理在 Apple Silicon / MLX 可用（不需要 CUDA；官方 finetuning 才需要）。
- 克隆只锁音色，不消除韵律波动；仍建议固定 seed + 较低 temperature。

## VoiceDesign（本地，自由描述）

`--design "温暖、温柔的年轻女声"`：自动加载 VoiceDesign 模型，与 `--voice` /
`--instruct` 互斥。跨段音色会漂，仅建议短视频试音。
