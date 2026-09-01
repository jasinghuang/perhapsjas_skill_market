# 图型模板库 · Ⅱ 多格/分镜板(图型 10-13, 31)

> Ⅱ 多格/分镜板 = 九宫格 / 状态批量 / 民族志陈列 / 正反打关系板。分类路由命中图型后,来此取「填空骨架」填空生成,再用「校对清单」逐项对账。

## 目录

- [图型 10 · 九宫格场景多机位分镜](#图型-10--九宫格场景多机位分镜3x3-contact-sheet)
- [图型 11 · 九宫格武戏分镜](#图型-11--九宫格武戏分镜首尾镜像闭环)
- [图型 12 · 状态批量九宫格](#图型-12--状态批量九宫格完好被毁)
- [图型 13 · 民族志服装陈列板](#图型-13--民族志服装陈列板3x3-documentary-plate)
- [图型 31 · 正反打双人对话关系板](#图型-31--正反打双人对话关系板shotreverse-shot-dialogue-coverage-board--180轴线)

---

## 图型 10 · 九宫格场景多机位分镜(3×3 contact sheet)

**何时用**:要把同一空间/同一时刻用九个不同机位一次性铺成一张 3×3 故事板(contact sheet / storyboard sheet)时——典型是"一场大事件(巨物降临/部落被毁)发生的那一瞬,要剧组从九个角度同时看清"。它是多机位分镜板,不是多视图设定图。两种产线:重型(逐格写死镜别 + 巨物铁律 + 全局锁,4K 一次成片级)与轻量(一句"生成九宫格多视图、不同角度"靠底图驱动)。

**命门**:
1. **全局锁跨格一致——九格必须读成"一个时刻"**:把光向/风向/色板/胶片/大气抽出来一次性声明,并显式 `Keep all nine panels visually consistent (same light, same dust, same color palette) — they are one moment from nine angles`。
2. **巨物尺度铁律(有巨物时)**:`the <巨物> is SO unimaginably gigantic that NO panel ever shows the whole <巨物>` + 每格只露 `a fragment` + `dwarfing the entire village to the scale of dust`。巨物永不全见,九格各换一种露法。
3. **逐格写镜别 + 内容**:Panel 1…Panel 9 逐格点名(top-left/top-center…bottom-right)+ 该格机位 + 巨物在该格怎么露。读序固定 left-to-right, top-to-bottom。
4. **双参考图分工 + 约束块兜底**:Image1 锁场景(建筑/帐篷色/色板/光/调性),Image2 锁巨物(材质/形体);末尾 CONSTRAINTS 复述铁律 + PHOTOGRAPHIC TONE 反 AI 味。

**填空骨架**:
```
模式:图生图(场景参考图 Image1 + 巨物/事件参考图 Image2 → 3x3 九宫格分镜)
size 16:9(1536×1024 或更大以容九格细节) / quality medium / jpeg / Thinking Mode 开
用途:多机位分镜板(同一时刻九机位 contact sheet),不是 turnaround 多视图

【参考图标注】
- Image1:<场景原图——锁建筑/色板/光/调性>
- Image2:<巨物/事件主体——只锁材质与形体>

【PROMPT 正文】
Generate a single 3x3 nine-panel grid image (nine separate cinematic frames arranged in a 3-row,
3-column grid, each panel divided by thin black borders, like a film contact sheet / storyboard sheet).
All nine panels depict the SAME <场景> (from Image 1) at the SAME moment — <这一瞬发生了什么>.
<全局气氛一句:光向/尘霾/调性签名>. In EVERY panel <巨物/主体> dominates — but it is SO
unimaginably gigantic that NO panel ever shows the whole <它>. In each panel only a fragment is
visible, always filling or towering over the frame, dwarfing <环境> to the scale of dust.
The nine panels show nine different views:
Panel 1 (top-left): <机位 + 内容 + 巨物怎么露>. Panel 2 (top-center): … … Panel 9 (bottom-right): <航拍俯顶>.
【PRESERVE】Preserve from Image1: <建筑/帐篷色/色板/光/调性>. Preserve from Image2: <材质/形体>.
Preserve overall: 9-panel 3x3 grid layout with thin black dividing borders; consistent <光+尘+色板>
across all nine panels so they read as the same moment.
【CONSTRAINTS】- 巨物永不全见,只露片段,永远压环境如尘. - 每格都要极端尺度对比. - 九格同光同尘同色板=同一时刻九角度. - 无文字/水印/logo. - 半毁非夷平,<环境>仍可辨.
【PHOTOGRAPHIC TONE】each panel is a film still that may appear slightly soft… Avoid: <反AI味清单> + fully-visible whole <巨物>, cartoon or CGI look, clean undamaged <环境>.
```

**校对清单**:是不是真 3×3 九格(细黑边/编号/读序对不对)?九格读成"一个时刻"了吗(光/尘/色板跨格一致)?巨物每格都只露片段、永不全见吗?极端尺度对比够不够(村落/人压成尘埃如蚂蚁)?逐格机位和 Panel 1–9 清单对得上吗?双参考图分工到位、半毁非夷平、环境仍可辨?

---

## 图型 11 · 九宫格武戏分镜(首尾镜像闭环)

**何时用**:要把一整段动作戏/群战用九格黑白(或彩色)分镜一次性讲完、并形成叙事闭环时——01 格开场、09 格收势,首尾同机位同姿势镜像呼应(敌从逼近→倒地,光从晨→暮),中间七格逐格推进。它是图型 10 的"动作戏 + 时间推进"变体:10 锁"同一时刻九角度",11 锁"一段时间九拍 + 首尾镜像"。

**命门**:
1. **全局锁(主角 + 敌数 + 光向 + 风向 + 胶片机型)做跨格一致**:主角必须同一人、敌人数量固定、光向/风向/胶片签名一次性声明贯穿九格——这是动作戏九宫格不串脸、不变天的根。
2. **首尾镜像闭环(01 ↔ 09)**:`Panel 09 must mirror the framing of Panel 01` 同机位同景别同姿势,只改"敌从逼近变倒地 + 光从晨光到暮色"。
3. **逐材质灰阶映射指令**:黑白片里仍给每种材质指定灰阶层级(红→中深灰、黑保深、白保亮),防层次糊成一团。
4. **逐格镜别 + 暴力降级合规**:Panel 01–09 逐格写景别/动作;武戏叠 `sword meeting sword NOT body / knocked back not injured / no blood`。

**填空骨架**:
```
模式:图生图(主角参考 + 武器参考 + 灰阶色卡参考 → 3x3 九宫格黑白武戏分镜)
size 16:9 / quality 2K / 用途:一张 prompt 出整段群战 storyboard,首尾镜像闭环

【参考图标注】
- 主角参考:<锁服装/造型/身份>
- 武器参考:<锁兵器形体>
- 灰阶色卡:<彩色色板,供黑白灰阶层级映射>

【PROMPT 正文 — 全局锁先行】
A 3x3 grid of 9 cinematic black-and-white film stills, total canvas 16:9. Each panel is itself a 16:9
frame, separated by clean thin black borders, panel numbers "01"–"09" in top-left corner, read order
left-to-right top-to-bottom. CRITICAL: these are PHOTOREALISTIC CINEMATIC STILL PHOTOGRAPHS
in pure B&W grayscale (NOT line art, NOT manga panels, NOT sketches). MAIN CHARACTER (identical
across all 9 panels): <主角锁>. OPPONENTS (consistent across panels): <N 名敌人锁>. Consistent
across all panels: <光向 + 风向 + 胶片机型(Kodak Double-X 5222 等)+ anamorphic>.
逐材质灰阶映射:<红→中深灰 / 黑保深 / 白保亮…>.
Panel 01: <开场机位 + 动作 + 敌逼近 + 晨光>. Panel 02 … Panel 08: <逐拍推进>.
Panel 09: MUST mirror the framing of Panel 01 — same camera, same pose — but <敌已倒地 + 暮色长影>.
合规:opponents knocked back by force not injured, sword meeting sword NOT body, no wounds no blood.
【反AI味结尾 + Avoid】
```

**校对清单**:是不是真 3×3、九格都有编号 01–09、读序对?主角九格是同一人吗、有没有串脸/换装?敌人数量各格一致吗?光向/风向/胶片质感跨九格一致吗?01 与 09 首尾镜像成立吗(同机位同姿势、敌逼近→倒地、光晨→暮)?黑白灰阶层级清楚吗?是 PHOTOREAL 灰阶照片不是 line art/manga 吗?暴力降级守住没?

---

## 图型 12 · 状态批量九宫格(完好→被毁)

**何时用**:已有一张"完好状态"的场景/部落/建筑图,要批量生成它变化后的多个视角(被摧毁/灾后/老化/雪覆)、做灾后镜头或状态对照素材时。它锁"同一对象 + 一个状态变化 + 多视图九宫格"三要素合一,靠参考图提供原始形态,再对它整体施加破坏/变化。极简一句话即可驱动,也可升级成图型 10 的重型逐格分镜。

**命门**:
1. **三要素一句话合一**:`参考图(完好对象)` + `状态变化(被摧毁)` + `多视图九宫格格式`——让模型从参考图读原始形态、再统一施加破坏。少任何一个就翻。
2. **靠底图承结构、prompt 只管"变状态"**:结构信息全在参考图里,prompt 不重写场景细节,只下"被摧毁 + 九宫格多视图"。
3. **状态一致性是弱项,需显式拉齐**:多格"被摧毁程度"易不一致,补一句统一破坏等级(如"半毁可辨,非夷平")。
4. **"多视图"≠ 严格定点环绕**:一句话版更像"同一灾后场景的多张景观拼贴";要严格环绕得升级到重型逐格写机位(图型 10)。

**填空骨架**:
```
模式:图生图(完好对象参考图[+ 破坏源参考图] → 状态变化九宫格)
size 16:9 / quality 1K-4K(要逐格细节可读则升 4K)
用途:状态批量(同一对象变化后多视角),做灾后/老化/对照素材

【参考图标注】
- 参考图1:<完好状态的对象——锁原始形态/身份>
- 参考图2(可选):<破坏源,如巨物/灾害——锁施加破坏的来源形态>

【PROMPT 正文 — 轻量版(一句话)】
参考重新生成一个新的九宫格场景图,展现被<参考图/破坏源>摧毁的<对象>景象的多视图九宫格。
(英文等价:Regenerate a new 3x3 nine-panel scene grid showing the <对象> after being destroyed by
<破坏源 from reference>, as a multi-view nine-panel grid — preserve the <对象> identity from reference,
apply consistent half-ruined-but-recognizable destruction across all nine views.)

【若要拉齐状态/升级成片】补:统一破坏等级(half-ruined not flattened, still recognizable)+
跨格同光同尘 + 升 4K 让每格细节可读 → 此时即转入图型 10 的重型逐格骨架。
```

**校对清单**:原对象身份保住了吗(灾后还认得出是同一个吗)?状态变化施加到位吗(真毁了还是只轻微改动)?是不是九宫格/多视图,还是退化成几张拼贴?九格破坏程度一致吗(易翻:有的夷平、有的几乎完好)?细节够清吗(1K 易糊,要逐格读细节升 4K)?

---

## 图型 13 · 民族志服装陈列板(3×3 documentary plate)

**何时用**:要为一个族群/部落一次性出多套服装变体 + 对应头饰 + 地面道具的无人体陈列参考板时——给剧组当服装参考表、世界观设定物料。范式是"博物馆纺织修复板":服装挂杆垂直悬挂排成 3×3,每套上方头位摆对应头饰,画布地面 flat-lay 散布道具。数量是这套 prompt 的稳定弱项,务必把"九套/3×3"当头号校对项。

**命门**:
1. **平光 + overhead-and-frontal + 无人体**:`flat-lit overhead-and-frontal documentary-style reference plate` + `without any human figures present` + `soft diffuse overhead studio lighting with no directional shadows`——纯物件存档式平铺,反棚拍戏剧光。
2. **三层同框结构**:① 服装挂杆垂直悬挂排 3×3;② 每套头位摆一件对应头饰(小木架上,九件各异);③ 画布地面 flat-lay 散布道具(布样/颜料碗/绳/弯刀/骨珠)。
3. **共享部落语言 + 逐套差异化 + 朱砂红串联**:九套统一部落语言(burgundy/dust-cream/sandstone-ochre/smoke-umber 色域),但逐套在主色比/层叠/材质/系法/金属配件上各异;`A single cinnabar red accent appears somewhere on each outfit`(#A82A2A)做唯一高饱和焦点色,九套各放一处。
4. **九件头饰逐件点名**:逐件描述形态,`tribal/ritualistic/archaic/hand-beaten, never resembling helmets or polished jewelry` 防跑成头盔/精致首饰。
5. **数量是稳定弱项**:`nine outfits` 和 `three rows of three` 要重复强调,出图后第一件事数数量;横幅 16:9 诱导横排,要严格九宫格考虑改方形(1:1)或显式锁 3×3 网格 + 细分隔线。

**填空骨架**:
```
模式:文生图(或轻图生图,参考图只给色板/部落语言)
size 16:9(⚠ 横幅利于平铺道具,但不利严格 3×3) / quality 1K+
用途:出服装参考表/设定物料(无人体陈列板)

【PROMPT 正文】
A flat-lit overhead-and-frontal documentary-style reference plate showing NINE complete outfit sets of
<族群>, displayed WITHOUT any human figures present. Each outfit suspended on a weathered wooden
pole / rough hemp cord, hanging vertically as if pinned for ethnographic study, arranged in THREE ROWS
OF THREE (3×3) against a neutral warm-grey canvas backdrop. Each outfit displays the full ensemble top
to bottom: <逐部位:斜挂布 / 半裙开衩 / 系带 / 不对称肩布 / 开衩裤 / 缠足布或皮靴 at base>.
The nine outfits share a unified tribal language but each varies: <主色比 / 层叠 / 材质 / 系法 / 金属件数量>.
A single <朱砂红 #A82A2A> accent appears somewhere on each outfit — small but visually loud across all nine.
Above each outfit, in the head position, rests one hand-forged metal headpiece on a small wooden stand —
NINE distinctly different headpieces: <逐件点名 9 种形态>. All headpieces tribal/ritualistic/archaic,
hand-beaten, never helmets or polished jewelry.
Scattered across the canvas floor: <flat-lay 道具:布样 / 颜料碗 / 绳 / 弯刀 / 骨珠 / 铜片…>,
every prop photographed flat-on, pure object documentation.
Composition: clean ethnographic study layout, neutral warm-grey canvas filling frame, soft diffuse overhead
lighting no directional shadows, no human presence, no environment. References a museum textile
conservation plate / film wardrobe reference sheet. Real photographic quality, 35mm medium format film
stock, soft documentary lighting, analog photochemical grain, shot as a flat archival reference photograph.
```

**校对清单**:数到底有没有九套(头号风险)?是不是真 3×3 三行三列,还是横排/单行/松散堆陈?无人体吗(有没有冒出人/假人模特)?平光无方向阴影吗?每套都有一处朱砂红 accent 吗、九套统一部落语言但逐套有别?九件头饰逐件不同且 tribal/hand-beaten(没跑成头盔/精致首饰)?地面 flat-lay 道具齐不齐?

---

## 图型 31 · 正反打双人对话关系板(shot/reverse-shot dialogue coverage board · 180°轴线)

**何时用**:一个空间内两个角色面对面说话(对话戏)、要在拆单帧之前先锁死"谁在轴线哪一侧、谁看哪个方向、正反打怎么覆盖"时。它是 per-scene 的人物关系交代板——一张 6 格 contact sheet,把一场双人对话的过肩/近景/中近景正反打覆盖一次性铺出来,当全场对话镜头的轴线/视线真源。和图型01(俯视、≥3 人、空间站位)互补:01 交代"谁站哪",31 交代"谁看谁、怎么打"。技术上是图型10(同场景多机位九宫格)的对话特化变体——砍到 6 格 + 加一条 180°轴线锁。

**命门**:
1. **180°轴线锁 = 本图型的灵魂(图型10 没有的那条)**:把轴线落成屏幕方向恒定——`A 恒在 screen-LEFT 且视线恒朝 RIGHT;B 恒在 screen-RIGHT 且视线恒朝 LEFT;镜头绝不跨过 A—B 连线`。要在正文开头声明一次、在 CONSTRAINTS 再复述一次(重复 = 注意力强化)。漏了它 6 格视线各自为政、跨轴不接。要正向(A左朝右/B右朝左)+ 负向(Avoid 视线翻转)双写。
2. **版面即轴线:2列×3行,左列恒A、右列恒B**:不要 3列×2行(把正反打对子拆到不同行)。用 2 列(左=A 覆盖、右=B 覆盖)× 3 行(过肩对/近景对/中近对),奇数格 1/3/5=A、偶数格 2/4/6=B。左右列直接把轴线两端做成版面,最防跨轴。编号 1–6 从左到右再从上到下,右下角白色加粗。
3. **继承图型10 的全局锁**:`同一房间、同一主光、同一戏服、同一时刻 —— 6 格是一个时刻的 6 个机位`。少了这句 6 格漂成 6 个不同时刻/不同光。
4. **过肩肩属 + 虚化前景方位写死**:格1 偏 A(A 的脸,B 的肩在右前景虚化);格2 偏 B(B 的脸,A 的肩在左前景虚化);格5 A 中近、B 作右边缘虚化前景;格6 B 中近、A 作左边缘虚化前景。方位错了轴线就崩。
5. **双角色定妆参考图分工 + 串脸 MAX**:6 格 ×2 人脸一致是最大风险,逐张参考图排他声明(Image1 只锁 A、Image2 只锁 B)+ Avoid 写 `faces swapped or merged`。第三人(随从/旁观)只作背景暗影、近景格剔除。

**填空骨架**:
```
模式:图生图(A 定妆 Image1 + B 定妆 Image2 + 场景 Image3 → 6 格正反打关系板)
size ~6:5 近方形(容 2列×3行的 16:9 格)/ quality 4K / Thinking Mode 开
用途:关系交代板 / 轴线·视线真源,blocking 级(位置/朝向/轴线正确优先于单格美感)

【参考图标注】
- Image1(角色A 定妆):只锁 A 的脸/发/戏服。
- Image2(角色B 定妆):只锁 B 的脸/发/戏服。
- Image3(场景锚):只锁环境与光。

【180°轴线 — 最高优先,6 格全适用】
A 恒在 screen-LEFT、视线恒朝 RIGHT;B 恒在 screen-RIGHT 且视线恒朝 LEFT;镜头绝不跨 A—B 连线。
<A 位置一句:斜倚/坐/立 + 在左>;<B 位置一句:立/坐 + 在右>;<第三人:隐于 B 身后阴影>。
同一房间、同一主光、同一戏服、同一时刻。

【6 格(2列×3行,左A右B)】
格1(行1-左)过肩中景偏A:A 的脸与上半身在左,越过右前景虚化的 B 肩;A 开口、视线朝右。
格2(行1-右)反打过肩中景偏B:B 的脸与上半身在右,越过左前景虚化的 A 肩;B 开口、视线朝左<;第三人暗影在其身后>。
格3(行2-左)A 单人近景,平视,无前景:脸占满,视线朝右,说话微表情。
格4(行2-右)B 单人近景,平视,无前景:脸占满,视线朝左,说话微表情。
格5(行3-左)A 中近景单人,平视,B 作右边缘虚化前景;A 恒左、视线朝右。
格6(行3-右)B 中近景单人,平视,A 作左边缘虚化前景;B 恒右、视线朝左。

【PRESERVE】A(Image1)、B(Image2)脸与戏服 6 格完全一致,不串脸/不合脸;场景(Image3)与主光跨格一致 = 一个时刻六机位。
【CONSTRAINTS — 复述轴线】每格:A 左·朝右,B 右·朝左,镜头不跨轴,跨格视线相接;第三人只作背景暗影、近景 3/4 剔除;恰好两个说话角色;全图唯一文字是右下角白色加粗格号 1–6,无字幕/水印/logo;每格细白边分隔。
【PHOTOGRAPHIC TONE】真实电影定格,<基调一句:暖烛光/冷蓝/日光>,35mm 胶片感,细微 grain,柔和景深,3–6 格平视镜头,克制不过饱和不塑料。
【Avoid】跨 180°轴线、视线翻转(A 朝左或 B 朝右)、faces swapped or merged、跨格服装/光不一致、过锐、HDR、磨皮、卡通、CGI 游戏感、anime、除 1–6 外任何文字。
```

**校对清单**:真 6 格 2列×3行、细白边、右下角白色加粗 1–6;轴线没跨(6 格里 A 恒左望右、B 恒右望左);视线接得上(格1/2 过肩视线相对、格3/4 近景方向相反);过肩肩属对(格1 前景是 B 肩/右、格2 前景是 A 肩/左);6 格脸一致没串脸(串脸 MAX)、服装/光跨格一致;格5/6 虚化前景是对方且不抢焦、方位对;第三人只在背景阴影、近景没乱入;除 1–6 外零文字/水印。
