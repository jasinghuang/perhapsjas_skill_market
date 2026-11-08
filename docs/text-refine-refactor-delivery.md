# text-refine 改造交付说明

日期：2026-11-08 ｜ 依据：`text-refine_Skill_改进技术需求文档.md`（仓库根）｜ 计划：`docs/superpowers/plans/2026-11-08-text-refine-refactor.md`

## 改了什么，为什么

| 改动 | 理由（对应需求文档） |
| --- | --- |
| **SKILL.md 整体重写**：三任务路由（原语言校对/翻译/精简润色）、AskUserQuestion 三选一、行为契约表、保守纠错、结构化管线工作流、三级审校 | §3/§4/§5/§15：意图不明先问；默认保留原语言、原信息与时间轴；删除强制删词规则 |
| **新增 4 个纯标准库模块 + CLI**（srt_struct / textblocks / taskstate / pipeline / skill_main，Python ≥3.9，零第三方依赖） | §1/§11：宿主模型只改正文，结构解析、校验、落盘、发布确定性完成；模型不手写序号与时间轴 |
| **references 扩为 4 个**：asr-corrections（候选表+语境+反例）、line-break-cases（案例标注适用任务）、timing-policies（新增）、file-interface（新增） | §5.2/§6/§7.3/§15：词表从强制替换改为有条件候选；字数口径统一（han_count / visible_char_count）；重新分段规则外置按需读取 |
| **tests/eval-cases.md 重写**：结构层（pytest A01–A19）与宿主行为层（B01–B26）分离 | §16：结构单测不能证明语言质量；行为评测按事实与语义断言 |
| **删除 add-subtitle 模块**（8 个文件）并清理 marketplace 注册、audio-transcribe 两处引用与一行测试注释 | §14：模块删除，有效入口不得再调用；历史文档（本交付文档、需求文档）保留模块名作历史记录 |
| marketplace 插件描述更新（去掉 add-subtitle，text-refine 描述改为校对/翻译/精简润色）；`metadata.version` 不变 | §14.1 + 仓库惯例（历次功能提交均不 bump version） |

## 已运行的检查与结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 结构与 CLI 单测 | `pytest plugins/video-toolkit/skills/text-refine/tests -q` | **83 passed**（覆盖 A01–A19 对应断言） |
| 四场景可复现演示 | `python3 plugins/video-toolkit/skills/text-refine/tests/demo_pipeline.py` | **4/4 通过**（英文校对 / 中译英 / 中文 TXT 精简 / 100 条长文件中断恢复） |
| 兄弟套件回归 | `pytest plugins/video-toolkit/skills/audio-transcribe/tests -q`<br>`pytest plugins/video-toolkit/skills/video-tts/tests -q` | **141 passed** / **270 passed, 1 skipped**（与会话开始基线一致） |
| 注册完整性（A19） | `python3 -m json.tool .claude-plugin/marketplace.json` + 逐路径存在性检查 | 可解析；8 个注册 skill 路径全部存在 |
| 残留引用（A19） | `grep -rn "add-subtitle" plugins/ .claude-plugin/` | 零命中（仅历史文档保留提及） |
| 文档禁令检查 | heredoc 作为指令（`cat >>`/`<<`）、32000、12 字、固定并发数 | 零命中；heredoc 仅作为「正文是数据」保护说明出现（spec §11 要求） |

⚠️ 已知调用怪癖（与本次改动无关）：audio-transcribe 与 video-tts 两套件**在同一 pytest 进程合跑**会因各自 `run.py` 同名而 import 串扰；分开跑均全绿。正确跑法即上表分行命令。

## 平台验证范围

**Mac（Apple Silicon, Python 3.15）已实测**：全部单测、四场景演示、中文/空格/引号路径（A05）、BOM/CRLF 输入（A05）、中断恢复（A10）、篡改检测（A12）、不覆盖发布（A13）。

**Windows 未实机验证**（本机无 Windows 环境），以下项为纯标准库跨平台写法、理论兼容但未实测：
- 路径分隔与中文/空格路径（代码全部走 `pathlib`，无硬编码 `/Users/...`）
- UTF-8 读写（显式 `encoding="utf-8"`；`os.replace` 原子替换；目录 fsync 已按不可用时忽略处理）
- 分块落盘、恢复与最终发布的全流程
- `${CLAUDE_PLUGIN_ROOT}` 反斜杠形式调用（SKILL.md 已写明两种写法）

## B 类抽样行为评测（本次实际执行的 4 例）

| 用例 | 执行方式 | 结果 |
| --- | --- |---|
| B02 校对英文字幕只纠错 | demo 场景 1 真跑管线：输出保持英文、拼写修正、命名关系保留、时间轴逐行一致 | 通过 |
| B04 中文字幕翻成英文 | demo 场景 2 真跑管线：数字/否定/专名保真、时间轴不变 | 通过 |
| B19 美化 TXT 不加 Markdown | demo 场景 3 真跑管线：无 `#`/`**`/`>` 标记、事实保留 | 通过 |
| B25 只校对不自动配音 | SKILL.md 工作流与上下游节均无任何 TTS 调用路径；管线代码无 TTS 依赖 | 通过（文档级验证） |

其余 B 用例（B01 交互路由、B03 目标语言询问、B05–B26）需在真实宿主会话中按 `tests/eval-cases.md` 执行，本次未逐一跑——不将其标为已通过。

## 剩余限制

1. **resegment 精确对齐**：只有词级时间戳（`word-timestamps`）或可用对齐能力（`audio-align`）时才能精确拆条；仅句级 SRT 时按 `srt-estimate` 估算并如实标注，需用户明确接受。
2. **内容审校质量**：结构校验是确定性的，语义保真（否定/数值/术语）仍依赖宿主模型与逐块审校；B 类全量行为评测待真实宿主执行。
3. **MD 行内保护粒度**：受保护块（围栏/表格/frontmatter）与链接地址、行内代码为硬校验；标题、列表等结构靠「块级原文回填」保持，未做 Markdown AST 级保护（spec §8.1 明确避免全量解析再序列化）。
4. **Windows 实机验证**：见上节清单。
