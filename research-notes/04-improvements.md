# 04 · 改进方向全集

> 前置：缺陷均经对抗性复核确认（判定与证据见 [03-findings-audit.md](03-findings-audit.md)）；render/check 的外部依据见 [05-comparison-video-engines.md](05-comparison-video-engines.md)。

---

## 一、确认的缺陷清单（复刻前必修 / 改原版优先修）

### #1 MaskReveal transition 永不重放【实证 bug，最高优先】
- **现象**：React 在节点插入前就设好 `class="mask-reveal in"`（终态），首帧计算样式即 `inset(0px)`，`getAnimations()` 为空——transition 需要先渲染前态再翻类，插入即终态 = 无可过渡起点（Playwright + React 18 UMD 实证复现）
- **影响**：模板 Example.tsx 的文字揭示**实际是瞬间出现、没有动画**；所有抄 MaskReveal 模式的章节文字揭示全部失效。keyframes 类（`fade-in`/`rise-in`/`pop-in`）正常重放
- **修法**（三选一）：
  1. 入场动画统一收敛 keyframes（最简，推荐）
  2. MaskReveal 改两帧翻转：`useEffect` 里 `requestAnimationFrame(() => setShow(true))`，首帧渲染无 `.in`
  3. 学 HyperFrames 用 GSAP paused timeline + `tl.seek(t)` 驱动（为 #7 的 render 铺路）

### #2 `?auto=1` 从持久化游标续播【bug】
- useStepper 初始化无条件读 localStorage，无任何 auto 模式重置逻辑；RECORDING.md"刷新一次清空历史 step"不成立
- **修法**：`?auto=1` 时 `useState` 初始化跳过 localStorage（或加 `&from=start` 参数）；AutoStartGate 启动时 `jumpToChapter(0,0)`

### #3 游标按 origin 共享，跨项目污染【bug】
- localStorage key `presentation-cursor-v4` 全局唯一；同端口（5174）所有脚手架项目共享游标——useStepper 注释自己承认
- **修法**：key 加项目名（`presentation-cursor-<dirname>-v4`），scaffold 时写入

### #4 端口漂移【文档 bug】
- vite.config = 5174，SKILL.md ×3 + RECORDING.md ×2 写 5173（scaffold.sh 正确写 5174）
- **修法**：统一 5174；或 SKILL.md 改为"看 scaffold 输出"

### #5 ProgressBar 硬编码上游 GitHub 链接【泄露】
- `DEFAULT_GITHUB_URL = "https://github.com/ConardLi/garden-skills"`，App.tsx 未传 null → 所有脚手架项目悬浮进度条渲染上游链接
- **修法**：默认 `null`，需要时显式传

### #6 README 双份漂移【文档】
- 引用已删除的 PRINCIPLES.md / PATTERNS.md（上游 git 考古：05-02 `d5373a88` 存在 → 05-03 `427910e8` 删除并入 CHAPTER-CRAFT，README 未更新）；工作流图仍是旧版双 checkpoint A1/A2
- **修法**：对照 SKILL.md 重写 README 工作流节 + Reference Map

### #7 extract-narrations 后缀匹配静默错配【设计缺陷】
- 实际机制：`folder.endsWith("-" + id)` 取 candidates[0]（import 顺序决胜）——**代码注释声称的"1:1 配对"与实现不符**
- 失败模式：① 后缀碰撞（`01-hook` vs `07-pre-hook`，import 顺序决定对错）→ 音频文本静默错拿；② 非字面量 id（模板字符串）/ 注释里的 id → 静默丢章或幽灵章；③ 非标准 import 路径 → loud error（安全）
- **修法**：章节注册走独立 React-free manifest（`registry/manifest.ts` 直接 export `[{id, folder}]`），extract 直接 import manifest——消灭正则解析

### #8 字体三重问题【缺陷 + 依赖】
- fonts.css 实为 **13** 家族（非 12）；**7 个内置主题声明的字体从未被加载**（Cormorant / Clash Display / Satoshi / Space Grotesk / Syne / Space Mono / Work Sans / Plus Jakarta Sans / Outfit）→ 主题 DNA 静默丢失
- 运行时 @import Google Fonts → **大陆环境不可达**，录屏字体全部退化
- **修法**（顺序）：① 先补齐缺失字体清单（theme.json 加 fonts 字段，scaffold 校验"声明=加载"）；② 迁 fontsource 自托管：`@fontsource/noto-serif-sc` 存在（~87MB unpacked，unicode-range 101 子集 × 9 字重，单子集 woff2 ≈ 1.5MB，浏览器按需下载）；CJK 家族重，dist 膨胀在本地录屏场景可接受

### #9 SKILL.md ↔ CHAPTER-CRAFT 路标失配【文档】
- SKILL.md:116,159,411,431,444 + scaffold.sh:205,228-230 引用"Part 0 十条原则 / Part 1 开工 5 问 / Part 2 关系→动作决策树 / Part 3 视觉工具箱 / Part 8 反馈速查"——实际文件（224 行）无 Part 编号，**开工 5 问 / 决策树 / 反馈速查三节不存在**（373→224 行重写后路标未更新）
- **修法**：要么补回三节，要么改 SKILL.md 路标指向实际小节名

---

## 二、把纪律自动化（最高价值改进）

原 skill 所有质量约束靠 agent 自觉——自检协议再严格也是"要求它记住"。**反 AI 味的判定恰恰大部分机器可做**。

### `npm run check`（一个 tsx 脚本）

| 检查 | 手段 | 对应原版纪律 |
|---|---|---|
| narrations 一致性 | 正则扫 tsx 的 `step === N` 最大值 +1 vs narrations.length | 完工自检第 14 条 |
| 禁硬编码色 | CSS 里 `#[0-9a-fA-F]{3,8}\b`、`rgb\(`、命名色（white/black 除外） | token 红线 |
| 禁硬编码字体 | `font-family:` 值不含 `var(--font-` | token 红线 |
| 禁紫粉渐变 | `gradient\(` + 色相检测（紫/粉/蓝紫范围） | 反 AI 味 |
| 禁 emoji | Unicode emoji range 扫描 | 反 AI 味 |
| 禁 setTimeout/setInterval | tsx AST 或正则 | 代码红线 |
| 估时 vs 动画时长 | ffprobe 实测音频时长 → `audio-durations.json`；标注动画超口播的 step | "动画 ≤ 口播" |
| 无头 seek pass | Playwright 逐 step 打开 → 收集 console error / 布局溢出 / `getAnimations()` 异常 | 完工自检的"浏览器点完一遍" |
| 文案反 AI 味 | 对 narrations 文本跑 SCRIPT-STYLE 五类句式的正则（"说白了/本质上/恰恰/反而/正是因为/归根结底/我必须"…） | 风骨层自检 |

学 HyperFrames 的 `check` 门禁形态：**persistent findings gate exit code**——check 不过 = 不能汇报"做完了"。这把"自检协议"从纪律变成 CI。

### `npm run render`（程序化出口，两个成熟先例）

Remotion 架构 = Chrome Headless Shell 逐帧截图 + `stitchFramesToVideo`（ffmpeg 编码），`ffmpegOverride` 可改 ffmpeg 命令——"无头浏览器截帧 + ffmpeg 拼接"正是它的公开管线。HyperFrames 同构（GSAP timeline seek + 逐帧捕获 + ffmpeg）。

**最简可行版**（口播驱动视频不需要 60fps 全采样）：
```
逐 step → 等 document.getAnimations() 全 finished（过滤 iterations===Infinity 的无限动画）
       → screenshot（viewport 1920×1080 + deviceScaleFactor 1 = 精确 1080p）
       → ffmpeg concat demuxer（每图 duration = 该 step 音频实测时长）
       → -fps_mode cfr 恒定帧率 + 混音（-shortest / apad）
```

**关键坑（官方文档确认）**：
- Playwright `screenshot { animations: "disabled" }` 会把 finite 动画**快进到终态**——适合"每步截终态"，**不能**用于逐帧动画采样
- 逐帧采样需 `getAnimations()` 控制 currentTime 或 CDP Animation domain——这要求先把动画改成确定性（缺陷 #1 修法 3）
- concat demuxer："All files must have the same streams"；输入帧率用 `-framerate` 不用 `-r`（官方："If in doubt use -framerate"）；`-fps_mode cfr`（5.1+）= 复制/丢帧达成精确 CFR
- YouTube 官方要求"以录制的帧率编码上传"（24/25/30/48/50/60）；B 站 CFR 要求仅社区共识（未从官方页面证实）
- 字体/图片就绪再截：学 Remotion `delayRender`/`continueRender` 语义（默认 30s 超时）

**双出口策略（终态建议）**：预览/录屏照旧（低门槛 + 真人感 + 浏览器即所见即所得），`render` 作为可选程序化出口（确定性 / 批量 / CI）。差异化要守住——**不要被程序化渲染带走向"全自动化"**，B 站口播的"呼吸感"正是 step + 真人录屏路线的价值。

## 三、流程层改进

1. **style-card.md 风格锚**：第 1 章验收后，agent 产出一页"本章实际用的动画词汇表/缓动/类命名模式"，注入后续 subagent prompt——比"参考第 1 章代码"聚焦，显著压缩模式 C 风格方差
2. **截图自检**：章节完工自检时 Playwright 逐 step 截图，agent 用**视觉**审查替代纯代码审查——"代码对"和"看着对"的 gap 正是视觉类 skill 最需要闭合的
3. **字幕层 `?sub=1`**：narrations 文本运行时现成，可选字幕几乎零成本（对预览/无声观看有用；烧录已有独立 add-subtitle skill）
4. **STORAGE_KEY 自动失效**：对 chapters.ts 内容 hash 替代手动 bump（缺陷 #3 修法的一部分）
5. **extract 的 manifest 化**：见缺陷 #7——顺带让"注册顺序"和"import 顺序"解耦
6. **中文口播估时校准**：`字数×250ms` 是粗估；合成后用 ffprobe 实测时长回写 `audio-durations.json`，运行时精确替代估时（Auto 模式更顺滑）

## 四、必须保留不动的设计（改进时别丢）

| 设计 | 为什么 |
|---|---|
| outline 不写动画 | 方法论灵魂；写死 = 退化翻译机 |
| 第 1 章强制主线程 + 验收 | 早暴露盲区；并行风格锚 |
| "没有等动画的兜底" | 倒逼节奏纪律 |
| placeholder 卡 > fake 素材 | 诚实原则 |
| provider 只内置 2 个 + 5 段片段 | 不替用户做技术选型 |
| 模式 C 风格漂移 = feature | 多 voice 呼吸感，token 兜底 |
| 三函数 provider 契约 | bash 层零依赖可扩展 |
| 双源原则（script 节拍 / article 密度） | "画面信息 > 口播信息"的机制化 |
| 渐进式文件读取表 | 长会话防遗忘 |

## 五、优先级排序（复刻者的执行序）

```
P0（不修不能抄）: 缺陷 #1 MaskReveal / #7 extract 正则 / #8a 字体清单
P1（复刻时顺手）: #2 #3 auto 续播与游标隔离 / #4 端口 / #5 GitHub 链接 / #8b 字体自托管 / #9 路标
P2（超越原版）  : npm run check / npm run render（最简版先行）
P3（锦上添花）  : style-card / 截图自检 / 字幕 / hash STORAGE_KEY / audio-durations 回写
```
