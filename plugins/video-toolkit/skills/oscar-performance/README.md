# oscar-performance

编写、修订、诊断 AI 视频表演提示词的 skill。入口是 [SKILL.md](SKILL.md)。

## 文件导航

| 文件 | 用途 |
|---|---|
| [SKILL.md](SKILL.md) | Agent 入口：五阶段、检查门、三种模式、输出格式 |
| [方法论.md](方法论.md) | 人类可读：为什么这样编排、核心原则、方法地图 |
| [references/01-understanding.md](references/01-understanding.md) | 前置理解：七层、场景引擎五问、理解卡 |
| [references/02-performance.md](references/02-performance.md) | 八维、逐拍处理过程、acting task、微表情、台词/话权、身体、无台词 |
| [references/03-scene.md](references/03-scene.md) | 轴线、机位、焦点、景别、光影、构图、声音、时间轴、连续性 |
| [references/04-prompt.md](references/04-prompt.md) | 四层结构、语言规则、参数库、负面约束、参考图绑定 |
| [references/05-verification.md](references/05-verification.md) | 最终正文独立验收、逐拍证据、自检、文字复核、风险表、AUDIT |
| [references/06-examples.md](references/06-examples.md) | 案例库（中文为主，标注来源） |
| [references/07-evaluation.md](references/07-evaluation.md) | 28 个文字验证用例与判据 |
| [references/08-character.md](references/08-character.md) | 人物丰满度、人物—物件交互 |
| [references/au-reference.md](references/au-reference.md) | 完整 FACS/AU 表（可选校准） |
| [references/source-map.md](references/source-map.md) | 原文逐段对照，方法不丢的凭证 |
| [HANDOFF.md](HANDOFF.md) | 项目交接：决策、验证状态、踩坑与下一步 |
| [验证记录.md](验证记录.md) | 既有用例历史自检与 v1.6 六组验收对照（非独立评估、非视频验收） |
| [evals/evals.json](evals/evals.json) | 机器可读用例（可选） |

## 快速开始

```text
使用 $oscar-performance 为下面这场戏写表演提示词。
时长 30 秒，画幅 2.39:1；台词、人物关系、结尾锁定；风格克制写实。
[粘贴剧本/故事/分镜]
```

```text
使用 $oscar-performance 诊断下面这段提示词，先告诉我最弱的一环，不要重写全文。
[粘贴提示词]
```

## 维护

- 方法版本：1.6。
- 修改方法后，同步更新 `source-map.md` 与 `验证记录.md`。
- 不把旧 skill 或外部 skill 作为运行依赖；本 skill 自包含。
