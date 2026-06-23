# bailian-tts — 阿里云百炼 AI 配音 skill

基于阿里云百炼 CosyVoice 的 AI 配音与音色管理 skill。支持文本/稿件/SRT/segments
清单合成音频,以及系统音色查询、声音复刻、声音设计、自定义音色库 CRUD。合成入口
同时兼容 web-video-presentation 的 TTS provider 契约。

## 背景

video-toolkit 插件现有音视频 pipeline:

```
video-downloader → audio-transcribe → text-refine → srt-html
   下载视频          转录(ASR)         字幕校准       字幕动画HTML
```

覆盖下载、转录、字幕校准、字幕动画,但缺少"把文本/字幕变成语音"的能力,pipeline
断在"有字幕无声音"。

同时,web-video-presentation 已有一套 provider-agnostic 的 TTS 框架
(`templates/scripts/tts-providers/`,三函数契约,内置 minimax + openai 两个
provider),用于给网页视频的 narrations 合成口播音频。用户希望接入阿里云百炼
CosyVoice 作为新 provider,并在此基础上做一个独立的通用配音 skill。

本 skill 同时服务两个入口:

1. **独立配音工具** —— 给文本/稿件/SRT/segments → 产出配音音频
2. **web-video-presentation 的 bailian provider** —— 把 `bailian.sh` 复制进
   `tts-providers/`,让网页视频用 CosyVoice 配音

## 设计目标(v1)

- 支持四种输入:单段文本、文本文件、SRT 字幕(逐条)、segments JSON 清单(批量)
- 音色能力:查询系统音色、选择音色、声音复刻(给样本)、声音设计(给描述)、自定义音色库 CRUD
- 天然兼容 web-video-presentation 三函数契约(产出可独立使用的 `bailian.sh`)
- 串联 video-toolkit pipeline(吃 SRT,可接 text-refine 输出)

## 非目标(v1,留给 v2)

- **SRT 时间对齐** —— v1 逐条朗读各管各的,不按时间码调 `--rate` 贴合原轴(译制配音)。v2 通过 ASR 测时长 + 调速实现。
- **视频音轨合成** —— v1 只产出分段音频 + manifest,不自动把音频叠回视频。v2 再做。
- **多 speaker 分角色配音** —— 一个 SRT 里多人对话自动分配音色。

## 官方接口能力(设计基础)

### `bl` CLI 已封装

| 能力 | 命令 |
|------|------|
| 系统音色列表 | `bl speech synthesize --list-voices --model cosyvoice-v3-flash`(64 个系统音色) |
| 选择音色合成 | `bl speech synthesize --voice <id> ...` |
| 风格控制 | `--instruction "用温柔的语气"`、`--rate/--pitch/--volume`、`--enable-ssml` |
| 多格式输出 | `--format mp3\|wav\|pcm\|opus`、`--out <path>`、`--text-file <path>` |
| 文件上传 | `bl file upload <path>`(上传到 DashScope 临时存储,48h) |

### 必须直连 DashScope RESTful API(`bl` 未封装)

端点(音色管理全用这一个):

```
POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization
Header: Authorization: Bearer $DASHSCOPE_API_KEY
        Content-Type: application/json
Body:   { "model": "voice-enrollment", "input": { "action": "<action>", ... } }
```

| action | 作用 | 关键参数 |
|--------|------|----------|
| `create_voice`(复刻) | 给样本音频克隆音色 | `target_model`、`prefix`、`url`、`language_hints`、`max_prompt_audio_length`、`enable_preprocess` |
| `create_voice`(设计) | 给文本描述生成音色 | `target_model`、`prefix`、`voice_prompt`、`preview_text`、`language_hints` |
| `list_voice` | 分页列自定义音色 | `prefix`、`page_index`、`page_size` |
| `query_voice` | 查单个音色详情/状态 | `voice_id` |
| `update_voice` | 换音频更新复刻音色 | `voice_id`、`url` |
| `delete_voice` | 删除音色(不可逆) | `voice_id` |

### 关键约束(直接影响设计)

1. **`target_model` 一致性强耦合** —— 复刻/设计时声明的 `target_model`(如 `cosyvoice-v3.5-plus`),合成时 `--model` 必须完全一致,否则失败。系统音色走 `cosyvoice-v3-flash`,自定义音色走 `cosyvoice-v3.5-plus/flash`。音色和模型必须配对管理(见 voices.json)。
2. **复刻音频要公网 URL** —— 不能直接传本地文件。本地音频需先上传(`bl file upload` 临时存 48h,或 OSS)拿 URL。
3. **复刻是异步的** —— `create_voice` 返回 `voice_id` 后要轮询 `query_voice` 直到 `status=OK`(经历 `DEPLOYING`→`OK`/`UNDEPLOYED`)。
4. **配额与计费** —— 1000 个音色上限,一年未用自动清理;CRUD 免费,仅合成按字符计费。
5. **prefix 限制** —— 仅数字+小写字母,<10 字符;`voice_id` 格式为 `<target_model>-<prefix>-<hash>`。

## 目录结构

```
plugins/video-toolkit/skills/bailian-tts/
├── SKILL.md              # agent 工作流引导 + AskUserQuestion 音色选择
├── skill_main.py         # 统一入口(子命令式),风格对齐 srt-html/skill_main.py
├── bailian.sh            # web-video-presentation 三函数契约 provider
├── voices.json           # 音色速查表(系统音色缓存 + 自定义音色 target_model 映射)
├── requirements.txt      # requests
├── manifest.json         # skill 元数据(对齐 web-video-presentation/manifest.json)
└── references/
    └── voices.md         # 系统音色完整列表(按语言分组)
```

调用约定(对齐 srt-html):

```
python ${CLAUDE_PLUGIN_ROOT}/skills/bailian-tts/skill_main.py <command> [options]
```

## `skill_main.py` CLI 接口

子命令式入口。合成类调 `bl`,音色管理类直连 RESTful。

### 合成类

#### `synth` — 单段合成

```
--text <str> | --text-file <path>   # 二选一,必选
--voice <id>                         # 必填
--model <id>                         # 默认 cosyvoice-v3-flash;自定义音色自动从 voices.json 取 target_model
--out <path>                         # 默认 ./output.mp3
--format mp3|wav|pcm|opus            # 默认 mp3
--rate 0.5-2.0  --pitch 0.5-2.0  --volume 0-100
--instruction <str>                  # 自然语言风格控制("用温柔的语气")
--language zh|en|ja|...
```

实现:`bl speech synthesize` 透传参数。

#### `batch` — 多段合成

```
--input <path>     # JSON 清单 [{"id":"x","text":"...","voice":"<可选>"}, ...]
                   # 也兼容 web-video-presentation 的 audio-segments.json
                   # ([{chapter,step,text}],自动用 "<chapter>/<step>" 作 id)
--voice <id>       # 默认音色(清单未指定 voice 的条目用它)
--out-dir <path>   # 默认 ./audio/
--concurrent <n>   # 默认 1(CosyVoice 可能限流,保守)
--format mp3
```

实现:逐条 synth,跳过已存在,产出 `<out-dir>/<id>.mp3` + `manifest.json`(记录 id→文件、voice、耗时)。单段失败不终止。

#### `srt` — SRT 逐条配音(v1 不对齐)

```
--srt <path>
--voice <id>
--out-dir <path>     # 默认 ./audio/
--format mp3
--merge              # 可选:合并为单个音频;默认逐条产出
```

实现:解析 SRT → 逐条 synth → `<out-dir>/<index>.mp3` + `manifest.json`(含 start/end 时间码,为 v2 时间对齐预留,但 v1 不调 rate 贴合)。

### 音色管理类(直连 RESTful)

#### `voices` — 列系统音色

```
--model cosyvoice-v3-flash
--language zh|en|ja|...    # 筛选
--refresh                  # 重新从 bl 拉取并更新 voices.json 缓存
```

实现:默认读 voices.json 缓存;`--refresh` 调 `bl --list-voices`。表格输出(id / name / desc / lang)。

#### `clone` — 声音复刻

```
--audio <path> | --url <url>          # 二选一
--prefix <str>                         # 必填,数字+小写字母 <10 字符
--target-model cosyvoice-v3.5-plus     # 必填
--language zh                          # language_hints
--preprocess                           # enable_preprocess(有背景噪音时开)
--max-length 20                        # max_prompt_audio_length,秒
```

实现:`--audio` 本地 → 先 `bl file upload` 拿 URL(若返回 URL 不能用于复刻,提示改用 OSS 或 `--url`)→ `create_voice`(复刻)→ 轮询 `query_voice`(超时 5 分钟,间隔 10s)→ `OK` 则写入 voices.json;`UNDEPLOYED` 则报错。

#### `design` — 声音设计

```
--prompt <str>              # voice_prompt,音色描述(必填;SKILL.md 提供模板)
--preview-text <str>        # 试听文本(必填)
--prefix <str>              # 必填
--target-model cosyvoice-v3.5-plus
--language zh
--play                      # 生成后用 afplay/ffplay 播放预览
```

实现:`create_voice`(设计)→ 返回 `voice_id` + 预览音频(base64)→ 解码存 `<voice_id>_preview.wav` → `--play` 则播放 → 用户满意后交互确认写入 voices.json。

#### `list` / `query` / `delete` / `update`

```
list   [--prefix <str>] [--page-size 50]
query  --voice <id>
delete --voice <id> [--yes]          # 强制确认,不可逆
update --voice <id> --audio <path> | --url <url>
```

实现:直连对应 action。`delete` 同步删 voices.json 条目。

### `check` — 环境与鉴权检查

```
python skill_main.py check
```

检查:`bl` 在 PATH、`bl auth status` authenticated、`requests` 可用、API Key 可解析。SKILL.md 步骤 0 调用。

## `bailian.sh` provider(三函数契约)

独立文件,可直接复制到 `web-video-presentation/templates/scripts/tts-providers/bailian.sh`。

```bash
# Provider: Aliyun Bailian CosyVoice (via bl CLI)
# Voice:   pass cosyvoice voice id; default longxiaochun_v3 (龙小淳, 知性积极女)
# Auth:    bl auth login --api-key

tts_check() {
  command -v bl >/dev/null || { echo "✗ bl CLI not found" >&2; return 1; }
  bl auth status >/dev/null 2>&1 || { echo "✗ bl not authenticated" >&2; return 1; }
}

tts_install_help() {
  cat <<'EOF' >&2
Install & auth the Bailian CLI:
  npm install -g bailian-cli
  bl auth login --api-key sk-xxxxx
Or pick another provider:  PRESENTATION_TTS=<name> npm run synthesize-audio
EOF
}

tts_synthesize() {
  local text="$1" out="$2" voice="${3:-}"
  # 两分支处理 voice,避开 macOS bash 3.2 空数组坑(对齐 minimax.sh)
  if [[ -n "$voice" ]]; then
    bl speech synthesize --text "$text" --voice "$voice" --out "$out" --format mp3 >/dev/null 2>&1
  else
    voice="${BAILIAN_TTS_VOICE:-longxiaochun_v3}"
    bl speech synthesize --text "$text" --voice "$voice" --out "$out" --format mp3 >/dev/null 2>&1
  fi
}
```

遵守 provider 契约全部要点(见 web-video-presentation `tts-providers/README.md`):`set -e` 友好、静默成功/喧闹失败、mp3 输出、音色 fallback、不并发、不污染全局、macOS bash 3.2 兼容。

## `voices.json` 结构与 target_model 配对机制

```json
{
  "version": 1,
  "system_voices": {
    "cosyvoice-v3-flash": [
      {"id":"longxiaochun_v3","name":"龙小淳","desc":"知性积极女","lang":"中文/英文"}
    ]
  },
  "custom_voices": [
    {
      "voice_id":"cosyvoice-v3.5-plus-announcer-abc123",
      "prefix":"announcer",
      "target_model":"cosyvoice-v3.5-plus",
      "type":"clone",
      "voice_prompt":null,
      "resource_link":"https://...",
      "gmt_create":"2026-06-23 10:00:00",
      "status":"OK",
      "note":"用户备注(可选)"
    }
  ],
  "defaults": {
    "system_voice":"longxiaochun_v3",
    "target_model_for_custom":"cosyvoice-v3.5-plus"
  }
}
```

**配对机制(解决约束 1)**:`synth` 时,若 `--voice` 命中 `custom_voices[]`,自动用其 `target_model` 作为 `--model`(用户无需记配对);若命中 `system_voices`,用 `cosyvoice-v3-flash`;若都不命中且未显式传 `--model`,报错并提示需指定匹配的 `--model`。

`voices --refresh` 更新 `system_voices`;`clone / design / delete / update` 同步维护 `custom_voices`。

## 鉴权策略

- **合成**:走 `bl`,鉴权由 `~/.bailian/config.json` 自带(已通过 `bl auth login` 配置)。
- **音色管理**(`skill_main.py` 直连 RESTful):API Key 解析顺序:
  1. `DASHSCOPE_API_KEY` 环境变量
  2. 从 `bl` 的 config.json 读明文 key
  3. 都没有 → 报错并引导(`export DASHSCOPE_API_KEY=...` 或 `bl auth login`)
- `check` 子命令同时校验两条路径。

## SKILL.md 工作流(对齐 audio-transcribe 风格)

**frontmatter description 触发词**:配音、朗读、TTS、语音合成、读出来、声音复刻、克隆音色、复刻声音、设计音色、自定义音色、给字幕配音、音色管理、列出音色、删除音色。

**流程**:

1. 步骤 0:`check`。失败则给安装/鉴权引导。
2. 首次依赖检查:`pip install requests`(若缺)。
3. 意图分流:
   - 配音/朗读/读出来 → `synth` / `batch` / `srt`
   - 复刻/克隆/设计/管音色 → `clone` / `design` / `list` / `delete`
4. 配音前 `AskUserQuestion`(从 voices.json 读系统+自定义音色混排,标明 类型 / 语言 / 描述):
   - 问题 1:选音色(系统音色按语言分组,自定义音色单独列出带备注)
   - 问题 2:格式(mp3/wav)、是否加风格 `--instruction`(如"温柔/激昂/沉稳")
5. `clone` 工作流:收集 prefix + target_model + 音频来源 → 执行 → 轮询期间告知进度 → 成功后试听一句 → 入库。
6. `design` 工作流:agent 协助写 `voice_prompt`(模板:性别 + 年龄段 + 音色质感 + 语速 + 适用场景)→ 收集 preview_text + prefix → 设计 → 播放预览 → 满意则入库,不满意则调 prompt 重设计。

## 数据流

```
单段文本      ──synth──→ 1 个 mp3
文本文件      ──synth──→ 1 个 mp3(整篇)
segments.json ──batch──→ N 个 mp3 + manifest.json
SRT           ──srt───→ N 个 mp3 + manifest.json(含时间码)

video-toolkit pipeline 串联:
video-downloader → audio-transcribe → text-refine → bailian-tts(srt) → srt-html(可选)

web-video-presentation 接入:
narrations.ts → extract-narrations → audio-segments.json
  → 复制 bailian.sh 进 tts-providers/
  → PRESENTATION_TTS=bailian npm run synthesize-audio
```

## 错误处理

| 场景 | 处理 |
|------|------|
| bl 未装/未鉴权 | `check` 拦截,打印安装/鉴权指引 |
| `create_voice` API 失败 | 打印 HTTP 状态码 + 错误码 + message,不重试 |
| 轮询超时(>5min 仍 DEPLOYING) | 报超时,保留 voice_id,提示后续 `query` 查看 |
| 复刻音频上传后 URL 不可用 | 提示改用公网 URL(OSS 或 `--url` 直传) |
| `synth` 用自定义音色但 model 不匹配 | 从 voices.json 查 target_model 自动纠正;不在库则报错 |
| `delete` | 强制 `--yes` 或交互确认;不可逆,执行后同步删 voices.json |
| 合成单段失败 | 打印失败段,继续下一段(`batch`/`srt` 不因单段失败终止) |

## 依赖检查

| 依赖 | 用途 | 必需 |
|------|------|------|
| `bl`(bailian-cli) | 合成、系统音色列表、文件上传 | 是 |
| python3 | skill_main.py | 是 |
| `requests` | 直连 RESTful 音色管理 | 是 |
| `jq` | (provider 不依赖) | 否 |
| `ffmpeg` | 格式转换/测时长(v2 时间对齐用) | 否(v1 可选) |
| `afplay`/`ffplay` | design 预览试听 | 否 |

## 测试策略

### 单元测试(无 API 调用)

- `voices.json` 读写、schema 校验
- SRT 解析(标准 / 多行 / 空条目 / 时间戳重叠)
- `prefix` 合法性校验(数字 + 小写字母 < 10 字符)
- `target_model` 自动配对逻辑(系统 / 自定义 / 未知三种命中)

### 集成测试(手动,消耗少量配额)

- `check`:环境通过
- `voices --refresh`:系统音色拉取并缓存(免费)
- `synth --text "测试"`:产出 mp3(消耗少量字符)
- `clone --url <官方示例 cosyvoice-zeroshot-sample.wav>`:复刻 + 轮询 + 入库
- 用新克隆音色 `synth` 验证 target_model 配对

### provider 契约测试

```bash
source bailian.sh
tts_check && tts_synthesize "测试一下" /tmp/test.mp3 ""
afplay /tmp/test.mp3
```

### 不纳入自动化

- `design`:每次创建占音色位(配额 1000),手动验证
- `delete`:不可逆,手动

## v2 路线(非 v1 范围)

1. **SRT 时间对齐** —— 用 `bl speech recognize`(FunAudio-ASR)测每段合成音频实际时长 → 与字幕时间码比较 → 调 `--rate` 重合成贴合原轴(译制配音)。
2. **视频音轨合成** —— 把分段音频按时间码叠回原视频(ffmpeg),产出带新配音的视频。
3. **多 speaker 分角色** —— SRT 标注说话人 → 自动分配不同音色。
4. **音色试听库** —— `design` 多次生成 + 本地缓存预览,挑最满意的入库。

## 默认决策(实现时可调)

- 默认系统音色:`longxiaochun_v3`(龙小淳,知性积极女)
- `batch` 并发默认 1(CosyVoice 可能限流,保守)
- `design` 时 agent 协助写 `voice_prompt`(提供模板),而非只接受用户原话
- 默认 target_model for 自定义音色:`cosyvoice-v3.5-plus`(质量优先;`flash` 作为低成本选项)
