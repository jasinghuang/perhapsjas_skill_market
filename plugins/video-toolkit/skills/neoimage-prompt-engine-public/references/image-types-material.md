# 图型模板库 · Ⅳ 物料/平面图(图型 23-30)

> Ⅳ 物料/平面图 = 色卡 / 灰底抠图 / knolling / 介绍卡 / 海报 / 标题卡 / 绿幕 / 质感后缀。分类路由命中图型后,来此取「填空骨架」填空生成,再用「校对清单」逐项对账。

## 目录

- [图型 23 · 色卡 color bible](#图型-23--色卡-color-bible平面-figma-风)
- [图型 24 · 灰底物料抠图](#图型-24--灰底物料抠图)
- [图型 25 · knolling 桌面陈列](#图型-25--knolling-桌面陈列)
- [图型 26 · 杂志风介绍卡](#图型-26--杂志风介绍卡60-30-10)
- [图型 27 · EVA 风人物海报](#图型-27--eva-风人物海报借姿势不借人)
- [图型 28 · 片头标题卡](#图型-28--片头标题卡复古动漫空画框版)
- [图型 29 · 绿幕/动捕占位图](#图型-29--绿幕动捕占位图为后期合成预留)
- [图型 30 · 质感后缀模块](#图型-30--质感后缀模块挂载件非独立图)

---

## 图型 23 · 色卡 color bible(平面 Figma 风)

**何时用**:开拍前要给全片钉死一套统一配色、当 production design bible / color management document 用时。reference-driven:色卡不是文生图,而是图生图——给一张电影感场景剧照,本图型从那张剧照提取主/辅/点缀调色板生成色卡;产出的色卡再当"电影感色调"参考图喂进全片每条 prompt。它不是画面是信息图:N 个色块 + 功能命名 + 精确 HEX,横排或网格,平面矢量风。核心反常识:这是全库唯一一种"必须主动反摄影、反电影感"的图型。

**命门**:
1. **反摄影封口是第一命门也是全部技术含量**:模型默认会把色卡渲染成"摆在桌上的 Pantone 卡照片"(带景深/纸纹/投影/高光)。必须用整段 `OVERALL DESIGN SPECIFICATION` + 超长 Avoid 拽回平面设计语言——关键词 `flat 2D vector / Figma or Adobe Illustrator / no depth / no perspective / no lighting / no photographic rendering / no paper texture`。Avoid 里 `photographic rendering, paper texture, desk surface, depth of field, lens blur, film grain, 3D render, shadows under swatches, glossy finish, mockup of physical object` 一个都别省。
2. **三段式结构化布局**:`ELEMENT 1 = 标题/副标题`、`ELEMENT 2 = 一排/网格色块`、`ELEMENT 3 = 每块下方两行注解(HEX + 功能标签)`。写成"三个元素"模型才不会乱排。
3. **13~22 色 + 功能命名 + 精确 HEX 三件套**:功能命名要写"在片里干什么"不是"什么颜色"——`hot sunlight cast / hard shadow / cinnabar accent / LED cyan dormant` 这种才有用,它让调色师知道这色块对应画面里哪块光。
4. **HEX 以写死的码为准,别回读出图**:1K 下色块上的 HEX 小字和功能标签几乎不可读。出图只用来核"色相分布对不对",真实 HEX 永远以 prompt 里写死的码为准,要逐块核 HEX 就上 2K。
5. **分组 vs 一排**:色多(>13)、跨多个叙事单元时用分组表头(主角/反派/环境/过渡);色少、单场景用单排。继承前片色系可把上一片色卡当 ELEMENT 锚喂入保持系统延续,但 HEX 该改还得改。

**填空骨架**:
```
模式:图生图(输入用户提供的电影感场景剧照 Image 1 → 提取该场景调色板生成色卡)
size 16:9 横 / quality(1K 下小字必糊,要逐块核 HEX 请上 2K)
用途:color bible 物料图 + 后续全片电影感色调输入

【参考图标注】
Image 1(电影感场景参考):仅作为调色板提取来源 —— 从这张剧照提取主色/辅助色/点缀色填进下方色卡;不复制其构图/人物/内容,只提取颜色。

【PROMPT 正文】
A clean digital color palette reference design that EXTRACTS its palette from the provided cinematic scene reference (Image 1), 16:9 horizontal layout, pure flat design aesthetic with NO
photographic elements. Background: solid neutral <off-white #F5F2EC / pure white #FFFFFF>, completely flat,
no texture, no shadow, no paper, no surface.
The composition contains exactly three elements:
ELEMENT 1 — Title (top center): clean sans-serif, solid black <#1A1A1A>, reads "<片名 · EPx · 场景 · PALETTE vN>".
  Subtitle below in smaller gray <#888888>: "<一句调性描述 · N color system>".
ELEMENT 2 — A single horizontal row of <13~22> rectangular color swatches, evenly spaced, identical dimensions,
  sharp clean edges, no gradient, no shadow, no border. The swatches left to right with these exact HEX fills:
  01:<#> 02:<#> … N:<#>
  （可选分组:ROW1 "<PROTAGONIST/主角组>" / ROW2 "<反派组>" / ROW3 "<ENVIRONMENT/环境组>"）
ELEMENT 3 — Two lines of small text beneath each swatch: line1 = HEX in monospace <#333333>; line2 = function
  label in smaller sans-serif <#666666>. The N function labels left to right: 01:<hot sunlight cast> 02:<sand
  highlight> … N:<LED cyan dormant>.
OVERALL DESIGN SPECIFICATION: flat 2D digital graphic design layout, the kind produced in Figma or Adobe
Illustrator for a film production design document. No depth, no perspective, no lighting, no photographic
rendering, no paper texture, no physical object. Pure flat vector-style swatches on a flat background with crisp
typography. Production design bible / color management document / design-system documentation. Precise, clinical,
informational, minimal, professional graphic design — not artistic, not painterly, not photographic.
Avoid: photographic rendering, paper texture, desk surface, table surface, depth of field, lens blur, film grain,
photorealistic, 3D render, lighting effects on swatches, shadows under swatches, glossy finish on swatches,
hand-painted look, watercolor, illustration, sketch, mockup of physical object, real-world object simulation.
```

**校对清单**:真的是平面矢量吗(最易翻:被渲染成桌上的色卡照片带景深/纸纹/投影/高光,见到任何实物感就是反摄影封口没生效);色块数量对不对;色相分布对不对(出图唯一可靠核验的事);每块下面有没有功能标签;HEX 真值别从图上回读以 prompt 写死的码为准;背景是纯平 off-white/white 无纹理无投影。

---

## 图型 24 · 灰底物料抠图

**何时用**:要把已有成图/角色图里的某个局部道具单独抠出来,做成干净的中性灰底物料图(给后期当贴图/参考/资产)时。典型:从角色全身图里只要她腰上挂的那个包。这是全库最短最省的物料图型——一句中文搞定,同句换参考图可批量出料。

**命门**:
1. **指代法定位主体,不描述外观**:不写"一个深褐色抽绳布袋",而写"人物腰间挂着的那个包"——用"在哪个位置、挂在谁身上"的指代让模型从参考图里自己定位并抠出。外观交给参考图,prompt 只负责"指哪个"。指代要唯一,画面有多个同类物时指代要更精确("右腰那个""带流苏的那个")。
2. **灰底 = 物料图的封口词**:`灰底`一句把背景洗成中性,产出可直接复用、不带原场景污染的资产图。
3. **负向锁最易翻的那一项**:本例 `不要有简体字`——符箓最易被跑成简体字。换别的道具就锁它最易被 AI"现代化/简化"的那点(如"不要现代拉链""不要塑料感")。
4. **同句换参考图批量**:prompt 一字不动,只换参考图 + 节点就能批量出不同物料(或同物料刷一致性)。要出一整套道具物料就把这句存成模板,逐件换参考图跑,别每件重写文案。
5. **方图便于当资产**:1:1 输出物料图最通用,后期当贴图/图标都好用。

**填空骨架**:
```
模式:图生图(喂含该道具的角色图/成图当参考 → 抠出局部成独立物料图)
size 1:1(物料图常用方图,便于当资产) / quality 视需要
用途:物料图 / 设定图,抠局部道具

【PROMPT 正文 — 一句中文即可】
生成灰底物料图,内容为<指代法定位:人物腰间挂着的那个包 / 角色手里那把刀 / 桌上那只青铜罗盘>。
<道具关键特征一句:包上贴着两个米色道家符箓>,<负向锁最易翻项:不要有简体字 / 不要现代材质>。

（批量:prompt 一字不动,换参考图 + 换节点反复出料即可)
```

**校对清单**:抠对了吗(指代的那个道具被单独抠出,没把旁边的也带出来);背景是干净中性灰(无原场景元素/光污染);道具特征对不对(本例:两个米色符箓在不在、位置对不对);负向项守住没(本例:有没有冒出简体字、符箓是不是篆体/符文样式);批量复用时核的是成果不是版面(参考图位的串接残留可忽略)。

---

## 图型 25 · knolling 桌面陈列

**何时用**:要把一组道具/物件按"整理收纳学(knolling)"摊平在桌面、90° 正俯拍成一张平面色块感极强的陈列图时(给美术当道具清单 / 当 Wes Anderson 式氛围物料 / 当后期合成资产总览)。难点不在"摆得齐",而在让模型把桌子读成一个有厚度的三维实物、从正上方拍,而不是把物件糊成一张平贴的图。

**命门**:
1. **90° 正俯 + 桌体三维厚度双重声明**:开头 `A perpendicular overhead 90-degree top-down photograph … viewed from directly above`,且专门用一整句强调桌子有厚度:`The table is a real three-dimensional physical object with measurable thickness — the tabletop sits raised above the floor on hidden legs … a narrow strip of the side-thickness is visible as a darker band along each of the four edges`,再加 `The raised tabletop casts a soft narrow shadow onto the floor along each edge`。桌缘厚度带 + 桌缘投影 = 让"俯拍"读出"桌子浮在地面上"而非"一张平图"的关键,这段别删。
2. **逐物 hex + 逐物对齐**:每个物件给精确 hex,`every object aligns to invisible parallel and perpendicular axes`(knolling 定义:全部对齐到隐形平行/垂直轴)+ `deliberate generous empty spacing between item groups`(组间留白)。
3. **Mondrian 计数法做色块平衡**:色块大小靠数量而非单件尺寸——`color-block sizing achieved purely through the quantity and grouping of uniformly-sized strips rather than any variation in single-strip size`。所有符纸同尺寸,5~6 张挤一起 = 大色块,2~3 张 = 中,1 张孤蓝 = 最小,`asymmetric Mondrian balance through quantity`。这是 knolling 出"平面色块画"观感的灵魂。
4. **Avoid 排 fisheye / 透视畸变**:90° 俯拍最易被加鱼眼/广角畸变,把 `fisheye, wide-angle distortion, perspective convergence, tilted angle` 排进负向。90° 是模型阻力区,`directly above / straight down / 90-degree` 反复说。
5. **喂一张布局参考最稳**:有参考图,模型对"摆哪、几件、什么材质"就不靠脑补,knolling 对齐和数量更准。

**填空骨架**:
```
模式:文生图 / 图生图(喂一张"桌面物品布局参考"锚定 layout、材质、色彩、knolling 排列)
size 21:9 超宽(便于一桌横陈) / quality 视需要
用途:桌面陈列物料图

【PROMPT 正文】
A perpendicular overhead 90-degree top-down photograph of a single low wide horizontal <桌/台> viewed from
directly above, the complete table including all four edges fully visible within the 21:9 ultrawide frame, sized to
fill most of the frame against a narrow border of the <floor/底面> beneath.
The table is a real three-dimensional physical object with measurable thickness — the tabletop sits raised above
the floor on hidden legs, and around the perimeter a narrow strip of the side-thickness is visible as a darker band
along each of the four edges, distinguishing the raised top from the floor below. The raised top casts a soft narrow
shadow onto the floor along each edge, the shadow lines defining the elevation. The table is the absolute subject.
<参考图 作为桌面物品布局、材质、色彩、knolling排列方式的视觉锚定参考。>
Every object on the table — <逐物 + 逐 hex:桌布 #_, 朱砂符×5-6 #_, 赭黄符×2-3 #_, 孤蓝符×1 #_, 青铜罗盘,
笔×2, 墨石, 朱砂碟, 铜钱横列, 铜铃, 卷轴, 空布袋> — strictly matches the reference in shape, color, material,
QUANTITY, individual size, and knolling-style alignment positions, each object aligned to invisible parallel and
perpendicular axes with deliberate generous empty spacing between groups.
Mondrian 计数法:color-block sizing achieved purely through QUANTITY and grouping of uniformly-sized strips,
NOT through varied single-strip size — the largest red block = a cluster of 5-6 identical strips, medium ochre block
= 2-3 strips, smallest = 1 lone indigo strip; asymmetric Mondrian balance through quantity.
Lighting: warm soft pool of a single <oil lamp #E87838→#A8401C> from above-behind, deep warm-brown shadows
#4A3E32 in the recesses, narrow cast shadow along each table edge.
35mm Kodak Vision3 500T, Greig Fraser cinematography, Dune 2021 firelit interior aesthetic, skip-bleach LUT,
analog grain, shot as a flat overhead reference photograph at 21:9.
Avoid: fisheye, wide-angle distortion, perspective convergence, tilted angle, <题材级负向>.
```

**校对清单**:是不是真·90° 正俯(易翻:被拍成斜俯 3/4,物件就不再是 knolling 平面色块);桌子有没有读出三维厚度(看四条桌缘有没有厚度暗带 + 落在地面的窄投影,没有 = 糊成一张平图);物件数量对不对(Mondrian 计数法靠数量,数错色块就失衡);对齐了吗(每件对齐到隐形平行/垂直轴,组间有留白);有没有鱼眼/广角畸变;逐物 hex 与材质对不对。

---

## 图型 26 · 杂志风介绍卡(60-30-10)

**何时用**:要为单个角色出一张高级时尚杂志风的"人物介绍页"(i-D / Dazed / AnOther 风),角色当主体大图 + 周围拼贴编辑元素(标题块、宝丽来、便签、符纸、印章、涂黑条),并用 60-30-10 配色做版面结构时。常做成冷暖双联(warm/cool diptych):同一套 60-30-10 结构系统,按各角色服装色反向校准背景冷暖。

**命门**:
1. **60-30-10 量化配色,逐档给 hex + 给职能**:`60% DOMINANT = 背景主色`、`30% SECONDARY = 一个大矩形色块(装标题与资料,risograph/offset 粗边)`、`10% ACCENT = 强调色,出现在 exactly four places(眼/耳坠/一枚印章/一处笔触标签),NO other anywhere else`。三档都写死 hex,且 10% 强调严格只许四处——不写死模型会到处撒强调色,版面立刻廉价;在 Avoid 里加 `more than four accent points`。
2. **冷暖双联 = 按角色服装色反向校准背景**:背景选与角色服装相反的冷暖,让人物从背景跳出来(figure-ground separation)。如白/黑/红服角色→暖基调,酒红/奶白/棕皮服角色→冷基调。prompt 里显式写 `SERIES DESIGN SYSTEM NOTE` 交代两卡如何成对,这是整组卡既统一又有别的最值钱一招。
3. **figure-ground 临界校准**:背景中明度必须卡在"比角色暗部亮、比角色亮部暗"之间——`mid-tone must be brighter than her black skirt AND darker than her white tunic`。这句直接决定剪影能不能瞬间读出。
4. **拼贴元素清单逐项点名 + 反对称**:`MAIN TITLE BLOCK(中文名大字 sans-serif modernist + 罗马音)/ DATA FIELDS(资料栏,可全填"?")/ KICKER 手写大标 / POLAROID / 符纸 or REDACTION 涂黑条 / 印章 seal stamp / 归档号 Vol.0x`,排版 `asymmetric — NOT a rigid grid, NOT a centered column`。反对称、反网格是 editorial 的命。
5. **双重反走样**:`STYLE LOCK: i-D / Dazed / AnOther` 锚时尚杂志语言 + `PHOTOGRAPHIC TONE: real printed magazine spread + real paper texture + real ink-on-paper + 宝丽来与印章的真实投影`,缺一不可——只锁 style 出数字海报味,只锁 tone 丢 editorial 排版。最易打折的是符纸篆体字/印章 seal-script/宝丽来里小脸等精工细节,要上 2K+ 或接受缩略层级看不清。

**填空骨架**:
```
模式:图生图(Ref1 = 角色身份锁脸/服装;可选 Ref2 = 只借姿势 body pose,不借身份/脸/衣/背景)
size 16:9 横 / quality 2K
用途:角色介绍卡物料图

【PROMPT 正文】
REFERENCE IMAGE(S): Ref1 — preserve identity/face/hair/clothing exactly. (可选 Ref2 — use ONLY body pose &
wind energy, NOT its identity/face/clothing/background.)
INSTRUCTION: 16:9 editorial magazine spread, contemporary high-fashion editorial (i-D / Dazed / AnOther). A
character introduction page; this is card N in a series — companion to card N-1.
COMPOSITION: <角色> stands center-LEFT, ~35-40% canvas width, full body head-to-feet, <pose 一句>. Right
55-60% = editorial collage, arranged asymmetrically — NOT a rigid grid, NOT a centered column.
COLOR PALETTE (60-30-10):
  60% DOMINANT — <背景主色 + hex 范围>(按角色服装反向选冷/暖;NOT <易跑偏的近似色逐个排除>).
  30% SECONDARY — <大矩形色块 + hex>,占右上 25-30%,装 main title + data,light cream type,risograph 粗边.
  10% ACCENT — <强调色 + hex>,EXACTLY four places:(1)<眼/光点>(2)<耳坠/饰>(3)一枚印章(4)一处笔触标签.
    NO other <强调色> anywhere.
SERIES DESIGN SYSTEM NOTE: card N-1 用了<暖基调三色>;本卡用<冷基调三色>,二者成 warm/cool diptych,同一
  60-30-10 结构、按角色服装色各自校准.
FIGURE-GROUND:背景中明度必须 brighter than <角色暗部> AND darker than <角色亮部>,剪影 instantly readable.
EDITORIAL COLLAGE:1 标题块(中文名大字 modernist sans-serif + 罗马音)/2 资料栏(姓名/年龄/身份/能力/性格/
  携带物,可全填"?")/3 KICKER 手写大标/4 宝丽来(白边微倾、投影)/5 符纸 or REDACTION 涂黑条/6 印章(seal-script)
  /7 归档号 "Vol.0x / 人物志".
PRESERVE / CHANGE / CONSTRAINTS / STYLE LOCK (i-D/Dazed/AnOther) / PHOTOGRAPHIC TONE (real printed
  magazine spread, paper texture, ink-on-paper, real polaroid & stamp shadows).
Avoid: anime cel-shading, manga, 3D render, video game UI, anime intro card, progress bars, brush calligraphy for
  main title, antique scroll paper, bamboo/desert/mecha/school background, garbled Chinese, >four accent points,
  symmetrical grid, centered column.
```

**校对清单**:60-30-10 三档色块都在、比例对(背景占大头、30% 大矩形装标题、10% 强调色点睛);10% 强调色严格只有四处(最易翻);figure-ground 角色从背景跳出来了(黑裙读暗、白衣读亮,背景明度卡在两者之间);冷暖双联这张背景冷暖和角色服装相反;版面反对称(没跑成居中列/规整网格);中文无乱码(标题/资料栏/印章/符纸逐处看是不是真字);像被拍下来的印刷页(宝丽来/印章有真实投影、纸纹);高危精工项(符纸篆体/印章/宝丽来小脸)是否糊成一团。

---

## 图型 27 · EVA 风人物海报(借姿势不借人)

**何时用**:要把一个已有角色重组进平面图形海报——身份保留、但换一套更有张力的姿势 + 改个别特征(如发光赤瞳)、配满版文字底纹背景、落片名——做角色物料 / 关键视觉 / 片名海报时。版式语言是 EVA(新世纪福音战士)式平面海报:单人主体压满画面、背后是密集的文字图案墙。它不是写实成片,是 flat graphic-design poster。

**命门**:
1. **双参考图职责切分,且逐项显式禁用**:全图型命根。Ref1 只给身份(`Preserve her identity, face, hair, hair accessories, and entire clothing exactly`),Ref2 只给姿势 + 风动能(`Use ONLY the body posture and the wind-blown energy`),然后一句不留地禁用 Ref2:`Do NOT use this image's character identity, face, clothing, eye color, or background setting`。"借姿势不借人"是高频翻车点,必须靠这套切分 + 末尾 CHANGE 块二次复述每一项替换(`Reference 2's character → entirely replaced` 等)彻底锁死。
2. **红是全图唯一高饱和(THE CONTRAST PRINCIPLE)**:发光赤瞳是全图最高饱和单点(`the single highest-saturation point`),红腰带 + 红发穗是仅有的另两处饱和红,其余一切压成低饱和深色。背景文字墙刻意做暗、永不与人物抢亮度(`background brightness competing with figure` 进 Avoid)。三处分别写明 + Avoid 压 `oversaturation of non-red elements`,双向夹。
3. **背景是平面文字墙、零透视**:`flat backdrop with NO perspective depth, NO three-dimensional space` + `purely a wall of text at the same depth`。文字必须是正经成形的篆隶字(`properly-formed seal-script / clerical-script, not garbled glyphs`),塞进项目主题关键词。
4. **片名是版面上最大的字、与底纹小字明确分层**:`clearly distinct from the small bamboo-slip text`,`No other large text`。
5. **模板写死、只换画幅批量产出**:同 prompt 换 aspect ratio 再跑一次成套物料,正文一字别动。

**填空骨架**:
```
模式:图生图(双参考图 → 合成平面海报)
size 9:16 或 4:3(同 prompt 换画幅即可成套)/ quality medium
用途:角色物料/片名海报,EVA 式平面图形海报,非写实成片

REFERENCE IMAGES:
- Reference 1: <角色>。Preserve identity, face, hair, hair accessories, and entire clothing EXACTLY.
- Reference 2: the body pose。Use ONLY body posture + wind-blown energy of hair/clothing.
  Do NOT use this image's character identity, face, clothing, eye color, or background.

INSTRUCTION: Generate a <画幅> Chinese cinematic film poster combining these two references,
in the visual language of a flat graphic-design poster — single character over a patterned
typographic background — like a Neon Genesis Evangelion character poster, figure dominating
against a dense text-pattern backdrop.

COMPOSITION: <角色> from Ref1 fills ~75-80% of canvas vertically, full body, centered, in the
EXACT dynamic pose from Ref2 with hair/sleeves/<布料> wind-blown. Eyes are the ONLY modification
from Ref1: <发光赤瞳 hex,supernatural luminous like lit coals, irises bright红 / whites natural>.
Everything else preserved exactly from Ref1.

BACKGROUND — <满版文字墙>:flat wall-like pattern edge-to-edge,<材质做旧深色 hex>,竖排篆隶字
top-to-bottom right-to-left,塞入主题关键词<…>,NO perspective / NO 3D / flat at same depth,做旧裂纹尘埃。

COLOR & TONE / THE CONTRAST PRINCIPLE:背景深低饱和坐阴影;人物中亮调站前;<红 hex>(眼/腰带/穗)是
全图唯一全饱和、视觉层级峰值;非红元素一律 slight gray tone, NOT oversaturated。

TITLE TYPOGRAPHY:片名 <片名> 大墨笔篆书竖排<位置>,与小字底纹明确分层,版面最大字,无其他大字。

PRESERVE FROM REFERENCES / CHANGE FROM REFERENCES:(逐条复述身份保留项 vs 改动项)
CONSTRAINTS:不加其他角色/机甲/武器/手持物;不留 Ref2 的校服/校园/天空/樱花;背景不加透视;无 logo/水印;
            无英文;篆隶字不可乱码;背景不可提亮。

STYLE LOCK:Flat graphic-design poster(EVA 时代日式动画海报传统)+ 中式神话符号;painterly 人物 + flat 文字底纹;
           细胶片颗粒;<色板 hex 全清单>。
PHOTOGRAPHIC TONE:像真实印刷海报、略软不锐(此软是刻意);真人皮肤毛孔瑕疵,无塑料感。
Avoid:oversharpening, HDR, beauty-filter, AI aesthetic, anime cel-shading, 3D, 校服/校园/樱花/天空,
       额外角色, 手持武器, 背景透视, 乱码汉字, 英文, watermark, 提亮背景, background brightness competing with figure,
       neon-glowing eyes that look digital/cyberpunk。
```

**校对清单**:身份是 Ref1 的人(脸/发型/服装/配饰没串成 Ref2);姿势 + 风动取自 Ref2(Ref2 的校服/校园/天空/樱花没漏进来);背景是平面文字墙、零透视、汉字成形篆隶没乱码;红(眼/腰带/穗)是全图唯一高饱和(其余没被提饱和、背景没被提亮抢人物);赤瞳明显发光(全身图脸小易打折,重点核);片名是版面最大字、与底纹小字分层;换画幅版各元素自适应、标题没被画幅吃掉。

---

## 图型 28 · 片头标题卡(复古动漫·空画框版)

**何时用**:要做片头 / 标题卡 / 章节卡:版面要有片名 logo + 副标 + 一句主题文案,且人物位置留空(后期再合成)时。本图型用复古动漫片头版式——1990 年代日式赛璐珞(cel)电视画风、平涂水粉质感、复古片头 logo,左侧挂一个完全空的画框(`COMPLETELY EMPTY`)做后期抠像位。纯平面美术稿、非写实、非 3D。

**命门**:
1. **空画框 = 后期合成位,且必须"完全空"**:画框内是一块纯色荧光绿面板,`COMPLETELY EMPTY — no silhouette, no figure, no object, just a clean blank glowing green surface, leaving negative space`。这句把"留负空间给后期"说死,否则模型会"好心"往框里塞个人影;这块绿同时就是预埋绿幕。
2. **大量精确 hex 锁复古赛璐珞配色**:背景平涂蓝灰 `#5f7689`、画框白边 `#ece9df`、绿面板/logo 荧光绿 `#5cb946`、中国结红 `#c4262c`、金珠 `#f0c419`——钉死复古片头色彩规范。
3. **反向强调精工细节防被简化**:四角中国结(盘长结)写明编织过户、金珠、红流苏,并用 `NOT flat, NOT cartoonish, NOT simplified` 反向夹住,因为重型 prompt 里这类精工最易被模型省成卡通简化。即便写了仍可能打折,细节越多越要单独放大核验。
4. **三处文字各就各位**:lower-right 片名 logo(荧光绿笔刷 + 深绿描边)、其下拉丁副标、bottom-center 主题文案。
5. **整体反摄影 / 反 3D**:`flat colors, no photographic realism, no 3D rendering, no glossy plastic look`——锁在平面赛璐珞语言。纯文生图,靠精确 hex 钉死色彩规范;成套出多张片头卡就固定 hex 清单 + 只改文案/画幅。

**填空骨架**:
```
模式:文生图(纯描述,无参考图)/ 也可作底图后续换元素
size 21:9(或所需画幅)/ quality medium
用途:片头/标题卡物料,复古动漫赛璐珞风,空画框留后期合成位

A <画幅> retro anime title-card illustration in the style of a 1990s Japanese cel-animation
TV screen, flat hand-painted gouache texture, slightly aged with subtle film grain.
Background: a flat muted <蓝灰 hex> field, evenly painted, calm/uncluttered, faint cel-paint texture.

<位置> a vintage SQUARE picture frame (1:1) mounted on the wall。Frame: clean off-white(<hex>)
painted wooden border, soft rounded corners. Inside: flat solid fluorescent <绿 hex> panel,
COMPLETELY EMPTY — no silhouette, no figure, no object, just blank glowing green, leaving negative space.

At each of the four corners of the frame hangs a 中国结(páncháng endless knot)woven from glossy
deep-red(<hex>)silk cord, visible over-under braiding + layered loops; gold(<hex>)bead at center;
red silk tassel below。NOT flat, NOT cartoonish, NOT simplified —— jewelry-quality craftwork.

Lower-right: bold stylized title logo <片名> in thick fluorescent <绿 hex> brush-style lettering
with darker green outline, playful/iconic like a retro anime show logo。Below: thin spaced latin
subtitle <拉丁副标> in small light-cream letters。Bottom-center: small cream-white text <主题文案>。

Overall mood: nostalgic, iconic, clean composition, flat colors, no photographic realism,
no 3D rendering, no glossy plastic look。
```

**校对清单**:画框内真的完全空吗(纯荧光绿、无人/无影/无物,这是后期合成的命门);三处文字都在且对吗(片名 logo / 拉丁副标 / 底部主题文案);配色 hex 对吗(蓝灰背景/荧光绿/白框/红结/金珠);四角中国结有没有被简化成卡通(放大看盘长结编织/金珠/红流苏);整体是平涂赛璐珞、非写实、非 3D、无塑料光泽;画幅成立吗。

---

## 图型 29 · 绿幕/动捕占位图(为后期合成预留)

**何时用**:要为后期动捕 / 绿幕合成预留视觉锚点时,两条路:(A) 在已有角色物料上叠加"绿幕动捕黑色点状外穿设备",做成 mocap suit 前置素材(一句中文轻型改图);(B) 在标题卡 / 版式里把人物位置做成"完全空的荧光绿面板",生图阶段预埋绿幕供后期抠入角色(见图型 28)。两者都不是成片,是给合成 / 动捕流程当前置占位素材。

**命门**:
1. **(A) 黑点要"很多 + 遍布全身"像真 mocap suit**:`在他身上加很多用于绿幕捕捉的黑色点状外穿设备`——关键词"很多""点状""外穿设备"缺一不可:不写"很多"会零星几点,不写"外穿设备"会被画成衣服纹样而非贴附标记点。一句话轻型改图即可一次到位。
2. **(B) 绿幕位必须"完全空"**:`COMPLETELY EMPTY — no silhouette, no figure, no object, just a clean blank glowing green surface`。预埋的是 fluorescent spring-green `#5cb946`,标准抠像绿,空了后期才能抠入。与图型 28 标题卡是同一手法。
3. **占位优先于美感**:成功标准是"后期能不能用"——动捕点够不够多够标准、绿幕够不够纯够空,而不是好不好看。别用美感标准评判。

**填空骨架**:
```
【路 A · 给角色加动捕点 — 图生图轻型改图】
模式:图生图(角色物料图 → 叠加动捕设备)/ 中文一句
在他身上加很多用于绿幕捕捉的黑色点状外穿设备
  （要点:很多 + 点状 + 外穿设备 + 遍布全身,像真实 mocap suit 标记点）

【路 B · 留绿幕空框 — 见图型 28 标题卡】
... Inside the frame: flat solid fluorescent spring-green (#5cb946) panel,
COMPLETELY EMPTY — no silhouette, no figure, no object, just blank glowing green, leaving negative space.
  （这块绿即预埋绿幕,后期抠入角色）
```

**校对清单**:(A) 黑点是"很多 + 遍布全身"吗(像真 mocap suit,非零星几点);(A) 黑点是点状外穿设备(贴身上/衣外,而非画进皮肤/衣纹);(B) 绿幕位真的完全空吗(无人/无影/无物),绿够不够纯(`#5cb946`);角色身份/其余元素有没有被改动(轻型改图只该加点,别串脸/改服);这张后期能直接用吗(动捕/抠像流程视角,而非美感视角)。

---

## 图型 30 · 质感后缀模块(挂载件,非独立图)

**何时用**:它不是一张图,没有主体——是一串纯光学/质感关键词,挂到任意主体 prompt 的末尾,统一注入"模拟胶片柔焦 + 去 AI 数字锐化味 + 统一材质语言"的画风。当你已有一条内容 prompt、只想整体改质感/改调性/去 AI 味而不动内容时,把这串词追加上去即可。本质是可复用的画风挂件/后缀模块。

**命门**:
1. **只写质感、不写内容**:整串没有任何主体/场景/构图描述,纯是光学与材质关键词——所以能挂到任何主体后面而不干涉画面内容,只改"看起来的质感"。它没有主体,单独跑没意义,必须挂到一条已有内容 prompt 后面才生效。
2. **主动注入胶片柔焦 + 反数字锐化**:核心三组——`halation on highlights`(高光光晕)、`photochemical softness` / `analog edge bloom`(化学胶片柔)、`no digital sharpening`(去数字锐化)——把模型默认的数字锐利味压成模拟胶片柔感。
3. **配"做减法"的画面语言**:`large color blocks, negative space, graphic simplicity, single focal point, unified material, subdued micro-detail`——大色块 + 留白 + 单焦点 + 统一材质 + 收敛微观细节,整体往克制、统一、不噪推。
4. **它治的是 AI 味,不是治糊**:柔焦 ≠ 糊,它是有控制的边缘柔化 + 高光晕染,不是降清晰度。若整图发糊,问题在主体 prompt 或分辨率,别赖这串后缀。与重型 prompt 的 `PHOTOGRAPHIC TONE` / `Avoid` 段功能重叠但更轻,是不想写整段电影感签名时的速配替代。

**填空骨架**:
```
【挂载方式】把下面整串词追加到任意主体 prompt 的末尾,统一画风,主体内容不动。
【模块本体 — 纯关键词串,无主体】
soft focus edges, gentle edge falloff, film-like softness, halation on highlights,
photochemical softness, analog edge bloom, no digital sharpening, restrained detail,
minimalist texture, large color blocks, negative space, graphic simplicity, hierarchy of focus,
single focal point, unified material, smooth surfaces, clean rendering, matte finish,
cohesive texture language, subdued micro-detail
```

**校对清单**:边缘柔焦/高光 halation 光晕出来了吗(模块见效最直接信号);数字锐化味压下去了吗(模拟胶片柔感、非数字锐利);柔焦有没有过头变成糊(柔 ≠ 糊,应是有控制的边缘柔化、主体仍清晰);大色块/负空间/单焦点/统一材质有没有兑现;主体内容没被这串后缀干扰/篡改吧(它只该改质感不改画面内容)。
