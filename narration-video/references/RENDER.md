# 渲染导出（A′ 确定性 seek · Phase 5 手册）

把确认过的章节**确定性**渲染成 mp4。**渲染 = 逐帧 seek 截图 + ffmpeg 拼帧，不是录屏**——
所以动画必须走组件（引擎注册表），手写 CSS 动画进不了 seek 运行时（门禁会拦）。

---

## 前置

1. `npm run check`（全量 20 项 + 扩展断言）**零 blocker**——不通过别渲染，红了查 `GATES.md`
2. 环境：`npx playwright install chromium`（首次一次，跨项目缓存复用）；
   `ffmpeg`（渲染必需——macOS `brew install ffmpeg`；缺失时 CLI 会抛安装指引）
3. 音频：合成过 → `public/audio-durations.json` 存在（真时长进时间轴）；
   未合成 → CLI 会明示"按估时出片（无声）"

---

## 命令与 flags

```bash
npm run render                          # 全量渲染（自起 Vite，不需要手动 npm run dev）
npm run render -- --no-subs             # 出无字幕版（默认带字幕，与预览一致）
npm run render -- --only 0,2            # 只渲指定步（specs 下标）
npm run render -- --concurrency N       # 帧流并发（默认 2；每 worker 一个浏览器进程，别开大）
npm run render -- --mock-audio          # 无真 TTS 时出占位音轨（lavfi 正弦）
npm run render -- --mock-audio --realistic-audio   # 拟真档（120ms 起手静音/44.1k/单声道）
npm run render -- --no-srt              # 不写 SRT 副产物
npm run render -- --verify-determinism  # 采样步跨会话重采逐字节 + 负样本
npm run render -- --no-fallback         # 失败时不降级，直接非零退出
```

> **`npm run render -- <flag>` 的 `--` 必带**——npm 会把不带 `--` 的 flag 当配置项
> **打一条 warn 后吞掉**（不转发），你会在日志里看不到任何该 flag 的效果。

---

## 管线五段（每段干什么）

| 段 | 干什么 |
|---|---|
| ① 窗口预扫 | 真机逐步量动画窗口（注册表声明上界）——时间轴的 `animMs` 来源 |
| ② 时间轴表 | manifest + durations + timing.json + 窗口 → 每步 `[startMs, audioMs, animMs, dwellMs, stepMs, frameCount, holdMs]`；`stepMs = max(音频, 动画窗口) + 停留垫` |
| ③ 帧流 | 每步独立 mount → 窗口内逐帧 `seek(30fps)` 截图 → 静置段单帧复用；捕捉时断言"捕捉窗口 === 时间轴窗口"，不符即抛 |
| ④ 编码 | 视频：concat 帧清单（cfr 30）+ 末帧按统一式声明时长；音频：单次 `filter_complex` concat（样本级对齐）+ `-shortest` mux |
| ⑤ 自校验 | 见下。失败 → **响亮降级**为实时捕获（`<slug>.realtime.mp4`，画面按墙钟、音轨按时间轴——A/V 同步是近似的，日志明写原因） |

---

## 产物

- `render/<slug>.mp4`（1920×1080 或 1080×1440 @30fps，h264 + aac）
- `render/<slug>.srt`（与 mp4 同源的字幕副产物——`--no-subs` **不影响**它）
- `render/` 是 gitignore 的可重生成目录；成片 md5 是它唯一的身份见证（金样 README 记过）

**无音频时的成片是无声的**（CLI 明示"按估时出片（无声）"）——真 TTS 合成后重渲即有声。
降级产物的文件名带 `.realtime` 后缀，**别把它当主产物交付**。

---

## 自校验判据（容差口径——全部实测校准过，别手滑改严）

| 判据 | 口径 |
|---|---|
| 成片总时长 | ±1 帧（33ms） |
| mp4 `nb_frames` | ±3 帧（`-shortest` mux 会丢 1~2 个尾包） |
| 帧率 | 严格 `30/1` |
| **视频内容边界**（步切换） | **±4 帧（133ms）**——25fps 包层网格 + cfr 重采样，实测上界 ~90ms |
| **音轨边界** | **±10ms**（紧口径——音轨是精确基准，别套 4 帧那套） |
| 音轨总长 | ±2 个 AAC 帧（42.7ms） |
| 落盘 PNG 数 | === Σ frameCount（与 nb_frames **两条口径，从来不相等**——CFR 会把静置帧复制成多帧） |
| 跨会话重采 | 采样步（含首末）同一 t 逐字节一致 |
| 确定性负样本 | 两个不同 t 的帧**必须不同**（动画没画 = 假绿） |

> 恒定 A/V 偏移 <133ms 对总时长/帧数/帧率三项**全不可见**——**边界断言是唯一护栏**。

---

## 页面导出按钮

`npm run dev` 后页面上有"导出"按钮（随 dev server 起的本地渲染服务，同源中间件）：
点一下 → 进度反馈 → 下载 mp4。**不可达时**按钮降级为"复制命令"提示。服务只监听本机、
仅 dev 生效；导出渲染跑在 dev server 进程内。

---

## 排查

| 现象 | 原因 / 修法 |
|---|---|
| `未找到 Chromium 浏览器` | `npx playwright install chromium`（一次，之后走缓存） |
| `ffmpeg: command not found` | `brew install ffmpeg`（Linux 用 apt） |
| flag 没生效（日志里没有对应行） | **npm 吞 flag**——用 `npm run render -- --flag` 的 `--` 形态 |
| 跑着跑着卡住不动 | 帧流在等页面产帧——大概率 dev server 冷启动/Vite 首次 dep 预打包把挂载推过 10s 超时（KNOWN-ISSUES K-83）：先单跑一个浏览器测试热缓存再重试 |
| 成片黑屏 | 渲染态页面白屏/黑屏——先 `--only 0` 渲一步定位：看该步页面在浏览器里手动打开（`?render=1&headless=1`）是不是也黑；常见因 = 章节代码运行时抛错（#16 控制台报错会拦）或主题 token 缺失 |
| `已降级为实时捕获（…）` | 确定性链某段失败（seek 断言/自校验）——产物带 `.realtime` 后缀、A/V 近似；**查明失败原因**，别把降级产物当正式交付 |
| 产物无声 | 未合成音频（CLI 已明示）；或降级路径连音轨自建也失败（日志会写"本次降级产物无声"） |
| 输出目录里有陈旧的 `.srt` | `--no-srt` 不清理旧 SRT（已知项）——手动删，或别混用带/不带 `--no-srt` 的多次运行 |
| 页面按钮点不动/下载 500 | 产物名含非 ASCII（中文 slug）时旧版会 500——已修（RFC 6266）；仍遇到查 `vite-plugins/export-service.ts` |
| `npm run check` 冷启动全量偶发红 | 浏览器臂并发 + Vite 冷缓存（K-83）——先热臂再全量；串行化根治未做 |

---

## 渲染前 Checklist

- [ ] `npm run check` 零 blocker；warning 逐条有交代
- [ ] 音频合成过（或明确接受"无声按估时"）
- [ ] `npm run storyboard -- --verify-sequential` 通过（渲染模型前置）
- [ ] 成片交付前**给人看一眼**（Phase 5 轻检查点；首个里程碑时 = 金样入库闸门）
