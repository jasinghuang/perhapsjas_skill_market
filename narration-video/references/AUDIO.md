# 音频合成（Phase 2 手册）

把每章的 `narrations`（机器生成的口播真相源）按 **step 颗粒度**合成 mp3，落到
`public/audio/<folder>/<step>.mp3`，再 ffprobe 实测写 `public/audio-durations.json`——
**渲染时间轴的时长来源**。

> **真相源**：`narrations` 是 step 数 + 口播文本的唯一来源（由 Checkpoint 1 确认过的
> `script.md` 机器生成，章节 agent 不得手改）。空 narration 步**不合成**（无声过场，
> 运行时按估时撑过）。音频**0-indexed**：`public/audio/01-coldopen/0.mp3` 对应第 0 步。

---

## 三函数契约（provider-agnostic，已冻结）

合成器不绑定任何 TTS 后端——每个后端是 `scripts/tts-providers/<name>.sh` 一个文件：

| 函数 | 必需 | 作用 |
|---|---|---|
| `tts_synthesize <text> <out_path> [<voice>]` | ✓ | 把一段文字写成 mp3 到指定路径 |
| `tts_check` | 可选 | 启动时校验环境（CLI/key/auth），未就绪 return 非零 |
| `tts_install_help` | 可选 | `tts_check` 失败时打印怎么修 |

**当前状态（如实）**：内置 provider 脚本（minimax/openai 及 5 段可粘贴片段）**随 M6 交付**；
契约与流程本文件已冻结。M6 之前用 **mock 音轨**打通全链（见下）。

---

## 标准流程

### 1. 切分清单（软停——省钱门禁）

合成前把"要烧 token 的文本清单"列给用户**扫一眼**：每条 = 章节 / step / 文本 / 预估字数。
确认切分与文本无误再继续。空 narration 自动跳过（不烧 token）。

### 2. 选 provider

- 内置 minimax（中文首选，`mmx-cli`）→ 内置 openai（有 `OPENAI_API_KEY` 即可）→ 自定义
  （抄一段可粘贴片段存成 `<name>.sh`）→ 都没就绪走**退化路径**（见下）

### 3. 合成

- **串行**合成（避免 rate limit）；**已存在的 mp3 自动跳过**（断点续合，不烧重复 token）
- 改稿后的**增量重合成**：只重合成受影响段（narrations 变了哪些段，重合成哪些段）
- 进度逐条打印；**不要假装合成成功**——provider 没就绪就明说，走退化路径

### 4. 实测时长 → 回写时间轴

合成完后对每个 mp3 跑 `ffprobe` 实测时长，写 `public/audio-durations.json`
（两形态：对象 `{chapterId: [ms,...]}` 或单章扁平数组）。**这一步是原版缺的**：

- 分镜页（Phase 3）显示**实测时长**（不是估时）——停留节奏的确认基于真数据
- 渲染时间轴表（Phase 5）用它算每步步长（公式唯一定义在 RENDER.md 管线段：`stepMs = max(音频实测, 动画窗口) + 停留垫`）
- 门禁 #13 校验条目数；**#19 警告 ≥15s 的段**（口播过密 / step 没拆够——方向以 §11.1 为准，
  2026-09-15 修过一次反向实现）

### 5. Mock 音轨（M6 前的全链占位）

```bash
npm run render -- --mock-audio            # lavfi 正弦占位音轨（48k/双声道/无起手静音）
npm run render -- --mock-audio --realistic-audio   # 拟真档（120ms 起手静音/44.1k/单声道）
```

用途：没有真 TTS 时打通"合成→时长→时间轴→成片"全链；**拟真档**专门用来验边界断言在
真音频形态（起手静音）下的行为。产物与真 TTS 同路径同格式，M6 换真 provider 无缝。

---

## 运行时如何使用合成音频

**不需要额外配置**——引擎已接好：预览是音频驱动自动播放（`audio.ended` 且动画窗口结束 →
停留垫 → next）；音频缺失/解码失败时退化估时（`max(1500ms, 字数×250ms)`）继续推进。
注意：dev server 上缺 mp3 的请求返回 **200 + text/html**（SPA fallback，非 404）——解码
失败走同一条兜底，这是已知事实（KNOWN-ISSUES K-01）。

---

## 退化路径（两个内置都没就绪）

告诉用户（话术模板）：

```
我可以：

  1. 用内置 openai（如果你有 key）——export OPENAI_API_KEY=sk-... 再合成
  2. 帮你装 MiniMax CLI（中文音色更稳）——npm install -g mmx-cli && mmx auth login
  3. 换其它 provider——README 里有 5 种可粘贴片段（ElevenLabs/edge-tts/macOS say/Azure/Google）
  4. 暂时用 mock 音轨（npm run render -- --mock-audio）先把全链跑通，音频后补
  5. 暂时跳过合成——稿子都在，你自己用任意 TTS 录好按清单命名放进来即可
```

**不要假装合成成功。**

---

## 故障排查

通用：

| 现象 | 原因 / 修法 |
|---|---|
| 音频请求"加载失败"但 dev server 返回 200 | SPA fallback 回 index.html（text/html 解码失败）——mp3 没合成或路径不对；核对 `public/audio/<folder>/<step>.mp3`（0-indexed） |
| 预览不推进（一帧死画面） | 自动播放策略拒了 `play()` 且无用户手势——预览页有点播放键；`?auto=1` 裸页面在自动化会话里需 `--autoplay-policy=no-user-gesture-required`（引擎已兜底估时推进，M5b 修复） |
| `[blocker] 音频完整性 <章节> …` | 非空 narrations 数 / mp3 数 / durations 条目数三者不一——增量重合成缺失段，重跑 ffprobe 回写 |
| `[warning] 音频节奏 … ≥ 上限 15000ms` | 该段口播过密——**拆 step / 加长画面演示**（别并 step，那是反方向） |
| 中间断了几条没合成 | 重跑合成——已存在文件自动跳过（断点续合） |

provider 相关（minimax / openai / 自定义）：

| 现象 | 原因 / 修法 |
|---|---|
| `mmx: command not found` | `npm install -g mmx-cli`；bin 不在 PATH 时 `npm config get prefix` |
| `mmx is not authenticated` | `mmx auth login --api-key sk-xxxxx` |
| 中文音色不自然 / 单段被截断 | 换 `--voice=<id>`；单段超上限（mmx ~5000 字符）→ **拆 narrations（也意味着拆 step）** |
| `OPENAI_API_KEY is not set` | `export OPENAI_API_KEY=sk-...` |
| 全部 FAILED 但 key 对 | model/voice 名错——试默认；`bash -x` 看请求体 |
| 中文不像真人 | OpenAI 六音色英语偏向——中文用 minimax |
| 合成产物浏览器播不了 | provider 出的是 wav/opus？`file` 看 magic header；加一步 ffmpeg 转 mp3 |
