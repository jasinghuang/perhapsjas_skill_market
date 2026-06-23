---
name: bailian-tts
description: >
  阿里云百炼 CosyVoice AI 配音与音色管理。基于 bailian-cli(bl)和 DashScope 声音复刻 API。
  当用户要配音、朗读、TTS、语音合成、把文字读出来、给文本/稿件/字幕(SRT)配音、
  批量配音、声音复刻、克隆音色、复刻声音、声音设计、设计音色、自定义音色、
  音色管理、列出音色、查询音色、删除音色、复刻我的声音时触发。
  合成支持文本/文件/SRT/segments 清单,可选风格控制(温柔/激昂/沉稳)。
  音色支持 64 个系统音色 + 声音复刻(10-20s 样本) + 声音设计(文本描述)。
  每次合成前用 AskUserQuestion 询问音色和格式;复刻/设计前收集参数。
  产出 mp3(默认)/wav/pcm/opus。本地未鉴权时引导用户 `bl auth login`。
---

# Bailian TTS — 阿里云百炼 AI 配音

基于阿里云百炼 CosyVoice。合成走 `bl` CLI,音色管理(复刻/设计/CRUD)走 DashScope
RESTful API(`bl` 未封装这部分)。所有命令经 `skill_main.py` 入口。

## 步骤 0:环境检查

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py check
```

失败则按提示修复:
- 缺 requests → `pip install requests`
- bl 未鉴权 → `bl auth login --api-key sk-...`
- 缺 API Key → `export DASHSCOPE_API_KEY=sk-...`(或先 `bl auth login`,本 skill 会从 `~/.bailian/config.json` 读)

## 意图分流

| 用户说什么 | 命令 |
|------------|------|
| 配音/朗读/把这段读出来 | `synth` |
| 给清单/segments 批量配音 | `batch` |
| 给字幕(SRT)配音 | `srt` |
| 复刻我的声音/克隆音色(给样本) | `clone` |
| 设计一个音色(给描述) | `design` |
| 有哪些音色/系统音色 | `voices` |
| 列出/查询/删除/管理已有自定义音色 | `list` / `query` / `delete` / `update` |

## 配音工作流(synth / batch / srt)

**每次配音前,用 AskUserQuestion 询问**(用户已在指令里指定的则跳过对应项):

```
AskUserQuestion({
  questions: [
    {
      header: "选择音色",
      question: "用哪个音色配音?",
      options: [
        // 先跑 `voices --refresh` 拿到当前系统音色;再从 voices.json 读
        // 系统音色按语言分组 + 自定义音色单列(从 list 命令或 voices.json 的 custom_voices)
        {"label": "龙小淳(知性女声,中文)", "value": "longxiaochun_v3"},
        {"label": "龙橙(智慧青年男,中文)", "value": "longcheng_v3"},
        {"label": "loongabby(美式英文女)", "value": "loongabby_v3"},
        {"label": "龙老铁(东北直率男)", "value": "longlaotie_v3"}
        // ...更多见 references/voices.md,或让用户 `voices --language X` 筛选
      ]
    },
    {
      header: "格式与语速",
      question: "输出格式和语速?",
      options: [
        {"label": "mp3,正常语速", "value": "mp3"},
        {"label": "mp3,慢速", "value": "mp3::0.85"},
        {"label": "mp3,快速", "value": "mp3::1.2"},
        {"label": "wav(无损)", "value": "wav"}
      ]
    }
  ]
})
```

语速选项含 `::` 的,拆成 `--format` + `--rate`。

> **关于风格控制(`--instruction`)**:CosyVoice 系统音色(`cosyvoice-v3-flash`)**不支持** `--instruction`,传了会报 `Engine error 428`。系统音色只能用 `--rate`(0.5-2.0)/`--pitch`/`--volume` 控节奏与音调。需要自然语言风格控制("用温柔的语气")请用支持 instruct 的模型(如 `qwen3-tts-instruct-flash`,需另行接入,非本 skill 默认)。

然后执行:

```bash
# 单段
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py synth \
  --text "..." --voice <id> --out output.mp3
# 批量(清单 JSON: [{"id":"x","text":"..."}, ...];也兼容 web-video-presentation 的 [{"chapter","step","text"}])
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py batch \
  --input segments.json --voice <id> --out-dir audio/
# SRT(v1 逐条朗读,不对齐时间轴;manifest 含时间码供 v2 用)
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py srt \
  --srt subtitle.srt --voice <id> --out-dir audio/
```

**target_model 自动配对**:系统音色自动用 `cosyvoice-v3-flash`;自定义(复刻/设计)音色自动用其 `target_model`,用户无需记配对。

## 声音复刻工作流(clone)

⚠️ 复刻需消耗 1 个音色配额(共 1000,一年未用自动清理;CRUD 免费,仅合成计费)。

收集:
- `prefix`:音色名前缀(仅数字+小写字母,<10 字符)
- `target_model`:默认 `cosyvoice-v3.5-plus`(质量优先);低成本可选 `cosyvoice-v3.5-flash`
- 音频来源:`--audio <本地路径>` 或 `--url <公网URL>`
- 样本要求:10-20s、清晰无噪音、单声道、WAV 优于 MP3

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py clone \
  --audio sample.wav --prefix myvoice --target-model cosyvoice-v3.5-plus
# 或直传公网 URL(免去上传步骤)
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py clone \
  --url https://example.com/sample.wav --prefix myvoice
```

执行后告知用户轮询进度(约 10-60s)。本地音频会先 `bl file upload` 上传;
若上传 URL 不可用于复刻,提示用户改用公网 URL 或 OSS。成功后用新音色合成一句试听。

## 声音设计工作流(design)

协助用户写 `voice_prompt`,模板:**性别** + **年龄段** + **音色质感** + **语速** + **适用场景**。
例:"沉稳的中年男性播音员,音色低沉浑厚,富有磁性,语速平稳,适合纪录片解说"。

收集:`--prompt`、`--preview-text`(试听文本)、`--prefix`。

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py design \
  --prompt "沉稳的中年男性播音员,音色低沉浑厚,语速平稳,适合纪录片解说" \
  --preview-text "大家好,欢迎收听" \
  --prefix announcer --play
```

`--play` 播放预览(macOS afplay / 其他 ffplay)。满意则保留(已入库),
不满意调整 prompt 重新 design。⚠️ 每次 design 占 1 个音色位。

## 音色库管理

```bash
# 系统音色(免费,缓存到 voices.json)
python .../skill_main.py voices --refresh           # 重新拉取 64 个系统音色
python .../skill_main.py voices --language 英文      # 按语言筛选

# 自定义音色 CRUD(直连 DashScope RESTful)
python .../skill_main.py list                        # 列出自定义音色
python .../skill_main.py query --voice <id>          # 查详情/状态
python .../skill_main.py delete --voice <id>         # 删除(不可逆,交互确认;--yes 跳过)
python .../skill_main.py update --voice <id> --audio new.wav  # 换样本(仅复刻音色)
```

## 与其他 skill 配合

```
video-toolkit pipeline:
  video-downloader → audio-transcribe → text-refine → bailian-tts(srt) → srt-html(可选)

web-video-presentation:
  把本 skill 的 bailian.sh 复制进 presentation/scripts/tts-providers/bailian.sh
  → PRESENTATION_TTS=bailian npm run synthesize-audio
  (narrations.ts → segments.json → CosyVoice 合成)
```

完整系统音色列表见 [references/voices.md](./references/voices.md)(或运行 `voices --refresh` 拉取最新)。
