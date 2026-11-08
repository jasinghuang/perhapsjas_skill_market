# 命令示例（video-tts）

统一入口：`python3 <skill>/run.py …`（Windows 把 `python3` 换成 `python`；
`${CLAUDE_PLUGIN_ROOT}` 为插件根目录）。

```bash
SKILL=${CLAUDE_PLUGIN_ROOT}/skills/video-tts
```

## 典型流程（本地 + 语义合并）

```bash
# 1) 解析 SRT 后由宿主读全文生成语义合并计划（见主文档「语义合并」），
#    写到 <srt 同名>.merge-plan.json（可带 srt_sha256）
echo '{"groups": [[1, 2, 3], [4, 5], [6]], "srt_sha256": "<sha256>"}' > video.merge-plan.json

# 2) 预览合并组数与计划（不写文件）
python3 $SKILL/run.py --srt video.srt --provider local --voice Serena \
  --merge-plan video.merge-plan.json --dry-run

# 3) 保存预览计划（plan.json + plan.srt，检查半句切断用）
python3 $SKILL/run.py --srt video.srt --provider local --voice Serena \
  --merge-plan video.merge-plan.json --write-plan

# 4) 正式合成（默认 natural + 48 kHz；输出 video.dub.wav / .mp4 / .srt / 报告 / 任务清单）
python3 $SKILL/run.py --srt video.srt --video video.mp4 \
  --provider local --voice Serena \
  --instruct "用平稳的解说语气，语速稍慢" \
  --merge-plan video.merge-plan.json
```

## 只出配音轨 / 指定输出

```bash
python3 $SKILL/run.py --srt video.srt --provider local --voice Uncle_Fu --track-only
python3 $SKILL/run.py --srt video.srt --provider local --voice Serena --out s2   # s2.dub.wav / s2.dub.mp4
```

## 在线（费用确认后才加 `--yes`）

```bash
# 旗舰（支持 --instruct）
python3 $SKILL/run.py --srt video.srt --video video.mp4 \
  --provider online --voice longanlingxin_v3.1 --instruct "平稳解说" --yes

# Qwen-TTS
python3 $SKILL/run.py --srt video.srt --video video.mp4 \
  --provider online --voice Cherry --yes

# HTTP 兜底（bl 不可用且已有 DASHSCOPE_API_KEY；不要在命令里回显 key）
python3 $SKILL/run.py --srt video.srt --video video.mp4 \
  --provider online --voice Cherry --tts-endpoint <DashScope endpoint> --yes
```

## 克隆 / 设计音色

```bash
# Base 克隆（参考 3–10s 单说话人干净音频）
ffmpeg -ss 12 -t 6 -i video.mp4 -vn -ac 1 -ar 24000 ref.wav
python3 $SKILL/run.py --srt video.srt --provider local \
  --ref-audio ref.wav --ref-text "参考音频的准确文本" \
  --temperature 0.6 --top-p 0.9 --top-k 40 --seed 42 --track-only

# VoiceDesign 试音（跨段音色会漂，仅短视频）
python3 $SKILL/run.py --srt demo.srt --provider local --design "温暖、温柔的年轻女声"
```

## 严格同步 / 超长处理 / 恢复

```bash
# 口型或短句快节奏：严格守字幕边界（不借空档；放不下默认停止并保存恢复信息）
python3 $SKILL/run.py --srt video.srt --provider local --voice Serena \
  --timing-mode strict_slot --merge-plan plan.json

# 某组怎么都放不下：改合并边界或提高上限后从任务清单恢复（已合成组直接复用缓存）
python3 $SKILL/run.py --srt video.srt --provider local --voice Serena \
  --merge-plan plan_v2.json --max-speed 1.5 --resume video.job.json --overwrite

# 确实接受有损成品（退出码 3；报告记录裁剪秒数）
python3 $SKILL/run.py --srt video.srt --provider local --voice Serena \
  --overflow-policy truncate
```

## 诊断 / 其它

```bash
# 保留逐组片段（人工检查用；缓存与任务清单始终生成）
python3 $SKILL/run.py --srt video.srt --provider local --voice Serena --keep-segments

# 自定义报告路径 / 显式覆盖已有成品 / 只装在线依赖跑预览
python3 $SKILL/run.py --srt video.srt --provider online --voice Cherry --json-report r.json --yes
python3 $SKILL/run.py --srt video.srt --provider local --voice Serena --overwrite
python3 $SKILL/run.py --srt video.srt --provider online --voice Cherry --dry-run
```

## 上游链路

```text
video-downloader → audio-transcribe → text-refine → video-tts
```

本 skill 只消费**已经是中文**、时间轴与视频一致的 SRT（时间原点从视频 0 秒
起）。需要下载 / 转录 / 翻译纠错时，先走上游 skill。

## 触发示例

```text
用户: 把这个视频配上中文旁白，字幕是 video.srt
用户: 用本地音色给这条 SRT 配个音
用户: 帮我把英文字幕翻译成中文后配音（先走 text-refine，再走本 skill）
用户: 用百炼的龙安灵心给这个视频配音
用户: 只要配音轨，不用合成视频
```
