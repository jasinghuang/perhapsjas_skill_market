# 已知问题台账（跨里程碑）

> **为什么有这份文件**：M1 终审把"resume-after-404 卡死"裁决为"延后到 M2a 一行守卫"——M2a 没做，此后设计文档、计划、代码三处零痕迹，直到 M4 收尾盘账才发现（2026-09-11，已修 `cc3a6f1`）。裁决只活在 SDD ledger 里，而 ledger 随工作区收尾即删。M2a/M2b 的工作区已删且其计划无执行记录段——**它们的 deferred 台账已经丢了**，无法找回。
>
> **规则（自此强制）**：任何终审/评审的 parked 裁决与 deferred 项，必须落进本文件或下一个里程碑计划的显式条目；**未落盘不允许删工作区**。条目修复后标注 commit 并移入 §0；不删除历史。
>
> 分工：本文件是**跨里程碑耐久登记**；里程碑交接的短期清单走设计文档 §12（如 "M5 遗留清单"），交接完成后并入本文件。

**更新**：2026-09-12（M5b **终审修复波**：**K-91 降级不失声**、**K-92 `--no-subs` 归一用例**结清入 §0，K-98 登记 T6 已结清的 deferred；**M5b 全部 deferred 与 Ruling 残留逐条落盘**——新增 §1 的 K-93（文案/口径）/K-94（夹具与覆盖口径，含 `--no-srt` 陈旧 SRT）/K-95（"不进降级"清单）/K-96（护栏已接受形态）/K-97（真机与金样缺口，含"金样无自动消费者"））

**更新**：2026-09-12（M5b 收口：**K-82③ 结清入 §0**（T1 `fc04d5a`）；K-79 指针更正为 M5b Task 4 并改「已实现」；K-87 补 autoplay 因果改写（缺 flag 退化为估时节奏而非冻死）；新增 §1 的 K-89/K-90 两条残余）

**更新**：2026-09-12（M5a 渲染核心收口：新增 K-76~K-83——渲染链的已知边界六条 + 边界断言/测试基建两条；M5a 无 §0 结清项，K-31/K-32 的归属见 §1）

**更新**：2026-09-12（M3b 收口：K-10/11/12/21 结清入 §0；新增 K-31/K-32 与 K-46~K-49、K-54~K-57）

**更新**：2026-09-12（M3b 终审修复波：T1~T9 的 ~40 条 deferred minor 与执行期 Ruling 残留项**全量落盘**——§0 K-58/K-59〔本波修复〕、§1 K-60~K-65、§2 K-66~K-69、§3 K-70~K-72；自此 M3b 工作区（按 K-50 收尾即删）里不再有只活在 ledger 的 deferred。code commit `293f30d`）

---

## §0 已修复（本轮盘账）

| ID | 来源 | 问题 | 修复 |
|---|---|---|---|
| K-75 | M3b 终审旁注（当时未落账，2026-09-12 清理时补） | `narration-video/templates/.impeccable/`（设计钩子的本地状态：narrow ignore 配置 + hook 缓存）是 untracked 且未被 `.gitignore` 覆盖，而 `scaffold.sh` 是**整目录 `cp -R`** → 它会随模板**拷进每个新项目**（与 M4 的 `storyboard/` 泄漏同型） | `.gitignore` 增 `.impeccable/`；`scaffold.sh` 的清理行补 `rm -rf "$TARGET/.impeccable"`；`scaffold-smoke.sh` 增 `test ! -e "$TMP/demo/.impeccable"` 断言（冒烟 OK）。**注**：同批曾把 `web-video-presentation/` 与用户素材 PDF 也写进 `.gitignore`，经用户裁定**已撤**（那两条属仓库边界决定，非本台账事项） |
| K-01 | M1 终审 parked ① | `resume()` 对加载失败的音频走 `audio.play()` 分支：失败资源上再 `play()` 不再触发 error 事件（实测 `errEvents` 恒 1、`networkState=NETWORK_NO_SOURCE`）→ 无计时器重武装 → **自动推进链被掐死**。比原记严重：模板无 `public/`，音频请求照样拿不到可解码资源，**点一次播放即冻死**（原记只写"暂停再播放"，实测无需暂停）。**措辞更正（2026-09-12）**：该请求不是 404，而是 dev server 的 **200 + text/html**（SPA fallback 回 index.html；静态服才多为 404）——失败机理（解码失败 → `onerror` → 估算兜底）与结论**不变** | `cc3a6f1`（resume 判 `audio.error` 走估时兜底 + 单测红→绿 + 真浏览器对照实验） |
| K-10 | M3a P4T2 | 颜色门禁**跨行值漏检**：`box-shadow:` 换行后的 rgba 逃逸（ledger 自认"Minor 级真回归"，行级契约内） | `39aa464` + 4 修复轮（`2860a69` / `38b0298` / `1239164` / `f97e637`）——scanner-css 声明级状态机（`tokenizeCss`，含 URL 态与字符串外转义） |
| K-11 | M4.5 P45T3 | `exemptEasing` 旗标被两条规则共享 → **EChart 拿到 spec 未要求的 easing 豁免**（§12c 动效策略被静默放宽） | `0e5464e`——豁免旗标拆三（`exemptDeterminism` / `exemptEasing` 逐字不动 / 新增 `exemptChartOption` 仅 components），规则名/severity/message 经字面量集合比对逐字未变 |
| K-12 | M3a P4T5 | `inBlock` 注释态泄漏：字符串里出现 `/*` 会让该文件后续检查**静默失效**（同型问题也存在于 scanner-css） | `39aa464`——同批状态机修复（注释态仅在字符串外开启；反转（`*/` 幻影、未闭合引号吞行）另有修复轮） |
| K-21 | M4 | `--verify-sequential` 与 `capture` 各自复刻浏览器三段启停（漂移面） | `2f4d500`——`scripts/shot/session.ts` 会话模块：全树唯一 `chromium.launch` / 桥等待 / `readyWithTimeout`，三段复刻删净（评审以 `git archive` 重建修前基线，零像素漂移） |
| K-58 | M3b T6 ① | `render` 支路无单测：守卫是 OR（`renderMode \|\| params.has("headless")`），测试只钉了 `headless` 支——若将来有人改成只判 headless，`?render=1`（无 headless）会静默恢复自驱而全库测试不报 | `293f30d`（终审修复波补 `/?render=1` 用例；变异验证：守卫改只判 headless → 该用例 RED、其余 11 条绿。注：当前不可达——`capture.ts`/`verify-sequential.ts` 都走 `openSession`，而它恒追加 `headless=1`，故这是防御锁） |
| K-59 | M3b T7 ① | `ConsoleWindow` 类注释仍写"`clear()` 丢弃（框架期/中止时）"——修复轮 1 已删开场 `clear()`，"框架期"已不存在 | `293f30d`（类注释去掉"框架期"，与 `check.test.ts` 的用例名"clear 丢弃（中止路径）"一致；用例名由 T9 `6c98350` 更正） |
| K-82③ | M5b T1（`fc04d5a`）；原记见 §1 K-82 的 ③ | **真 TTS 起手静音把该步边界整条跳过 → 对正确产物假红**：旧判据在**产物轨**上找 onset 当锚点，起手静音吃掉整窗即无 onset 可找（方向安全，但"对正确产物报红"）。mock 音轨（lavfi 正弦起手即满幅）不触发，故 M5a 冒烟看不见它 | 已修（T1 `fc04d5a`）：**改在参考轨（ideal）上找 onset** 作锚点。三条判据全绿（拟真 `judged=3/failures=0`；mock 读数与 `ff1b405` **逐字相同**；注入 +30ms → 3 条红）。**三条从 M5b ledger 之外看不到的口径**：① **这是一次判定面收窄**——`dwell=0` + 前一步音频填满的夹具下 旧 `judged=3` → 新 `judged=2`（删掉的是**错标读数**：旧读数标"步 2 起"量的却是上一步的尾巴）；真 deck（dwell ≥400ms）不踩；② **前视 500ms 是硬编码**——真 TTS 起手静音 >500ms 会回到"全跳 → 假红"（方向安全、错文可诊断，**仍留残余**，M6 接入真 TTS 时复核）；③ 该判定分支的触发阈值 = **≥50ms 起手静音 + dwell ≥50ms** |

| K-91 | M5b 终审 **C-1**（评审真机实测的缺口） | **降级在"编码前失败"时交付无声成片，且按钮用户零提示**：`encoded` 只在 `encodeVideo` **之后**才有值，而 §8 步骤 4 的主触发（帧流 seek 断言失败）发生在 encode **之前** ⇒ `audioTrack: null` ⇒ 产物**只有 video 流**。评审真机证据：`POST /__export/run` → `state:"done"` → `/file` 交出的 `presentation.realtime.mp4` **无 audio 流**；`[realtime] 本次降级产物无声…` 日志确实响亮，但**按钮用户看不到任何一行日志**、退出码 0。计划 I3 原文是"**降级不得失声**" | 已修（本波）：`encode.ts` 外提 `encodeAudioTrack`（音轨命令的**唯一一份**：`buildAudioFilterComplex` + AAC），`encodeVideo` 改为调用它（命令一字未变）；`degrade()` 在 `encoded === undefined` 时**自建音轨**（同一份 `segments`（`public/audio/<folder>/<step>.mp3` + 时间轴 `stepMs`）与 `fps`，落 `<slug>/audio.m4a`）再交实时捕获 mux。验证：注入式两条（自建音轨被调且源同一份 / 自建失败仍出片 + 响亮标注）+ **真机一条**（真 deps 跑整条 `runRender`，只让 `captureFrames` 抛错 → 产物 `hasVideo=true, hasAudio=true, audioMs 7650 = Σ stepMs`）；**负对照**：自建分支短路回旧口径 → 同一条真机臂 `hasAudio: false`（逐字复现评审读数）。**残余**：自建音轨**也失败**时（ffmpeg 挂了）仍出无声片——此时 `degrade()` 打 `[render] 自建音轨失败：…本次降级产物**无声**` 且 realtime 侧另有 `[realtime] …无声…` 一行（见 K-93⑦ / K-96②） |
| K-92 | M5b 终审 **I-1**（评审） | **`--no-subs` 的 CLI 归一零自动化覆盖**：`render.test.ts` 里 `noSubs\|no-subs` 出现 **0 次** ⇒ `parseArgs(["--no-subs"])` 与 `render.ts` 那行归一（喂**四个**消费者：窗口预扫 / 帧流 / 自校验重采 / 确定性终验）无测试——一次重构就能让它静默变成"要无字幕却给了带字幕的片子"（T6 只补了**参数名字面**两端：`session.test.ts` 写侧 + `App.test.tsx` 读侧） | 已修（本波）：`render.test.ts` 加一条——`parseArgs(["--no-subs","--verify-determinism"])` → **四处 URL 都含 `no-subs=1`（且 `render=1`/`headless=1`）且逐字相同**（`new Set(urls).size === 1`）；**负对照**：删掉那行归一 → 该用例红 |
| K-98 | M5b T6（收口期**已结清**的 deferred 登记） | 收口期已修的项（登记以免被读成"未修"）：① T3① `withNoSubs` 无单测 → 补三条（逐字断言 `?no-subs=1` + 幂等 + 保留既有 query）；② T1① `golden/README.md` 写 7.65s 而待审成片 7.77s → T2 已回正（现写 7.770s）；③ T2③ 成片 md5 未记进报告 → T6 记进报告与 `golden/README.md`（`3ec3bdef1085d4ed2473ea9f6d9554d2`）；④ T5① `render.test.ts:652` 排版回归 → T5 修复轮 1 已拆行；⑤ T5④ `export-service.ts` 的 `mount?` 注释读不通 → T5 修复轮 1 已改写 | 见各条（无需动作） |

---

## §1 活跃（已登记，未修）

### 中：会让门禁/建构比设计宽松（假绿方向）

| ID | 来源 | 问题 | 建议处置 |
|---|---|---|---|
| K-31 | M3b T9 | §11.1 #1 的 step 使用上界**无头半边**推迟：章节 `f(step)` 越界渲染且**不抛错**时（纯空白帧）不被抓——T7 的逐 step console 断言只部分兜底（只有"越界即报错"的写法才现形） | M5 帧流：加"该帧非空白"一类的像素/文本面判据（无头 seek pass 已备好逐 step 骨架） |
| K-32 | M3b T9 | 无头 pass 跑 `?render=1&headless=1` **冻结态**：不覆盖"动画播放期才出现的 console error"（冻结态下动画不推进，播放期才触发的报错不现形） | M5 帧流（真实播放 / 逐帧 seek）覆盖；当前冻结态是"确定性优先"的有意取舍 |

### 低：可用性/测试覆盖/诊断质量

| ID | 来源 | 问题 | 建议处置 |
|---|---|---|---|
| K-20 | M4 | `html.ts` 帧图 `width/height` 硬编码 16:9 → 3:4 项目分镜页占位跳变 | 从主题 dims 派生 |
| K-22 | M1 T6 | 停止按钮在 (0,0) 处按下后 marker 残留，下一次键盘推进被吞为静态场景——终审裁定"可接受"，约定做停止态 UI 时重审 | 停止态 UI 落地时一并处理 |
| K-23 | M1 T7 | 冒烟断言 3-4 接受任意非零退出（stderr 吞掉难诊断）；`.engine-version` 只查存在不查内容；`--slug` 缺值报 cryptic | 冒烟硬化轮 |
| K-24 | M1 T3 | `gotoChapter` 零覆盖、slug 隔离无测试；空 `stepsPerChapter` 产生 NaN（真实内容不可达） | 补测或加守卫 |
| K-25 | M3a P4T6 | 版本守卫死代码（静态 `import registerHooks` 使友好 throw 不可达）→ 建议补 `engines` 字段；`readThemeJson` 缺失时 crash 与 finding 不一致 | 补 `engines` 字段 |
| K-26 | M4 | `assertChapterId` 非字符串隐式 ToString（TS 不可达）；`manifest.define()` 未校验 id 字符集；`shotPath("")` 根锚定；`withHeadless` 无协议 URL 裸 TypeError；5174 被占时指引不提示实际端口 | 注册期/入口校验小修 |
| K-27 | M4.5 P45T2 | 主题生成器：`var()` fallback 含括号静默透传、值捕获 `{}` 截断、扁平 last-wins 无视 `@media`；`EChart` rest 透传丢 DOM props；StrictMode 双挂载无测试；门禁同行去重吞第二违规、`textStyle.rich.*` 不覆盖 | 主题生成器硬化轮 |
| K-28 | M3a P4T4 | `AI_PHRASES.join` 未转义（现全中文无元字符）；`foo.Math.random` 式别名过覆盖（少漏报方向） | 加 escape 或注释 |
| K-29 | M1 T1 | `package-lock.json` 的 tarball URL 全指向 `registry.npmmirror.com`（本机 npm 配置泄漏）；jest-dom 6.10 声明 `node>=22`（EBADENGINE 仅警告） | 发布前重生成为 registry 中性 |
| K-30 | M3b T4 | 安全框的 3:4（1080×1440）绝对值 = **基准比例折算**（36/54/149/1245/1277），不是用户确认的视觉裁定；`engine/safe-area.ts` 只按 W/1920、H/1080 折算，不含小红书档案的构图判断 | M7 档案定稿时由用户确认绝对值；届时把确认值落入 `SAFE_AREA_BASE` 或加档案覆盖表（文件头已注明） |
| K-60 | M3b 终审 ②-3 | **`examined` 语义在两条线上不一致**：溢出收集器 = 画布内**所有**元素（不看文本）；#20/#18 = 只数"含直接文本且未被 caption 排除"的元素——两条线共用同一句"`examined === 0` → blocker（收集器什么都没查到）"护栏 | 终审已**实测证伪**其"假红"主假设（示例章节改纯图形、文字只留 caption → examined 只掉到 **1**、护栏未触发）；残留仅"整 deck 无任何非 caption 文字且不用 KenBurns"这类 deck（#20/#18 归零 → 假 blocker）。处置：把两条线的定义对齐（或文档明写差异）；M5 帧流引入该类 deck 时复核 |
| K-61 | M3b T1 ③ | `codeLinesOf` 以"trim 后 `/*`/`*` 开头"判注释行——将来夹具出现 `* {…}` 选择器会被误剔（测试装置面，非扫描器判据本身） | 夹具扩充时一并改判据/加守卫 |
| K-62 | M3b T3 ①② | ① `session.test.ts` 成环护栏正则只挡静态 import 形式（挡不住 `import("./capture")`；当前全仓实际无环，已核实）；② `assertCursor`/`assertChapterId` 未补进冻结面断言（计划原文本就含这两个名字，属合规必要——评审判"建议防误删"） | ① 正则覆盖动态形式；② 冻结面清单补两个名字（各一行级） |
| K-63 | M3b T2/T3/T4 | 测试文档失真与覆盖缺口一批：① T2 两个 EChart 夹具头注释与 `fixtures.test.ts` 决策记录称"同一段源码分别注入两路径"，实际两份夹具正文不同、也无该交叉注入测试（**文档失真，判别力不受损**）；② T2 `isSrcSubdir` 的"非直接子目录不豁免"用例未覆盖 EChart 规则；③ T4 取整语义无测试区分（3:4 分数全为 .33，floor 与 round 同值——未来档案可能分叉）；④ T3 jsdom 下 `new URL(相对, import.meta.url)` 解析成 `http://localhost:3000/…`，读源码型测试须用 `fileURLToPath` + `path.join`（**已在测试注释注明**） | ① 改措辞（收尾轮顺手）；②③ 补用例；④ 已文档化，无需动作 |
| K-64 | M3b T5/T8/T9 | 注释/文案与事实不符一批（一行级）：① T5 `clip()` 截断结果实为 **81** 字符（80 + 省略号），注释写 80；② T8 缺省臂注释称它"防漏接采集"，真正兜底的是 `collectorExaminedGuard`；③ T9 `headless.ts` 的 #19 读数在"durations 存在但读坏"时括注写"缺失"；④ T9 `useAudioPlayer.test.ts` 三处用例名/注释仍写 "404"（K-01 已澄清真实回落是 200 + text/html） | 文案更正轮（不改判据） |
| K-65 | M3b T3③/T5① | 小硬化项一批：① `scaffold-smoke.sh` 的 playwright 安装提示 grep 依赖字面量物理位置（T9 逐字未动；该常量再迁会二次变红）；② `audit()` 的 `isRunning`/`isOwned` 与 `get.call(document)` 未包 try/catch（理论面：Proxy 条目 / monkeypatch 的 `getAnimations` 会让 audit 抛；真机只返回原生 Animation） | ① 改按内容/锚点匹配；② 视 M5 消费面决定是否加防御 |
| K-82 | M5a T6 评审 minor ①②③ | **边界断言的已知边界**（真机判据的残余，三条）：① **首条边界（t=0）是单向搜索窗口**——左端被 clamp 到 0，30ms 级偏移可能报绿（实测相关性 0.615 仅高过 0.6 下限）；② **显著性判据在中位为 0 时退化为"峰值 > 0"**（真 deck 中位恰为 0，比值 ∞）——建议加绝对下限（如 `peak ≥ 0.3` 灰阶）或 `max(median, 0.1)`，未做；③ ~~**真 TTS 起手静音 ≥50ms 时该步边界整条跳过**（窗口两侧皆静音），全跳则对**正确产物假红**（方向安全）~~ **已修**（M5b T1 `fc04d5a`，见 **§0 K-82③**——含"判定面收窄 / 前视 500ms 硬编码 / 阈值 ≥50ms 起手静音 + dwell ≥50ms"三条口径） | ① 右侧窗口或把相关性下限提到 0.7；② 加绝对下限；③ **已修（§0 K-82③）**；①② 仍不改现有容差口径 |
| K-83 | M5a T4/T5 执行观察 + T7 收口 | **全量套件的浏览器臂并发 flake**：首轮 `npx vitest run` 偶发红（`window-scan.browser.test.ts` 2 条"桥未安装"，归因 **Vite 冷启动 dep 重新预打包**让挂载超 10s；单独跑/连跑第二次均全绿）。随浏览器测试文件增多触发率上升——**M5b T6 时点的面**：**8 个 `*.browser.test.ts`**（真 Chromium），其中 5 个自起真 Vite（`encode` / `frames` / `realtime` / `verify` / `window-scan`）、3 个走静态 http 夹具或进程内中间件（`session` / `verify-sequential-negative-control`〔本任务新增〕/ `export-service.test.ts`） | T7 收口实测：**先热一次缓存**（先单跑一个浏览器臂文件）后全量绿；根治方向 = 把浏览器臂文件串行化（`fileParallelism: false` 或独立 project），未做。⚠️ **冷缓存下全量会红**（Vite 首次 dep 预打包把挂载推过 10s 超时）——在串行化之前，本条**不宜当作 CI 门禁**，也不该按"套件坏了"处置。**锚刷新（2026-09-12，M5b T6 收口）**：全量 **850 测试 / 59 文件**，**先热（单跑 `window-scan` + `session` 两个真机臂）→ 全量一次过、无 flake**（本条旧锚 737/54 与 M5a 收尾的 741/54 是更早代的读数——**读旧锚一律按本条新锚换算**） |
| K-84 | M5a 各任务 deferred（2026-09-12 收尾时落盘） | **注释/报告/措辞口径一批**（均不改判据）：① T1② `TimelineStep.holdMs`（**残差**）与运行时 `playStep(…, holdMs, …)`（垫原值）**同名不同义**——各自消费点有说明，但名字本身是误导源；② T2① `window-scan.frameCountByStep`（注册表容量/诊断）与 `timeline.frameCount`（落盘 PNG 数）**同词不同义**；③ T3① HMR 模块实例的坑（`?t=` URL = 另一个实例）只写在 commit message，源码注释里只有操作顺序 `jumpTo → ready → seek`；④ T4③ R7 泄漏判据**复用门禁的 `animationEscapeVerdict`** ⇒ 也绑定门禁的**文案**（门禁只改措辞也会让 frames 测试红）；⑤ T4④ 帧目录字符串被构造两份（`frameDir` 与手拼）；⑥ T4⑤ `--only` 的重复检测只覆盖被选下标；⑦ T5④ `encodeVideo` 层的 `stepMsByStep` 长度护栏本身无用例（纯函数层有）；⑧ T5⑤ cfr 重采样那 1.5~2.7 帧的机理**未定论**（只做了包层/成片层分层定位）；⑨ T7① 新增两条 `grep -qF` 断言失败时无消息（`set -e` 只给退出码）；⑩ T7③ 报告 §四 的真机读数块仍是修复前 `?render=1`；⑪ T7④ 报告"原文写 82"与任何提交都对不上（79/89/94）；⑫ 终审残留：计划 `:329` 仍写 "ffmpeg 8.0.1 已核"且无更正块（`:11` 有兜底）；⑬ 终审残留："8→9 产物逐字节不变"措辞**强半档**（字节级证据是四个重采帧 md5 + 成片结构读数，mp4 本身未逐字节比对） | 文案更正轮（随相邻改动顺手） |
| K-85 | M5a 各任务 deferred（同上） | **测试覆盖缺口一批**：① T1① `animMsByStep` 缺位/非法 → 静默 0 **无测试覆盖**（下游 T4 泄漏告警可见；可在 CLI 边界断言长度）；② T2③ `window-scan.browser.test.ts` 的 realm shim（`TextEncoder`/`TransformStream`）是**文件级全局补丁**——第二个"jsdom 里自起 Vite"的测试文件出现时应抽共享 setup；③ T3② `App.test.tsx` 的 doMock 替身**无类型强制**（删掉 `seek` 行 tsc 仍过、用例仍绿）——修法：factory 标 `typeof import("./engine/cursorBridge")`（一行）；④ T3③ `scripts/shot/session.browser.test.ts` 夹具页缺 `seek`（复用该夹具时须补）；⑤ T6② 两条"一条都没测到 → 报红"的非空护栏**无测试驱动**（可把 `hasSignal` 导出后单测）；⑥ T6③ `Int16Array` 视图化 Buffer 的 byteOffset 奇数会 RangeError（实测路径不可达） | 随相邻改动的顺手补测 |
| K-86 | M5a T2/T5 deferred（同上） | **环境/流程两条**：① T2④ `window-scan` 的 viewport 固定取 `stageConfig.dims`（接口冻结）⇒ T7 若用 `--url` 复用**另一个项目**的服务，视口不随 URL 走（跨项目复用需在 CLI 层禁止或断言）；② T5⑥ T7 冒烟宜用**真 deck 形状**（偏差 ≤1 帧）而非 tight（dwell:0）形状 | 接 CI/多项目复用前处理 |
| K-87 | M5b T4（实时捕获降级）执行观察 | **降级产物的 A/V 同步是近似的（画面按墙钟、音轨按时间轴）**，三条已实测的残余：① **头部装载期**——录像从 `context` 创建起算，deck 到装载完才起播 ⇒ 产物头若干百 ms 是装载页（真机实测：`--only 0,1` 的 `.realtime.mp4` t=0 帧是近纯色页 8.6KB、t=0.4s 起才是 deck 内容 39.8KB；独立探针实测 recordVideo 的 webm 总长比录制窗口长 **1.32s**〔3.0s 窗口 → 4.32s webm〕）——输出侧 `-t <declaredMs>` 只顶尾部，**不裁头部**；② **子表对不上整档**：`--only` 只改"声明时长/音轨"，页面仍自驱走**完整 deck**（录像被 `-t` 截在声明时长处）⇒ 子表降级产物的尾部内容与声明不符；③ **不做帧级自校验**（按定义不可确定复现）——有牙的判据是"首/中/末帧 md5 两两不同" + "游标轨迹覆盖到声明窗口内应到的**全部**步"（`judgeTrace`，修复轮 1 起）。**md5 那条只覆盖"全程定格"**：t=0 恒是装载页故"首≠中"恒真，真牙在"中≠末"；"走 ≥2 步后冻住"而抽帧点恰好落在视觉不同的步上**仍会绿**。另：定格判据只在观测窗口 ≥ `REALTIME_MIN_JUDGE_MS`(3000ms) 时生效，短窗口（`--only` 子表可以短到几百 ms）只告警不判——"没动"与"还停在第 0 步"不可区分（修复轮 1 / 评审 M1）。④ **autoplay 的因果改写（修复轮 1 口径）**：**缺 `--autoplay-policy=no-user-gesture-required` 不再冻死**——`play()` 被策略拒后走 `useAudioPlayer` 的**估时兜底**（T4 的 A 修复），画面退化成**估时节奏**：产物"能动"，但节奏是估的、与 mux 进来的确定性音轨对不上（`REALTIME_LAUNCH_ARGS` 恒带这个 flag，只有 E2E 手排时才可能缺） | 收窄方向：用页面侧锚点（`addInitScript` 钩 `HTMLMediaElement.play`，取首个 play 的 `performance.now()`）量出装载偏移后按 `-ss` 裁头；②要真收窄需页面支持"按 `--only` 只走子表"。**M6/金样期复核**；在此之前降级产物按"逃生舱、同步近似"读 |
| K-88 | M5b T4 修复轮 1（评审建议） | **降级是"缺省即起真浏览器"的失败路径**：`runRender` 一遇自校验红 / 抛错就调**真** `captureRealtime` ⇒ 任何**忘了注入** `RenderDeps.realtimeCapture` 的单测都会以"环境错乱"形式红（首轮全量实测：`srt.test.ts` 的"自校验红"用例撞真实现 → jsdom 缺 `TransformStream`）；`--no-fallback` 是这类用例的另一个逃生口 | 注入用法已写进 `RenderDeps.realtimeCapture` 的注释；`render.test.ts` / `srt.test.ts` 两条相关用例改取 `--no-fallback`。后续再加"沿用假 deps"的用例时，一并注入或加 `noFallback` |

| K-89 | M5b T5 评审 minor ②（T6 收口落账） | **「真降级 × 导出按钮」无端到端取证**：`vite.config.ts` 的交付物挑选（降级 ⇒ 交付 `.realtime.mp4`，未通过自校验的 mp4 不是交付物）已抽成纯函数 `pickDeliverable` 并有单测（T5 修复轮 1 / 评审 M-2），但**真机只覆盖了非降级路径**——没有造出一次真降级再点按钮（造法：临时让 seek 断言抛错 + `POST /__export/run`），故"降级产物能否经服务交付到页面"这条链只有单测背书 | M6/E2E 轮：补一条"造真降级 → 按钮交付 `.realtime.mp4`"的真机臂；在此之前按"挑选逻辑有单测、端到端未证"读 |
| K-90 | M5b T6（收口三条护栏）执行观察 | 三条护栏与 `--all-steps` 的已知边界（均已在源码/测试注释里写明，此处登记去向）：① **主题快照护栏只守映射面**——`THEME_TOKEN_MAP` 覆盖 8 个 token 键（`ink` 映射 `--text` + `--surface-3` 两条），`blocker` 是分镜页**本地色**、显式登记在 `LOCAL_THEME_KEYS`（新增快照键不登记即红）；② **`--all-steps` 的真机臂缺位**——模板 deck 只有 3 步（`min(3,3)`），这个开关在它上面是 **no-op**，取证靠 ≥4 步的夹具（`verify.test.ts` 的 5 步表 + `render.test.ts` 的编排透传），**全 deck 真机重采未跑**；③ **负对照只证判据链**——它篡改的是**参考图字节**（副本），证"字节 → 判定 → 退出码"有牙（真机 CLI 已跑，见 M5b T6 报告），**不覆盖**"主流程截图本身写错图"这类上游错（那要另一条负对照） | 有 ≥4 步/多章 deck 时补 `--all-steps` 真机臂；三条都不改现有判据 |

| K-93 | M5b 各任务 deferred（2026-09-12 终审修复波落盘） | **文案/注释/口径一批**（均不改判据）：① T1③ 产物被截断时跳过文案仍打"步起点后 500ms 内无内容"；② T1⑤ `--realistic-audio --help` 先抛用法错（惯例内）；③ T1⑥ 判据①的注释/报告未写"**锚点比真内容起点早 ≤5ms**"——后人易把 `expectedMs` 当真起点做时间码（T2 已获提醒）；④ T2④ `srt.ts` 的注释把偏差说小（写"≤5ms"，本 deck 实际 **120ms** = 拟真档起手静音）；⑤ T4② `judgeTrace` 零观测分支白算 `where` 字符串；⑥ T4③ realtime 的 fatal 文案仍把"缺 `--autoplay-policy`"列为死因之一而同句说它已不冻死（括号已限定）；⑦ T6 CLI 负对照的**两层退出码**语义用"帮助文案"承载（内容够、词不准——真机形态见 K-96②） | 文案更正轮（随相邻改动顺手） |
| K-94 | M5b 各任务 deferred（同上） | **测试夹具/覆盖口径一批**：① T1② 判据①（音轨边界锚点）的夹具是**合成 PCM**，brief 字面要"真 mp3 + 真音轨图"——实质覆盖未丢（真 mp3 形状由 `audio.test.ts` + 真机臂承担）；② T2① **`--no-srt` 不清理陈旧 SRT**（评审顺手复现：预置陈旧 SRT → `--no-srt` 跑完 **EXIT 0**、mp4 更新、**陈旧 SRT 原封不动**）⇒ 将来人拿到的是一对**静默错配**的 mp4+srt（本 deck 两种音频档切点不同：缺省 3400/5750 vs 拟真 3400/5870）；③ T3② `--only × --no-subs` 真机未跑（stub 级已坐实正交）；④ T3③ 报告几何表述缺"**绘制盒 ≠ 层盒（inline span）**"一句注释；⑤ T4① 新短窗口真机臂的 `toBeLessThanOrEqual(1)` 只有 ~300ms 余量（静默快机上会假红）→ 换成"轨迹里不得出现第 1 步之后的步"或加容差；⑥ T6 负样本判据收紧的边界：**对称/循环动画**的步（t=0 与 t=animMs 同态）会红——**有意从严**，失败文案已给两条读法 | 随相邻改动的顺手补测/更正 |
| K-95 | M5b T4/T6（降级边界） | **"不进降级"的清单**（与"降级不得失声"同一层，此前都没登记）：① **`encodeVideo` 抛错不进降级**（可接受：编码失败是确定性链路的确定性失败，重试无意义）；② **窗口预扫 / `buildTimeline` / 入口三道对位断言抛错不进降级**（那一步还没有子时间轴与音轨段——`degrade()` 的位置在"6) 音轨段"**之后**，它的两个前提〔子时间轴、确定性音轨〕都不成立）。两条都是**有意的边界**，不是漏接 | 有意取舍（已注释）；要给它们兜底得先解决"没有时间轴就没有降级窗口" |
| K-96 | M5b T6（三条护栏/负对照的**已接受形态**，评审判可接受） | 逐条记档：① 负对照篡改的是参考图**副本**（真图字节零改动，`referenceIntact` 成读数——比"改完再还原"更强）；② CLI 的**两层退出码**（**双退出码**语义：篡改臂 `exitCode=1` 由负对照断言并打印；CLI 在控制通过时 EXIT 0、"没复现"时 EXIT 1）；③ 主题护栏只守映射面（`blocker` 是分镜页本地色，`LOCAL_THEME_KEYS` 显式登记，见 K-90①）；④ 判据从严（K-94⑥）；⑤ 两条真机成片用 `--realistic-audio` 而非 brief 字面的 `--mock-audio`（理由：待审成片就是拟真档、可做逐字节对照；缺省档形状由 `audio.test.ts` + T1/T2 记录承担） | 记档（评审已接受）；M6 真 TTS 落地时⑤一并复核 |
| K-97 | M5b T5/T6（真机与**金样**覆盖缺口） | ① **StrictMode 导致 4s 内两次 `/status`**（无害，未钉）；② 真机未覆盖：dev server 重启中断作业、**双标签页**同点、LAN 环境页面表现；③ **金样（`narration-video/golden/`）没有任何自动消费者**——全仓 `golden` 只出现在 README / 计划 / 报告里，回归全靠人；④ 金样"mp4 在才补写"的守卫仍只在 README 散文里（未落成代码块/脚本）；⑤ 金样 `clip.mp4` 仍缺席（T1 人工闸门未过，T6 按 Ruling P2 **跳过 + 明示**） | M6/E2E 轮；③④⑤ 随金样落库一并处理 |

---

## §2 已知边界（设计取舍，非缺陷；已在代码或设计文档注记）

| ID | 来源 | 边界 |
|---|---|---|
| K-40 | M1 | 兜底 resume 重启**全量**估时（不恢复已流逝部分）；`waapi` dispose 不取消底层动画（卸载后无视觉影响，无限动画另有门禁 #8）；首帧 `scale=1` 一闪 |
| K-41 | M3a | #14 不支持 `url()` 形式与 source 斜杠形式；#15 角括号候选需含 `.` 与 `/`（HTML 标签零误报、无扩展名路径漏检）；同步护栏非递归 + 扩展名白名单；CLI 无 `.catch`（unhandledRejection 但 exit 非零） |
| K-42 | M3a | P4-6 尺度集合读脚本自身项目而非 `repoRoot`（scaffold 部署同文件，无障碍，已文档化） |
| K-43 | M4.5 | 运行时 CSS 变量**局部覆写**（`scope()`）不随主题跟随——ECharts 5.3+ 支持 style 值内 CSS 变量，留 polish 轮 |
| K-44 | M4.5 | "按需引入"的边界 = 库内按需：统一出口为库级导出，任何项目构建携带 echarts（>500kB chunk）——已接受报备 |
| K-45 | M3a | 冒号门/注释状态机的其余良构罕见形态（`content: "/*"` 幻影态、`/*` 字面嵌套） |
| K-46 | M3b T8 | `data-safe-band="chrome"` 约定**暂无生产者**：V1 的"chrome 元素水平 ≥64px"这条带只能靠章节自己标记（标记语法随 CHAPTER-CRAFT/M7 成文）；未标记的顶栏按内容带（96px）**从严**报错——**有意为之**：宁可误报教作者标记，不放过真越界 |
| K-47 | M3b T8 | V1 的"**硬阴影落点计内容占位**"#20 **未覆盖**：#20 只查元素盒（border box），硬阴影的落点（box-shadow 偏移 24px）不在检查面内 |
| K-48 | M3b T8 修复轮 1 | #14 的**残余不对称**：`loaded` 与 `used` 两侧都是**跨步并集**——"eager-load 且从不使用"（预载字体但无渲染文本消费）在并集语义下只能靠"加载面 ⊆ 使用面"的逆向护栏兜住（真机造法：真 `@font-face` data URI + 显式 `document.fonts.load`） |
| K-49 | M4 | `captureSteps` **不带 `?render`** 时播放 transport（进度条 / 播放键）会进截图——M5 逐帧渲染须带 `?render=1`（M3b 无头 pass 内部恒 `withRenderMode`，不受影响） |
| K-54 | M3b T7 | `serve.ts` **默认永不复用**外部服务（缺省自起 Vite + `hmr:false` + 断言 `resolvedUrls` 非空；端口占用自动 +1）——防"探活即复用"静默检查**别人的项目**（实测 5174 被占）；只有显式 `--url` 才复用（这是**刻意**的缺省，不是省事） |
| K-55 | M3b T1 | scanner-css 残余：**未闭合 `url(` 且行内无 `)`/换行**（minified 单行）只漏该行——URL 态按"换行或配对括号"终止，无终止符时该行余下内容不判（方向：响不漏） |
| K-56 | M3b T7 | console 归因**刻意加宽**：`isPageScriptLocation` 把同源 `/node_modules/.vite/deps/*.js` 计为本页脚本 → 依赖模块**求值期**的 `console.error` 会成为 step-0 blocker（宁可偶尔拦下第三方报错，不许静默漏报本页脚本） |
| K-57 | M3b T8 修复轮 1 | 示例章节的场景边距派生自 `stageConfig.safeArea`（随档案折算）——**3:4 档案定稿时**（见 K-30）章节布局与视觉需 M7 一并复核 |
| K-66 | M3b T1/T7/T8/T9 | 调试口与读数语义（已接受）：① T7 `HeadlessOptions.only` 过滤掉第 0 章时，装载期消息归到后续**首个保留步**（方向多报，调试口）；② T9 #19 读数不受 `only` 过滤（调试口）；③ T7 `notes()` 无 kind 时按桶序返回（消费方须显式传 kind——T8 已照办）；④ T8 `fontExamined` 把终帧与末步同一帧重复计入（文案已如实标注）；⑤ T1 emoji finding 在同 severity 组内的报告顺序与旧版不同（无测试依赖，未钉顺序） |
| K-67 | M3b T4/T5/T6 | 同值/键序/前缀/未消费（已注释或无语义影响）：① `SLIDE_DIMS` 与 `SAFE_AREA_BASE_DIMS` 同为 1920×1080（语义不同，已注释）；② `scaffold-smoke.sh` 的 SAFE_34 整串比较耦合 JSON 键序（当前稳定）；③ `audit()` 运行时键序与计划声明序不同（TS 无影响）；④ `CSSTransition`（无 animationName）落 `waapi:` 前缀（选择器仍可定位）；⑤ headless/render 下 `stoppedRef` 永不被消费（无可观测差异） |
| K-68 | M3b T1（Ruling R2/R4/R6/R8/R9） | scanner-css 状态机的**已接受残余**（方向均已明写）：① 未加引号的**跨行** `url` 被换行拆开 → 误报（响方向，加引号即免）；② 未加引号 url 的**内容内**空白（spec 上是 bad-url）被当内容 → 只让后续更少误报；③ 未闭合 `url(` 的静默漏家族见 K-55；④ 分词器边界（`{`/`}` 无条件作边界）与转义跳过**比 brief 更严**（R2/R4：保住"声明起始行"归属；R6 的转义跳过两行**无判别向量**，注释已写明防御性理由）——代价是极少数非法 CSS 行为变化 |
| K-69 | M3b T4（Ruling R10/R11） | #20 的几何边界：内容盒实测 (100,116)–(1820,934)，**底缘恰好 934.000（零余量）**——判据必须写成 `≤ 934 + 容差`（不得严格 `<` 或零容差）；**纯 padding 容器**（无直接可见文本）天然不入 #20 检查面。`?guides=1` 参考线与元素之间保留 4px（R11：showcase slide 自身装饰边框；真实章节 `border:0/padding:0`，dev-only 观感） |
| K-76 | M5a T2/T7（计划取舍 ①） | **动画窗口是"声明面上界"，不是实测播放时长**：`animMs` 取自引擎注册表声明的最大时长（`audit().windowMs`）——`?render=1` 下动画"创建即冻结"，没有任何"实际播放了多少"可观测。后果：动画声明时长 > 真实播放时长时，成片该步的静置期偏长（画面提前冻住）；反向（声明 < 真实）会让动画被截断——**处置（2026-09-12 M5b T6 更正，因果已断开）**：**不因 M5b 的双渲对比 / `--all-steps` 收窄**——双渲测的是**可复现性**（同一 t 在独立会话里逐字节相同），它看不见"声明窗口 vs 真实播放时长"；`--all-steps` 只是把可复现性的采样面铺满。真收窄需**实测 `document.getAnimations().finishTime` 与声明面对照**，**归 M6**。（原文的"由 M5b 双渲对比全 deck 化兜底 + `plans/…` **任务 4**"是**占位计划 v1 的错误指针**：v2 重排后 Task 4 是实时捕获降级、双渲全 deck 化是 Task 6 的 `--all-steps`——已删。）收窄后回写本条与 §8 |
| K-77 | M5a T7 | **无音频 deck 按估时出片（无声）**：`public/audio-durations.json` 不存在（未跑 TTS）时，每步时长 = `max(估时, 动画窗口) + 垫`，音轨用 `anullsrc` 段顶——**成片是哑的**。CLI 已明示（"未合成音频，按估时出片（无声）"+ 每步行标"无声（未合成）"），但产物本身与有声成片无法从文件名区分——**处置**：有意取舍（TTS 归 M6）；需要有声成片时先 `npm run render -- --mock-audio`（占位音轨，节奏与未合成预览同源） |
| K-78 | M5a T7 | **`render/` 产物不入库**（`/render/` 已 gitignore，**前导斜杠锚定模板根**——裸 `render/` 会吞掉 `scripts/render/` 整棵源码树）：`render/<slug>.mp4` + 中间产物（帧目录 + concat 清单 + 两条中间轨）全在本地，**换机器/新 clone 后不存在**，也无法从 git 找回——**处置**：有意取舍（与 `dist/`、`storyboard/`、`public/audio/` 同类：整目录可重生成）；要留档就把 mp4 复制到仓库之外 |
| K-79 | M5a T7（§8 step 4 / §8.1 ④） | **实时捕获降级未实现**：§8 选型把"B 实时捕获"定为降级逃生舱，但 M5a 只交付了确定性 seek 链——seek 断言失败时 `npm run render` 的失败模式是**报错退出**（不是降级出片）。**已实现（2026-09-12，M5b Task 4）**——**指针更正**：原记与本条一度写"归 M5b 任务 5"，但 M5b 计划两轮质检重排（v1 → v2 采纳 C1#1/C1#2）后**实时捕获降级是 Task 4**（Task 5 是导出服务）；占位计划 v1 的序号不可再引。代码：`scripts/render/realtime.ts`（真播放 + 录屏 + 同一份确定性音轨 mux；`REALTIME_LAUNCH_ARGS` 的 autoplay flag 是死因②的解药）+ `--no-fallback` 严格模式 + `judgeTrace` 定格判据；交付 commit `ee02cbc`（T4 主体）+ `209127a`（修复轮 1）。**残余见 K-87/K-88** |
| K-80 | M5a T4/T7 | **`softwareGL` 默认 false，只有渲染 CLI 开**（`--use-gl=angle --use-angle=swiftshader`，§11.2 跨机像素稳定）：storyboard / 无头门禁两条管线仍走默认 GL——它们的产物只在本机消费（人眼看/门禁读数），跨机像素稳定性只对**成片**负责。另：软渲 flag 被 Chromium 拒绝时**退化重试并告警**（不拖死渲染链），退化后该次成片的跨机稳定性不再有保证——**处置**：有意取舍；**T7 真机取证（2026-09-12，Chromium 145.0.7632.6 / Playwright 1.58.2 / macOS 26）——判据与量级（修复轮 1 更正）**：**renderer 串不判别**：本机 headless **默认臂的 GL 实现本就是 SwiftShader**（`SystemInfo.getInfo`：两臂 `auxAttributes.displayType` 均 = `ANGLE_SWIFTSHADER`、`glRenderer` 串逐字相同 = `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver-5.0.0)`）⇒ "`UNMASKED_RENDERER_WEBGL` 指向 SwiftShader"**对不传 flag 的臂同样为真**，不能证明软渲生效。**真正的实测差异在 featureStatus 与像素**：默认臂 `webgl=disabled_off`、`2d_canvas`/`rasterization`/`gpu_compositing` 全 `disabled_software`（**WebGL 上下文根本建不起来**，走 Skia CPU 兜底；`webglcontextcreationerror` 报 `BindToCurrentSequence failed`），软渲臂这三项翻成 **`enabled`**（WebGL 可建）；同一张**纯 CSS** 页（无 canvas）两臂截图 **md5 不同**（默认 `2fa69097057bc9076e0b9c4c6ea91a2d`/34910B vs 软渲 `b3c924f5217f9fb170595c2b552d3833`/35206B）⇒ flag 被接受、不是空转、确实改变了光栅化，且真机两次 `npm run render` 全程**无**"softwareGL 启动失败"告警（未走退化臂）。**仍未证的**：**跨机**像素一致性需第二台机器/CI 才能对照——本条只证"本机这一臂真的换了 GL 路径"，不证"换机器也逐字节一致" |
| K-81 | M5a T1/T4 | **`holdMs = 0` 的步不发静置帧**：`frameCount` = 窗口帧数（不含静置帧），末帧在 concat 清单里用统一式 `max(0, stepMs/1000 − (frameCount−1)/fps)` 声明时长——这是 `dwell ≤ slack`（`stepMs` 短于窗口帧时长）时的**正确**产物：该步没有"窗口之后"可供静置。逐帧人审时会看到"最后一张不是静置帧"，那是数据如此，不是漏拍——**处置**：有意取舍（T1 的算例与 T5 的 F1 修复轮都覆盖）；读者别把它当 bug 报 |

---

## §3 记账/流程（不是代码问题）

| ID | 事项 | 状态 |
|---|---|---|
| K-50 | M1/M3a/M4.5 三个 SDD 工作区未删（M2a/M2b 的删了）——同一收尾动作执行不一致 | 待清（本文件落盘后方可删） |
| K-51 | **M2a/M2b 的 deferred 台账已丢失**：工作区删除 + 计划文件无执行记录段，其 deferred minor 不可找回 | 不可逆损失，记档为戒 |
| K-52 | M4.5 ledger 缺"终审"段（终审实际做了，证据在设计文档 §12c） | 记档 |
| K-53 | **一次不准确的自我声明**：早先视觉审计轮声称"0 新增违规"，S24 展望块实际越安全框 18px（后于 M4 前置轮修正，commit `2f127fc`） | 已修正，记档 |
| K-70 | M3b 报告/commit 措辞与实现不符一批（T1① / T1④ / T4① / T5①③ / T6② / T8②④ / T9④）：T1① 报告夹具表漏写"注释内裸色"场景的去处（实由既有 `good-chapter.css` 覆盖）；T1④ 修复轮 3 使一处已披露残余格子变宽（行内未闭合 `url(` 无冒号前缀形态：报→漏），报告未标注"较上一提交变宽"；T4① 报告/commit 称"ThemeShowcase 内不再有任何手写规格值"过强（仍有 chrome 布局字面量 top:48/left:64/right:64 与 `tokens.css` 的 `--stage-pad-x/y`）；T5 报告 D3 自述"任何怪异数据都不抛"属**过度声明**；T6② 报告引的还原 md5 是探针时的 App.tsx（提交版仅注释差异）；T8② 报告 §5 第 4 条"真机造不出 loaded 面"不成立（评审用真 `@font-face` data URI 复现）；T8④ 报告头/commit body 的 554 vs 555 笔误；T9④ 报告 §5 条目编号映射错位（内容齐全，仅标签） | 记档为戒（内容无缺，均为可追溯性/措辞问题） |
| K-71 | M3b 计划文本与实现的漂移两处（终审点名）：① **`session.ts` 冻结面文档滞后**——`auditAnimations`（计划"接口约定 1"归 T5、实际 T7 产出，Ruling R12）与 `beforeGoto`（Ruling R17 追加的可选钩子）都不在计划"接口约定 1"里；`session.test.ts` 的冻结面是**存在性清单（⊆）**故不冲突，但 M5 若按计划文本读接口会漏掉 `beforeGoto`（连带 R16：`FindingBag` 追加 `addNote/notes` 也不在计划冻结面）；② **#14 的 info 语义**——计划 Global Constraints 写"没有主题字体文本 → info"，C1 修复轮已重推为"**loaded 为空 → info**"（§12 已按新语义记录，计划原文未回改） | 记档；M5 引用接口/判据时以源码（`scripts/shot/session.ts`、`headless.ts`）与 §12 为准 |
| K-72 | M3b T9①：`scaffold-smoke.sh` 新增 `test -f "$TMP/demo/scripts/check/check.ts"` 超出 brief"只许改那一行 + 新增 grep"的字面（纯增行、与相邻 `test -f check-fast.ts` 同风格） | 追认为合规 |
| K-73 | M3b 终审复核的边缘项（**由里程碑主控在收尾时补录**；来源 `progress.md` Ruling R15① 时序半）：无头 pass 的 console **归因窗口含该步 `jumpTo→ready` 渲染期**（T7 的必要放宽，字面读法抓不到章内错误）⇒ **两步之间滞后的异步错误会被算进下一步**（方向：不丢、可能差一步）。当前只在 `scripts/check/headless.ts` 文件头 ⚠ 两处口径标注，无独立台账句 | M5 若做错误归因精化时复核；现口径可接受 |
| K-74 | M3b T7 评审的建议（**主控补录**，属"建议"非 deferred finding）：给 `scripts/shot/session.ts` 的 `auditAnimations` 补一个 `readAnimations` 同款 Page 替身单测（约 8 行）。评审同时判"真机覆盖已足够"（成员缺失会 reject 崩、形状漂移被 tsc 抓、底层 `audit()` 有专项单测） | M5/M6 动 `scripts/shot/` 时顺手补 |

---

## §4 关联

- **M5 交接清单**（7 项：**音频自驱抢游标——已于 M3b Task 6 提前落地 `ed42c7e`（前提更正见设计文档 §12 该条）** / canvasAnim t=0 / dwell 运行时消费 / STORYBOARD_THEME 漂移 / ShotSpec 时间维 / verify 负对照自动化 / 人审纪律）→ 设计文档 `07-design-draft.md` §12，M5 收尾后并入本文件。**进展（2026-09-12，M5a）**：#2/#3/#5 已落地（T3 `80e3268` / T1 `4e271ad` / T3+T4 `80e3268`+`1ea438b`），#1 由 M3b 提前落地；**#4/#6 归 M5b 的 Task 6**（**已结清**：`STORYBOARD_THEME` 漂移护栏 + `--verify-sequential` 负对照自动化；占位计划 v1 曾写"任务 6/7"，两轮质检重排后这两项同属单一 **Task 6**，见下条 M5b 落盘行）
- **M3b 全量落盘**（2026-09-12 终审修复波，commit `293f30d`）：T1~T9 的 deferred minor 与执行期 Ruling 残留项已逐条并入本文件——§0 K-58/K-59 为本波修复，§1 K-60~K-65 / §2 K-66~K-69 / §3 K-70~K-72 为落盘；M3b 工作区按 K-50 收尾删除后，其台账不再只活在 SDD ledger 里
- **M5a 渲染核心落盘**（2026-09-12，七任务；短哈希见 `07-design-draft.md` §12 的 M5a 行）：T1~T7 的边界条目与已知取舍已并入本文件（K-76~K-83），渲染链的接口面与容差口径见各模块文件头；M5b 的任务清单见 `plans/2026-09-12-M5b-subtitles-export-service.md`
- **M5b 字幕/SRT/导出服务/实时降级/收口落盘**（2026-09-12，六任务；短哈希与裁决见 `07-design-draft.md` §12 的 M5b 行）：本里程碑把 **K-79 结清**（实时降级，Task 4）、**K-82③ 结清**（§0）、**M5 遗留 #4/#6 结清**（主题快照护栏 + 负对照自动化，Task 6）；新增残余 **K-87/K-88**（降级 A/V 近似 + 注入面）与 **K-89/K-90**（T5 真降级 × 导出按钮的端到端缺口 / T6 三条护栏的边界）
- **M5b 终审修复波落盘**（2026-09-12，末次提交 `fix(M5b): 终审修复波…`）：**K-91 降级不失声**（C-1）+ **K-92 `--no-subs` 归一用例**（I-1）结清入 §0；**T1~T6 的全部 `minor (deferred)` 与 Ruling 残留逐条落盘**为 §1 的 **K-93**（文案/口径）/ **K-94**（夹具与覆盖口径，含 `--no-srt` 陈旧 SRT 的实况复现）/ **K-95**（"不进降级"清单：`encodeVideo` 抛错 + 窗口预扫/`buildTimeline`/入口断言）/ **K-96**（护栏的已接受形态）/ **K-97**（真机与金样缺口，含"金样无自动消费者"），并把收口期已修的项记进 **K-98**。此后 M5b 工作区可删（台账不再只活在 ledger 里）
- 每条 deferred 的上下文（评审原话、复现路径）在对应里程碑的 SDD ledger 或计划"执行记录"段；本文件只留判定与去向
