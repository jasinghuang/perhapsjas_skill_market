# oscar-performance 交接

## 当前状态

- 版本：1.5（2026-11-20）。
- 项目源：`/Users/jasing/Documents/Work/perhapsjas_skill_market/plugins/video-toolkit/skills/oscar-performance/`（2026-11-20 由 `创作提示词/oscar-performance/` 移入市场仓库）。
- 状态：已提交到市场仓库 `plugins/video-toolkit/skills/` 并注册在 `marketplace.json`；未安装。市场发布以仓库 main 为准。
- 入口：[SKILL.md](SKILL.md)。导航：[README.md](README.md)。方法说明：[方法论.md](方法论.md)。

## 用户已确认的核心决策

1. 新建自包含的编写型 skill `oscar-performance`；不引用、不依赖 `video-performance`，旧 skill 未来可删除。
2. 方法不删，重复的表述合并；案例可去重，方法不可丢。
3. 八维口径按唐国强篇：时间段、人物目的、情绪变化、台词触发词、面部动作与 AU、目光和身体、声音呼吸与停顿、结束状态和静止反应。
4. 提示词结构统一为四层主干：全局控制 / 人物内核 / 时间轴 / 声音与镜头。
5. 五元素场景引擎（Goal/Obstacle/Tactic/Reversal/Value Shift）为**必查**；单条 30 秒也跑，但不强制硬造反转。
6. 增加 AUDIT 诊断模式：不重写全文，给 weakest point + 最小/干净修复。
7. 默认交付全量版：理解卡、导演阐述、场景引擎判断、表演节拍表、八维记录、镜头/声音摘要、风险表、最终提示词、未解决冲突。
8. AU：常用简表进 `02-performance.md`，完整 FACS 表进 `au-reference.md`；AU 只作可选校准。
9. 例句中文为主；英文原例保留为来源对照。
10. 新增人物丰满度层：先挖文本，不新增设定；每拍 1–2 个可见细节。
11. 新增人物—物件交互层：事件前/中/后、表情三股力、肢体链、连续性、AI 负面约束。

## 文件结构

- `SKILL.md`：Agent 入口，五阶段、检查门、三种模式、输出格式。
- `方法论.md`：人类可读说明。
- `README.md`：文件导航与快速开始。
- `references/01-understanding.md`：七层、场景级概念、场景引擎五问、理解卡。
- `references/02-performance.md`：八维、acting task、微表情、台词/话权、身体、无台词、可选双人反差轴。
- `references/03-scene.md`：空间、摄影机、焦点、构图、光影、声音、时间轴、连续性。
- `references/04-prompt.md`：四层结构、语言规则、参数库、负面约束、参考图绑定。
- `references/05-verification.md`：自检、文字复核、风险表、AUDIT。
- `references/06-examples.md`：15 组案例（中文为主，标注来源）。
- `references/07-evaluation.md`：22 个文字用例与判据。
- `references/08-character.md`：人物丰满度、人物—物件交互。
- `references/au-reference.md`：完整 FACS/AU 表。
- `references/source-map.md`：A–E 五组来源逐条映射。
- `agents/openai.yaml`：Codex 兼容显示名。
- `evals/evals.json`：22 个机器可读用例。
- `验证记录.md`：自检记录；18 个结构自检通过，4 个待真实稿复跑。

## 来源分层

- A 唐国强篇：八维、三层结构、情绪节拍、台词即表情时间轴、AU、正反案例。
- B 对白暗流篇：话轮、重叠、抢话、语言受阻、悲伤三股力、四层结构。
- C 9 节整理稿 / 原始 S01–S15：场景构建、空间、镜头、光影、声音、案例。
- D higgsfield-acting-skill：acting task、scene goal、ending names event、all in one event、physical channel。
- E higgsfield-prompt-engine：五元素引擎、AUDIT、weakest point + minimal/clean fix。

## 验证与限制

- `evals/evals.json` 通过 JSON 解析；skill 内本地 Markdown 链接 0 个断开。
- 16 个文字用例结构自检通过：T01–T08、T10、T12、T15–T20。
- 4 个待真实稿复跑：T09（输入不完整）、T11（时长/台词冲突）、T13（局部修订）、T14（原稿跨轴/光源冲突）。
- 没有视频生成、没有逐帧观察、没有独立评阅者；不声称成片效果。
- 案例为原文案例/教学改写，不冒充本项目实测；原文没有的台词/完整提示词不补造。
- AU 不是模型接口；数值不是逐帧保证；肌肉清单不等于可靠控制。

## v1.1 增补（2026-11-20）

- 新增 `references/08-character.md`：人物丰满度、人物—物件交互。
- 新增 T19（人物丰满度）、T20（物件交互）；用例 18→20；16 个结构自检通过，4 个待真实稿复跑。
- 同步更新 SKILL.md、方法论.md、README.md、03-scene.md、02-performance.md、04-prompt.md、05-verification.md、01-understanding.md、source-map.md、evals.json、验证记录.md。

## v1.2 增补（2026-11-20）

- 对白暗流篇补强：02 §6 导语（为什么假 / 对白暗流编排 / AI 演员像人 / 失序带来真实）、§6.3 触发词规则、§6.4 speech disfluency 与“I”口吃完整链、06 §12 悲伤细节。
- source-map B 组改为“保留/补强”，修正 over-claim；T05 判据更新。
- 20 个用例、16 个结构自检通过、4 个待真实稿复跑不变。

## v1.3 增补（2026-11-20）

- 唐国强篇补强：02 §4.2 保护层设计法（emotional arc）、04 §1.3 六点清单与镜头层级、06 §15 30 秒四镜节拍与 “What about my life?” 示例。
- source-map A 组对应行改为“保留/补强”；新增 T21 保护层与情绪弧线。
- 21 个用例、17 个结构自检通过、4 个待真实稿复跑。

## v1.4 增补（2026-11-20）

- 新增“意外/事件的因果可见性”：03 §11、02 §9、05 §1.2/§10、01 §5.7；新增 T22。
- 22 个用例、18 个结构自检通过、4 个待真实稿复跑。

## v1.5 修正（2026-11-20）

- 用户指出：不应把办公室碰撞案例写进 skill；应先理解人物目的与事件起源，再提炼方法论。
- 移除 `03 §11.3` 的办公室碰撞案例；把“意外/因果可见性”提炼为“事件起源与因果链”：人物目的 → 注意力 → 信息差 → 环境/路径 → 触发 → 第一次意识 → 反应 → 后果。
- 同步更新 01 §5.7、02 §9、03 §11、05 §1.2/§10、T22、source-map G。
- 22 个用例、18 个结构自检通过、4 个待真实稿复跑。

## 下一步

1. 用用户真实脚本/提示词复跑 T09/T11/T13/T14，补进 `验证记录.md`。
2. 已提交到市场仓库 `plugins/video-toolkit/skills/oscar-performance/` 并注册；安装由用户决定，市场发布以仓库 main 为准。
3. 如有视频反馈，再补“生成后验收”附录；在此之前，文字结论只针对稿件。
4. 新增案例优先补 `06-examples.md`，并在 `source-map.md` 增加落点。

## 踩坑记录

- **不要把“方法不删”理解成“原文照搬”**：合并重复簇时，必须保留每条方法在 `source-map.md` 有落点。
- **不要把五元素必查做成硬造反转**：单条 30 秒氛围片可以写“无反转+理由”；必查是诊断，不是强制结构。
- **不要把 AU/量化当模型保证**：自然语言先行，AU 只作可选校准；不要堆编码。
- **不要把作者叙述写成本项目实测**：案例分“原文案例/教学改写/本项目实测”三类。
- **不要用四层模板覆盖用户原结构**：修订模式保留原结构，只给替换段。
- **不要忽略听者**：每个在画角色都要有任务；听者的反应要具体。
- **不要在旧矛盾后叠加新规则**：一次只改一层，先消除旧冲突。
