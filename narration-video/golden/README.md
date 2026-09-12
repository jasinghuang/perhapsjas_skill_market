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

**T6（收口）回归消费复核（2026-09-12）**：本目录仍只有本 README（`clip.mp4` 缺席）⇒ 按 Ruling P2
**跳过**，未产生任何"因缺文件而红"的判据；同时记一条正面证据——T6 的默认字幕臂真机跑（`--realistic-audio`
+ 固定 flag）产物 md5 = `3ec3bdef1085d4ed2473ea9f6d9554d2`，**与 T1 待审成片（`templates/render/presentation.mp4`）
逐字节相同**：闸门过后要 `cp` 的正是这一份（`cmp` 直接过，不存在"待审的那条与现在能出的那条不是同一条"的漂移）。
真机读数见 `.superpowers/sdd/2026-09-12-M5b-subtitles-export-service/task-6-report.md`。

## 待审 SRT 的身份见证（2026-09-12 终审修复波补）

`clip.srt` 的来源 `templates/render/presentation.srt` 的**待审内容**是：

| 项 | 值 |
|---|---|
| md5 | `c6d5d9d356ee830e12eab8a3964e487d` |
| 内容 | `00:00:00,000 → 00:00:03,400` / `00:00:03,400 → 00:00:05,870`（**拟真档**切点；缺省档是 5,750）+ 两行口播 |

**为什么记这个**：`clip.mp4` 有 md5 见证，SRT 此前**没有**——而一旦有测试/脚本往 `templates/render/`
写东西，SRT 会被静默改写（真发生过：T6 的 I-1 用例漏传 `--out`，把夹具口径 `5,750` 写进了待审目录，
一路无人发现；mtime 也只推了一下）。**落金样时以本表的 md5 为准**：`cp` 之后 `md5 -q clip.srt` 必须
等于它；若因后续修复导致内容变化，以**修复后重新实测并经人确认**的值为准，并在此表更新（不许只改文件不改表）。
