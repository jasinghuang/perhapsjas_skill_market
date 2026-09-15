# 机器门禁手册（20 项 + 扩展）

门禁红了查这里：**编号 → 查什么 → 级别 → 报错怎么读 → 怎么修 → 能否绕过**。
本手册经独立审计与实现逐条对账（规则名/级别/判据均取自扫描器源码字面量）。

> 本手册的部分条目引用项目外编号（§11.1 = `research-notes/07-design-draft.md`；
> K-xx = `research-notes/KNOWN-ISSUES.md`）——skill 独立分发时这些编号可查设计仓库。

## 执行形态

| 命令 | 覆盖 | 何时跑 |
|---|---|---|
| `npm run check:fast` | 静态 15 项 + 扩展项（秒级） | 每章完工、每次改动后 |
| `npm run check` | 静态 + 无头 5 项（自起 Vite + Chromium 逐 step，十秒级） | 渲染前、汇报前 |
| `npm run storyboard` | 分镜阶段门禁（**需先 `npm run dev`**——不自动起服） | Phase 3 |
| `npm run render` | 产物自校验 + 确定性（经 npm 传参须 `--`：`npm run render -- --verify-determinism`） | Phase 5 |

**级别语义**：blocker 不过 = 退出码非零 = 不许说"做完了"；warning 不拦流程，但汇报时
**逐条说明**。报告行形如 `[severity] 规则名 定位 消息`。

---

## 静态 15 项（check:fast）

### #1 manifest一致性 · blocker
**查什么**：`steps`（由 manifest `define()` 从 narrations 派生）与导入的 `narrations.length`
一致——声明制，注册即校验；step 使用上界由无头 pass 兜底。
**报错**：`[blocker] manifest一致性 <章节> steps=X 与 narrations.length=Y 不符`。
**修法**：改 narrations 或改注册（**章节 agent 不得手改 narrations**——回 Phase 1 改稿重生成）。
**能否绕过**：不能。

### #2 禁硬编码色 · blocker
**查什么**：章节层 CSS/inline style/SVG 属性（`fill`/`stroke`）里的 hex/rgb/hsl/命名色
（white/black 豁免；transparent/rgba 裸值同样禁止）。SVG 属性的规则名是 `SVG属性色值`。
**报错**：`[blocker] 禁硬编码色 <文件:行> 裸色值（须走 var(--*) token，white/black 豁免）`。
**修法**：换 `var(--*)`——涨=橙 `--accent-3`、跌=绿 `--accent-1`。
**能否绕过**：不能。

### #2b ECharts option 裸色/裸字体 · blocker（§12c Plan 4.5 追加，不在 §11.1 表内）
**查什么**：`<EChart option={{...}}>` 对象字面量内的 `color:`（含数组色板、嵌套
itemStyle/textStyle）与 `textStyle.fontFamily` 裸值；豁免面仅 `src/components/`。
**报错**：`[blocker] ECharts option 裸色/裸字体 <文件:行> EChart option color 裸值（色须走
注册主题，white/black 豁免）`。
**修法**：色走注册主题（换主题自动跟随）、字体走 `var(--font-*)`。
**能否绕过**：不能（图表是唯一允许"自带主题"的组件，绕过它换主题就花）。

### #3 禁硬编码字体 · blocker
**查什么**：裸 `font-family`（须 ∈ 四坑位：display-cn/display-en/body/mono）。
**报错**：`[blocker] 禁硬编码字体 <文件:行> 裸 font-family（须走 var(--font-*)）`。
**修法**：换 `var(--font-*)`。**能否绕过**：不能。

### #4 禁裸动画时长 / 禁裸缓动 · blocker
**查什么**：裸 `animation-duration`/`transition-duration`/缩写值内时长；裸 `cubic-bezier()`。
**注意口径**：缓动半边**只在 TSX 字符串/模板串查**（CSS 文件无 cubic-bezier 检查），且
`src/engine/` 与 `src/components/` 目录豁免（P4-7——组件库代码自证 token 纯度）。
**报错**：`[blocker] 禁裸动画时长 <文件:行> 裸动画时长（须走 var(--dur-*)）`；
`[blocker] 禁裸缓动 <文件:行> cubic-bezier( 裸值（缓动须走 var(--ease-*) token）`。
**修法**：`var(--dur-fast/mid/slow)`、`var(--ease-*)`。**能否绕过**：不能。

### #5 字阶成员 / 最小字号 / 间距成员 · warning
**查什么**：字号 ∈ 字阶集合且 ≥24px；间距 ∈ `--space` 集合。规则名分别是 `字阶成员`、
`最小字号`、`间距成员`。
**报错**：`[warning] 最小字号 <文件:行> 字号 18px 低于最小字号 24px（V4）`。
**修法**：升档或并入正文。**能否绕过**：能——但财报视频小字=观众看不清，别绕。

### #6 禁裸紫粉渐变 / 禁emoji · warning
**查什么**：章节层手写渐变含紫粉色相（hue 250-350°）；emoji 字符（含注释内）。
**报错**：`[warning] 禁裸紫粉渐变 <文件:行> 手写渐变含紫粉色相（hue 305）`。
**修法**：token 化渐变；删 emoji。**能否绕过**：能——视觉指纹第一号，绕了就是"AI 味"。

### #7 确定性黑名单 · blocker
**查什么**：`setTimeout`/`setInterval`/`Math.random`/`Date.now`/`performance.now`/
`requestAnimationFrame`/`new Date()`。**豁免口径**：仅 `src/engine/` 目录豁免
（P4-7——组件同为库代码**不**豁免）。
**报错**：`[blocker] 确定性黑名单 <文件:行> setTimeout 调用（章节层确定性：计时走引擎虚拟
时钟、随机走 SeededRandom）`。
**修法**：删掉——画面由 step 驱动，不需要计时器。**能否绕过**：不能。

### #8 禁无限循环动画 / 无限循环动画 · blocker
**查什么**：CSS 的 `animation: …infinite`（规则名 `禁无限循环动画`）；TSX 的
`iterations: Infinity / -1 / -Infinity` **字面量**（WAAPI，规则名 `无限循环动画`）——
两个规则名、两种判据形态，报告里都叫"无限循环"。
**报错**：`[blocker] 无限循环动画 <文件:行> iterations 无限迭代（渲染确定性；氛围组件用有限周期版）`。
**修法**：有限周期；氛围循环走氛围组件。**能否绕过**：不能。

### #9 组件契约 · blocker
**查什么**：`components/` 目录内禁裸色/裸时长/**裸 font-family**；组件 CSS 每个选择器
片段 `.cdp-` 类名前缀门禁。
**报错**：`[blocker] 组件契约 <组件> <具体违规>`。
**修法**：组件改 token + `.cdp-` 前缀。**能否绕过**：不能。

### #10 主题契约 · blocker
**查什么**：必填 token 全定义；**章节 var() 引用 ⊆ 主题定义**（含主题内部 var() 闭合）。
（对比度**不在**这里——它是 #18 无头 warning。）
**报错**：`[blocker] 主题契约 src/theme <缺失 token / 非法引用>`。
**修法**：用词表里的 token 名（LIBRARY.md）。**能否绕过**：不能。

### #11 文案反AI味 / 字幕结尾标点 · warning
**查什么**：narrations 五类 AI 句式；字幕结尾的句号/逗号/顿号/书名号/省略号（V3；`？！` 豁免）。
**报错**：`[warning] 文案反AI味 <章节> <句式>`。
**修法**：按 SCRIPT-STYLE 清单改。金融大词（护城河/飞轮/赋能…）不在扫描器词表——风骨层
自检自己扫。
**能否绕过**：能——绕了观众一耳朵听出来。

### #12 禁外部网络资源 · blocker
**查什么**：img/font/css 远程 URL（豁免：localhost；**注释不查**）。
**报错**：`[blocker] 禁外部网络资源 <文件:行> <URL>`。
**修法**：资源落本地（`public/`）、字体走 fontsource。**能否绕过**：不能。

### #13 音频完整性 · blocker
**查什么**：**非空** narrations 数 === mp3 文件数 === durations 条目数（空 narration 步
不合成、不吃条目）。
**报错**：`[blocker] 音频完整性 <章节> …`。
**修法**：增量重合成；未跑 TTS 的脚手架态是合法 warning。**能否绕过**：不能。

### #14 字体声明未加载（静态半边）/ 字体加载（无头半边） · blocker
**查什么（两半边，方向都别记反）**：
- 静态（scaffold 期）：**declared ⊆ fonts.css @import**——"声明=加载契约"，每个
  `theme.json fonts.declared` 的 family 必须有对应 @import；
- 无头：**`status==="loaded"` 家族 ⊆ 全 deck 使用面并集**——"加载了但没人用 = 主题与
  真实排版漂移"（**加载面为空**时降为 info——`loaded` 为空，不是 examined===0）。
**报错**：`[blocker] 字体声明未加载 声明的字体「X」（source）在 src/theme/fonts.css 的
@import 中无对应加载`；`[blocker] 字体加载 <家族清单>`。
**修法**：补 @import 或删声明；渲染文本用上已加载字体。**能否绕过**：不能。

### #15 文档死链 · warning
**查什么**：SKILL.md/references 里 `](path)` **相对路径**存在性（**v1 只查路径，不查
节标题/锚点**；协议链接/绝对路径豁免）——原版那种"引用了不存在的 Part 2"的锚点漂移，
机器**不抓**，改文档时人查。
**报错**：`[warning] 文档死链 <文件:行> <目标不存在>`。
**修法**：修链接或补目标。**能否绕过**：能——改了文档记得顺手修。

### 附：三条同步断言 · blocker（M2b 组件库结构规范化追加）

- **防失同步**：`--dur-fast/mid/slow` 的 tokens.css 解析值 === 引擎 `motion.ts` 的
  fallback 字面量（300/700/1400）——改档位不同步映射就拦
- **三方同步**：`manifest.ts` ↔ `components/index.ts` ↔ `StyleGuide.tsx` 三处组件清单
  逐字一致
- **组件覆盖**：每个组件都在 styleguide 有展示格

---

## 无头 5 项（check 全量，自起 Vite + Chromium 逐 step）

> 定位格式是 `章节 X 第 Y 步（id） · <DOM 元素描述>`（**没有文件:行**——无头项定位到
> 步与元素，不定位到源码行）。

### #16 控制台报错 / 被画布截断 / 动画逃逸 · blocker
**查什么**：① 逐 step 挂载下的本页脚本 `console.error`/`pageerror`（规则名 `控制台报错`
与 `运行期报错`——pageerror 分支；归因到步）；② **所有可见元素**越出画布且无裁剪祖先
承接（规则名 `被画布截断`——不限于文本元素）；③ 未注册动画在跑（`unownedRunning > 0`）
或 render 态下任何动画在跑（`running > 0`）；`unowned > 0` 但没在跑 → warning。
**报错**：`[blocker] 控制台报错 章节 0 第 1 步（example） · console.error …（来源 <文件>）`。
**修法**：定位到步 → 打开页面看真实现形 → 修章节。
**能否绕过**：不能。

> **另有三条 harness 级 blocker（管线本身失效的信号，一般不是章节代码问题）**：
> `收集器非空护栏`（全 deck examined===0——"什么都没查"≠"没问题"）、`游标失配`
> （游标被 clamp）、`页面溢出`（documentElement 滚动面 > 视口）。修法在消息内已给出；
> 遇到先重跑、再查管线（dev server/选择器/桥），别急着改章节。

### #17 动画窗口 · warning
**查什么**：每步"注册表**声明**的动画窗口" > 音频实测时长——动效超出人声、步长被动画拉长。
（声明面上界，非实测播放时长——render 冻结态下实测值无从取得。）
**报错**：`[warning] 动画窗口 章节 0 第 0 步 · #17 注册表声明的动画窗口 3000ms > 音频时长
2000ms——动效超出人声 1000ms`。
**修法**：三选一——写更长口播 / 拆 step / 调快档位。**能否绕过**：能——绕了节奏会"卡"。

### #18 对比度 · warning
**查什么**：文字 vs 有效背景的对比度——大字（≥24px）≥3:1、小字 ≥4.5:1；背景是图片/渐变/
Canvas 时记 info（消息含"不可判定"，不拦）。
**报错**：`[warning] 对比度 章节 X 第 Y 步 · <元素> 比值 2.1:1 低于 3:1（大字档）`。
**修法**：换 token（浅强调色只做反色底，禁作文字色）。**能否绕过**：能——绕了看不清。

### #19 音频节奏 · warning
**查什么**：单段音频 **≥15s** → 口播段过密、step 没拆够（§11.1 规格方向；2026-09-15 修正过
一次反向实现，见 KNOWN-ISSUES K-100）。
**报错**：`[warning] 音频节奏 章节 X 第 Y 步 · #19 音频段 18000ms ≥ 上限 15000ms——口播段
过密，step 没拆够`。
**修法**：**拆 step / 加长画面演示**（不是并 step——那是反方向）。**能否绕过**：能——绕了
观众中途划走。

### #20 文字安全边距 · warning
**查什么**：真实文字元素是否越出内容带（x[96,1824] y[112,934]；chrome 元素 ≥64px）。
**报错**：`[warning] 文字安全边距 章节 X 第 Y 步 · <元素> 文本越界 左 40px——若为 chrome 带
元素请加 data-safe-band="chrome"`。
**修法**：移进安全框；或打 `data-safe-band="chrome"` 标记。**能否绕过**：能——绕了平台
裁切/字幕遮挡。另：同名规则还有两条 **harness 级 blocker** 分支（"未找到画布根"与
"安全带参数缺失"）——那是管线失效信号，不是章节违规，修法在消息内。

---

## 阶段门禁（不在 check 里，但同属"机器拦你"）

| 阶段 | 命令 | 拦什么 |
|---|---|---|
| Phase 3 分镜 | `npm run storyboard`（**需先 `npm run dev`**） | 静态版零动画（氛围微动须 `timing.json` `ambient` 声明豁免）+ 帧数 === 总 step 数 |
| Phase 3 一致性 | `npm run storyboard -- --verify-sequential` | 顺序推进（**真键盘 ArrowRight 事件**）vs 独立 mount 逐字节一致；**已声明 ambient 的步免比对** |
| Phase 5 渲染 | `npm run render` 自校验 | 帧数/时长/帧率 vs 时间轴表 + 跨会话同刻重采逐字节 + 步边界偏移（**完整容差口径见 RENDER.md 自校验判据表**） |
| Phase 5 确定性 | `npm run render -- --verify-determinism` | 采样步整段重采逐字节 + 负样本（两个不同 t 必须不同） |

---

## 报红后的通用处置顺序

1. **读定位**（文件:行 或 章节:步）——不要先猜
2. **查本手册对应编号**——看修法列
3. **修 + 复跑 `check:fast`**（秒级闭环）
4. **warning 也要处理**：要么修、要么在汇报里说明理由（"绕"要明说，不许静默）
5. 无头项（#16-20）需要 `npm run check` 全量复跑确认
