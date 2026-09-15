# Figma 组件库镜像设计（styleguide → Figma）

- 日期：2026-09-15
- 状态：设计已批准（brainstorming 两节逐节确认），待 spec 审阅
- 目标文件：https://www.figma.com/design/S0ca2PukTI731lj9jFtCsX/styleguide（file key `S0ca2PukTI731lj9jFtCsX`）

## 1. 背景与目标

narration-video/templates 拥有 44 个组件（[manifest.ts](../../../narration-video/templates/src/components/manifest.ts) 是单一事实来源）和一套 token 体系（theme/tokens.css）。`?styleguide=1` 页是这两者的可视化目录。本设计在 Figma 中建立一份等价组件库。

两个用途，共同决定建法：

- **B · 设计复用**：未来在 Figma 里设计新页面，直接拖用组件。要求真组件、变体、token 绑定。
- **C · AI 工具链**：作为 Figma Make / design-to-code 的结构化素材源。要求语义清晰、命名与代码零翻译差。

**非目标**：动画还原（Figma 只建终态）；EChart 数据驱动变体全展开；多主题（当前单主题，预留 mode 扩展位）。

## 2. 环境与工具链

- Figma 账号 `jas`（hjqhcy@163.com），广发证券 team（pro tier）+ Full seat：可发布团队库，variables 全功能。
- 目标文件已存在，当前仅空白 Page 1。
- 执行通道：Claude Code + Figma MCP（plugin:figma:figma，已验证 whoami 与 get_metadata 连通）。每次 use_figma 调用前先加载 figma-use skill。
- 字体：Space Grotesk / Archivo Black / Noto Sans SC / JetBrains Mono 均为 Google Fonts，Figma 原生可用，无需安装。

## 3. Token 层设计

### 3.1 Collection 划分（3 个，按变量类型）

按类型分 collection 而非按组件分：Figma 变量选择器按 collection 分栏，绑定属性时只出现对应类型；mode 是 collection 级的，将来加主题只给 `color` 加列，其余不动。

```
📁 color（Color）
├─ primitive   surface×3 · text×4 · accent 四色+2 dark · rule · shell
├─ semantic    card-bg→surface · badge-bg→surface-3 · badge-text→surface
│              table-head-bg / table-head-text / table-zebra
│              caption-stroke / caption-text · split-before-text（均 alias）
│              caption-bg = #ffffff（硬值；用户定稿"纯白"，描述中记录该偏离）

📁 size-type（Number + String）
├─ type-size   t-display-1(130px) … t-label(24px)，7 档
├─ space       space-1(8)…space-6(64) · grid-gutter(28)
│              stage-pad-x(96) / stage-pad-y(64) · headline-gap→space-6（alias）
├─ radius      r-card(0) · r-pill(999) · caption-radius(16)
├─ semantic    border-w(4) · rule-w(4) · split-min-w(1200) · split-seam-pad(96)
│              seal-size(88) · year-bar-w(140) · caption-size(40)
├─ font        display-cn / display-en / body / mono（4 坑位，主字体）
│              hero-num-font→font-display-en（alias）
│              hero-num-weight(400) · hero-num-track(0)
└─ decor-family  "block"（string）

📁 motion（Timing + Easing）
├─ duration    dur-fast(0.3s) · dur-mid(0.7s) · dur-slow(1.4s) · stagger(0.12s)
└─ easing      ease-in · ease-out · ease-emph（cubic-bezier → Figma Easing）
```

### 3.2 关键规则

- **Code Syntax 全量设置**：每个变量的 Web 语法 = 其 tokens.css 原名（`--card-bg`）。Dev Mode Inspect 输出即为 `var(--card-bg)`，与代码零翻译差。
- **Scope 收窄**：字阶只开 font size；间距只开 gap/padding/宽高；字体坑位只开 font family；hero-num-weight 只开 font weight；hero-num-track 只开 letter spacing。
- **alias 语义层照搬 tokens.css 引用关系**，改源头全库跟随。

### 3.3 不进变量的 token（如实边界）

- **复合值**：`--shadow-card` / `--shadow-card-sm`（双层硬阴影）、`--card-border`（"4px solid"）、`--table-border`、`--rule-style`。Figma 无复合效果/边框变量。处理：拆到组件上——效果颜色绑 `accent-3` / `surface-3` 变量，几何参数（24/12px 偏移、4px spread）写死在组件；描边拆 strokeWeight（绑 `--border-w`）+ 描边色绑变量。这些 token 的定义保留在 spec JSON 中仅作文档。
- **字体 fallback 栈**：Figma 只存主字体，fallback 记在变量描述里。
- **Timing 单位换算**：CSS ms → Figma 秒。

## 4. 组件层设计

### 4.1 页面组织

Assets 面板镜像 file > page > frame 结构，页面按字母序排列，用数字前缀锁定组序：

```
00 Foundation     token 样张：色板 / 字阶 / 间距（人肉检查 + AI 上下文锚点）
01 Text 文字      02 Data 数据      03 Structure 结构
04 Reveal 揭示    05 Decor 装饰      06 Media 素材
07 Ambient 氛围   08 Chrome 功能     09 Chart 图表
```

组件归属与组序由 manifest.ts 派生，页面内按组件建 section。

### 4.2 Component set 规则

- **variant 维度的单一事实来源 = StyleGuide 展示的全变体目录**；生成器从 StyleGuide.tsx 与组件 props 交叉提取，不自创变体。
- variant 属性名对齐 React props；组件集名对齐 manifest export 名；description 记中文名 + `cdp-*` class 名。
- **结构纪律**：全部 auto layout，禁止绝对定位快照；fill / stroke / 字号 / 间距 / 圆角 100% 绑变量。
- **动效组件**（Reveal / Stagger / Counter / KenBurns 等）：建终态；description 标注"动效终态，动画参数见 motion collection"。
- **EChart**：注入一个代表性 SVG 终态样例，标注"数据示意"。
- **StagePad 等舞台结构**：按 1920×1080 真实尺寸建。

## 5. 实施流程

```
Phase 1  repo 写 scripts/figma-export/：tokens.css → tokens.dtcg.json
         （DTCG 格式 + codeSyntax/scope/description 扩展字段）
         → use_figma 程序化建 3 collection
Phase 2  spec 生成器：manifest.ts + StyleGuide.tsx → components-spec.json
         （结构树 + variant 表 + token 绑定点）
         → use_figma 分批执行，建 00-09 页 + 44 组件集
Phase 3  校验闭环（见第 6 节）
```

- spec 分片执行 + 进度落盘；**幂等可重跑**（失败从断点续，不重建已完成部分）。
- 两个 JSON 留在 repo，将来接 Figma REST API / CI 同步有现成规范源。

## 6. 验收标准

1. **数量对账**：variables 数 = tokens.dtcg.json 变量数；component set = 44；每组件变体数 = StyleGuide 目录变体数。
2. **Dev Mode 体检**：选中任一组件，Inspect 输出 `var(--xxx)` 与 tokens.css 原名一致。
3. **视觉对照**：Figma 各组页截图 vs `?styleguide=1` 对应组截图逐组比对。
4. **拖用 smoke test**：新建空文件 → 启用该库 → 拖 3 个不同组的组件实例 → 切换 variant 正常。

## 7. 风险与错误处理

| 风险 | 处理 |
|---|---|
| use_figma 限流 / 中断 | spec 分片执行、进度落盘、幂等重跑 |
| 字体不可用 | 4 字体均为 Figma 内置 Google Fonts；Phase 3 预检兜底 |
| 复合 token 无法变量化 | 按第 3.3 节拆组件级处理，JSON 保留文档 |
| 代码与 Figma 漂移 | manifest.ts 为源；改组件后重跑生成器 |
| 复杂组件（SplitCompare 蒙版 / KenBurns）程序化描述成本高 | 允许个别组件退化为占位 + 手工修；html.to.design 导入快照作辅助参照 |

## 8. 交付物

- `scripts/figma-export/`：tokens 与 components 两个 spec 生成器（tsx）
- `tokens.dtcg.json` / `components-spec.json`：repo 内规范源
- Figma 文件内容：3 collection（含全部变量、alias、code syntax、scope）+ 10 页 + 44 组件集
