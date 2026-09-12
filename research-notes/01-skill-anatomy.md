# 01 · Skill 完整解剖：web-video-presentation 是什么、怎么运转

> 证据层见 [03-findings-audit.md](03-findings-audit.md)（对抗性复核），本文档是解剖层。所有 file:line 均已复核。

---

## 1. 本质：一步"降维翻译"

这个 skill 的真正产品**不是**那套 Vite 模板代码——代码层非常薄（核心 hooks 合计 < 400 行），护城河在 `references/` 里约 2000 行的"创作法"文档。

它解决的根本问题：**普通人/Agent 做视频，卡在时间轴上**。After Effects、剪映、Remotion 都要求操纵一条连续时间轴——什么在 2.3s 入场、什么在 4.1s 淡出。这对 LLM 是灾难：无法预判渲染结果、无法精准对轨、改一处动全身。

破解方式是"降维"：

> **把时间轴（连续）替换成步进计数器（离散）——视频的每一秒变成一个可点击的 step。**

时间不再是驱动力，"全局 step 游标"才是。画面怎么动完全由"当前 step 是几"这个纯状态决定。翻译完成后，视频制作变成纯前端开发——Agent 最擅长的事。

**产物形态**：Vite + React + TS 项目 + 按章节切分的音频 + 人肉录屏成片。

---

## 2. 五大核心机制（复刻必须一字不差继承）

### 2.1 时间轴 → 坐标轴：`chapter = f(step)` 纯函数渲染

`Stage.tsx` + `useStepper.ts` 构成引擎：

- 游标 `(chapter, step)`，点击/→ 推进，←/Backspace 回退，数字键跳章，Home/End 跳首尾（`useStepper.ts:139-160`）
- 章节组件是**纯函数**：`if (step === N) return <FullScene/>`，每步返回独立布局树
- 禁 `setTimeout`/`setInterval` 驱动动画——全部 CSS keyframes/transitions，靠节点挂载触发

**重挂机制（复核修正后的精确表述）**：
- `App.tsx:57` 的 `key={ch.id}` 挂在**章节层**——只在跨章节时强制重挂，不是每步
- 章内 step 切换时：相邻两步返回同类型根节点（如 Example.tsx 的 `div.ex-scene`）→ React 复用根节点只更新 children（**新挂载的子树播动画，复用的根不播**）；hook-chapter 这类在内部显式 `key={step}` 的章节 → 整树重挂
- **"挂载即动画，存活即静止"是框架最重要的隐性契约**，文档只在 EXAMPLES README 间接提到（"布局不重排，只是单元格内容变化"），复刻时应显式化
- ⚠️ **实证缺陷**：MaskReveal 的 clip-path transition **在挂载时永不重放**（React 插入前已带终态类 `in`，首帧即 `inset(0px)`，无可过渡起点——Playwright 实证，见证据报告 #1）。keyframes 类动画正常。模板 Example.tsx 的文字揭示全走 MaskReveal → **实际是瞬间出现、没有动画**

### 2.2 单一真相源：`narrations.ts`

整个 skill 最漂亮的工程决策（`templates/src/chapters/01-example/narrations.ts`）：

```
数组长度 = 章节 step 数 = 音频文件数 = Auto 模式推进依据 = mp3 命名依据
```

- `useStepper` 直接读 `narrations.length` 当 step 总数——**没有 `totalSteps` 字段可写错**（grep 全仓库仅两处"已移除 totalSteps"注释：AUDIO.md:9、chapters.ts:9）
- 同时是 5 处的真相源：step 计数 / 章节代码 `if (step === N)` 上界 / TTS 合成文本 / Auto 推进 / 文件命名。注释明言根除"网页 step 数和音频文件数对不上"的老问题
- 空串 `""` = 无声过场 step（不烧 TTS token，Auto 模式按字数估时撑过）
- 代价：自检协议必须反复强调"最大 N + 1 === narrations.length"，靠 agent 纪律保证 → 改进点（见 04 文档）

### 2.3 固定 1920×1080 舞台 + transform scale

`useStageScale.ts` 三层结构：

```
.app-shell        ← 视口居中（flex）
.stage-fitter     ← 真实可见 px（1920*scale × 1080*scale），flex 居中任何视口/DPR bulletproof
.stage-frame      ← 原始 1920×1080，transform: scale() 从左上角缩放
```

**没有响应式断点**——录制输出天然确定 16:9，是"视频感"的物理基础。marginX/marginY 默认 80/100 给隐藏 UI 留呼吸位。

### 2.4 音画同步：`audio.ended` 事件就是时间轴

`useAudioPlayer.ts` 是同步机制的全部：

| 模式 | 触发 | 行为 |
|---|---|---|
| manual（默认） | 直接打开 | 不播音频，点击/方向键推进 |
| audio（半自动） | `?audio=1` 或按 M | 进 step 自动播音频，手动推进 |
| auto（全自动） | `?auto=1` 或两次 M | 播音频 → `ended` + 200ms trail → 自动 next |

- **推进规则一句话**：`audio.ended + 200ms → next()`。**没有"等动画跑完"的兜底**——动画必须 ≤ 口播时长，否则被当场切断。这个约束反而倒逼节奏纪律
- 全覆盖退化路径：error 事件（:86）/ play() catch（:93）/ src null（:97）→ `estimateFallbackMs = max(1500, 字数×250)`（App.tsx:22-25），保证预览永远跑得通
- `AutoStartGate` 处理浏览器 autoplay 手势限制（Space 启动）
- 隐藏 chrome：进度条/模式切换默认 opacity 0，悬浮边缘才现（ProgressBar/AutoToggle），录屏画面干净

⚠️ **复核确认的 bug**：`?auto=1` 会从 localStorage（`presentation-cursor-v4`）恢复游标续播而非 step 0；RECORDING.md:62"刷新一次清空历史 step"不成立（localStorage 跨刷新持久）。且 localStorage 按 origin 存储——**同端口所有脚手架项目共享游标**（useStepper.ts:27-32 注释自己承认），跨项目污染。真正重置手段：Home 键或清 localStorage。

### 2.5 主题 token 双层契约

23 套主题（复核：23 套全部定义了全部 16 个必填 token）+ 严格消费规则：

- **必须用 token**：4 表面色 + 4 文字色 + 1 rule + 3 accent + 4 字体家族 = 16 个（THEMES.md:128-169）
- **章节自由发挥**：字号/间距/时长/缓动/边框——按内容写死即可
- 中间层 4 个"性格 primitive class"（`.hero-num` / `.rule` / `.card` / `.stage-frame`）：主题通过 `--hero-num-*`、`--rule-w/style`、装饰槽位（pattern/vignette/text-shadow）注入性格，章节只用 class 不碰 var
- 效果：换主题 = 覆盖一个 tokens.css，章节代码零改动——也是并行开发模式 C 的底气
- ⚠️ 复核发现：**7 个内置主题声明的字体从未被 fonts.css 加载**（Cormorant / Clash Display / Satoshi / Space Grotesk / Syne / Space Mono / Work Sans / Plus Jakarta Sans / Outfit）→ 静默回退，主题 DNA 部分丢失（详见 04 文档缺陷 #4）

---

## 3. 全流程运转细节

### 3.1 Phase 1 —— 内容生产流水线

```
用户输入三态识别 → article.md(保留不删!) + script.md + outline.md 三件套
```

**输入三态**（SKILL.md 1.1）：
| 用户给的 | 该做的 |
|---|---|
| 原始文章 | 一次产出 script.md + outline.md |
| 直接的口播稿 | 落盘 script.md，产简化版 outline.md |
| 啥都没有 | **反问**要素材/大纲——skill 不替用户构思内容 |

**双源原则**（核心设计）：
- `script.md`（口播稿）决定**节拍**：`---` 分隔 = step 边界
- `article.md`（原文）决定**画面密度**：outline 每章首段抽"信息池"（数字/引用/案例 + **必带来源标注** `—— article §X / Lxx`），章节实现时回原文挂"口播没念但画面能显示"的细节
- 判据：画面信息密度 > 口播信息密度。只用口播稿做章节 = 把口播打字上屏 = PPT 不是视频

**SCRIPT-STYLE.md（~410 行）**：完整的"去 AI 腔"写作法——
- 最高约束：信息保留度 ≥ 60%（`wc -m` 可验证；原文 5000+ 字做 3 分钟视频 → 告诉用户拉长或拆集，不许缩到 30% 假装做完）
- 8 条形式原则：口语化 / 每句 ≤20 字 / 第二人称 / 3 秒钩子（悬念/反差/利益三种）/ `---` 切节拍 / 数字翻译成感受（核心冲击数字除外）/ 禁结构词堆砌 / 具体例子优先
- 五类 AI 指纹（风骨层）：假共情（"我知道你最近…"）/ 假深刻（"恰恰/反而/正是"包装）/ 自我标榜（"我必须认真说"）/ 万能模板（"说白了/一句话总结"）/ 排比堆砌（连续 ≥3 同构短句）
- 平台变体：B 站（默认）/ 抖音 ≤12 字 1 秒钩子 / YouTube long-form / 知乎 / 小红书；微妙的边界区分："小红书闺蜜感 ≠ AI 假共情"（区别在有没有具体场景）

**OUTLINE-FORMAT.md**：最反直觉也最关键的一条——**outline 只规划节奏与信息密度，禁止写动画**。理由（SKILL.md）：写死动画 = chapter agent 退化为翻译机；留白才能触发"内容驱动动画"的即时设计。另规范：
- 命名：`0N-<id>` 文件夹 = 章节 id = 音频子目录；PascalCase 组件；`.cd-` 式 CSS 前缀
- 章节切分经验：每章 3~8 步 / 30~60s 一聚焦主题 / 总时长÷30 ≈ 章节数 / 章节边界 = 口播稿里"讲者会咳一声换语气"的位置
- 末尾素材清单（✓/⚠️ 分章节标注）

### 3.2 协作协议（skill 的另一半灵魂）

**三个硬 checkpoint，故意合并对齐轮次**：

1. **Checkpoint Plan**——一次对齐 5 件事（稿子/outline/主题/素材/开发模式）。agent 预备动作：读全部 `themes/*/theme.json` 动态生成推荐（**不硬编码清单**）、按 `bestFor` 字段命中内容类型挑 2~3 套、扫素材清单。用户说"你帮我选"→ 取推荐第 1 个并说明理由给反悔机会
2. **第 1 章 = 强制 anchor**——必须主线程 + 用户验收，不可跳过。理由：CHAPTER-CRAFT 指引在当前主题+题材下的第一次落地；token 不够用/指引有盲区一定在第 1 章暴露，早改成本最低；后续章节（含并行 subagent）都参考第 1 章代码模式
3. **Checkpoint Audio**——合成前让用户扫 `audio-segments.json` 确认文本，才烧 TTS token

**自检协议**（贯穿全程，带能力降级链）：
```
Agent Teams 独立 reviewer → subagent → 自检兜底
铁律：先按 fail 项改完再汇报；直接拿原始结论汇报 = 违规
```
三个产出各有专属 checklist：script.md（SCRIPT-STYLE 三层自检）/ outline.md（OUTLINE-FORMAT 自检）/ 单章实现（CHAPTER-CRAFT 完工自检，15 项含 tsc --noEmit）。

**开发模式 A/B/C**：
- A 逐章确认（默认，风险最低）
- B 第 1 章后顺序开发（不支持并行的环境）
- C 第 1 章后 subagent 并行（用户控并行数）。风格漂移被定性为 feature："人手写视频的呼吸感"，靠 token + 章节物理隔离兜底。并行 prompt 必含：outline 段落 + CHAPTER-CRAFT 路径 + theme.json 气质 + 第 1 章代码作风格参考 + 硬规则（独立前缀/不改 chapters.ts/tsc）

**渐进式文件读取**：SKILL.md 有"阶段 × 必读文件"表——"写章节时只读一份 CHAPTER-CRAFT.md"，防长会话遗忘原则（章节实现重复 N 次）。EXAMPLES 目录自带"不是抄袭模板是结构 anchor，倒着抄 = 反模式"警告 + "地板不是天花板"进阶玩法表。

⚠️ **复核发现的结构漂移**：SKILL.md:116,159,411,431,444 与 scaffold.sh:205,228-230 反复引用"Part 0 十条原则 / Part 1 开工 5 问 / Part 2 关系→动作决策树 / Part 3 视觉工具箱 / Part 8 反馈速查"——实际 CHAPTER-CRAFT.md（224 行）**无 Part 编号**，"开工 5 问 / 决策树 / 反馈速查"三节**不存在**（427910e8 把 373 行旧版重写后路标未更新）。agent 按路标翻找会扑空。

### 3.3 Phase 2 —— 网页开发

**scaffold.sh**（182 行，复核 CONFIRMED）：
```
npm create vite@latest (react-ts) → npm install → 装 tsx
→ 删 Vite boilerplate → 拷模板（hooks/components/registry/example 章节）
→ 拷所选主题 tokens.css → node 合并 package.json scripts
→ 写 .theme 标记 → npx tsc --noEmit 冒烟 → 输出下一步指引
```
带 `--list-themes`（grep+sed 提字段，不依赖 jq）；目标目录非空拒绝覆盖。

**2.5 大改后 bump STORAGE_KEY**：改 chapters.ts（增删重排章节或某章 narrations 长度变化）后手动 bump `v4` → `v5`，防持久化游标落空。

### 3.4 Phase 3 —— 音频管线（provider-agnostic）

```
narrations.ts ×N ──tsx 动态 import──▶ audio-segments.json ──jq 循环──▶ tts-providers/<name>.sh ──▶ public/audio/<id>/<N>.mp3
```

- **extract-narrations.ts**：用**正则**解析 chapters.ts（直接 import 会拉进 React/CSS），对每个 narrations.ts 做 `await import()`（React-free）。⚠️ 复核修正：配对机制是**后缀匹配**（`folder.endsWith("-" + id)` 取 candidates[0]，import 顺序决胜）+ 全等回退——**代码内注释声称的"1:1 配对"与实现不符**。脆弱点：后缀碰撞静默错配（`01-hook` vs `07-pre-hook`，import 顺序决定对错）；非字面量 id/注释 id 静默丢章或幽灵章；非标准 import 路径 loud error（安全）
- **synthesize-audio.sh**：runner 不绑任何 TTS。串行（防 rate limit）、增量（已存在跳过 = 断点续合不烧重复 token）、`--force` 重合成、进度打印 `[ 3/24] coldopen/3.mp3 ✓ 4s`
- **三函数契约**：`tts_synthesize <text> <out> [voice]`（必需）/ `tts_check` / `tts_install_help`。内置 minimax（mmx-cli）+ openai（curl）；README 附 5 段可粘贴片段（ElevenLabs / edge-tts / macOS say / Azure / Google）。甚至记了 macOS bash 3.2 空数组 + `set -u` 会炸的坑
- **合成后校验**：ffprobe 逐条出时长，≥15s 的段 = narration 过密或该拆 step → 给最后一次节奏校准机会
- **退化路径**（2.D）：两个内置 provider 都没就绪 → 给用户 4 选 1（openai / 装 mmx / 换 5 种 provider / 跳过自行录制）。**"不要假装合成成功"**

### 3.5 Phase 4 —— 录屏

Auto 模式一镜到底：`?auto=1` → 全屏 → 开录屏（Cmd+Shift+5 / QuickTime / OBS）→ 按 Space → 整片自动跑完 → 停录 → 裁头尾即成片。**音视频天然同步，零后期对轨**。没合成音频则退回"手动点击 + 后期配音"（DaVinci / iMovie / 剪映）。

---

## 4. 设计决策背后的"为什么"（复刻时最容易被丢掉的部分）

| 决策 | 为什么 |
|---|---|
| outline 不写动画 | 写死 = chapter agent 退化翻译机；留白触发内容驱动设计 |
| 第 1 章强制主线程 + 验收 | 指引/主题盲区早暴露早改，成本最低；并行模式的风格锚点 |
| "没有等动画的兜底" | 倒逼节奏纪律；比加复杂度好 |
| 素材缺失用 placeholder 卡 | "没有就承认没有，比 fake 强一百倍"；禁 emoji 凑/无关图凑/编数字 |
| provider 只内置 2 个 | "不替你做更多技术选型"；5 段片段给足扩展路径 |
| 模式 C 风格漂移 = feature | 多 voice/多视角的呼吸感；token 兜底气质不跑偏 |
| 每次 checkpoint 合并 | 压缩人机往返；git 历史显示旧版双 checkpoint 已合并为单 Checkpoint Plan |
| 一次产出 script+outline | outline 不写动画后依赖只剩"稿子切节拍 + article 抽池"，可同思考完成 |

## 5. 演化方向观察（git 历史）

版本演化显示迭代方向一直是**减少 agent 需要读的文件数、减少人工维护的状态、把约束从"文档纪律"收敛到"结构保证"**：

- `PRINCIPLES.md`（173 行）+ `PATTERNS.md`（196 行）→ 427910e8（05-03）删除并入 CHAPTER-CRAFT 单一入口（README 死链由此来，未更新）
- 双 checkpoint（A1/A2）→ 单 Checkpoint Plan
- `{text, minHoldMs}` narration 形式 → 删除（extract-narrations 遇到非字符串直接报错并提示三选一）
- `totalSteps` 字段 → 删除（narrations.length 唯一真相源）

**如果你要复刻，这个方向本身就是最好的设计指南**——每一处能从"要求 agent 记住"变成"结构上不可能写错"的地方，都值得改。
