# 组件库与 token 词表

44 个受控组件（reacticle 契约）+ token 契约 + 动画原语。章节层从这里选零件，
**禁手写裸样式**（门禁 #9）。**用哪个组件由章节 agent 按内容自己决定**——本文件只
把每个组件的用途写清楚，不做"常用/少用/别用"的分级。

> 完整细节看 `?styleguide=1`（每个组件的变体/尺寸/样例都有）；这里只给"它是干什么的"。

---

## 一、组件目录（按组）

### 文字组 TEXT（6）

| 组件 | 用途 |
|---|---|
| `HeroTitle` | 全屏主标题——一步只挂一个，是这一步的"标语" |
| `Kicker` | 眉标/小标签（mono 字距拉开的那行小字），给标题/数字做前缀注释 |
| `BodyCopy` | 正文段落（variants：plain / lede 大号导语）——财报视频里大段文字少用 |
| `QuoteBlock` | 引用块（引年报原话/管理层表态） |
| `NumberPill` | 序号药丸（2px 墨框 999 圆角）——列表/步骤的编号标记 |
| `DeltaText` | **涨跌文本**——文本内涨跌片段自动**涨橙跌绿**（A股规则）；给句子里的"增长 12.4%"上语义色 |

### 数据组 DATA（9）

| 组件 | 用途 |
|---|---|
| `HeroNumber` | hero 大数字展示（主题定衬线/等宽/粗黑风格）——一步的主角数字 |
| `Counter` | 数字**递增动画**——数字从 0 滚到目标值的"过程感" |
| `BarGrow` | 横条**生长动画**——条从 0 长到目标宽度 |
| `DonutMeter` | 圆环**填充**——占比类数据（分部/成本结构） |
| `StatCard` | 统计卡（大形态：数字+标签+delta） |
| `StatCell` | 统计格（mono 角标 + delta 涨跌标签 + HeroNumber + 标签 + 描述；Card 风格零阴影——网格单元纪律） |
| `StatInline` | 统计内联卡（数字+药丸标签同行的紧凑形态） |
| `YearBarGroup` | 年份柱组——多年对比；柱高=value/max；tone 灰或绿 |
| `DataItemRow` | 数据列条目（accent 序号药丸 + 标题 + 描述，描述自动过涨跌色） |

### 结构组 STRUCTURE（9）

| 组件 | 用途 |
|---|---|
| `Card` | 卡片容器（plain/invert 反色/accent 强调底） |
| `Rule` | 分割线（solid/dashed；线宽样式由主题定） |
| `Grid` | 网格布局容器（列数/gap 消费端定） |
| `Table` | 表格（数据密集场景；紧凑内衬 8/24） |
| `SplitCompare` | **对比切开**——左右两块被中线分开，各放一个对比项（同比/竞对） |
| `JisCheck` | 勾选框（24×24 墨框方块，checked=墨底对勾）——规格表/清单的"有/没有"标记 |
| `StepCard` | 流程步骤卡（大 mono 序号 + 标题 + 一句描述）——流程型内容的单步卡片 |
| `MotionCell` | 动效展示格（展示区 + mono 标签）——演示动画的格子 |
| `StagePad` | 舞台留白容器（消费 `--stage-pad-x/y`）——章节内容的默认外框 |

### 揭示组 REVEAL（4）

| 组件 | 用途 |
|---|---|
| `RevealText` | 单块文字**揭示入场**（遮罩扫过/逐段显现） |
| `RevealList` | 清单**逐项揭示**（一项一个 step；讲到的亮起、讲过的灰化保留上下文） |
| `StepSequence` | 序列步骤条（N 个节点按 step 依次点亮）——流程/步骤的进度可视化 |
| `StaggerRow` | **错峰入场行**——对直接子元素逐个错峰 reveal（铁律 5 逐子延迟） |

### 装饰组 DECOR（7）

| 组件 | 用途 |
|---|---|
| `DecorDot` | 装饰圆点（plain/glow 发光强调点） |
| `DecorBar` | 装饰色条（solid 墨色/accent 强调色） |
| `DecorRing` | 装饰圆环（outline 描边/filled 实心） |
| `StackedBlocks` | 堆叠方块（4 块错位叠放，四强调色序列）——结构示意/构图装饰 |
| `MarkerBlock` | **主角块**（4px 墨框 + 24px 双层硬阴影 + 32/48 内衬；plain cream/accent 粉/invert 墨底）——封面主角、结论砸出 |
| `StepStairs` | **阶梯**（台阶状递进的基数展示，每阶一个数+注）——季度环比台阶 |
| `PostIt` | 便签卡（五色 tone + mono 标签 + 短句）——风险点/看点的短注 |

### 素材组 MEDIA（3）

| 组件 | 用途 |
|---|---|
| `Figure` | **诚实占位卡**（按真实比例留位的占位框 + 描述）——缺素材时用；有素材就换真图 |
| `TypedTerminal` | 终端**逐字打印**（模拟命令行） |
| `PathDraw` | SVG **路径自绘**（描边动画）——趋势线/传导链 |

### 氛围组 AMBIENT（3）

| 组件 | 用途 |
|---|---|
| `SeededParticles` | 有限周期粒子（传 seed 的确定性粒子） |
| `Breathe` | 呼吸（缓慢缩放微动） |
| `KenBurns` | 背景缓推（缓慢平移缩放） |

> 氛围组是"t=0 即组合态、无入场态"的持续微动。**静态分镜阶段必须零动画**——
> 用到它们须在 `timing.json` 的 `"ambient": {"<step>": "<note>"}` 逐帧声明豁免。

### 功能组 CHROME（2）

| 组件 | 用途 |
|---|---|
| `TimelineTrack` | 时间线进度条（章节内一般不需要——框架已有进度） |
| `ProgressDots` | 进度点列（同上） |

### 图表组 CHART（1）

| 组件 | 用途 |
|---|---|
| `EChart` | **受控图表**（按需引入的 echarts，SVG 渲染）——option 禁裸色/裸字体（走注册主题）；图表本体 `animation:false`，动效由引擎入场给 |

---

## 二、Token 契约（三层）

### 1. 基础层（base，主题统一定义）

| 类别 | Token | 说明 |
|---|---|---|
| 强调色 ×4 | `--accent-1`(绿) `--accent-2`(粉) `--accent-3`(橙) `--accent-4`(黄) | 语义色约定：**涨=accent-3 橙、跌=accent-1 绿**；分类序列每类一色（绿粉橙黄） |
| 墨与纸 | `--text`（墨字）/ `--surface` / `--surface-2` / `--surface-3`（墨底反色） | 注意：**没有 `--ink`**——墨色就是 `--text` |
| 辅助文字 | `--text-mute` / `--text-faint` | 说明/来源注；`--text-faint` 只在可读前提下用 |
| 字阶 | `--t-display-1`(130，最大) / `--t-display-2`(96) / `--t-h1/h2/h3` / `--t-body` / `--t-label`(24，最小) | 全片字号范围 24~130px（V4） |
| 间距阶 | `--space-1..N` | margin/padding/gap 必须 ∈ 此集合（#5b） |
| 字体 | `--font-display-cn`(Noto Sans SC 900) / `--font-display-en`(Archivo Black) / `--font-body`(Space Grotesk) / `--font-mono`(JetBrains Mono) | 数字/标题→display，正文→body，角标/代码→mono |
| 动效 | `--dur-fast`(300) / `--dur-mid`(700) / `--dur-slow`(1400)；`--ease-in/out/emph` | 档位与缓动（#4 禁裸时长） |

### 2. 语义层（组件自动消费，章节不用管）

`--card-*`（卡片圆角/阴影）/ `--table-*` / `--rule-*` / `--badge-*` / `--hero-num-*` /
`--decor-family`（装饰形态族；现网已落地 dot/bar/ring/block——polygon/stamp 为设计语言预留，未见组件）/ `--shadow-card`
（24px 双层）/ `--shadow-card-sm`（12px）/ `--caption-*`（字幕白底墨描边）/
`--stage-pad-*`（内容 gutter 96/64）。

章节**不直接写这些**——它们由组件消费；章节只写基础层 token + 组件 props。

### 3. 组件层

每个组件的尺寸/内衬/配色语义，看 `?styleguide=1` 对应格子。两条全局纪律：
组件内衬 ≥24px（V9；`Table` 豁免为紧凑 8/24）；网格单元零阴影（`--shadow-card`
只给 featured 主角元素）。

---

## 三、动画原语（档位与语义）

| 档 | Token | 语义 |
|---|---|---|
| fast | `--dur-fast` 300ms | 小元素/数字到位即停 |
| mid | `--dur-mid` 700ms | 条生长/环填满 |
| slow | `--dur-slow` 1400ms | 大场面：趋势线自绘/全景进场 |

- 缓动：进场默认 `--ease-out`；强调用 `--ease-emph`（无过冲强缓出，主题签名）
- 揭示：单元素走组件自带；多元素错峰 `StaggerRow`；清单逐个 `RevealList`/`StepSequence`
- 氛围微动：见氛围组的声明豁免规则

---

## 四、构图模板册（怎么拼——M6 新增，Checkpoint 2 用户反馈后补）

**组件目录告诉你"有什么"，本册告诉你"怎么拼"。** showcase 的 27 屏（`?showcase=1`）
是构图的唯一正样：**先选屏型，再填数据**——不许自由拼组件。

### 屏型 → 场景映射（财报视频常用 8 型）

| 屏型 | showcase 参照 | 适用场景 | 组件清单（全套，别多加） |
|---|---|---|---|
| **封面** | S1 | 片头/第 1 步/章节开篇 | Kicker + MarkerBlock(invert){HeroTitle} + 装饰行(DecorBar+DecorDot) + QuoteBlock(rule) + 印章 |
| **数据墙** | S3 / S20 | 一组并列指标（4 个） | 2×2 Grid + StatCell ×4（角标/数字/标签/描述/delta 四件套） |
| **流程三步** | S6 | 机制/传导/步骤 | Grid + StepCard ×3（tone 各异） |
| **便签墙** | S13 | 风险/注意/单条提醒 | PostIt（微旋转 + 图钉） |
| **对比屏** | S17 | 同比/前后对比 | SplitCompare（中缝 VS 圆章） |
| **墨底结论** | S18 | 结论/落点/收束 | 全屏 surface-3 + HeroTitle + 单强调色条 |
| **指标带** | S16 | 单个大数字 + 一行小注 | HeroNumber + Kicker + 辅助数据行 |
| **收尾屏** | S27 | 结尾 | 绿底 + stamp 标题 + 印章 |

### 排版铁律（违规 = 返工）

1. **每屏主角块 ≤1、辅助块 ≤3**——塞 4 个以上的块 = 乱（Checkpoint 2 用户原话："总是在一个页面里塞了太多组件，这是不对的"）
2. **4 卡 2×2 → 对角线同色**（S3 对角填充先例）：对角两卡共用一种填充，另一对角用第二种。**填充只许两色**：墨底（`--surface-3` 奶油字 15:1）与奶油（plain 不填）——粉/橙底填充实测 **2.34~2.93:1 低于 #18 的 3:1 底线**（M6 实测踩坑），且橙填充与涨橙语义打架。跌卡保留绿填充（语义优先）；涨跌语义色全在 delta 标签
3. **底色全铺**：每屏画布 100% 覆盖主题底色（--surface），不得有白底/漏底色区域
4. **封面纪律**（V7 重申 + M6 明确）：财报视频第 1 步**复用 S1 封面排版**，主角块禁粉
5. **数据过密就拆帧**：一个节拍的数据在画面里摆不下 → 拆成 2 拍 2 帧（回 Phase 1 改稿），不许在单帧堆 2 个以上数据组
6. 每帧终态 = **一个数据点的完整呈现**（hero 数字 + 单位口径 + 锚点/对比），其余细节留给信息池按需
7. **涨跌语义色**：delta 标签/涨跌片段涨橙跌绿；分类序列（非涨跌语义）每类一色

---

## 四·补、构图基础设施

### 硬性布局标准（M6 用户拍板，从 showcase SlideShell / S1 封面提取的精确值——照抄，不许"凭感觉"）

| 项 | 精确值 |
|---|---|
| 内容带 | x[96, 1824]，y[112, 934]（顶 112 = topbar 48 + StagePad 内衬 64；底 934 = 字幕区 958 − 24） |
| chrome 元素（眉标/角标） | 距边 ≥64px |
| 舞台留白纪律 | 四边大留白，画面不塞满（原版同条："留白要多——舞台四边都要让出大留白"） |
| 满高帧的外框 | `position:absolute` + top/left/right = 安全框值 + bottom:0（**禁 height:100%+外边距**——底缘会被顶出画布，门禁 #16 实测） |
| 满高帧内容列 | `display:flex; flexDirection:column; paddingTop: var(--space-5); paddingBottom: var(--space-3)` |

### S1 封面精确规格（财报视频第 1 步照抄此模板）

| 元素 | 规格 |
|---|---|
| 眉标 | `Kicker variant="block"`（mono 0.08em 字距） |
| 主角块 | `MarkerBlock variant="invert"`（4px 墨框 + 24px 双层硬阴影 + 32/48 内衬，组件自带）+ `HeroTitle size="display-1"`（130px）latin + cn 双语双行 |
| 装饰行 | `display:flex; gap: var(--space-3); marginTop:auto`：DecorBar accent（accent-2 粉）+ DecorDot glow（粉 + `box-shadow: 0 0 var(--space-4) var(--accent-2)`）+ DecorBar solid（墨） |
| 宣言 | `QuoteBlock variant="rule"`，外层 `scope({"--accent-1": "var(--accent-2)"})`（S1 用色纪律：宣言左粗条改粉） |
| 印章（右下） | 340×340 accent-2 粉方块 `rotate(-6deg)` + `border: 4px solid var(--surface-3)`；内圈 68% 奶油圆环 `4px solid var(--surface)`；中心 mono 40px 700 0.08em（surface-3 字）。**定位**：`right/bottom: calc(var(--space-5) + 48px)`（旋转 bbox 必须落回内容带——门禁 #16 实测 340px 方块转 -6deg 需内移 48px） |
| 文字反色手法 | 墨底/深色块上的文字：`scope({"--text": "var(--surface)", "--text-2": "var(--surface)"})`（S18 同款；组件自设色子元素回归 cream） |

- **`StagePad`**：章节内容的默认外框（消费 `--stage-pad-x/y`）- **`Grid`**：网格布局（网格单元零阴影纪律）
- **安全框**（V1）：内容带 x[96,1824] y[112,934]；字幕带 y[958,1038] 别占；
  chrome 元素 ≥64px。`?showcase=1&guides=1` 看参考线；#20 门禁量真实文字越界
- **封面纪律**（V7）：封面/主角卡片主色不用粉红（MarkerBlock invert 墨底）
- **分类色序列**（V8）：季度/分类条形每类一色，优先于"每屏 2-3 强调色"的通用纪律

---

## 五、换主题 = 覆盖 token 文件（章节零改动）

主题 = `theme.json`（元数据）+ `tokens.css`（值）+ `fonts.css`（字体装载）。章节只
消费 token **名**，不碰 token **值**——换主题/换字体，章节一行不改。新主题字体
必须走 fontsource（门禁 #14 校验"**声明 ⊆ 加载**"——方向别记反）。
