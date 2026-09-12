# web-video-presentation 独立研究报告

本地快照：`/Users/jasing/Documents/Work/perhapsjas_skill_market/web-video-presentation`
已验证与上游 `github.com/ConardLi/garden-skills` main 分支逐字节一致（manifest / SKILL.md / README.md / scaffold.sh / useStepper.ts / THEMES.md 均 diff 无差异；上游最近一次 touch 该 skill 的 commit 是 2026-06-09 release 1.2.2，本地 manifest 也是 1.2.2）。
研究日期：2026-09-01。引用格式：本地 `path:line`，外部 URL + 一句话。

> **落盘说明**：证据由后台研究 agent 收集（含本地源码逐行核对、Playwright + React 18 UMD 实证测试、GitHub raw/commit 历史抓取、Remotion/Playwright/fontsource/ffmpeg 官方文档抓取）。agent 在写文件阶段反复卡死，本报告由主会话依据其转录中的结论文本代为整理落盘，结论与证据均出自该 agent 的一手验证。

---

## 任务 A：十条既有结论对抗性复核

### 1. step 游标纯函数渲染 —— PARTIAL（机制描述需修正）

- `templates/src/registry/types.ts:16-25`：`ChapterDef { id, title, narrations, Component }` —— 注意比转述**多了 `title` 字段**。
- `templates/src/hooks/useStepper.ts:36,79,84,92,105,116,128,166`：全部直接用 `c.narrations.length` 推导 step 数；全仓库无 `totalSteps` 字段（仅两处"已移除 totalSteps"注释：`references/AUDIO.md:9`、`templates/src/registry/chapters.ts:9`）。**这部分 CONFIRMED。**
- **修正**：`App.tsx:57` 的 `key={ch.id}` 挂在章节层，**只在跨章节时重挂，不是每步重挂**。章内 step 切换时，若相邻两步返回同类型根节点（如 Example.tsx 的 `div.ex-scene`），React 会复用 DOM 节点只更新 children——新挂载的子树播动画，被复用的根节点不播。"每步天然重放"成立于：① hook-chapter 这类在内部显式 `key={step}` 的章节；② 相邻 step 返回完全不同结构树的章节。
- **实证发现（Playwright + React 18 UMD 复现测试）**：**`MaskReveal` 的 transition 在重挂时根本不重放**。React 在节点插入前就设好 `class="mask-reveal in"`，首帧计算样式即终态 `inset(0px)`，`getAnimations()` 返回空数组——transition 需要先渲染"无 .in"的前态再翻类，插入即终态 = 无可过渡起点。对照组：`fade-in`（keyframes）新挂载节点返回 `["CSSAnimation:fade-in"]`，正常重放。
- **推论**：模板自己的 Example.tsx 字句揭示全走 MaskReveal `show` 恒 true —— **这些文字揭示实际上是瞬间出现、没有动画的**。这是模板的一个真实潜伏缺陷：keyframes 类动画没问题，transition 类（MaskReveal）在"挂载即终态"模式下永远不触发。

### 2. useAudioPlayer auto 推进 —— CONFIRMED

- `useAudioPlayer.ts:83`：`audio.addEventListener("ended", () => advanceAfter(trailMs))`，trailMs 默认 200（`useAudioPlayer.ts:44`），App.tsx:48 传 200。
- 退化路径全覆盖：error 事件（:86）、play() catch（:93）、src 为 null（:97）→ `advanceAfter(estimateFallbackMs)`；`App.tsx:22-25` `estimateMs = max(1500, text.length * 250)`。
- 文档与代码一致（`references/AUDIO.md:218-224`）。

### 3. `?auto=1` 从持久化游标续播 —— CONFIRMED（且比原判断更广）

- `useStepper.ts:42-52`：useState 初始化无条件读 localStorage（key `presentation-cursor-v4`）→ sanitize（只 clamp 不重置）。
- useAutoMode / App / AutoStartGate 全部**没有任何**在 auto 模式下重置游标的逻辑。按 Space 后从持久化位置续播。
- `RECORDING.md:62`"刷新一次清空历史 step"**不成立**——localStorage 跨刷新持久；SKILL.md 2.5 的"bump STORAGE_KEY"指引反而印证持久化是有意设计，RECORDING.md 与之矛盾。真正重置手段是 Home 键或手动清 localStorage。
- **附加发现**：localStorage 按 origin（localhost:5174）存储，**同端口的所有脚手架项目共享同一游标**——`useStepper.ts:27-32` 注释自己承认这一点（"a different scaffolded project sharing the same dev-server origin"）。跨项目污染风险比"上次位置续播"更大。

### 4. 端口漂移 —— CONFIRMED

- `templates/vite.config.ts:7` = `port: 5174`；SKILL.md:275,358,401 与 RECORDING.md:22,61 写 5173（共 5 处）；scaffold.sh:194,213 正确写 5174。
- vite.config 未设 `strictPort`，端口被占会继续漂移（scaffold.sh:194 自己说"被占会自动换端口"）。

### 5. ProgressBar 硬编码上游 GitHub 链接 —— CONFIRMED

- `templates/src/components/ProgressBar.tsx:16-17`：`DEFAULT_GITHUB_URL = "https://github.com/ConardLi/garden-skills"`，且 App.tsx 未传 `githubUrl={null}` → 所有脚手架项目悬浮进度条都会渲染这个上游链接。

### 6. README 引用死链 + 旧版流程图 —— CONFIRMED（附上游历史证据）

- `README.md:72,314,318` 与 `README.zh-CN.md:72,314,318` 引用 `PRINCIPLES.md` / `PATTERNS.md`，references/ 目录实际只有 7 项（AUDIO / CHAPTER-CRAFT / EXAMPLES / OUTLINE-FORMAT / RECORDING / SCRIPT-STYLE / THEMES）。
- 两份 README 的 `43-59` 行工作流图均为旧版双 checkpoint（A1/A2），与 SKILL.md:33-49 的单 Checkpoint Plan 矛盾；`README.md:37`"Hard checkpoints"条目也是旧三段式描述。
- **上游 git 历史**（raw.githubusercontent.com 按提交抓取验证）：PRINCIPLES.md（173 行）与 PATTERNS.md（196 行）在 `d5373a88`（2026-05-02"Enhance web-video-presentation skill documentation"）时 HTTP 200 存在，在次日 `427910e8`（2026-05-03"Refactor ... for clarity and structure"）被 `delete mode` 删除、内容并入 CHAPTER-CRAFT.md。**README 从未随删除更新** → 死链成因确凿。
- 附：SKILL.md frontmatter 里的"按 PRINCIPLES + ANTI-AI 法则"同样指向已删除的文件名。

### 7. extract-narrations 配对机制 —— PARTIAL（机制转述有误，脆弱性属实）

- **原转述错误**：代码**不是**"id: 出现顺序与 import 顺序 1:1 配对"。实际机制（`extract-narrations.ts:44-75`）：ids 按出现顺序收集；folders 收集为去重 set（顺序 = import 出现顺序）；配对用**后缀匹配** `folder.endsWith("-" + id)` 取 `candidates[0]`（import 顺序决胜），无后缀命中再退回全等匹配。**代码内注释（:55-57）声称的 1:1 配对与实现不符**——注释本身在撒谎。
- 脆弱性成立，具体失败模式：
  1. **后缀碰撞 + import 顺序 → 静默错配**：id `hook`（文件夹 `01-hook`）与 id `pre-hook`（文件夹 `07-pre-hook`），若 `07-pre-hook` 的 narrations import 排在前面，`candidates[0]` 命中 `07-pre-hook` → hook 章的音频文本错拿 pre-hook 的，**无任何报错**。
  2. **非字面量 id / 注释里的 id → 静默丢章或幽灵章**：模板字符串 id（`` id: `${base}-cn` ``）不被正则命中 → 该章进 audio-segments.json 缺失 → TTS 不合成 → 录屏时该章走估时假播，extract 全程不报错。注释里的 `{ id: "coldopen" ... }` 被当成真 id → 要么 loud error，若恰好存在同名文件夹则幽灵章被合成。
  3. **非标准 import 路径**（`@/chapters/...`、`.js` 后缀）→ 正则不命中 → loud error"no matching folder found"（fail-safe，安全）。

### 8. fonts.css @import 数量 —— REFUTED（实际 13，且发现更大的问题）

- `templates/src/styles/fonts.css:8-20` = **13 个** @import / 13 个家族（Instrument Serif、Playfair Display、Fraunces、Source Serif 4、Noto Serif SC、Manrope、Inter、Noto Sans SC、Archivo Black、IBM Plex Mono、IBM Plex Sans、JetBrains Mono、Patrick Hand）。grep 计数 14 是因第 4 行注释文本含"@import"。
- **更大的发现**：部分主题在文档/tokens.css 里声明的字体**根本没被加载**——dark-botanical 的 Cormorant、neon-cyber 的 Clash Display + Satoshi、bold-signal 的 Space Grotesk、creative-voltage 的 Syne + Space Mono、vintage-editorial 的 Work Sans、pastel-dream 的 Plus Jakarta Sans、split-canvas 的 Outfit 均不在 fonts.css 清单里 → 这些主题静默回退到 fallback 字体，主题的视觉 DNA 部分丢失。fonts.css 注释要求"新主题作者自行 append"，但 7 个内置主题自己就没遵守。

### 9. 23 套主题 + 16 必填 token —— CONFIRMED

- themes/ 目录 ls = 23；THEMES.md:42 声明 23。
- 必填集合 = 4 表面色（shell/surface/surface-2/surface-3）+ 4 文字色 + 1 rule + 3 accent + 4 字体家族 = 16（THEMES.md:128-169）。脚本化 grep 全部 23 个 tokens.css：**23 套全部定义了全部 16 个**。midnight-press/tokens.css:14-33 为典型样本。

### 10. scaffold.sh 流程 —— CONFIRMED

- `scaffold.sh:93`（npm create vite → react-ts）→ `:97` npm install → `:100` 装 tsx → `:105-111` 删 boilerplate → `:114-161` 拷模板（`:126` 主题 tokens 在其中）→ `:165-173` node 合并 package.json scripts → `:176-178` 写 .theme → `:182` `npx tsc --noEmit` 冒烟。转述顺序与实现一致。

---

## 附加发现（十条清单之外）

1. **CHAPTER-CRAFT.md 结构漂移**：SKILL.md:116,159,411,431,444 与 scaffold.sh:205,228-230 反复引用"Part 0 十条原则 / Part 1 开工 5 问 / Part 2 关系→动作决策树 / Part 3 视觉工具箱 / Part 8 反馈速查"——**实际 CHAPTER-CRAFT.md（224 行）没有任何 Part 编号**，标题是普通中文小节；"开工 5 问 / 关系→动作决策树 / 反馈速查"三个被反复指引的内容**在现文件里不存在**。git 历史显示旧版 373 行（标题"章节开发圣经"）含 Part 编号，427910e8 重写为 166/224 行后 SKILL.md 与 scaffold.sh 的路标全部失配——agent 按 SKILL.md 的路标翻找会扑空。
2. **上游 demo 目录不存在**：README 图库链接指向 `demo/web-video-presentation-demo`，但上游 demo/ 下只有 web-design-demo（404）。预览图实际活在 jsDelivr CDN（dist/imgs）。
3. **同端口跨项目游标污染**：见第 3 条附加段。

---

## 任务 B：外部一手来源研究

### B1. Remotion（remotion.dev 官方文档）

- 时间建模：https://www.remotion.dev/docs/the-fundamentals —— "The idea of Remotion is to give you a frame number and a blank canvas"；视频 = 帧的函数；Composition = 组件 + 元数据（width/height/durationInFrames/fps）；帧 0-indexed。
- 渲染管线：https://www.remotion.dev/docs/renderer 与 stitchFramesToVideo 页 —— renderFrames() 产图片序列，`stitchFramesToVideo` "Takes a series of images and audio information generated by renderFrames() and encodes it to a video"，提供 `ffmpegOverride` 钩子；`npx remotion render` 出 mp4、`--sequence` 出帧序列；默认浏览器为 Chrome Headless Shell。
- 异步等待：https://www.remotion.dev/docs/delay-render —— delayRender/continueRender 阻塞渲染直到异步资源（字体/图片）就绪，默认 30s 超时。
- **判词**："无头浏览器逐帧截图 + ffmpeg 编码"正是 Remotion 的架构——`npm run render` 设想有成熟先例。可借鉴：① Composition 元数据（显式 fps / durationInFrames，对应本 skill 的 narrations 估时）；② `useCurrentFrame` 把"step 的纯函数"细化为"frame 的纯函数"（逐帧截屏的刚需：transition 动画无法跳帧采样，只有确定性帧函数可以）；③ delayRender 等字体/图片就绪再截；④ 两阶段渲染（先帧后编码）保证 CFR 输出。
- **实施要点**：Playwright 的 `screenshot { animations: "disabled" }` 会把 finite 动画快进到终态——适合"每步截终态"的最简实现，**不适合**逐帧动画采样；逐帧需用 `getAnimations()` 控制 currentTime 或 CDP Animation domain。

### B2. Playwright（官方文档 + microsoft/playwright 源码 types.d.ts）

- `page.screenshot` 有 `animations: "disabled" | "allow"` 选项；caret 默认隐藏。
- `deviceScaleFactor` 是 context 选项（`newContext({deviceScaleFactor})`）；精确 1080p 输出 = viewport 1920×1080 + dsf 1（此时舞台 scale=1，CSS px 1:1）。
- `document.getAnimations()` 覆盖 CSS Animations + CSS Transitions + Web Animations；`await Promise.all(animations.map(a => a.finished))` 可等全部结束——**注意 infinite 动画永不 finish**，需先过滤 `a.effect?.getTiming().iterations !== Infinity`。
- 对本 skill 最简可行的 render 管线：逐 step → 等 `getAnimations()` finished（或等音频时长）→ screenshot → ffmpeg concat。

### B3. @fontsource（fontsource.org + npm registry）

- 自托管标准做法：npm 按字重导入（`import "@fontsource/inter/400.css"`）；可变字体用 `@fontsource-variable/*`。
- **`@fontsource/noto-serif-sc` 存在**（registry 5.3.0 / npmmirror 5.2.8），unpacked ~87MB——101 个 unicode-range 子集 × 9 字重的 woff/woff2；单个 `chinese-simplified-400` woff2 ≈ 1.5MB；unicode-range @font-face 保证浏览器只下载用到的 range。
- 对本 skill：把 13 个家族迁到 fontsource = 离线、录制确定性、摆脱 Google Fonts 运行时依赖；代价是 node_modules/dist 体积（本地录屏场景可接受）。**但先修第 8 条的"7 个主题字体未加载"问题**——补齐字体清单比换加载方式更紧急。

### B4. ffmpeg（官方文档 / 官方 wiki）

- concat demuxer（https://trac.ffmpeg.org/wiki/Concatenate）：文本清单 `file` / `duration` 指令；"All files must have the same streams (same codecs, same time base)"。
- image2 demuxer：`-framerate`（默认 25）、`-loop`、`-start_number`、glob `pattern_type`；输入 `-r` 与 `-framerate` 的区别——官方建议"If in doubt use -framerate instead of the input option -r"。
- CFR：输出 `-r` "Duplicate or drop frames right before encoding them to achieve constant output frame rate"；`-fps_mode cfr`（5.1+）"Frames will be duplicated and dropped to achieve exactly the requested constant frame rate"。
- 音画对齐：concat 清单里每张图配 `duration` 条目 + 混音频 `-shortest` / `apad` 补尾。
- 帧率口径：YouTube 官方（https://support.google.com/youtube/answer/1722171）"Content should be encoded and uploaded in the same frame rate it was recorded"，常见 24/25/30/48/50/60。**B 站 CFR 要求未能从官方页面证实**（社区共识，本报告如实标注为未证实）。

### B5. 上游仓库（github.com/ConardLi/garden-skills）

- 本地快照 = 上游 main 逐字节一致（关键 5 文件 raw 对照 IDENTICAL + 全目录 diff 通过）；上游最后 touch 该 skill 的 commit `78b4d08`（2026-06-09，release 1.2.2）→ **上游没有比本地更新的版本**。
- PRINCIPLES.md / PATTERNS.md 生命周期：`d5373a88`（05-02）存在 → `427910e8`（05-03）删除并入 CHAPTER-CRAFT.md。
- `demo/web-video-presentation-demo` 上游不存在（仅 web-design-demo）。

---

## 结论统计与差异清单

**统计**：10 条中 **7 CONFIRMED**（#2 #3 #4 #5 #6 #9 #10）、**2 PARTIAL**（#1 #7）、**1 REFUTED**（#8）。

**与先前结论的差异**（主会话第一轮分析的修正项）：

| # | 原结论 | 修正后 |
|---|---|---|
| 1 | "key={ch.id} 强制重挂 → CSS 入场动画每步天然重放" | key 只在跨章节时重挂；每步重放取决于章内树结构/key={step}。**MaskReveal 的 transition 挂载即终态、永不重放（实证）**——模板自己的文字揭示实际是瞬间出现 |
| 7 | extract-narrations "1:1 顺序配对" | 实为**后缀匹配 + import 顺序决胜**；代码注释声称的 1:1 与实现不符；主要风险是后缀碰撞静默错配与非字面量 id 静默丢章 |
| 8 | "12 个 Google Fonts 家族" | 实为 **13 个**；且 7 个内置主题声明的字体（Cormorant / Clash Display / Satoshi / Space Grotesk / Syne / Space Mono / Work Sans / Plus Jakarta Sans / Outfit）**从未被加载** |
| 新 | —— | SKILL.md/scaffold.sh 引用的 CHAPTER-CRAFT"Part 0~8"路标在现文件中不存在（无 Part 编号，缺开工5问/决策树/反馈速查） |
| 新 | —— | localStorage 游标按 origin 共享，同端口所有脚手架项目互相污染 |
| 新 | —— | 上游 demo 目录 404；PRINCIPLES/PATTERNS 删除历史有精确 commit 证据 |
