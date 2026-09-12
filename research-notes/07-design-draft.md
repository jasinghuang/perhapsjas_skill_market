# 07 · 新视频 skill 需求设计（定稿）

> **状态**：**已定稿**（2026-09-04：用户确认全部章节 + 2 agent 独立质检 + 全部发现已修复；命名与触发器文案留待 M7 打磨）
> **对象**：复刻并深度重构 `web-video-presentation` 的新 skill（暂未命名）
> **方法**：基于 [01-06 研究文档](README.md) 的结论 + 与用户逐节对话打磨 + 对抗性审查
> **已敲定决策以「已定」标注，待敲定以「待定」标注**

---

## 0. 原始需求 15 条 → 归宿映射

| # | 原始需求 | 归宿 |
|---|---|---|
| 1 | 生成富有动画效果的 PPT 视频 | 总目标（§1） |
| 2 | 样式美观，参考 beautiful-html-templates | 美学 DNA 参考（§5 主题系统） |
| 3 | 文稿→口播稿→分镜/步骤动画；画面补口播没念的细节 | 双源原则继承（§7 Phase 1/3） |
| 4 | 主题风格重新设计，如何控制风格 | §5 主题系统（token 契约 + 四乘数） |
| 5 | 字幕功能 | §9（CaptionLayer + 烧录 + SRT 副产物） |
| 6 | 渲染管线，导出视频 | §8（A′ 确定性 seek 渲染） |
| 7 | 播放/暂停/停止/导出，无点击推进 | §9（播放控制） |
| 8 | 延续严格 harness | §7（Phase 0-5 + Checkpoint + 门禁） |
| 9 | 每阶段提示词与你打磨确认 | §7（提示词文档集合，开发期逐份打磨） |
| 10 | 第一阶段先确定静态分镜让用户确认 | §7 Phase 3（静态章节先行 + storyboard.html） |
| 11 | React 库 vs Vite 模板 | **已定**：Vite 模板（三层叠加形态） |
| 12 | reacticle 受控组件，禁手写裸样式 | §6（组件库铁律） |
| 13 | npm run check 机器门禁（含视觉 token） | §7/§11（门禁清单 + token lint + 注册表覆盖断言） |
| 14 | 组件库锁地板，天花板留给章节层 | **已定**：地板强制 / 天花板自由 + 构图模式库可选（§6） |
| 15 | 音频驱动 vs 分镜驱动 | **已定**：音频驱动为主 + 时长数据化（§3） |

---

## 1. 定位与范围

**一句话定位**：把一个原始文稿，经"口播稿 → 静态分镜确认 → 动画章节 → 音频 → 确定性渲染"全管线，产出**带字幕、自动播放的动画口播视频**（16:9 与 3:4 双平台双项目），同时保留浏览器即播放器的实时预览能力。

| 维度 | 决策 | 状态 |
|---|---|---|
| 技术形态 | Vite 模板（骨架）+ reacticle 受控组件库（地板）+ harness（流程协议+机器门禁）三层叠加 | 已定 |
| 画面比例 | **双项目**：B站 16:9（1920×1080）+ 小红书 3:4（1080×1440），各自独立完整流程 | 已定 |
| 稿子 | **两个平台各自定制稿子**，口播优化提示词按平台独立设计（平台档案承载） | 已定 |
| 首批主题 | 1 套精做 = creative-mode 1:1 还原（§5.4），token 架构按可无限扩展设计 | 已定 |
| 平台口味 | 继承 SCRIPT-STYLE 平台变体，v1 两档案：B站 + 小红书 | 已定 |
| 交互 | 自动播放唯一推进；播放/暂停/停止/导出四控制；点击推进降级为开发调试 | 已定 |
| 非目标 | 不做 9:16、不做真人出镜、不做批量变体出片 | 已定 |

## 2. 总架构

```
harness（流程协议 + 门禁）—— SKILL.md Phase 流程 + Checkpoint + check/render 命令
        │ 套在
组件库（reacticle 受控组件 + 构图模式库）—— 地板锁质量，动画语义内建
        │ 装在
Vite 模板（骨架 + 引擎 + 主题 token）—— scaffold 出来的一次性项目
```

**平台档案（Profile）= 第一公民抽象**：

```
用户输入素材 ──▶ Phase 0 意图对齐（选平台：B站16:9 / 小红书3:4，可多选；素材对齐：用户提供/agent 挑选/placeholder 三选一）
                     │
        ┌────────────┴────────────┐
   B站档案（16:9）          小红书档案（3:4）
   各自完整跑一遍 harness，互不共享状态
```

- 档案文件（`profiles/bilibili.md` / `profiles/xiaohongshu.md`）各含：舞台尺寸、口播风格提示词、outline 约定、字幕/构图约定、渲染参数
- 新增平台 = 新增一个档案文件，引擎与 harness 不变
- **引擎回到单比例**（舞台尺寸由档案参数化——原版 Stage.tsx 的 1920×1080 字面量需参数化，小改），原 skill 引擎结构可几乎照抄

**数据流（双源原则继承，新增两个阶段）**：

```
article.md ──┬──▶ script.md（口播稿，--- 分隔 = 节拍，按平台风格提示词润色）
             └──▶ outline.md（章节节奏 + 信息池，禁动画）
                     │  Checkpoint 1：稿子/大纲/主题/素材对齐
                     ▼
             脚手架 + 机器生成 narrations.ts（改稿走重生成）
                     ▼
             音频合成（三函数契约）→ ffprobe 实测 → audio-durations.json
                     ▼
             Phase 3 静态分镜（章节静态终态版 + 截图 storyboard.html）
                     │  Checkpoint 2：全部画面静态分镜确认
                     ▼
             Phase 4 章节开发（在静态版上叠动画，组件+token 组合）
                     │  npm run check 门禁
                     ▼
             npm run render → mp4（字幕可选烧录 + SRT 副产物）
```

## 3. 时间与驱动模型 + 引擎优化

### 3.1 三层时间模型

1. **step 游标（创作层）**：`chapter = f(step)` 纯函数，`narrations.ts` 单一真相源（长度=step数=音频文件数）——原样继承
2. **音频驱动（运行时）**：**`audio.ended` 且 动画窗口结束 → 停留垫 → next()**——动画窗口实测是**引擎层通用能力**（与渲染共用同一测量），预览与成片同源同节奏。**步长（停留时长）= max(音频时长, 动画窗口) + 停留垫**——构造上满足停留 > 动画、停留 > 音频（用户定），动画永不被切断、音频念完有消化拍。停留垫层级：**引擎默认 400ms（已定）** → 档案可覆盖（平台节奏）→ 分镜每帧可调（载体 `timing.json`，引擎导出、运行时与渲染共同消费）。**已定：音频驱动为主**（人声节奏是真相源），预估兜底退居最后手段
3. **seek 运行时（渲染层，新增）**：一切动画统一走可 seek 运行时（WAAPI/GSAP，组件库封装），渲染逐帧 `seek(t)` + 截图；Canvas 走帧函数逃生舱（`draw(t)` + 虚拟时钟）。**同一机制服务渲染与门禁**

### 3.2 引擎优化（三类）

**A. 原版缺陷修复（继承即优化）**：章节注册 manifest 化（消灭正则后缀匹配）；STORAGE_KEY 按 chapters.ts 内容 hash 自动失效；`?auto=1` 从 step 0 起播；其余缺陷（MaskReveal/字体契约/端口/链接）全部在引擎/scaffold/文档层修掉。

**B. 新需求驱动能力**：暂停 = 冻结所有时间线（seek 运行时直接收益）；下一段音频预加载（消除段间 decode 延迟）；audio-durations.json 进运行时（实测时长替代估算作兜底；估算公式 = max(1500, 字数×250ms)，继承原版 App.tsx）；渲染编排器（第四模块）。

**C. 结构纪律**：引擎极小化（目标 <800 行）+ `.engine-version` 标记 + check 时提示升级；"挂载即动画"契约显式化并由运行时强制生命周期；兜底降级链（音频缺失→实测时长→估算；渲染 seek 失败→实时捕获）。

## 4. 与原 skill 差异对照

| 维度 | 原 skill | 新设计 | 性质 |
|---|---|---|---|
| 成片方式 | 人肉录屏 | A′ 确定性渲染（录屏保留作 fallback） | 新增 |
| 交互 | 点击推进 | 自动播放 + 播放/暂停/停止/导出 | 替换 |
| 画面比例 | 固定 16:9 | B站 16:9 + 小红书 3:4 双项目 | 新增 |
| 稿子 | 单一平台变体 | 每平台独立定制稿子 + 独立提示词 | 升级 |
| 主题 | 23 套 | 1 套精做、架构可扩展 | v1 收缩 |
| 样式纪律 | 文档纪律 + agent 自觉 | 组件库强制 + 机器门禁 | 升级 |
| 流程 | Phase 1-4 | Phase 0-5，新增静态分镜确认 | 新增 |
| 字幕 | 无（靠 add-subtitle 后期） | 主题驱动字幕层内置 | 新增 |
| 章节自由度 | 任意 CSS/动画 | 组件+token 组合，禁裸样式 | 收窄（换质量地板） |
| 已知缺陷 | 9 项 | 全部规避 | 修复 |

**灵魂保留清单**（一字不丢）：step 模型、narrations 单一真相源、双源原则、音频驱动、harness 协作协议（三 checkpoint 精神）、第 1 章强制验收、模式 A/B/C、渐进式文件读取、placeholder 卡 > fake 素材（诚实原则）、三函数 provider 契约、"不要假装合成成功"。

**双项目 vs 单项目双布局（已定：双项目）**：理由——两个平台稿子各自定制（本就不是同一支片子）；引擎零改造；单一真相源的收益不复存在（稿子不同则音频/时长全不同）。代价（narrations 双份）不复存在因为流程本来就跑两遍。

## 5. 主题系统

### 5.1 token 契约（#4 清单逐项归属）

| 视觉维度 | 归属 | 机制 |
|---|---|---|
| 背景色/字色/分割线/阴影 | 基础 token | `--surface*` `--text*` `--rule*` `--shadow*`（原版 16 必填继承扩展） |
| **强调色（多槽位）★** | 基础 token | `--accent-1..4` 可选槽位（主题声明才存在，绿/粉可带 dark 变体）；章节饱和色只能来自此集合（门禁 #2 结构性保证） |
| 表格颜色 ★ | 语义 token | `--table-*`（行线/表头/表头文字/斑马纹），`<Table>` 消费（--table-head-text 为执行期新增：表头墨底需配反色文字） |
| 动画时长缓动 ★ | 动效 token | `--dur-fast/mid/slow` + `--ease-in/out/emph` + `--stagger`（数值化，机器可查） |
| 动态元素形状 ★ | 语义 token | `--decor-family`（dot/bar/ring/polygon/block/stamp 六族），装饰组件消费 |
| 卡片长相 | 语义 token | `--card-*`，`<Card>` 消费 |
| 卡片大小 | 间距阶 + 组件 props | `--space-1..6` 选档，不写裸 px |
| 间距网格 ★ | 基础 token | `--space-1..6` + `--grid-gutter` |
| 字号大小 ★ | 基础 token（字阶） | `--t-display-1..micro`，门禁校验"章节 px ∈ 字阶集合" |
| 大数字性格/字体样式 | 语义 + 基础 | `--hero-num-*` 继承；字体四坑位 + 字体契约 |
| 对齐样式 | 章节层 | 构图自由 |
| **边框宽/圆角** ★ | 语义 token | `--border-w` `--r-card` `--r-pill`（creative-mode 的 4px 墨框/零圆角正是此槽位） |
| **舞台纹理/留白密度** | 基础 token | `--surface-pattern*` `--vignette` `--stage-pad-x/y`（v1 由主题内部固定、不对章节开放） |

★ = 原版没有、新设计新增的维度。三层结构：基础 token（色/字阶/间距阶）→ 语义 token（卡片/表格/分割线/徽章/大数字/装饰语言/字幕）→ 组件 token（v1 留空位）。

### 5.2 字体契约（修原版缺陷 #8）

theme.json 声明 `fonts: [{family, weights, source}]` → scaffold 时"声明=加载"校验 + 自动安装 fontsource 自托管包（大陆可达，CJK unicode-range 按需下载）→ 门禁扫"章节 font-family ∉ 主题声明"报错。主题可声明 **extraFonts 一次性字体白名单**（特殊视觉时刻用）；章节用字体必须 ∈ 四坑位 ∪ 白名单。

### 5.3 风格控制力 = 四乘数（诚实边界）

```
主题风格控制力 = ①维度覆盖 × ②组件纯度 × ③值的品味 × ④使用指引
```

- ① 维度覆盖：风格决策点全有 token 槽位；未 token 化维度上出现裸值 → 门禁报错
- ② 组件纯度：组件 100% 消费 token，components/ 目录 token lint + 契约测试
- ③ 值的品味：v1 主题值单独打磨；主题作者指引（THEMES 文档）沉淀方法（对比度底线/强调色使用规范/动效节奏——具体规范待与你共同拟定，不预设任何原版结论）
- ④ 使用指引：每主题气质描述注入章节开发提示词（比原版 mood 更丰富，推广到所有开发模式）
- **主题验收**：以后加新主题，渲染同一样例章节，用户视觉确认后入库
- 换主题机制照旧：覆盖一个 tokens.css + theme.json，章节零改动
- 诚实划界：构图与信息设计不在主题控制范围（章节层的事），主题管"皮肤和性格"

### 5.4 首套主题：creative-mode 1:1 还原（已定）

模板 DNA（beautiful-html-templates/templates/creative-mode）：
- 暖奶油纸底（cream #EFE9D9 / cream-2 #E4DCC4）+ 墨黑结构（ink #0F0F0F / ink-2 #2A2A2A）
- **四色强调**：森林绿 #1F8A4C / 热粉 #F06CA8 / 焦橙 #E85A1F / 阳光黄 #F5C518（绿/粉带 dark 变体，橙/黄无）
- 字型：Archivo Black（超重海报黑体，全大写、行高 0.92）+ Space Grotesk（正文）+ JetBrains Mono（标签/页眉，宽字距大写）；字阶 220px → 24px 全套可直映射
- 签名语言：4px 墨边框、硬偏移阴影（24px 24px 0 双层）、扁平色块、零渐变零圆角（pill/印章例外）、旋转徽章（-4deg）/ 印章（-6deg）、间距体系 96/64/28/32
- 气质：Bauhaus 网格 + 朋克杂志 + 瑞士编辑，graphic / confident / playful

**对 token 契约的三处修正（由此主题引出）**：

1. **多强调色**：--accent-1..4 可选槽位（"唯一饱和色"是原版 skill 的单强调色设计，此前被静默继承、未经你确认——现按 creative-mode 改为多槽位，这条原则不在新 skill 中成立）。真正的结构性保证只有一条：章节禁硬编码色门禁（§11.1 #2）——饱和色只能来自主题声明的集合；多色如何分配是主题作者指引（值品味）的事，由第 1 章验收兜底
2. **decor-family 值域扩展**：dot/bar/ring/polygon → + block（色块族）/ stamp（印章族）
3. **阴影语言**：--shadow 须支持**偏移实色硬阴影**（非仅模糊阴影），24px 双层硬阴影直接进 token

**中文配对（已定稿 2026-09-06）**：**Noto Sans SC 900**（用户拍板 A；模板官方 CJK 指引推荐 Serif 900，此为标注在案的**主动偏离**——理由：现代中性，与 Archivo Black 同气质）。还原的是**视觉语言**（色/字/框/影/印章），不是**信息密度**——模板是 8 张高密度 slide deck，口播视频每帧 5-15s，密度纪律按视频标准裁剪（执行期裁定：字阶顶档 220→160px，M2b-4）。

**已知坑**：yellow on cream 对比度仅 ~1.6:1——模板中黄只作背景色块配墨字。主题作者指引注明"浅强调色只用于反色底（配墨字），禁作文字色"，门禁 #18 对比度检查兜底。

## 6. 组件库

### 6.1 形态与铁律

模板内 `components/`（非 npm 包）+ `.engine-version` 标记。五条铁律：
1. 动画全部走可 seek 运行时（WAAPI/GSAP），组件封装；章节层选预设和档位（`reveal="wipe" duration="mid"`），不写动画代码
2. Canvas 类组件走帧函数逃生舱（`draw(t)` 纯函数 + 虚拟时钟）
3. 章节层禁手写裸样式（#12），组件+token 组合是唯一合法路径，门禁执行
4. **动画属性白名单**：opacity/transform/色彩/clip-path/stroke-dashoffset（P2-1 执行期扩展——SVG 描边动画不触发重排），禁布局属性动画（width/height/padding 逐帧重排，HF 经验）
5. **stagger 用时间线偏移实现**（一条时间线多个子段），规避 animation-delay 的 seek 边界
6. **step 入场动画契约**：跨步状态变化必须表达为 f(step)、mount 时从头可复演的动画（StepSequence 类组件内部实现）——渲染"每步独立 mount 可并行"与顺序推进画面逐帧一致的前提（list-reveal 式节点跨步存活手法在独立 mount 下会丢失入场过渡动画）

### 6.2 组件清单（v1 骨架）

| 组 | 组件 | 动画语义（内建） |
|---|---|---|
| 文字 | HeroTitle / Kicker / BodyCopy / QuoteBlock | 揭示（fade/rise/wipe） |
| 数据 | HeroNumber / Counter / BarGrow / DonutMeter / StatCard | 数字滚动 / 横条生长 / 环形描边 |
| 结构 | Card / Rule / Grid·Split / StagePad / Table | 入场 + 主题驱动 |
| 揭示 | RevealList / StepSequence（步骤动画）/ RevealText | stagger 逐条 / 步骤点亮 |
| 装饰 | DecorDot / DecorBar / DecorRing | 形状族吃 `--decor-family` |
| 素材承载 | **Figure**（4px 墨框+硬阴影+遮罩揭示）/ TypedTerminal（打字机）/ PathDraw（SVG 自绘） | 揭示/打字/路径绘制 |
| 氛围微动 | **SeededParticles / Breathe / KenBurns**（有限周期版——#8 无限动画禁令的确定性等价物，保原版"持续微动"电影感） | 种子粒子漂移/呼吸/缓推 |
| 功能 | TimelineTrack / ProgressDots | 时间轴自绘（字幕层归框架，非章节组件，见 §9） |

### 6.3 构图模式库（天花板，可选不强制）

封面 / 数据冲击 / 对比 / 流程 / 总结 / 行动号召，每类 2-3 变体，纯文档+参考代码。强制天花板 = AI 味回归；可选 = 提速保底。**v1 种子取 creative-mode 模板的 8 张 slide 组件形态**（stat-cell 数据格 / step-card 步骤卡 / 4px 墨框表格 / stamp 印章 / marker 标记块 / bar-chart 墨框图表），作为首批模式参考。

### 6.4 组件库方案五缺点修复（定稿）

| 缺点 | 定稿措施 |
|---|---|
| 1. AI 味转移到组件模板 | 组件契约：每组件 ≥2-3 变体；装饰形状族做宽；构图模式库维持可选；最终防线 = 分镜确认 |
| 2. v1 组件必然不够用 | **组件缺口上报流程**：章节开发发现缺组件→上报→用户确认→组件库追加进版本→后续章节可用。组件库边用边长；第 1 章验收作试金石 |
| 3. 动画表现力天花板 | 动画预设注册表开放；Canvas 逃生舱；章节可提案新预设（走缺口上报流程） |
| 4. 禁裸样式执法难 | 物理隔离：组件样式只在 components/ 内，章节样式独立文件+前缀，门禁只扫章节层目录 |
| 5. agent 乱用组件 | 组件参考卡（用法/变体/动画预设/何时用何时不用），章节开发前先查卡；改组件必改卡 |

### 6.5 动画方案的风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| React 与 seek 生命周期冲突（最深） | 挂载即动画契约下 React 管生命周期；章节 useEffect 副作用在 mount 时跑、不被 seek 时钟看见 | 组件动画必经引擎 API（渲染模式"创建即冻结"）；副作用由组件契约禁止 |
| 预设僵化 → AI 味 | 组件就那十几种动画，整片词汇重复 | 每组件 ≥2-3 变体 + 开放注册表 + 缺口上报 |
| 动画观感后置验证 | 分镜只确认静态+词汇标注，实际节奏/缓动 Phase 4 才可见 | 第 1 章验收**显式包含动画观感**（全片动画风格锚）；每章完成后浏览器实时预览 |
| Canvas 逃生舱失控 | draw(t) 自由区，契约和门禁管不到内部质量 | 使用须在分镜确认时可见（帧上标注"Canvas 绘制"）；第 1 章验收兜底 |
| 布局属性动画 | 逐帧重排，慢且截图易闪烁 | 动画属性白名单（铁律 4） |
| stagger 的 seek 边界 | animation-delay 负 currentTime 边界多 | 时间线偏移实现（铁律 5） |

### 6.6 扩充与升级路径

- 加组件 = components/ 加一个文件（遵守契约）；加动画预设 = 注册表加一行；加主题 = 一份 token 文件；加平台 = 一个档案文件
- 组件契约测试：新组件自动过 token lint（禁裸色/禁裸时长/动画走运行时）
- **平滑升级 reacticle 式 npm 包**：契约是纯 props + token 接口，需要包管理时挪目录+加 package.json 即完成，无重写。v1 不背发布流程

## 7. Harness 流程（Phase 0-5）

```
Phase 0 · 意图对齐    输入三态识别 + 选平台（可双选）+ 素材对齐（用户提供/agent 挑选/placeholder
                      三选一）+ 开发模式（A/B/C）+ 生成主题画廊 HTML（浏览器直选；
                      v1 单主题时此步退化为展示+确认）
Phase 1 · 内容生产    article.md + script.md（平台口播提示词）+ outline.md（禁动画）
                      ── Checkpoint 1：稿子 / 大纲 / 主题 / 素材 一次对齐 ──
Phase 1.5 · 脚手架+真相源  scaffold 项目（档案参数）→ 由已确认的 script/outline **机器生成
                      narrations.ts**（章节 agent 不得手改；改稿走重生成——
                      "改稿→重生成→增量重合成"回环闭合）
Phase 2 · 音频合成    extract（manifest 化）→ TTS（三函数契约：内置 MiniMax + OpenAI，
                      不可用走 4 选 1 退化、不假装合成成功）→ ffprobe → audio-durations.json
Phase 3 · 静态分镜    ★ 章节"静态终态版"先行 + 逐帧截图 → storyboard.html
                      每帧 = 静态终态图 + 口播文本 + 音频实测时长 + 停留垫（可调）
                      → 停留时长 + 主导动画词汇标注
                      ── Checkpoint 2：静态构图 + 每帧停留节奏 + 动画方向一次确认 ──
Phase 4 · 章节开发    静态版上叠动画（组件预设+档位）；第 1 章强制主线程+验收
                      （**含动画观感，作为全片动画节奏风格锚**）；缺口上报；模式 A/B/C
Phase 5 · 渲染导出    npm run check 全量门禁 → npm run render → mp4 + 截图终审
```

**关键决策**：

1. 分镜产出形态 = **静态章节先行**（Layout Contract 落地）：Phase 3 写静态终态版（硬规则：禁一切动画类，check 扫"getAnimations 为空"），截图拼 storyboard.html；Phase 4 叠动画。截图模块与渲染管线**同源（M4 交付）**——**分镜/门禁/渲染共用一台时间机器**
2. **动画的"设计/实现"分离**：动画方案（主导动画词汇）在 Phase 3 设计、随 Checkpoint 2 确认（创造性决策必须有确认窗口）；动画实现在 Phase 4 落地（定方向不定实现，原版"outline 禁写动画"哲学的平移）。**Checkpoint 2 反馈分级**：改构图/停留垫 → 直通 Phase 4 数据修改（timing.json）；改文本/切分 → 回 Phase 1 局部重生成 + 增量重合成 + 重截受影响帧
3. Checkpoint Audio 合并进 Checkpoint 1（narrations 文本 = 确认过的稿子切分）；合成后打印文本+实测时长清单
4. 提示词文档集合：主 SKILL.md + 平台档案（各含口播风格提示词）+ references/ 通用手册（SCRIPT-STYLE 去AI腔纪律共享、STORYBOARD-CRAFT.md、CHAPTER-CRAFT.md、OUTLINE-FORMAT.md、AUDIO.md、RENDER.md）——**开发期与你逐份打磨定稿**，运行期按阶段渐进加载
5. 双平台各跑各的完整流程，可顺序可并行，默认顺序

## 8. 渲染管线（A′ 确定性 seek）

**选型结论**：A′ 自建轻量 seek 引擎（击败：B 实时捕获——漂移+实时耗时；C 静态帧流——丢动画；D Remotion——重依赖+许可证+门禁不同源）。**B 实时捕获是真正的降级逃生舱（已内建）；D（Remotion）为研究性远期选项**（帧函数模型不能直接驱动 WAAPI/GSAP 时间线，接入需重写组件动画内部实现）。

```
npm run render
 ├─ 1. 读 audio-durations.json + chapters manifest + timing.json（每步停留垫覆盖）
 │      → 时间轴表（每步[起始, 音频时长, 动画窗口, 步长]）
 ├─ 2. Playwright 逐 step：定位游标 → 等字体/图片就绪（delayRender 语义）→
 │      动画窗口内逐帧 seek(30fps) + 截图 → 静置期截 1 帧终态（核心优化）
 │      → 动画覆盖率断言（**引擎动画注册表全覆盖**——组件动画必经引擎 API；
 │        getAnimations 辅助扫 CSS/WAAPI 泄漏，否则降级+告警）
 ├─ 3. ffmpeg：concat demuxer + -fps_mode cfr → 混音（各步 mp3 **按步起点偏移放置**，
 │      步长由时间轴表驱动）→ mp4；可选字幕烧录 / .srt 副产物
 └─ 4. 失败降级：seek 断言失败 → 实时捕获模式兜底出片
```

- 动画窗口**实测**（所有有限动画**全部** finished 的最早时刻 = 各动画结束时间的最大值），作者零声明
- 无限循环动画默认禁止（门禁执行），确有需要走"长循环+可见周期截断"
- 音画同步构造保证：总时长 = Σ步长，**步长 = max(音频时长, 动画窗口) + 停留垫**，两轨同源；停留垫为数据（引擎默认 400ms → 档案覆盖 → 分镜每帧可调），引擎单一源头导出（运行时/渲染不漂移）
- 采样 30fps；16:9 输出 1920×1080，3:4 输出 1080×1440
- 静置期优化使渲染快于实时：每步 ~46 帧而非 450 帧（静置期单帧复用覆盖"静置+垫"）
- 空 narration 步（无声过场）：停留时长 = max(1500 默认, 动画窗口) + 垫，与运行时一致
- step 级并行渲染进 v1：`--concurrency N`（默认 2-4），每步独立 mount 天然可并行（前提：铁律 6 step 入场动画契约）

### 8.1 风险与结构性方案（"没有缺点"= 不存在看不见、检测不到、无兜底的风险）

| 风险 | 结构性方案 | 残余 |
|---|---|---|
| 自建引擎工程风险（最大） | ① 动画运行时模块化：API 面积极小（pause/seek/注册），vitest 单测覆盖 delay/fill/迭代/负 currentTime 全边界；② 渲染编排器流水线化：时间轴表 JSON → 帧图目录 → ffmpeg，每段独立可验证（帧图人眼抽查、ffmpeg 命令单独跑）；③ 静态帧流先行 = 打通全链路 80%，逐帧 seek 只是"1帧/步→45帧/步"的增量替换；④ B 实时捕获降级兜底；D（Remotion）为研究性远期选项（组件动画内部需重写） | 边界 bug 仍可能出现，被单测+金样围住 |
| 纪律静默失效（最阴险） | ① 渲染模式"**创建即冻结**"：组件动画必经引擎 API，render 模式下 Animation 创建即 paused——动画不允许自主播放，首帧闪烁与 mount 即播从结构上消灭（MaskReveal 类问题的终极解）；② 引擎动画注册表覆盖断言；③ **双渲对比**：**每步动画窗口段重采**逐帧哈希（静置期单帧哈希，成本增量小），任何非确定性必然两渲不一致→报错——不需要知道违规在哪，直接测非确定性 | **Canvas 内部**（draw(t) 是否真只依赖 t 不可机检）：由分镜标注 + 第 1 章验收兜底（诚实残余，非"无"） |
| 确定性黑名单的创作代价 | 组件库提供 **SeededRandom（传 seed）** + 虚拟时钟 useStepTime()——"禁止"改为"给确定性能力" | 作者换写法 |
| 性能 | 静置优化 + **step 级并行渲染进 v1**（--concurrency N 默认 2-4，每步独立 mount 天然可并行）；帧缓存不做（复杂度不值） | 长视频线性增长，靠并行摊平 |
| 跨环境脆弱 | 锁 Playwright/Chromium 版本 + 字体自托管（消网络波动）+ **金样回归**（升级环境后跑金样对比，像素差异超阈值告警） | 环境变化变为可检测事件 |
| 细节一致性 | 停留垫数据单一源头（引擎导出，运行时/渲染共用）+ **渲染产物自校验**（帧数×帧率 vs 时间轴表总时长 + 抽帧与预览同刻截图比对）——渲染正确是验证出来的，不是"相信跑完了" | 无 |

## 9. 字幕与播放控制

**字幕（#5）**：字幕层归**引擎框架**（非章节组件）——文本强制来自 narrations，章节在结构上无法硬编码字幕（比门禁检查更强）；样式走主题 token（字幕专属 token 位）；渲染管线截的是页面，字幕天然进视频且与预览 100% 一致（`--subs` 开关，烧录零成本）→ SRT 副产物从 narrations+时间轴表导出 → 分镜确认时字幕样式一并确认。

**播放控制（#7）**：

| 控制 | 行为 |
|---|---|
| 播放 | 自动推进（音频驱动），唯一推进方式 |
| 暂停 | 冻结所有时间线 + 暂停音频 |
| 停止 | 回 step 0 + 音频回零 |
| 导出 | 页面按钮 → 本地渲染服务（随 dev server 启动、页面经本地端口发现；不可达时页面给出启动指引）→ 进度反馈 → 取 mp4（用户不碰命令行） |
| 开发调试 | 方向键步进/Home/End，藏在无 UI 模式 |

录屏模式（`?auto=1` 干净画面）保留作 fallback 出口。

## 10. 已敲定决策清单

| # | 事项 | 结论 | 状态 |
|---|---|---|---|
| 1 | 音频合成前移 | **前移**（Phase 2 在分镜前，实测时长服务分镜确认，增量重合成兜底） | 已定 |
| 2 | 分镜产出形态 | **静态章节先行**（storyboard.html 截图确认，Phase 4 叠动画） | 已定 |
| 3 | 导出按钮形态 | **页面内按钮调本地渲染服务**（进度反馈，用户不碰命令行） | 已定 |
| 4 | 主题确认方式 | **主题画廊 HTML 页**（样例内容渲染进每套主题，浏览器直选）；Checkpoint 1 = 稿子/大纲/主题/素材 | 已定 |
| 5 | 首批主题风格方向 | **creative-mode 模板 1:1 还原**（视觉语言还原，信息密度按口播视频纪律裁剪） | 已定 |
| 6 | 新 skill 命名 | 先空着，M7 时与 description 触发器文案一起定 | 已定（M7） |
| 7 | 剩余设计节 | 门禁/测试/里程碑 | 已通过（§11，双 agent 质检后全部发现已修复） |

## 11. 门禁清单 / 测试策略 / 里程碑（双 agent 独立质检已通过，2026-09-04 全部发现已修复）

### 11.1 npm run check 门禁清单（两层执行）

**执行形态**：`check:fast`（静态扫描，秒级，章节开发迭代用）+ `check`（全量 = fast + 无头 pass，汇报/渲染前必过）。persistent findings gate + exit code——blocker 不过 = exit 非零 = 不能汇报完成；warning 须在汇报时逐条说明理由或修复计划。

**静态扫描（check:fast）**（扫描范围 = 章节层 CSS 文件 + TSX inline style + SVG 属性 fill/stroke/font-size——堵住 inline style/SVG 逃逸旁路）：

| # | 检查 | 手段 | 级别 |
|---|---|---|---|
| 1 | narrations 一致性：**manifest 声明制**（每章 `steps === narrations.length`，注册即校验——不扫代码字面量，派生/fall-through 写法合法）；step 使用上界由无头 pass 兜底 | manifest + 无头 | blocker |
| 2 | 禁硬编码色（hex/rgb/命名色，white/black 除外；transparent/rgba 裸值同样禁止） | 章节层 CSS+inline style+SVG 扫描 | blocker |
| 3 | 禁硬编码字体（须 ∈ 四坑位 ∪ extraFonts 白名单） | 章节层 CSS+inline style 扫描 | blocker |
| 4 | 禁裸动画（animation/transition/缓动裸值、非运行时动画） | 章节层 CSS+inline style 扫描（秒级）；渲染前引擎注册表覆盖断言（check 全量无头） | blocker |
| 5 | 字阶成员校验（章节字号 px ∈ 字阶集合）+ 间距/边框尺寸 px ∈ --space 集合 | CSS 扫描 vs 主题字阶/间距阶 | warning |
| 6 | 禁裸紫粉渐变（**只扫章节层手写渐变，token 化渐变豁免**——防误伤紫色主题）+ 禁 emoji | 色相检测 + Unicode range | warning |
| 7 | 禁 setTimeout/setInterval、禁 Math.random/Date.now/performance.now/requestAnimationFrame/new Date()——**引擎虚拟时钟 API 是章节层唯一合法时间来源** | AST 扫描 | blocker |
| 8 | 禁无限循环动画（渲染确定性；确定性等价物 = 氛围组件有限周期版 SeededParticles/Breathe/KenBurns） | AST/getAnimations | blocker |
| 9 | 组件契约（components/ 内禁裸色/裸时长，token 纯度） | 组件目录 lint | blocker |
| 10 | 主题完整性（必填 token 全定义 + **章节 var() 引用 ⊆ 主题定义** + 对比度底线） | theme.json/tokens.css 校验 | blocker |
| 11 | 文案反 AI 味（五类句式正则 + 五类指纹） | narrations 文本扫描 | warning |
| 12 | 禁外部网络资源（img/font/css 远程 URL——确定性 + 大陆可达） | 章节层扫描 | blocker |
| 13 | 音频完整性（narrations.length === mp3 文件数 === durations 条目数） | 文件系统 + 数据校验 | blocker |
| 14 | 字体加载校验（实际加载 ⊆ 主题声明，声明=加载） | scaffold 期静态 + check 全量无头 | blocker |
| 15 | **文档完整性 lint**（SKILL.md/references 引用的相对路径与节标题存在——防原版 #6/#9 类路标漂移） | 文档扫描 | warning |

**无头 pass（check 全量）**：

| # | 检查 | 手段 | 级别 |
|---|---|---|---|
| 16 | 无头 seek pass（逐 step：console error / 布局溢出 / 动画异常） | Playwright | blocker |
| 17 | 动画窗口 vs 音频时长关系（动画 > 音频 → 提示"动效超出人声，步长被动画拉长"） | 无头实测 | warning |
| 18 | 对比度检查（章节层文字 vs 背景，WCAG 底线；elementFromPoint 采样，覆盖文字落色块/图片/Canvas 场景） | 无头计算 | warning |
| 19 | 音频段 ≥15s 节奏警告（原版人工校准机器化） | durations 扫描 | warning |
| 20 | 文字安全边距（画面边缘 Xpx 内文字；**X 按平台档案参数化**——3:4 小红书有常驻 UI，16:9 全屏无） | 无头检测 | warning |

**Phase 3 阶段门禁（分镜提交时）**：静态版 getAnimations 为空（禁混入动画）+ 分镜页帧数 = 总 step 数。

### 11.2 测试与验证策略

| 层 | 策略 |
|---|---|
| 引擎单元 | seek 运行时（delay/fill/迭代边界）、游标、音频兜底链——vitest |
| 组件契约测试 | 新组件自动过 token lint + 双画布（1920×1080 / 1080×1440）冒烟渲染 |
| 渲染金样 | 固定样例章节渲染结果对比；**首版入库须用户视觉确认**（防坏基准入库）；**双渲 = 每步动画窗口段重采逐帧全等**（bit-exact，静置期单帧哈希）；**跨版本回归 = 像素阈值**（环境变化允许亚像素差）；截图环境**强制软件渲染**（无 GPU）保像素稳定 |
| 端到端 | 一条样例素材走完整 harness（script → render 出 mp4）；**mock TTS**（三函数契约天然支持：test provider 直接 cp 固定 mp3，零 token） |
| 门禁负样本测试 | 金样项目故意埋全部违规类型，check 必须全抓到 + **false-positive 集**（list-reveal 派生/fall-through 合法写法必须通过）——"检查的检查"，防门禁自身漂移（原版 #9 路标失配教训） |
| 主题验收 | 新主题渲染样例章节，用户视觉确认入库 |

### 11.3 里程碑划分（执行序草稿，供 writing-plans 细化）

**贯穿原则（#9）**：每个 M 的产出 = 代码 + 该层提示词文档（与你打磨定稿）——不再有独立文档里程碑。

- **M1 引擎 + 脚手架**：单比例引擎（原版结构照抄+9缺陷修复+版本标记，含档案最小参数）+ scaffold + 播放控制 + 引擎单测
- **M2a token 架构 + 组件骨架**（不依赖风格方向）+ 组件契约测试 + 对应提示词
- **M2b 首套主题值**：creative-mode 1:1 还原（奶油纸底/四色强调/Archivo Black 字阶/4px 墨框/硬偏移阴影 → token 值）+ 中文重型黑体配对（Noto Sans SC 900 / Noto Serif SC 900 对比，与你打磨）
- **M3a 静态门禁**（随 M2a 完成，check:fast 15 项）
- **M4 静态分镜管线**：**Playwright 截图模块（"时间机器"，交付于此）** + Phase 3 静态版 → storyboard.html + 分镜阶段门禁（静态版零动画 + 帧数=step 数）+ **顺序推进 vs 独立 mount 截图逐帧一致性门禁**
- **M3b 无头门禁**（随 M4/M5 完成，check 全量 20 项）
- **M5 渲染管线**：静态帧流先行打通（复用 M4 截图模块）→ 逐帧 seek（创建即冻结）→ step 级并行 → 字幕（框架层）→ 导出按钮服务 + 渲染产物自校验 + 金样（用户确认入库）
- **M6 端到端验证**：样例素材全流程 smoke test（mock TTS + 真实 TTS 各一遍）+ 门禁负样本 + 金样双渲
- **M7 skill 封装与发布**：manifest.json / description 触发器打磨（skill 门面，原版手法 1）/ 命名 / README——触发器文案与你打磨

依赖序：M1→M2a→M4→M5；M3a 随 M2a，M3b 随 M4/M5；M2b 独立排期；M6 依赖 M5 完成；M7 最后收口。E2E 素材 = 用户提供旧素材（已定）。

## 12. 执行期同步记录（M1-M2b 实现期裁决回写，2026-09-05~06）

> 实现里程碑 M1/M2a/M2b 已全部完成并合并 main（**131 测试全绿**，组件库 35 组件）。以下为执行期裁决与终审修复的权威记录，设计文档主体与代码以此为准：

| # | 裁决 | 状态 |
|---|---|---|
| P2-1 | 动画白名单扩展 stroke-dashoffset（§6.1 已同步） | 已落地 |
| P2-4/P2-6/7/8/10/11/12/13 | 组件装配/工厂模块作用域/lint ?raw/工厂 tag 收窄/测试基建全局化/waapi dispose cancel | 已落地 |
| P3-1~P3-13 | 揭示组自接动画/打字机无光标/氛围有限周期/工厂契约/canvas 测试 stub/computed style 读色/waapi iterations/清未用 import/金样值/--decor-family 消费延后/filled 真填充/canvasAnim rAF/单 active 语义 | 已落地 |
| 终审 P2 C1 | vitest css:false 使 ?raw 空串——lint 假绿修复 + 门禁测试双护栏教训（负样本+非空护栏，已成为后续计划强制约束） | 已落地 |
| 终审 P3 I-1 | canvasAnim 非 render 模式创建即播（预览触发断链）——帧函数组件预览可动、推进不挂死 | 已落地 |
| M2b-1~M2b-10 | 动效 token 唯一时间基准（氛围系数 ×10/×8/×3）/档位归并/BarGrow 收敛 waapi/字阶 160px/decor-family=block/accent-1 绿/字体 A 拍板/回退色对齐 | 已落地 |
| 终审 M2b I-1 | --table-head-text 语义 token（表头墨底墨字）——closure 测试守名字级闭合、抓不到语义配对，此为其边界实证 | 已落地 |
| 动效定稿 | --ease-emph = cubic-bezier(0.16,1,0.3,1)（无过冲强缓出，impeccable hook 修复） | 已落地 |
| --decor-family 六族形态 | dot=圆点 / bar=色条 / ring=圆环 / polygon=多边形 / **block=矩形色块（creative-mode 当前形态，v1 组件消费）** / stamp=旋转印戳——形态映射文档随组件参考卡（Plan 5）交付 | block 已落地，其余随参考卡 |
| **A股涨跌语义色** | 财报/金融数据语义色：**上涨 = 红色系**（非粉——本主题用 **accent-3 橙 #E85A1F**）、**下跌 = 绿色系（accent-1）**；delta 标签 / KPI 附注等涨跌/增减语义标注统一按此（涨橙/跌绿）；系列色（年份柱/分类条等非涨跌语义）不受影响 | 已落地（M2b 二十四轮，showcase 全局扫描 + 落地清单见 showcase-refine-report） |
| **组件库结构规范化**（M2b 结构轮 · 2026-09-11） | ① **单一注册表** `src/components/manifest.ts`：44 组件（导出名 / 组 / 根类 slug / CSS 路径）为唯一真相源——冒烟 presence 清单 / contract-lint CSS 装配 / styleguide 组件数·组序·组计数全部派生（数量不再写死）；② **类名前缀门禁**：组件 CSS 每个选择器片段必须 `.cdp-` 开头（注释与 @-规则前导跳过、@keyframes 内部豁免、@media 内部照查）；③ **三方同步防线**：manifest ↔ `index.ts`（CSS 装配路径 + 导出名，双向）× manifest ↔ `StyleGuide.tsx`（组件 JSX 覆盖，缺 `<Name` 用法即 blocker），下层为 contract-lint `?raw` 键集 ≡ manifest cssPath 集的模块级 throw（缺一即炸）；④ **测试粒度按组件**：九个组测试文件拆为组件级嵌套 describe（it 标题与断言逐字不变）；⑤ **内部件收纳** `components/_internal/`（factory / motion / seededRandom + 单测），**组改名** `function/` → `chrome/`（组标题 FUNCTION·功能 → CHROME·功能，中文"功能"保留） | 已落地（3 提交 `50d1927` / `c3759a2` / `4ec1cbc`；303 测试全绿 + 门禁 blocker 0 + 截图对照零视觉变化 + 三方断言负样本实测报红） |
| **M4 静态分镜管线**（2026-09-11） | ① **游标桥** `src/engine/cursorBridge.ts`：`window.__presentation`（`jumpTo` / `getState` / `ready` / `animations`）——仅 dev 或 URL 含 `?headless=1` 安装，生产构建不暴露；`ready()` 语义 = 双 rAF + `fonts.ready` + 全 `img.complete`（无内建超时，消费方包）；② **截图模块（"时间机器"）** `scripts/shot/capture.ts`：Playwright 单页逐帧 `jumpTo → ready（10s 超时）→ 截图`（1920×1080 × DSF 1，viewport 裁剪非 fullPage），`chapterIds` 必传 + 跳转后与**截图后**双重游标回读（自驱推进抢先即抛，不静默落错帧）；③ **storyboard 生成器** `npm run storyboard`：章节 manifest + `public/audio-durations.json`（对象/单章扁平两形态，缺失 = 合法降级"未合成"）+ 各章 `timing.json`（`dwell` 覆盖 / `animation` 词汇 / `ambient` 声明）→ `storyboard/index.html` + `storyboard.json` + `shots/<chapterId>/<step>.png`（自包含离线页，主题色为 tokens 的 hex 快照）；④ **分镜阶段门禁**：帧数 === 总 step 数 + 零动画——**Ruling M4-1**（`animations()` = WAAPI + 引擎注册表之和，对 WAAPI 为上界语义，只判 `>0`）、**Ruling M4-2**（氛围微动逐帧豁免：`timing.json` `"ambient": {"<step>": "<note>"}` 声明步允许计数 > 0 且 note 上帧；未声明的计数 > 0 = blocker，入场动画一律禁入静态版）、**Ruling M4-3**（`chapterIds` 必传，缺失即 throw 不静默退化为数字下标）；⑤ **一致性校验** `--verify-sequential`：键盘顺序推进 vs 独立 mount（主流程 jumpTo 产出）逐字节比对，不一致非零退出并列出差异步，已声明 ambient 的氛围步免比对 | 已落地（M4 五提交，短哈希：`421c00b` 游标桥 / `56ba865` 截图模块 / `789d289` 截图模块评审硬化 / `a154e7d` storyboard 生成器 / `d14683a` storyboard 评审硬化；387 测试全绿 + check blocker 0 + 冒烟：帧数 3/3、step 0 氛围声明豁免、step 1/2 顺序与独立 mount 逐字节一致） |

| **M4 收尾盘账**（2026-09-11） | 跨里程碑盘账：**找回并修复 M1 终审 parked ① 的 resume-after-404 死锁**——裁决为"延后到 M2a 一行守卫"后 M2a 未做，设计文档/计划/代码三处零痕迹（parked 裁决只活在随收尾即删的 SDD ledger 里）；实测影响比原记更重：模板无 `public/`，示例章节每步 mp3 请求拿不到可解码资源（**实测为 dev server SPA fallback 的 200 + text/html，非 404**——措辞于 M3b Task 6/9 更正，机制结论不变，见 [KNOWN-ISSUES.md](KNOWN-ISSUES.md) K-01），**点一次播放即掐死自动推进链**（真浏览器对照：不点击 `scene-1@3.5s` → `scene-2@5.6s`；400ms 点播放 → 6s 零推进）——修法即原裁决的一行守卫（`resume` 判 `audio.error` 走估时兜底），commit `cc3a6f1`。**同时建立 [KNOWN-ISSUES.md](KNOWN-ISSUES.md)** 跨里程碑已知问题台账（已修 / 活跃 / 已知边界 / 记账四段），并立规：终审 parked 裁决与 deferred 项**必须落盘**（本文件或下一里程碑计划显式条目），未落盘不许删工作区；M2a/M2b 的 deferred 台账已随工作区删除**不可找回**（记档为戒） | 已落地 |

| **M3b 无头门禁**（2026-09-11~12） | `npm run check` 从"静态 15 项"补齐为**全量 20 项 = 15 静态 + 5 无头**——无头 5 条 = **#16 seek pass**（逐 step 三断言：console error / 布局溢出 / 动画逃逸；每步归因窗口含该步 `jumpTo→ready` 渲染期，首步含页面装载期）+ **#17 动画窗口 vs 音频**（warning）+ **#18 对比度**（warning；自身底色优先，hit-test 取字形盒中心）+ **#19 音频段 ≥15s**（warning；durations 扫描）+ **#20 文字安全边距**（warning；安全带数字全部来自单一源 `src/engine/safe-area.ts`），另含 **#14 字体加载**的无头半边（blocker 半边：`status === "loaded"` ⊆ 全 deck 使用面**并集**）。工程面：① 无头编排 `scripts/check/headless.ts` + 全量 CLI `scripts/check/check.ts`（自起 Vite〔`hmr:false`，端口占用自动 +1，**默认永不复用**外部服务——防"探活即复用"静默检查别人的项目〕+ `?render=1&headless=1` 创建即冻结；`--no-headless` / `--url` 两个调试口）；② 收集器一律**源码串**载体注入页面（tsx `keepNames` 注 `__name` → 真函数进浏览器必崩）+ Node 侧同一文本单测 + 真浏览器 fixture 双证；③ **节奏检查判据** `scripts/check/tempo.ts`（#17 是**声明面比较**——注册表声明窗口 vs 音频，render 冻结态无从实测播放时长；#19 逐段输出实际值；音频对位与分镜页**同源**：`resolveAudioMs` 从 `storyboard/data.ts` 外提导出）；④ 安全框单一源 `deriveSafeArea`（档案参数化，3:4 按比例折算——绝对值待 M7 确认）+ 参考线 4px 纠偏；⑤ 桥追加 `audit()`（WAAPI owned/unowned 归因 + 注册表容量/窗口）；⑥ **K-10/11/12/21 收敛** + M5 遗留首项提前落地（见下） | 已落地（M3b 九任务，短哈希：T1 `f97e637`〔主体 `39aa464` + 4 修复轮〕/ T2 `0e5464e` / T3 `2f4d500` / T4 `7449815` / T5 `85c4479` / T6 `ed42c7e` / T7 `0fcd039`+`bc3f4d5` / T8 `3e130b6`+`e4e1c61` / T9 `6c98350`；**565 测试全绿** + tsc 0 错 + `npm run check` 模板 **blocker 0**（fast 层 1 条既有音频 warning 逐字不变；#20 warning 0 条、#14 无 finding）+ `npm run build` 通过 + scaffold-smoke OK） |

| **M5a 渲染核心**（2026-09-12） | `npm run render` 全链打通：**`[--mock-audio] → 窗口预扫 → buildTimeline → captureFrames → encode → verify [→ --verify-determinism]`**——命令一行出一条 mp4，且"渲染正确是**验证出来的**"。七任务：① **时间轴表** `scripts/render/timeline.ts`（每步 `[startMs, audioMs, animMs, dwellMs, stepMs, frameCount, holdMs]`；`animMs` 取注册表**声明面上界**；dwell 合并 `timing.json` 与 `stageConfig.holdMs` 成"停留垫"单一源头——**M5 遗留 #3 落地**）；② **窗口预扫** `window-scan.ts`（`animMsByStep` 的唯一生产者，逐章逐 step 读 `audit().windowMs`）；③ **桥 seek 面**（`seek(t)` + 渲染态 `seek(0)` 归位后才 draw——**M5 遗留 #2/#5 落地**）；④ **帧流捕捉** `frames.ts`（逐 step seek 逐帧 + 静置期单帧复用 + 页级并行〔每 worker 一浏览器进程〕+ 帧数/同源/泄漏三断言 + 落定上限 `settleWithTimeout` 5s 防永久挂住）；⑤ **合成音轨 + 编码** `audio.ts`/`encode.ts`（`--mock-audio` = lavfi 正弦 + ffprobe 实测时长 → `public/audio/` + `audio-durations.json`；编码 = concat cfr 帧清单 + 单次 `filter_complex` 音轨 + `-shortest` mux）；⑥ **产物自校验** `verify.ts`（总量层：时长/帧数/帧率/音轨长/PNG 数 + **边界层**：视频内容边界〔灰度签名序列的跳变 argmax，±4 帧〕与音轨边界〔PCM 对独立构造的理想波形做窗口对齐，±10ms〕——**"总时长对而音画错位"的唯一护栏** + 内容层：跨会话同刻重采逐字节）；⑦ **CLI 编排** `scripts/render.ts`（自起 Vite〔复用 M3b `startServe`，默认永不复用〕+ `?render=1` + loader-hooks 必挂 + viewport 取 `stageConfig.dims` + **`softwareGL: true`**；`--only` 传**重算前缀和的子时间轴**〔绝不拿全表比对〕；入口三道对位断言〔窗口表 / durations / 音轨段〕把 R4 类静默降级改成 throw；`--verify-determinism` 独立会话整段重采 + **"两个不同 t 必须不同"负样本**）。工程面：无音频 deck 明示"按估时出片（无声）"；软渲 flag 不被接受则**退化重试 + 显式告警**（不拖死渲染链）；`/render/` 前导斜杠入库排除 + scaffold 清理行 + 指引段（含 ffmpeg 前置）+ 冒烟断言。 | 已落地（M5a 七任务，短哈希：T1 `4e271ad` / T2 `d9dc798` / T3 `80e3268` / T4 `1ea438b` / T5 `9e1b2b4`+`e03bd09`+`ddaf023`〔两修复轮〕/ T6 `bf22927` / **T7 收口 = 本行所在提交**（`git log --oneline --grep=M5a`）；**737 测试全绿**〔54 文件；699 基线 + 38 新增〕+ `npx tsc --noEmit` 0 错 + `npm run check` **blocker 0**〔3 warning：2 条 #19 + 1 条 #17，均为既有音频节奏读数〕+ `npm run build` 通过 + `bash narration-video/scripts/scaffold-smoke.sh` OK（含新增两断言）+ 真机 `npm run render --mock-audio` 出片 **`render/presentation.mp4`**：成片 **7.650000s**〔Σ步长 7.650000s，差 0.0ms〕/ `nb_frames=229`〔期望 230，−1，容差 ±3〕/ `r_frame_rate=30/1` 严格 / 音轨 aac 48000Hz 2ch 7.650000s / 93 张 PNG 逐条相符 / 两条视频内容边界 −33.3ms 与 −16.7ms / 两条音轨边界 0.0ms〔相关性 1.000〕/ 4 帧跨会话重采逐字节相符；`--verify-determinism` 终验：**91+1+1 帧整段重采逐字节相符**（独立会话/另一浏览器进程）+ **负样本 t=0 与 t=3000ms 的产物帧不同**（md5 `f201d64c…` vs `bf941b16…`——判据不是空转）） |

> **M5a 该层不覆盖的边界**（逐条落 [KNOWN-ISSUES.md](KNOWN-ISSUES.md)，K-76~K-83）：**K-76** 动画窗口是"**声明面上界**"而非实测播放时长（真实播放时长待 M5b 双渲对比全 deck 化收窄）；**K-77** 无音频 deck 按估时出片（**成片是哑的**，CLI 已明示）；**K-78** `render/` 产物不入库（换机器/新 clone 不存在）；**K-79** **实时捕获降级未实现**（§8.1 ④ 的兜底 = M5b 任务 5；结清前 `npm run render` 的失败模式是报错退出）；**K-80** `softwareGL` 默认 false（仅渲染 CLI 开，跨机像素稳定只对成片负责；**T7 真机取证：软渲确生效**——`UNMASKED_RENDERER_WEBGL = ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`）；**K-81** `holdMs=0` 的步不发静置帧（数据如此，不是漏拍）；**K-82** 边界断言三条已知边界（首条边界单向搜索 / 显著性判据中位为 0 时退化 / 真 TTS 起手静音全跳会假红）；**K-83** 全量套件的浏览器臂并发 flake（收口时先热缓存，根治方向 = 串行化）。**M5 遗留 #4（`STORYBOARD_THEME` 漂移护栏）/ #6（`--verify-sequential` 负对照自动化）归 M5b**，连同字幕/SRT、导出服务、金样、实时捕获降级——任务清单见 `plans/2026-09-12-M5b-subtitles-export-service.md`。
>
> **M3b 该层不覆盖的边界**已逐条落 [KNOWN-ISSUES.md](KNOWN-ISSUES.md)：K-31（#1 的 step 使用上界无头半边 → M5）、K-32（动画播放期 console error → M5）、K-46~K-49 / K-54~K-57（chrome 标记暂无生产者 / 硬阴影落点未覆盖 / #14 并集不对称 / captureSteps 的 transport / serve 默认不复用 / scanner-css minified 单行 / console 归因刻意加宽 / 示例章节边距随档案）。
>
> **M3b 全量 deferred 台账已落盘**（2026-09-12 终审修复波，code commit `293f30d`）：T1~T9 的 ~40 条 deferred minor 与执行期 Ruling 的残留项，除上文条目外全部收进 [KNOWN-ISSUES.md](KNOWN-ISSUES.md) §1/§2/§3（K-58~K-72；含终审点名的 **`examined` 两条线语义不一致**、**`session.ts` 冻结面文档滞后**〔R12/R17，M5 读接口以源码为准〕、**#14 计划文本漂移**〔以本条与源码为准〕）。**台账在哪**：跨里程碑耐久登记就是 `research-notes/KNOWN-ISSUES.md`（另有本 §12 承接交接期短期清单）——SDD 工作区 `.superpowers/sdd/2026-09-11-M3b-headless-gates/` 按 K-50 收尾删除后不再丢记录。

**M5 遗留清单**（M4 终审转交，写进 M5 计划前置项）：

1. ~~**音频自驱抢占游标（M5 首项）**~~ → **已提前落地于 M3b Task 6**（commit `ed42c7e`）：headless/render 下 `playStep` 不武装推进链的闸门已进 `App.tsx`（含真机反证与预览回归护栏），M5 无须重做。**并更正本条前提**：模板缺 mp3 时 dev server **不返回 404**，而是 **200 + text/html**（SPA fallback 回 index.html，静态服才多为 404）——音频照样解码失败，走的还是 `onerror → 估算` 兜底，故自动链**真的在跑**（约 2.2~2.5s 就把游标带走，不是原记的"当前不触发"）。
2. ~~**canvasAnim 在 `?render=1` 不 `draw(0)`**~~ → **已落地于 M5a T3**（commit `80e3268`：桥 `seek(t)` 面，渲染态 `seek(0)` 归位后 canvasAnim 才 draw——拍帧/自校验/确定性终验三处都在 `jumpTo → ready` 之后先归位 0）。
3. ~~**`timing.json` 的 dwell 目前只有分镜页消费**~~ → **已落地于 M5a T1**（commit `4e271ad`：时间轴表把 `timing.json` 的 dwell 与 `stageConfig.holdMs` 合并成"停留垫"单一源头，预览与渲染同源）。
4. **`STORYBOARD_THEME` 快照漂移无护栏**：tokens.css 改色后分镜页静默掉色；M5 加断言或生成时读取。
5. ~~**M5 API 形状预决**~~ → **已落地于 M5a T3+T4**（commit `80e3268`+`1ea438b`：桥 `seek(t)` 方法 + 帧流 `FrameSpec` 消费同一路径；沿用 M4-3 的"追加字段 + 运行期必传"，既有四方法契约未破）。**原文**：`ShotSpec` 需追加时间维（如 `seekMs?: number` + 桥侧 seek 方法）——沿用 M4-3 的"追加字段 + 运行期必传"模式，避免破坏性变更。
6. **`--verify-sequential` 负对照自动化**：终审人工做了一次（篡改参考图 → mismatch + exit 1）；固化为可选冒烟脚本防回归。
7. **人审纪律**：氛围声明的滥用面由 Checkpoint 2 兜底——SKILL/STORYBOARD-CRAFT 成文时补"人审须逐帧确认声明步不是入场动画"。

### 12b. 视觉定稿规则集（M2b 视觉验收 32 轮 · 2026-09-06，用户逐轮拍板）

> 以下全部为用户在 `?showcase=1` / `?styleguide=1` / `?font-preview=1` 三页上视觉终审的定稿结果，权威性同设计主体；M3b 门禁按此参数化。

| # | 规则 | 内容 |
|---|---|---|
| V1 | **安全框规格**（每画布） | chrome 元素（topbar/页眉）水平 ≥64px；内容元素水平 ≥96px、垂直不侵入 chrome 带与字幕带（实测锚定：内容底 ≤934、阴影落点 ≤958）；氛围背景层（粒子/缓推/纹理）豁免；**硬阴影落点计内容占位**；guides 可视化（&guides=1） |
| V2 | **字幕保留区** | 每画布底部为字幕专属带；CaptionLayer 为框架级组件（§9 正式形态） |
| V3 | **字幕规格** | 40px 居中；**纯白底**（用户明示偏离设计稿"禁纯白"）+ 4px 墨描边 + 16px 圆角矩形 + 左右留空 24px；**结尾禁句号/逗号/书名号** |
| V4 | **字号范围** | 最小 = --t-label 24px（--t-micro 18px 档已删除）；最大 = --t-display-1 130px |
| V5 | **阴影双档** | --shadow-card 24px 双层（featured 主角元素）；--shadow-card-sm 12px（卡片）；网格单元零阴影（构图级例外须在 styleguide 标注） |
| V6 | **标题下间距** | headline 与下方首元素间距统一 --headline-gap 64px（全屏机器可查） |
| V7 | **封面主色** | 封面/主角卡片主色禁粉红（MarkerBlock invert 墨底） |
| V8 | **分类色序列** | 季度/分类类条形图**每类一色**（四强调色序列绿/粉/橙/黄）——优先于"每屏 2-3 强调色"通用纪律 |
| V9 | **组件内安全边距** | 卡片/填充类组件内容距边缘 ≥24px 四周；豁免：Table（紧凑 8/24，数据密集语义）、NumberPill/DonutMeter（内联徽章/无盒） |
| V10 | **一致性原则** | showcase 中组件 = styleguide 文档中的同一组件（零本体覆写）；构图级例外必须在 styleguide 标注 |
| V11 | **组件库 35 个** | 新增：MarkerBlock / NumberPill / StackedBlocks / SplitCompare（align center·split）/ StatCell（descStyle plain·block·pill·pillFilled，default block）/ StatInline（filled 对角）/ StepStairs（v4：高度递增+位置平齐+顶部橙条）；能力扩展：HeroTitle latin·cn 双语 / Figure ratio+bare / KenBurns framed / Table columns 彩色列 / Kicker plain+pill(2px) |
| V12 | **时间轴累计点亮** | TimelineTrack 节点 i ≤ activeIndex 全部点亮（P3-13 单节点裁决已翻转） |
| V13 | **验证页三件套** | ?showcase=1（25 屏构图库 + 8s 循环重播 + &guides=1 安全框）/ ?styleguide=1（六区段 token 词典 + 35 组件全变体）/ ?font-preview=1（字体对比存档） |
| V14 | **动效档位保持** | 动画默认档位（300/700/1400 + 三缓动）不在视觉终审范围——M6 第一个真实项目时配合第 1 章动画验收精调（V 规则集交付于构图模式库文档，随 Plan 5） |

### 12c. 路线图新增项（2026-09-06）

| 项 | 内容 | 排期 |
|---|---|---|
| **Plan 4.5 · ECharts 受控组件**（用户确认） | ① 按需引入 echarts/core（tree-shaking）；② **主题生成器**：从 tokens.css 生成 ECharts 主题（四强调色=系列调色板/墨线轴/cream 底/mono 标签/无圆角风格）——换主题自动跟随；③ 受控组件 `<EChart option reveal>` 收编组件库（统一初始化/销毁/主题注册）；④ **动效策略**：ECharts 本体永远 `animation: false`，图表动效由引擎入场动画提供（确定性/成片同源/seek 兼容）；⑤ 门禁新条目：章节层 option 禁写颜色/字体字面量（全走注册主题） | 已落地（2026-09-08，M4.5 五任务收口：主题生成器/EChart 组件/门禁条目/styleguide 36 组件格/showcase S25 真实图表屏，全量 273 绿 + Playwright 终审 0 违规） |

**ECharts 执行期记录**（2026-09-08 终审，用户确认后记档）：① 主题一次注册、随 tokens 改档（重建）跟随；**运行时 CSS 变量覆写（scope() 局部配色）不跟随**——已记录为已知边界，ECharts 5.3+ 支持 style 值内 CSS 变量解析可彻底打通（留 polish 轮）；② "按需引入"的边界 = 库内按需（BarChart/LineChart/PieChart + Grid/Tooltip/Legend + SVGRenderer），因统一出口为库级导出，任何项目构建携带 echarts（>500kB chunk，已接受报备）；③ SVGRenderer 默认（jsdom 可测 + M3b DOM 可断言 + M5 截图友好）。
