# video-tts 视频配音 Skill 设计

- 日期：2026-11-06
- 状态：待实现
- 目标读者：实现这个 skill 的工程师

## 1. 背景与意图

用户要把外语视频做成中文配音。上游链路已经存在：

```
外语视频 → audio-transcribe(ASR) → text-refine(翻译/校准) → 中文 SRT
```

本 skill 负责最后一环：**按中文 SRT 逐条合成配音，严格贴住原时间轴，替换视频音轨，输出成品 mp4**。

提供两种配音方案，用户每次调用开始时自己选：

- **本地**：开源 Qwen3-TTS-12Hz-1.7B（MLX），免费、离线、9 个固定音色。
- **在线**：阿里云百炼，首选 `qwen-audio-3.1-tts-plus` 的 4 个 v3.1 旗舰音色；备选 `qwen3-tts-flash` 的 12 个精选音色（6 女 / 6 男，含粤语）。按 token 计费、需联网，但有 SSML / 指令控制 / 时间戳 / 声音复刻等更完整的能力。**通过 `bl` CLI 调用，复用其登录态，不需要把 API key 交给 skill。**

## 2. 目标 / 非目标 / 反目标

### 目标

- 每次调用开头先让用户选 **本地 / 在线**，再按所选方案选音色。
- **所有需要用户做选择的地方，一律用 `AskUserQuestion` 交互控件**；纯文本只用于展示信息（音色表、进度、报告），不用来提问或让用户回复"1/2/3"。
- 输入「视频 + 中文 SRT」或「仅中文 SRT」，输出配音轨；有视频时输出替换音轨后的成品 mp4。
- 每条 SRT 在自己的时间窗内完成，超长时在 ±15% 内用 atempo 压缩；放不下才升级处理并明确警告。
- 本地固定音色跨段一致；在线固定 voice 参数跨段一致。
- 本地模型只加载一次，整片逐条合成；两种方案都支持缓存与断点续跑。
- 本地保留 VoiceDesign 自定义音色模式（可选，不作为默认）。

### 非目标

- 不做 ASR、翻译、字幕校准（由上游 skill 负责）。
- 不做多角色 / 说话人分离。SRT 没有角色标签，全片单音色。
- 不做人声分离，不保留原片背景音乐。默认整轨替换。
- 不支持 Windows / Linux 的本地 MLX 方案；在线方案跨平台。
- 不做实时流式合成（在线也走非实时 HTTP 接口）。
- 不烧录 / 软封装字幕。

### 反目标（即使技术能跑通也算失败）

- 逐条调用本地 CLI，导致每条都重新加载模型。
- 音色逐段漂移。
- 配音越界压到下一句字幕。
- 失败、空音频或全静音时假装合成成功。
- 在线方案不提示费用就直接批量合成。

## 3. 已核实的技术事实（2026-11-06）

### 本地（MLX）

| 项目 | 事实 |
| --- | --- |
| 默认模型 | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16` |
| 可选模型 | `...-1.7B-VoiceDesign-bf16`、`...-0.6B-CustomVoice-bf16` |
| 运行库 | `mlx-audio >= 0.3.0` |
| 输出 | 24 kHz 单声道 wav |
| 调用 | `model.generate(text, voice=..., instruct=..., lang_code=...)` → 迭代 `GenerationResult(audio=mx.array, sample_rate)` |
| 模型类型 | CustomVoice 为 `custom_voice`；VoiceDesign 为 `voice_design` |
| `speed` 参数 | mlx-audio 明确「not directly supported yet」→ 语速一律用 ffmpeg atempo 后处理 |
| VoiceDesign 限制 | 无 speaker encoder、无 seed，跨调用音色会漂；只适合单条试音 |
| 语言代码 | `chinese, english, japanese, korean, german, french, russian, portuguese, spanish, italian`；Dylan 自动切北京话、Eric 自动切四川话 |
| 首次下载 | 1.7B bf16 约 3.4 GB；模型缓存在 `~/.cache/huggingface/hub` |
| 本机环境 | M3 Max / 36 GB；`mlx_audio` 未安装，模型未缓存；`ffmpeg` 需可用 |

### 在线（百炼）

| 项目 | 事实 |
| --- | --- |
| 首选模型 | `qwen-audio-3.1-tts-plus` |
| 首选调用方式 | `bl speech synthesize --text ... --model ... --voice ... --format wav --language zh --sample-rate 24000 --out <wav>`（`bl` 2.8+ 已验证参数透传） |
| 鉴权 | 复用 `bl` CLI 登录态：`bl auth status --output json` 为 `authenticated: true` 即可；凭据由 `bl` 存在 `~/.bailian/config.json`（0600），skill 不接收、不保存、不打印明文 key |
| 未登录时 | 运行 `bl auth login --console --no-browser`，捕获打印出的登录 URL，以可点击链接展示给用户；后台等待 CLI 回调，并轮询 `bl auth status` 直到 `authenticated: true`。超时后再让用户选「重新获取链接 / 重新登录 / 切本地」；skill 只检测，不代存 key |
| 兜底调用方式 | 仅在 `bl` 不可用时：`DASHSCOPE_API_KEY` + DashScope HTTP（`services/audio/tts/SpeechSynthesizer`），响应 `output.audio.url` 下载 wav |
| 音色枚举 | 不要依赖 `bl speech synthesize --list-voices`：对 `qwen-audio-3.1-tts-plus` 与 `qwen3-tts-flash` 返回 `voices: null`；以附录 A 内置目录为准 |
| 旗舰音色（首选） | 列表页 3.1 Plus 只列 4 个 v3.1 旗舰：`longanlingxin_v3.1`、`xunanchuan_v3.1`、`longanhuan_v3.1`、`longanfengyue_v3.1` |
| 备选模型 | `qwen3-tts-flash`（非实时） |
| 备选音色 | Qwen-TTS 音色列表精选 **12 个音色（6 女 / 6 男，含粤语阿强/阿清）**，完整清单见附录 A |
| 能力 | `instruction` 自然语言控制、SSML、情感/拟声标签、字级时间戳（流式）、声音复刻 |
| 计费 | 按 token 计费；3.1 Plus 与 qwen3-tts-flash 单价以控制台为准 |
| 限流 | 参考 qwen3-tts-flash 为 RPS 3；plus 以控制台为准，串行合成并对 429 退避 |
| 参考音色列表 | https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list 、https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list |

### 仓库约定

skill 放 `plugins/<plugin>/skills/<skill>/`；`SKILL.md` + `run.py` + `skill_main.py`；`marketplace.json` 的 `skills` 数组显式登记。

## 4. 方案对比与选择

### A. 单进程 + SRT 逐条合成 + 拼轨（已选）

`run.py` 选解释器 → `skill_main.py` 选 provider → 加载/准备 provider → 循环合成每一条 → ffmpeg atempo 适配 → numpy 按时间轴拼整轨 → ffmpeg 替换 mp4 音轨。

- 优点：本地模型只加载一次；时间轴完全可控；同一套对齐/拼轨逻辑复用于本地与在线。
- 缺点：需要自己实现对齐、拼轨、混流与 provider 抽象。

### B. 每条 SRT 调一次本地 CLI

- 缺点：每条都重新加载 ~3.4 GB 模型。100 条字幕 = 100 次加载，不可行。
- 结论：只适合单条试听，不作为 skill 的实现方式。

### C. 整段文本一次合成、再按时间切分

- 缺点：中文语速与原片不同，无法按 SRT 时间窗切准，违背「精准卡轴」。
- 结论：放弃。

## 5. Provider 与音色

### 5.1 本地 9 音色（CustomVoice）

| 音色 | 声音描述 | 原生语言 |
| --- | --- | --- |
| Uncle_Fu | 低沉醇厚的成熟男声 | 中文 |
| Serena | 温暖、温柔的年轻女声 | 中文 |
| Vivian | 明亮、略带锋利感的年轻女声 | 中文 |
| Dylan | 年轻北京男声，清晰自然 | 中文（北京话） |
| Eric | 活泼成都男声，略带沙哑亮度 | 中文（四川话） |
| Ryan | 节奏感强的男声 | 英语 |
| Aiden | 阳光美式男声，中频清晰 | 英语 |
| Ono_Anna | 活泼轻盈的日语女声 | 日语 |
| Sohee | 温暖、情感丰富的韩语女声 | 韩语 |

中文配音默认推荐 **Uncle_Fu**（解说/口播）或 **Serena**（温柔叙述）。`--instruct` 可追加语气控制。

### 5.2 在线音色

在线 provider 内置两组音色。**首选 3.1 Plus 旗舰音色；Qwen-TTS 12 音色作为备选。**

#### 5.2.1 首选：qwen-audio-3.1-tts-plus 旗舰音色（4 个）

| 名称 | voice 参数 | 性别 | 特点（页面/试听文案） |
| --- | --- | --- | --- |
| 龙安灵心_v3.1 | `longanlingxin_v3.1` | 女 | 知心、温柔 |
| 许南川_v3.1 | `xunanchuan_v3.1` | 男 | 磁性、讲故事 |
| 龙安欢_v3.1 | `longanhuan_v3.1` | 女 | 活泼、爱笑 |
| 龙安风悦_v3.1 | `longanfengyue_v3.1` | 女 | 自然亲切、播报感 |

这组支持 `instruction` 自然语言控制（如「用平稳的解说语气，语速稍慢」）以及 SSML / 情感标签；本 skill 只透传 `instruction`，不生成 SSML。

#### 5.2.2 备选：Qwen-TTS 精选 12 音色（qwen3-tts-flash）

来源：[Qwen-TTS 音色列表](https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list)。**保留 12 个中青年音色，男女 1:1**；包含粤语阿强 / 阿清，排除童声（Bella / Mia / Mochi / Bunny / Pip / Nini / Stella）、老年（Eldric Sage / Arthur）、其余方言（Jada / Dylan / Li / Marcus / Roy / Peter / Sunny / Eric）以及外语人格角色。

| 性别 | 名称 | voice 参数 | 描述 |
| --- | --- | --- | --- |
| 女 | 芊悦 | `Cherry` | 阳光积极、亲切自然小姐姐 |
| 女 | 苏瑶 | `Serena` | 温柔小姐姐 |
| 女 | 四月 | `Maia` | 知性与温柔的碰撞 |
| 女 | 十三 | `Vivian` | 拽拽的、可爱的小暴躁 |
| 女 | 茉兔 | `Momo` | 撒娇搞怪，逗你开心 |
| 女 | 粤语-阿清 | `Kiki` | 甜美的港妹闺蜜，粤语女声 |
| 男 | 晨煦 | `Ethan` | 标准普通话，带部分北方口音；阳光、温暖、活力、朝气 |
| 男 | 甜茶 | `Ryan` | 节奏拉满，戏感炸裂，真实与张力共舞 |
| 男 | 月白 | `Moon` | 率性帅气的月白 |
| 男 | 安德雷 | `Andre` | 声音磁性，自然舒服、沉稳男生 |
| 男 | 阿闻 | `Neil` | 平直的基线语调，字正腔圆的咬字发音，最专业的新闻主持人 |
| 男 | 粤语-阿强 | `Rocky` | 幽默风趣的粤语男声，在线陪聊 |

注意：这 12 个音色属于 `qwen3-tts-flash`，**不能与 3.1 Plus 的 4 个旗舰音色混用**（百炼会返回 `InvalidParameter`）。在线 provider 必须按「音色 → 模型」映射选模型；`instruction` 只对 3.1 Plus 组生效，Qwen-TTS 备选组不传 `instruction`，需要指令控制时提示用户改用旗舰组。

### 5.3 选择建议（写进 SKILL.md 与菜单描述）

- 想免费、离线、隐私优先、音色够用 → **本地**。首次需下载约 3.4 GB 模型。
- 想要更细分的普通话人格音色、SSML / 情感标签、更强表现力，且接受按 token 付费 → **在线**。
- 在线首选 **3.1 Plus 4 个旗舰音色**；想要更多中青年普通话人格（阳光 / 温柔 / 知性 / 拽 / 撒娇 / 新闻男等），再选 **Qwen-TTS 精选 12 音色**备选（含粤语）。
- 音色不一一对应：本地没有「知心灵心 / 磁性南川 / 活泼安欢」的精确对应，只能近似（Serena ≈ 温柔女声，Uncle_Fu ≈ 低沉男声）。

### 5.4 模型覆盖与映射

- 本地默认 CustomVoice 1.7B bf16；`--model <hf-id>` 可覆盖（0.6B / 8bit / VoiceDesign）。
- 本地 `--design "<音色描述>"` 切 VoiceDesign；未显式给 `--model` 时默认加载 `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16`，且与 `--voice` / `--instruct` 互斥。明确提示跨段漂移风险，仅建议短视频。
- 在线按音色自动选模型：
  - 4 个 `*_v3.1` 旗舰音色 → `qwen-audio-3.1-tts-plus`
  - 12 个精选 Qwen-TTS 音色 → `qwen3-tts-flash`
- 在线 `--model` 只能覆盖为同一音色组对应的模型；音色与模型不匹配时在本地预检阶段直接报错，不发请求。
- `--lang` 默认 `chinese`；在线对应 `language_type` / `language_hints` 由 provider 映射。

## 6. 输入 / 输出契约

### 输入

- `--srt <path>`：必需。标准 SRT，UTF-8，文本已是中文。
- `--video <path>`：可选。提供时输出成品 mp4；不提供时只输出整条配音 wav。
- `--audio <path>`：可选。只取音频时长（用于总轨长度），不混流；与 `--video` 互斥。
- 视频与 SRT 的时间原点一致（SRT 从视频 0 秒开始计时）。

### 输出

- `<out_stem>.dub.mp4`：视频流复制（必要时重编码），音频替换为 AAC 192k。
- `<out_stem>.dub.wav`：24 kHz 单声道整轨，长度 = 视频时长（无视频时 = 最后一句结束时间）。
- stdout 报告：逐条 `序号 / 开始 / 窗口 / 合成时长 / atempo 系数 / 状态`，末尾汇总警告数与失败数。
- `--keep-segments`：保留每条合成 wav 到 `<out_dir>/segments/`。
- `--json-report <path>`：可选，机器可读报告。

退出码：全部成功 0；有截断/超速警告仍为 0；有合成失败或混流失败为非 0。

## 7. 对齐算法（精确）

### 7.1 解析与校验

- 解析 SRT 为 `{index, start_s, end_s, text}`，按 `start_s` 排序。
- 文本处理：去首尾空白；多行合并——换行两侧都是 ASCII 字母/数字则补一个空格，否则直接拼接；去掉纯空白条目。
- `--skip-bracketed`（默认关闭）：跳过纯音效标记条目（如 `[音乐]`、`（掌声）`）。
- 校验并报错（列出条目号）：
  - `end_s <= start_s`、负时间、空文本、零时长。
  - 有视频时：`start_s >= 视频时长` → 报错；`end_s > 视频时长` → 夹到视频时长并 warning。
- SRT 条目重叠：按开始时间排序后，若 `start_i < end_{i-1}`，warning；规划时令 `effective_start_i = max(start_i, 上一条实际结束位置)`，若 `effective_start_i >= next_start` 则该条无可用窗口，按失败处理。

#### 7.1.1 语义合并计划（推荐，`--merge-plan`）

逐条合成会让每条字幕独立起调、句尾收束；短条目多时听感卡顿。CLI 支持一个显式计划：

```json
{"groups": [[1, 2, 3], [4, 5], [6]]}
```

- 分组由 Claude 读完整 SRT 后按语义决定，**不按时间间隙机械合并**；每组必须是完整语义单元，合并文本以句末标点结尾。
- 规则：逗号/顿号/冒号结尾或无标点的条目并入下一组；人物介绍、步骤标题、明显新话题单独起组；长停顿且语义另起时断开；每组约 3–8 条、≤18s，过长在最近句末标点处拆。
- 组可以是索引数组，也可以是 `{"indices": [...], "text": "..."}` 对象；`text` 用于在不改 SRT 的前提下精简该组文本，时间窗仍取 `indices` 首尾。
- `merge_plan.load_merge_plan()` 校验：覆盖全部条目、顺序递增、组内连续；非法计划退出 2。
- 合并后 `Cue.index` 取组首条目，`start` 取组首开始，`end` 取组末结束，`next_start` 取下一组开始；引擎、缓存、适配逻辑不变。

### 7.2 单条适配

对第 i 条：

- `slot = end_i - start_i`
- `next_start = start_{i+1}`（最后一条：有视频时取视频时长，否则取 `end_i`）
- 合成后先裁掉首尾静音（10 ms 窗口、幅度阈值判定），保留 10 ms 首尾淡入淡出，得到时长 `d`。

适配顺序（`warn_speed` 固定 1.15，`max_speed` 默认 1.30，可配置）：

1. `d <= slot`：保持原速，放在 `effective_start_i`，尾部补静音到 `next_start`。
2. `d > slot` 且 `d / slot <= 1.15`：`atempo = d / slot`，**先压到本条时间窗内**。这是首选路径，不算 warning。
3. 1.15 压缩后仍超出 `slot`，但 `d / 1.15 <= next_start - effective_start_i`：保持 1.15，允许占用本条结束后的间隙，**不压到下一句**；记 yellow warning（超出字幕窗但未越界）。
4. 仍放不下且 `d / (next_start - effective_start_i) <= max_speed`：`atempo` 到该系数（超过 1.15 的部分记 warning）。
5. 仍放不下：在 `next_start` 处截断，末尾 50 ms 淡出，记 red warning。

规则：

- **只加速、不减速**。短于窗口就补静音，不主动拉长。
- 任何情况下不得与下一条重叠。
- `--max-speed` 是硬上限：
  - 若 `--max-speed < 1.15`，步骤 2 的上限跟着降到该值，更多条目会进入 spill / 截断。
  - 若 `--max-speed > 1.30`，步骤 4 允许更高压缩，warning 阈值仍是 1.15。
- 所有 atempo 走 ffmpeg `atempo` 滤镜；单级超过 2.0 时链式拆分。

### 7.3 拼轨

- 主缓冲：24 kHz 单声道 float32，长度 = 视频时长（`ffprobe`），无视频时 = 最后一条实际结束时间；不足处补静音。
- 每条处理后的音频按 `effective_start_i` 写入主缓冲；写入前做重叠检测。
- 写 WAV 用 `soundfile`，随后交给 ffmpeg 编码 / 混流。

## 8. 合成引擎

### 8.1 Provider 接口

```python
class TTSProvider:
    def prepare(self) -> None: ...            # 加载模型 / 校验 key，只调用一次
    def synthesize(self, text: str, voice: str,
                   instruct: str, lang: str) -> np.ndarray: ...  # 24k 单声道 float32
    def describe(self) -> dict: ...           # 名称 / 计费提示 / 音色表
```

本地与在线实现同一接口；下游的裁剪、atempo、拼轨、混流完全复用。

### 8.2 本地 provider

- 复用 `audio-transcribe/run.py` 的解释器选择策略：上次成功解释器 → 当前 → PATH python3 → Homebrew 版本化 Python → pyenv → `/usr/bin/python3`，逐个验证 `import mlx_audio`；全都没有才安装（跳过 `/usr/bin/python3`）。
- 模型只加载一次，循环内调用 `model.generate(...)`。
- 采样稳定性：`--seed` 调 `mx.random.seed()`；`--temperature/--top-p/--top-k` 透传给 `model.generate`。默认 `temperature=0.9` 波动较大，长片建议 0.6–0.7 + 固定 seed。
- Base 克隆：`--ref-audio/--ref-text` 时自动加载 `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16`（或显式 Base 模型），调用 `generate(ref_audio=..., ref_text=...)`；参考音频 3–10s 单说话人，文本需逐字一致。Base 推理可在 MLX 本地跑，不需要 CUDA。
- 进度：`[12/87] 00:01:23.400  合成 4.2s  窗口 3.8s  atempo 1.11x ✓`。

### 8.3 在线 provider

**主路径：`bl` CLI（推荐，零 key 处理）**

- 音色目录：内置两组映射（附录 A）。`voice -> model` 查表决定 `--model`：
  - `longanlingxin_v3.1` / `xunanchuan_v3.1` / `longanhuan_v3.1` / `longanfengyue_v3.1` → `qwen-audio-3.1-tts-plus`
  - 12 个精选 Qwen-TTS 音色（Cherry / Serena / Maia / Vivian / Momo / Kiki / Ethan / Ryan / Moon / Andre / Neil / Rocky）→ `qwen3-tts-flash`
- 预检：`bl` 是否在 PATH；`bl auth status --output json` 的 `authenticated` 是否为 true。
- 未登录时的登录链接流程：
  1. 后台启动 `bl auth login --console --no-browser`（不要让它阻塞主进程）。
  2. 从 stdout 捕获登录 URL，以 Markdown 可点击链接展示给用户：
     `请点击登录：[打开百炼登录页](https://...)`
  3. 保持登录子进程存活，轮询 `bl auth status --output json`（默认每 2 秒，最多 5 分钟）。
  4. 登录成功后杀掉/等待子进程退出，继续原流程；超时或子进程提前退出 → 用 `AskUserQuestion` 选「重新获取链接 / 重新登录 / 切本地」。
  5. 登录 URL 只展示给当前用户，不写入报告/日志；skill 只读取登录态，**不接收、不保存、不打印明文 key**。
- 逐条调用，不加载模型，只是网络请求；串行执行：

```bash
bl speech synthesize \
  --text "<单条台词>" \
  --model "qwen-audio-3.1-tts-plus" \
  --voice "longanlingxin_v3.1" \
  --format wav --language zh --sample-rate 24000 \
  --out "<tmp>/seg.wav"
```

- `--instruction` 仅对 3.1 Plus 组透传；Qwen-TTS 备选组忽略并 warning。
- 不使用 `--list-voices`（这两个模型返回 `voices: null`）；音色以附录 A 为准。
- 429 / 5xx 指数退避重试 2 次（1s / 2s）；401/403 提示重新 `bl auth login`；额度不足 / Throttling 直接报错并给出百炼控制台链接；音色与模型不匹配在本地预检直接拦截，不调用 `bl`。
- 输出 wav 由 `bl` 直接写到 `--out`，后续裁剪 / atempo / 拼轨与本地 provider 完全一致。

**兜底路径：DashScope HTTP（仅 `bl` 不可用时）**

- 读取 `DASHSCOPE_API_KEY`；endpoint 可用 `--tts-endpoint` 覆盖（官方示例为工作空间专属域名）。
- 请求体：`input.text`、`input.voice`、`input.format="wav"`、`input.sample_rate=24000`、`input.language_type`（`--lang` 映射成 `Chinese` / `English` 等）；`input.instruction` 仅对 3.1 Plus 组。
- 响应取 `output.audio.url` 下载 wav；下载失败重试一次。

**费用提示**：开始批量合成前打印总字数与「按 token 计费」提示，需用户确认（`--yes` 可跳过）。

#### 8.3.1 配音优化参数（百炼文档）

- `--rate` / `--pitch` / `--volume` / `--seed`：透传给 `bl` 的 `--rate/--pitch/--volume/--seed`，HTTP 兜底写入同名 `input` 字段；只允许在线。
- `--enable-ssml`：仅 3.1 Plus 旗舰音色；透传 `bl --enable-ssml` / `input.enable_ssml=true`，SRT 文本可含 `<break>` 等 SSML；provider 自动套 `<speak>...</speak>`（已套则不重复）。
- `--instruct`：仅 3.1 Plus；可用于语速、情绪、角色、方言（如「请用粤语说」）。Qwen-TTS 备选组忽略。
- 情感/拟声标签（`[excited]`、`[laughing]` 等）直接写在 SRT 文本里，仅 3.1 Plus。
- 语言：3.1 Plus 的 HTTP 请求使用 `language_hints: [code]`；Qwen-TTS 使用 `language_type`；粤语系统音色由 voice 决定语种，不发送语言字段。
- `hot_fix`：`--hotfix-file <json>`，仅在线 3.1 Plus；`bl` 不暴露该参数，因此强制走 DashScope HTTP 兜底（需 `DASHSCOPE_API_KEY` + `--tts-endpoint`）。JSON 形如 `{"pronunciation": [{"重庆": "chong2 qing4"}], "replace": [{"今天": "金天"}]}`，两个数组都可省略。
- 以上风格参数都进入缓存键，改参数会重新合成。

### 8.4 合成结果校验与缓存

- 校验：非空、时长 ≥ 0.2 s、采样值有限（无 NaN/Inf）、RMS 高于静音阈值。空音频 / 全静音 / 异常短 → 视为失败，**不写缓存、不写入成品**。
- 失败重试 1 次；仍失败则终止整次运行并报错（不生成残缺成品），除非 `--continue-on-error`。
- 缓存 key = `sha256(provider + model_id + voice + instruct + lang + normalized_text)[:16]`
- 路径：`~/.cache/video-tts/segments/<key>.wav`（存裁剪后的原始合成音频，不含 atempo）
- 命中直接复用；`--no-cache` 跳过读写。

### 8.5 长条目保护

- 单条文本超过 300 个字符，或按字数估算音频超过 60 秒时，在句末标点处切块合成后拼接；块级缓存 key 加 `chunk_index`。
- 拼接后仍按第 7 节走同一条适配逻辑，不静默截断。

## 9. 音频处理与混流

### 9.1 先拼一条完整音轨

- 每条：ffmpeg 解码 → 裁剪静音 → 需要时 `atempo` → PCM float32 → 按 `effective_start_i` 写入主缓冲。
- 主缓冲长度 = 视频时长（`ffprobe` 实测）；最后一条结束后补静音到片尾，保证音轨和视频等长。
- 写 `*.dub.wav`（24 kHz 单声道）。这一步之后，视频还没动，音频已经是一条可独立播放的完整配音轨。

### 9.2 探测视频

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,r_frame_rate,duration \
  -of json "<video>"
```

- 视频时长用于定主缓冲长度。
- 编码格式用于决定复制还是重编码：
  - H.264 / HEVC → `-c:v copy`。
  - VP9 / AV1 / 其他不兼容 mp4 的编码 → 重编码 `-c:v libx264 -crf 18 -preset medium`，warning 提示耗时变长。

### 9.3 一条 ffmpeg 完成替换

```bash
# 视频流可直接复制
ffmpeg -y -i "<video>" -i "<track.wav>" \
  -map 0:v:0 -map 1:a:0 -map_metadata 0 \
  -c:v copy -c:a aac -b:a 192k \
  -movflags +faststart \
  "<out>.dub.mp4"

# 视频编码不兼容 mp4 时
ffmpeg -y -i "<video>" -i "<track.wav>" \
  -map 0:v:0 -map 1:a:0 -map_metadata 0 \
  -c:v libx264 -crf 18 -preset medium \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  "<out>.dub.mp4"
```

- `-map 0:v:0`：只取原视频的第一条视频流。
- `-map 1:a:0`：只取配音轨；原视频音轨**不映射**，等于整轨替换。
- `-map_metadata 0`：保留原视频的标题、创建时间等元数据。
- **不用 `-shortest`**：主轨已补齐到视频时长，避免音轨略短时把视频截断。
- 原视频有多条音轨时只替换为一条；不保留原声（背景音乐分离不在范围内）。

### 9.4 产出后校验

```bash
ffprobe -v error -show_entries \
  stream=index,codec_type,codec_name,duration \
  -of json "<out>.dub.mp4"
```

- 必须存在一条视频流 + 一条音频流，且音频流编码为 AAC。
- 输出视频时长与输入视频时长相差 ≤ 0.2 s。
- 音频源轨为 24 kHz 单声道；混流命令不加 `-ar`，由 ffmpeg 的 AAC 编码器按源采样率输出。
- 校验失败 → 删除未完成的 `.dub.mp4` 并报错，不留下看起来成功但音画不同步的文件。

## 10. CLI 参数

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `--srt` | 中文 SRT 路径 | 必需 |
| `--video` | 视频路径；提供则输出 mp4 | 无 |
| `--audio` | 音频路径（只取时长，不混流；与 `--video` 互斥） | 无 |
| `--provider` | `local` / `online` | 交互选择 |
| `--out` | 输出前缀或 `.mp4` 路径（非 `.mp4` 后缀按前缀处理） | `<video stem>` 或 `<srt stem>` |
| `--voice` | 音色名/参数（本地 9 个或在线 16 个） | 交互选择 |
| `--instruct` | 语气/风格指令 | 空 |
| `--rate` | 在线语速 0.5-2.0 | 模型默认 |
| `--pitch` | 在线音调 0.5-2.0 | 模型默认 |
| `--volume` | 在线音量 0-100 | 模型默认 |
| `--seed` | 随机种子 0-65535（本地/在线） | 模型默认 |
| `--temperature` | 本地采样温度（默认 0.9；越低越稳定） | 模型默认 |
| `--top-p` | 本地 top-p 采样 | 模型默认 |
| `--top-k` | 本地 top-k 采样 | 模型默认 |
| `--enable-ssml` | 在线 SSML（仅 3.1 Plus 旗舰） | false |
| `--hotfix-file` | hot_fix JSON（仅 3.1 Plus，强制 HTTP 兜底，需 key + endpoint） | 无 |
| `--design` | 本地 VoiceDesign 音色描述；与 `--voice` / `--instruct` 互斥，自动加载 VoiceDesign 模型 | 无 |
| `--ref-audio` | 本地 Base 克隆参考音频（3–10s，需 `--ref-text`；与 `--voice`/`--design`/`--instruct` 互斥） | 无 |
| `--ref-text` | 参考音频对应文本 | 无 |
| `--lang` | 语言代码；在线映射为 `zh` / `en` / `ja` / `ko` / `de` / `fr` / `ru` / `pt` / `es` / `it` | `chinese` |
| `--model` | 覆盖 provider 的模型 id；在线必须与音色同组， VoiceDesign 模型只能配 `--design` | 各 provider 默认 |
| `--tts-endpoint` | 兜底 HTTP endpoint 覆盖（仅在 `bl` 不可用时） | 官方示例域名 |
| `--track-only` | 只出配音轨，不混流 | false |
| `--keep-segments` | 保留逐条 wav | false |
| `--no-cache` | 禁用缓存 | false |
| `--json-report` | 写机器可读报告 | 无 |
| `--continue-on-error` | 单条失败继续（会缺句） | false |
| `--skip-bracketed` | 跳过纯音效标记条目 | false |
| `--merge-plan` | 语义合并计划 JSON（推荐；按整句分组） | 无 |
| `--max-speed` | 最大 atempo | `1.30` |
| `--yes` | 跳过在线费用确认 | false |
| `--dry-run` | 只解析并打印计划，不合成 | false |

## 11. 交互流程（SKILL.md 约束）

**总原则：所有需要用户做选择的地方，一律使用 `AskUserQuestion` 交互控件。** 纯文本只用于展示音色表、SRT 摘要、进度和最终报告，不用来问「选哪个 / 要不要继续」，也不要求用户回复「1/2/3」。

`AskUserQuestion` 的真实 schema：每题最多 4 个选项、每次最多 4 个问题；每个选项是 `{label, description}`；`header` ≤ 12 字符；`multiSelect` 必填。选项超过 4 个就拆成多次调用。

有视频/音频时，第一个决策「音色来源：原声克隆 / 系统音色」同样必须用 `AskUserQuestion`（header：音色来源）；没有媒体可截参考时跳过该问题，已给 `--ref-audio` 或 `--voice`/`--design` 时也跳过。

### 11.1 决策点清单

| 时机 | 问题（header） | 选项 | 何时跳过 |
| --- | --- | --- | --- |
| 启动（有视频/音频） | 音色来源 | 原声克隆（推荐）/ 系统音色 | 已传 `--ref-audio` 或已选 `--voice`/`--design` |
| 启动 | 配音方案 | 本地（推荐）/ 在线 | 原声克隆（只能本地）/ 传了 `--provider` |
| 在线 | 音色组 | 3.1 Plus 旗舰（推荐）/ Qwen-TTS 12 音色 | |
| 在线·旗舰 | 具体音色 | 4 个旗舰音色 | 传了 `--voice` |
| 在线·Qwen-TTS | 性别 | 女声（6，含粤语）/ 男声（6，含粤语） | |
| 在线·Qwen-TTS | 具体音色 | 每组 6 个，拆 3 + 3 两页 | 传了 `--voice` |
| 本地 | 音色方向 | 普通话 / 方言 / 英语 / 日语·韩语 | 传了 `--voice` |
| 本地 | 具体音色 | 该方向 2–3 个 | 传了 `--voice` |
| 选完音色 | 语气 | 默认 / 平稳解说 / 活泼；自定义走 Other | 传了 `--instruct` |
| SRT 解析后 | 语义合并 | 语义合并（推荐）/ 逐条合成 | 传了 `--merge-plan` 或用户明确不要合并 |
| SRT 解析后 | 是否开跑 | 开始合成 / 只预览（dry-run）/ 取消 | |
| 在线开跑前 | 费用确认 | 继续 / 切本地 / 取消 | `--yes` |
| 在线未登录（超时后） | 登录方式 | 重新获取链接 / 重新登录 / 切本地 | 已登录或链接等待中 |
| 合成失败 | 失败处理 | 切本地重跑 / 终止 | `--continue-on-error` |
| 输出已存在 | 覆盖策略 | 覆盖 / 另存 / 取消 | 输出不存在 |

### 11.2 展示顺序

1. 选方案 → 选音色组 → 选性别（仅 Qwen-TTS）→ 选具体音色 → 选语气。
2. 完整音色表是纯信息展示；选择动作在表后由 `AskUserQuestion` 完成。
3. 预检：本地查 `ffmpeg` / `mlx_audio` / 模型缓存；在线查 `bl` + `bl auth status`。
   - 未登录：自动后台运行 `bl auth login --console --no-browser`，把捕获到的登录 URL 以可点击链接展示，轮询 `bl auth status` 等待完成；只有超时或子进程提前退出时才用 `AskUserQuestion` 选「重新获取链接 / 重新登录 / 切本地」。不接收、不代存 key。
   - 未安装 `bl`：用 `AskUserQuestion` 让用户选「安装 bl / 走 HTTP 兜底（需 DASHSCOPE_API_KEY）/ 切本地」。
4. 解析 SRT，打印摘要 → `AskUserQuestion` 确认「开始合成 / 只预览 / 取消」。
5. 在线：打印总字数与计费提示 → `AskUserQuestion` 确认「继续 / 切本地 / 取消」。
6. 合成中逐条打印进度；完成后打印报告与产物路径；有警告时单独列出条目号。
7. 失败时用 `AskUserQuestion` 处理「切本地重跑 / 终止」。

## 12. 触发描述与上游串联

- skill 名：`video-tts`
- 描述关键词：视频配音、中文配音、SRT 配音、把字幕读成声音、外语视频转中文配音、dubbing、voiceover、TTS。
- 明确它**不是**通用 TTS：输入必须是 SRT；纯文本转语音不在范围内。
- 上游链路：`video-downloader → audio-transcribe → text-refine → video-tts`。

## 13. 目录结构（建议）

```
plugins/video-toolkit/skills/video-tts/
├── SKILL.md
├── run.py                    # 解释器选择 + 入口
├── skill_main.py             # CLI / 流程编排
├── srt_parse.py              # 解析、时间窗、校验
├── providers/
│   ├── __init__.py           # get_provider(name)
│   ├── local_mlx.py          # mlx-audio CustomVoice / VoiceDesign
│   └── online_bailian.py     # qwen-audio-3.1-tts-plus + qwen3-tts-flash
├── audio_fit.py              # 静音裁剪、atempo、放置计划
├── track_build.py            # 主缓冲拼接、写 WAV
├── mux.py                    # ffprobe、编解码预检、ffmpeg 混流
└── tests/
    ├── test_srt_parse.py
    ├── test_fit_plan.py
    ├── test_track_build.py
    └── fixtures/
```

`marketplace.json` 的 `Video_Toolkit.skills` 追加 `./skills/video-tts`。

## 14. 测试

- 纯逻辑单测（不加载模型、不联网）：SRT 解析、多行合并、重叠夹取、适配分级、`--max-speed` 边界、主缓冲放置、报告生成。
- 音频单测用合成正弦波 / 静音 WAV，断言长度与偏移；空音频/全静音校验单独覆盖。
- Provider 单测：用 mock 替换 `synthesize`，断言缓存 key、失败重试、费用确认流程、音色→模型映射。
- 集成冒烟（opt-in，需模型或 key）：2 条 SRT + 5 秒测试视频，断言 mp4 存在、含音频流、时长不变。标记 slow，不进默认测试集。

## 15. 错误处理

| 现象 | 处理 |
| --- | --- |
| 缺 ffmpeg / ffprobe | 报错并给 `brew install ffmpeg` |
| 缺 mlx-audio | `run.py` 自动选解释器安装；装不上给出 pip 命令 |
| 本地模型首次下载失败 | 报错，提示检查网络或手动 `huggingface-cli download` |
| 本地音色名非法 | 参数校验阶段列出 9 个合法音色后退出（码 2） |
| 在线缺 `bl` | 提示安装；可询问是否切本地；已有 `DASHSCOPE_API_KEY` 时可加 `--tts-endpoint` 走兜底 HTTP |
| `bl` 未登录 | 自动展示 `bl auth login --console --no-browser` 的登录链接并轮询；超时后用 `AskUserQuestion` 选重新获取链接 / 重新登录 / 切本地；skill 不代存 key |
| `bl` 401/403 | provider 立即报错并提示运行 `bl auth login` 重新登录；可切本地 |
| 在线 429 / 5xx | provider 内指数退避重试 2 次（1s / 2s）；仍失败则询问切本地或终止 |
| 在线额度不足 / Throttling | provider 立即报错并给出[百炼控制台](https://bailian.console.aliyun.com/)链接；可切本地 |
| 在线音色与模型不匹配 | 参数校验阶段直接报错（码 2），不发请求 |
| `bl --list-voices` 返回空 | 正常现象（这两个模型返回 null）；以附录 A 为准，不报错 |
| SRT 为空 / 时间非法 / 零时长 | 列出条目号并退出 |
| 单条合成失败 / 空音频 / 全静音 | 重试 1 次；仍失败终止（除非 `--continue-on-error`），不写缓存 |
| 单条放不下 | 按 7.2 升级；截断记 warning |
| 视频无视频流 | 混流前报错，不出残缺文件 |
| 视频编码不兼容 mp4 | 自动重编码 H.264 并 warning |
| 输出已存在 | 默认覆盖（`-y`）；`--out` 显式指定时由 builder 决定是否提示 |

## 16. 留给 builder 的决定

以下不影响「做成什么」，builder 可自行决定并在实现说明中标注：

- 模块拆分粒度（上面的文件划分只是建议）。
- 是否在 v1 实现 `bl` 不可用时的 HTTP 兜底（建议实现，代码量不大；也可先只支持 `bl`）。
- 兜底 HTTP 的 endpoint / workspace id 配置方式（环境变量 / 参数 / 配置文件）。
- 缓存音频是否也缓存 atempo 结果（建议只缓存原始合成音频）。
- 是否在 v1 支持 0.6B / 8bit 模型的快捷参数（`--model` 已可覆盖）。
- 逐条合成失败重试的退避细节。
- 报告用纯文本还是表格宽度自适应。

---

## 附录 A：在线音色总表

### A.1 3.1 Plus 旗舰音色（4）

| 名称 | voice 参数 | 性别 | 特点 |
| --- | --- | --- | --- |
| 龙安灵心_v3.1 | `longanlingxin_v3.1` | 女 | 知心、温柔 |
| 许南川_v3.1 | `xunanchuan_v3.1` | 男 | 磁性、讲故事 |
| 龙安欢_v3.1 | `longanhuan_v3.1` | 女 | 活泼、爱笑 |
| 龙安风悦_v3.1 | `longanfengyue_v3.1` | 女 | 自然亲切、播报感 |

### A.2 Qwen-TTS 精选 12 音色（qwen3-tts-flash，6 女 / 6 男，含粤语）

| 性别 | 名称 | voice 参数 | 描述 |
| --- | --- | --- | --- |
| 女 | 芊悦 | `Cherry` | 阳光积极、亲切自然小姐姐 |
| 女 | 苏瑶 | `Serena` | 温柔小姐姐 |
| 女 | 四月 | `Maia` | 知性与温柔的碰撞 |
| 女 | 十三 | `Vivian` | 拽拽的、可爱的小暴躁 |
| 女 | 茉兔 | `Momo` | 撒娇搞怪，逗你开心 |
| 女 | 粤语-阿清 | `Kiki` | 甜美的港妹闺蜜，粤语女声 |
| 男 | 晨煦 | `Ethan` | 标准普通话，带部分北方口音；阳光、温暖、活力、朝气 |
| 男 | 甜茶 | `Ryan` | 节奏拉满，戏感炸裂，真实与张力共舞 |
| 男 | 月白 | `Moon` | 率性帅气的月白 |
| 男 | 安德雷 | `Andre` | 声音磁性，自然舒服、沉稳男生 |
| 男 | 阿闻 | `Neil` | 平直的基线语调，字正腔圆的咬字发音，最专业的新闻主持人 |

> 已排除：童声（Bella/Mia/Mochi/Bunny/Pip/Nini/Stella）、老年（Eldric Sage/Arthur）、其余方言（Jada/Dylan/Li/Marcus/Roy/Peter/Sunny/Eric）、外语人格角色（Jennifer/Katerina/Bodega/Sonrisa/Alek/Dolce/Sohee/Ono Anna/Lenn/Emilien 等）。**粤语阿强/阿清已纳入**；其余音色后续再扩目录。
