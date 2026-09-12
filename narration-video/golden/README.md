# golden/ —— skill 级金样（成片回归的参照物）

**位置是刻意的**：`narration-video/golden/`（skill 级），**不在 `templates/` 内**——模板目录会被
scaffold 整棵拷进每个新项目，金样跟着走就会在每个项目里多出一份几十 MB 的旧成片。这里放的是
**这套 skill 自己的**参照物：M5a/M5b 的渲染链改了什么，用它能一眼看出"成片形状变没变"。

## 文件清单（M5b 接口约定 6 冻结）

| 文件 | 是什么 |
|---|---|
| `clip.mp4` | 一段**拟真档**（起手静音 120ms / 44100Hz / 单声道 mock 音轨）的成片，3 步 **7.770s**（T1 minor ① 回正：7.65 → 7.77，T2 真机重跑逐字节复核） |
| `clip.srt` | 与 `clip.mp4` **同源**的字幕（同一次渲染的 `buildSrtCues` 输入 → 主产物 `<slug>.srt` 的副本） |
| `clip.probe.json` | 同一次渲染的 ffprobe 摘要（时长 / 帧数 / 帧率 / 音轨规格）——回归时对照"形状" |
| `frames/first.png` `frames/mid.png` `frames/last.png` | 首 / 中 / 末三帧（人眼看的那一眼：构图 / 字体 / 字幕层） |

## 纪律

- **重采须用户确认**：金样是"人审通过"的锚，不是自动生成物。重采（跑一次渲染覆盖这里）**必须**
  由用户看过新成片点头之后再做——否则回归的参照点会随时间自己漂走，且漂走时无声无息。
- **消费方在 scaffold 后的项目里须跳过**：新项目里的 `narration-video/golden/` 不会存在（它不在
  `templates/` 内）；M5b 的 T6 回归消费要**处理缺席**（跳过 + 明示），不得因缺文件而红
  （Ruling P2：金样可能为空）。
- **本目录不是生成物目录**：`templates/` 里的 `/render/`、`/public/audio/` 都 gitignore（可重生成）；
  这里**入库**（回归要靠它跨会话存在）。

## 当前状态（2026-09-12, M5b T1 + T2）

**金样待用户审片确认——`clip.mp4` / `clip.srt` / `clip.probe.json` / `frames/` 尚未写入。**
T1 已在真机上出片并记录读数（见 `.superpowers/sdd/2026-09-12-M5b-subtitles-export-service/task-1-report.md`），
按人工闸门的要求停在"交用户审"这一步：用户点头后再把成片与三帧落进本目录。

**T2（SRT 副产物）已交付**：渲染链现在**默认**写 `<outDir>/<slug>.srt`（`--no-srt` 关；与画面开关
`--no-subs` 无关），`clip.srt` 的来源就绪——真机读数与本轮 SRT 全文见
`.superpowers/sdd/2026-09-12-M5b-subtitles-export-service/task-2-report.md`。**但本目录仍不写入**：
Ruling P2（金样缺席 = 跳过 + 明示，不得因缺文件而红）——闸门过后由落库那一步**一并** `cp`
`templates/render/presentation.srt` → 本目录 `clip.srt`（同一次渲染的同一份 `buildSrtCues` 输入，
"同源"由此保证；不许拿另一次渲染的 SRT 顶）。
