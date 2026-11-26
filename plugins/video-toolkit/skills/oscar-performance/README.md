# oscar-performance

编写、修订、诊断 AI 视频表演提示词的 skill。方法版本 **v1.6**，支持 Codex 和 Claude Code，包含在 [perhapsjas Skill Market](https://github.com/jasinghuang/perhapsjas_skill_market) 的 **`video-toolkit`** 插件中。

输入剧本、对白、故事大纲、分镜文字或已有提示词，输出有任务、有触发、有处理过程、能跨镜承接的表演指令，以及可复制的视频生成提示词。

本 skill 由当前 Agent 执行文字设计，无需额外 API Key、Python 或本地音视频模型；不依赖旧版 `video-performance` 或其他外部 skill，不执行视频生成。

## 安装

**先添加市场，再安装 `video-toolkit`。** `oscar-performance` 是插件内的 skill，市场中显示的安装条目为 `video-toolkit`。

### Codex 桌面端

打开“添加插件市场”，填写：

| 字段 | 内容 |
| --- | --- |
| 来源 | `https://github.com/jasinghuang/perhapsjas_skill_market.git` |
| Git 引用 | 留空，使用仓库默认分支 `main` |
| 稀疏路径 | 留空 |

来源填写仓库根地址，不是本 README 或 `SKILL.md` 的网页地址。不带 `.git` 的仓库 HTTPS 地址也支持；窗口中的灰色 `plugins/codex` 是占位示例，无需填写。

添加后，在 `perhapsjas_skill_market` 市场安装 `video-toolkit`，再新建聊天使用 `oscar-performance`。来源格式详见 [OpenAI 官方说明](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli)。

### Codex CLI

```bash
codex plugin marketplace add https://github.com/jasinghuang/perhapsjas_skill_market.git
codex plugin add video-toolkit@perhapsjas_skill_market
```

### Claude Code

在 Claude Code 中执行：

```text
/plugin marketplace add jasinghuang/perhapsjas_skill_market
/plugin install video-toolkit@perhapsjas_skill_market
```

安装后重启 Claude Code，再开始新会话。

## 快速开始

在 Codex 中可以用 `$oscar-performance` 显式调用；在 Claude Code 中也可以直接说明“使用 video-toolkit 中的 oscar-performance”，并附上文本或文件路径。

### 从剧本创作

```text
使用 $oscar-performance 为下面这场戏写表演提示词。
时长 30 秒，画幅 2.39:1；台词、人物关系、结尾锁定；风格克制写实。
[粘贴剧本/故事/分镜]
```

### 优化已有提示词

```text
使用 oscar-performance 修订下面的提示词。
保留剧情、台词、镜头、时长和原有结构，重点补足人物感知、处理、行动选择、
可见或可听的证据及状态承接。只读取最终可复制正文进行验收。
[粘贴已有提示词，或提供文件路径]
```

### 只诊断或局部修改

```text
使用 $oscar-performance 诊断下面这段提示词，先告诉我最弱的一环，不要重写全文。
[粘贴提示词]
```

```text
使用 oscar-performance 只修改第三镜的表演，保留其他镜头和全部台词。
给第三镜的替换段，并检查它与前后镜头的状态衔接。
[粘贴提示词，或提供文件路径]
```

## 工作方式与交付

| 模式 | 处理方式 | 交付 |
| --- | --- | --- |
| 创作 | 先理解全稿，再设计表演与场景耦合 | 完整表演方案及可复制提示词 |
| 修订 | 保留原结构与锁定项，补表演及直接相关的冲突 | 完整修订稿；局部请求只给替换段 |
| 诊断（AUDIT） | 检查结构与表演，确定收益最大的薄弱点 | 最弱一环、最小修复与干净修复建议，不重写全文 |

关键节拍按以下过程设计：

```text
起始任务与状态 → 感知/触发 → 处理与行动选择 → 可见/可听证据 → 结束与承接
```

验收直接核对最终复制正文中的证据。动作顺畅、分析表完整或写了“自然、克制”，都不能代替表演过程；画外旁白与画内人物分别检查。无对白、即时反射和持续状态按实际任务处理，不强制增加犹豫、冲突或情绪转折；AU 编码仅作可选校准。

默认交付包含理解卡、导演阐述、场景引擎五问、表演节拍、八维检查、视听摘要、风险表、最终提示词及未解决冲突。需要简版时可说明“只要成稿”；方法与执行入口见 [SKILL.md](SKILL.md)。

这些检查只判断文字设计是否成立，不保证视频模型逐项执行，也不代表已通过成片验收。

## 更新与排查

Codex 先刷新市场，再更新插件：

```bash
codex plugin marketplace upgrade perhapsjas_skill_market
codex plugin add video-toolkit@perhapsjas_skill_market
```

Claude Code 在终端中执行：

```bash
claude plugin marketplace update perhapsjas_skill_market
claude plugin update video-toolkit@perhapsjas_skill_market
```

更新后，Codex 使用新聊天加载新版；Claude Code 重启后应用更新。两个客户端的市场副本与安装缓存各自独立。

- **市场中找不到同名 skill**：选择并安装 `video-toolkit`，安装后再调用 `oscar-performance`。
- **已添加市场但无法使用**：确认插件已安装、已启用；在 Codex 可运行 `codex plugin list --marketplace perhapsjas_skill_market --available --json` 查看状态。
- **更新后仍用旧内容**：依次刷新市场、更新插件、重新加载会话；仅拉取仓库代码不会自动更新已安装缓存。已添加的市场保持原 Git 引用，刷新时使用更新命令。

其他 skill 与完整市场说明见 [仓库 README](../../../../README.md)。

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

## 维护

- 方法版本：1.6。
- 修改方法后，同步更新 `source-map.md` 与 `验证记录.md`。
- 不把旧 skill 或外部 skill 作为运行依赖；本 skill 自包含。
