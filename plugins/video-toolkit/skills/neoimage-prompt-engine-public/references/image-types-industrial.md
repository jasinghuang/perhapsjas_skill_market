# 图型模板库 · Ⅲ 工业设定图(图型 14-22)

> Ⅲ 工业设定图 = turnaround / character sheet / creature sheet / 载具 / 武器 / 比例尺 / 变体。分类路由命中图型后,来此取「填空骨架」填空生成,再用「校对清单」逐项对账。

## 目录

- [图型 14 · 角色四视图定妆](#图型-14--角色四视图定妆2x2-turnaround--character-sheet)
- [图型 15 · 生物 creature sheet](#图型-15--生物-creature-sheet多视图设定表)
- [图型 16 · 生物侧身正交全景](#图型-16--生物侧身正交全景)
- [图型 17 · 纪实实景陈列](#图型-17--纪实实景陈列反棚拍)
- [图型 18 · 载具设计图](#图型-18--载具设计图vehicle-design-sheet--2x2-四视图)
- [图型 19 · 机械兽形态设计图](#图型-19--机械兽形态设计图creature-war-mount-design-sheet--2x2-四视图)
- [图型 20 · 武器四视图](#图型-20--武器四视图借结构换材质--2x2-设计表)
- [图型 21 · 比例尺立绘](#图型-21--比例尺立绘人剑等高--11-高度对照)
- [图型 22 · 同物种变体](#图型-22--同物种变体兽王精英)

---

## 图型 14 · 角色四视图定妆(2×2 turnaround / character sheet)

**何时用**:要给一个角色锁死"正脸/侧脸/全身正/全身背"四套权威视角,供后续分镜复刻一致性 + 后期换脸时用。它是 turnaround character sheet——身份特征、视角分工、四格版式正确优先于单格美感。两种规格:重型英文版(主役/精英)与轻型中文版(次要角色/网格扩展)。同系列多角色靠格式继承 + 差异化对照表保证"同部落不撞脸"。

**命门**:
1. **四格版式逐格点名指派,且每格显式锁宽高比**:逐格写清内容(`左上正脸特写/右上侧脸特写/左下脖子以下全身无脸/右下背面含后脑勺`)+ 整体画幅(9:16 竖版/不等大上小下大,或 `2x2 每格 16:9`)。轻型版翻车点正是没锁每格比例→被压成正方格、没锁尺寸权重→"上小下大"读不出。
2. **左下"全身无脸"格刻意把脸裁出框 = 换脸存活位**:`BODY FRONT (NO FACE) ... face/head intentionally cropped out at the top of this panel ... zero face involvement so this panel survives any future face replacement edit`。
3. **族群/身份锚定 + 海量 NOT 反向锁**(重型版):AI 默认欧美/韩剧脸 → 用一长段 `ETHNICITY — CRITICAL: <族群>` + `NOT pure Caucasian / NOT K-pop / NOT anime face` 把脸压回设定。
4. **格式继承 + 差异化对照表**(同系列多角色):后续角色用一句中文 `【格式继承】完全同<已有角色>格式` 挂载整套模板;收尾附一张多维差异化总览表(性别/年龄/体型/发/胡/服装/双签名装备/主副武器/战利品/气质),把"群像不撞脸"变成可对账的 check 表。

**填空骨架**:
```
模式:文生图 / 图生图(角色 ref → 四视图定妆表)
—— 重型英文版(主役/精英):size 9:16 竖版 / quality 最高
—— 轻型中文版(次要角色/网格扩展):一句话挂模板,显式锁每格比例

【house 格式(所有角色定妆都用)】
size 9:16 竖版 / 4K · 写实摄影棚定妆照背景 · 单侧暖光侧逆光
版式:2x2 上小下大 —— 上排两格(~1/3高)=脸特写;下排两格(~2/3高)=脖子以下全身;细灰分割线,四格同背景同暖光侧逆光。
四格:
- 左上 正脸特写:锁骨往上,正对镜头,脸全露。
- 右上 侧脸 profile:纯侧脸朝 camera-right,暖逆光勾发丝与下颌/鼻线。
- 左下 正面脖子以下(无脸无头):锁骨到脚跟全身,正面;头从格顶裁出(零脸参与=供换脸),正面服装全见。
- 右下 背面脖子以下(无脸无头):背面全身,颈到脚跟,头从格顶裁出;发垂背,披风/腰带/腿挂等背侧装备可见。

【重型版 PROMPT 骨架】
A character design reference sheet. **Vertical 9:16 aspect ratio. Maximum resolution output.**
Pure solid neutral light-warm-grey studio backdrop. Single-sided side-rim backlighting from
camera-right at 45° behind subject, no fill / no front light.
【Layout】2x2 grid with UNEQUAL panel heights: top row two SMALLER panels (~1/3 height) = face
close-ups; bottom row two LARGER panels (~2/3 height) = full body.
【4 Panels】
- Top-left FRONT FACE CLOSE-UP:<正脸·眼睛完整·头巾拉到脖子露脸>
- Top-right SIDE FACE (PROFILE):<纯侧脸·背光勾后脑·发型特征>
- Bottom-left BODY FRONT (NO FACE):<脖子以下全身·脸裁出框·签名装备1正面可见>(换脸存活位)
- Bottom-right BACK VIEW (含后脑勺):<背面全身·签名装备2背挂可见>
【Subject】<年龄+体型一句> ETHNICITY — CRITICAL:<族群锚定>. <发/胡/战痕/服装/签名装备×2/战利品等级>
【Pose 同四格】<默认站姿,关系驱动:working laborer/alert pilot/calm veteran,NOT action NOT seductive>
【Critical consistency】SAME individual in all 4 panels — identical face/hair/clothing/signature gear.
【Panel Labels】FRONT FACE / SIDE FACE / BODY FRONT (NO FACE) / BACK + Title
【Constraints】NOT 1:1(must 9:16)/ NOT equal panels(top smaller)/ NOT face in bottom-left /
            <族群 NOT 清单>/ <装备与同系列其他角色的差异化 NOT 清单>

【轻型版 PROMPT 骨架(已有单图→扩四视图)】
出2x2四视图。每个格子比例都是<16:9 / …>。   ← 关键:必须显式锁每格宽高比
（或)2x2四宫格,上小下大,左上正脸特写/右上侧脸特写/左下脖子以下全身不含头/右下背面全身,
    背景写实摄影棚定妆照,单侧侧逆光。

【同系列多角色追加】
- 一句中文挂模板:【格式继承】完全同<已有角色>格式:9:16竖版+4格不等大+正脸/侧脸/脖子以下/背面+single-side rim
- 收尾差异化对照表:|维度|角色A|角色B|角色C| 性别/年龄/体型/发/胡/服装/签名装备×2/主副武器/战利品/气质
```

**校对清单**:四格内容对不对(正脸/侧脸/全身无脸/背面含后脑勺)?每格比例/整体画幅锁住了吗(易被压成正方格;"上小下大"尺寸差读不出)?左下"全身无脸"格脸是否真的裁出框?族群/身份对不对、有没有跑欧美/韩剧/anime 脸?签名装备 ×2 都可见、和同系列其他角色差异化了吗?单侧侧逆光 + 纯灰底 + 四格标签 + 标题到位?(上游:真人脸角色先出半身锁脸图当 ref 再转四宫格)

---

## 图型 15 · 生物 creature sheet(多视图设定表)

**何时用**:要把一只虚构生物交付给建模/VFX 团队,需要在一张图里同时给出多个正交视图 + 比例参照 + 配色规格时。它是工业级 creature concept design sheet / turnaround——一页式交付物,信息完整、可读优先于美感。建议先有一张怪物的"正常全图"(图生图锚定 vibe 出的单张全身),再把它当 Image 1 喂进来转四宫格(转不转先问用户),别跳过正常全图直接从零出 sheet。

**命门**:
1. **版面分区写成"坐标 + 内容 + caption"三件套**:逐格点名位置(LEFT HALF / TOP RIGHT / MIDDLE RIGHT / BOTTOM STRIP / BOTTOM RIGHT CORNER)+ 该格画什么 + 格下 caption 文字(`Label text reads "TOP VIEW"`)。
2. **比例尺做两层**:主图旁放 1.8m 黑色火柴人剪影(约 1/20 生物高,`HUMAN 1.8M`),底部再来一条五物种横向比例条(人 1.8m / 象 3m / 巴士 12m / 蓝鲸 30m / 生物 35m 黑剪影并排)。
3. **hex 色板条钉死配色**:角落一条 5 色 swatch,每块标 hex(`pale sand-yellow #C9A876…`)。
4. **PRESERVE / specifications 跨所有格统一**:`Creature design specifications (applies to all views)` 一段把标志特征逐项锁死,再强约束 `Consistent lighting direction across all four views` + `Orthographic projection — no perspective foreshortening` + `float on clean background`(净底浮空、删环境)。
5. **预出特殊姿态格**:六视图里可专设 `TOPPLED — BELLY OUT` / `TOPPLED — HEAD CLOSE` 两格,为后续被击倒镜头预备标准设定图。

**填空骨架**:
```
模式:Edit / 图生图(基于生物参考图 Image1 出多视图设定表)
size 16:9 / quality medium / jpeg / Thinking Mode 开
用途:creature concept design sheet,信息完整可读优先,净底浮空、正交无透视

【参考图标注】
Image 1:<底层物种参考图> —— 锁物种解剖基准,所有格保持同一只

【PROMPT 正文】
This image / a professional creature concept design sheet that may appear slightly soft like a
real studio-photographed model sheet — this softness is intentional. <净底:clean neutral
light-grey background, soft even studio lighting, orthographic concept-art lighting to reveal form>.
Subject: <生物一句:体量 + 体型 + 标志特征>.

Layout structure of the sheet（逐格写"坐标 + 内容 + caption"）:
- LEFT HALF (large): <主侧视图,facing frame-left> + 旁置 1.8m 黑色火柴人剪影做比例(约 1/20),
  caption "HUMAN 1.8M" / "BODY LENGTH 35M"
- TOP RIGHT (medium): <俯视图,显式说看到几节甲/几条肢> caption "TOP VIEW"
- MIDDLE RIGHT (medium): <头部特写,锁标志结构> caption "HEAD DETAIL — …"
- BOTTOM STRIP (full width): 五物种黑剪影比例条 人1.8m/象3m/巴士12m/蓝鲸30m/生物XXm,各带名+尺寸
- BOTTOM RIGHT CORNER: 5 色 hex 色板条 <#xxxxxx 各带英文色名>
（六视图变体:3×2 网格 SIDE/FRONT/TOP/3-4/+ 两格特殊姿态 TOPPLED-BELLY/TOPPLED-HEAD-CLOSE）

Creature design specifications (applies to ALL views): <逐项锁:甲壳质感/无眼铲头/N对肢/共生附着物/腹面>.
Preserve from Image 1 across ALL panels: <物种解剖逐项> — same color palette, same material, same proportions.
Constraints: keep all panels the SAME creature, consistent design and scale; clean light-grey background
(#E8E6E2), thin neutral grey divider lines; sans-serif labels dark grey (#2A2A2A), small but legible & sharp;
35mm film grain, neutral grading; consistent lighting across all views; orthographic — no perspective
foreshortening; no environment (no sand/sky/dust), all views float on clean background; no extra creatures,
no humans other than the scale silhouettes, no vegetation, no riders/equipment.
PHOTOGRAPHIC TONE: real studio-photographed design maquette, slightly soft, not tack-sharp, photographically
captured not 3D-rendered/AI-stylized, colors restrained not oversaturated.
Avoid: oversharpening, artificial sharpness, heavy digital grain, HDR, AI-generated aesthetic, overpolished
studio look, plastic smoothing, oversaturation, glossy highlight blowout, generic AI image quality, default
model aesthetic bias.
```

**校对清单**:各视图是不是同一只生物(物种解剖/配色/比例每格一致)?正交无透视了吗(易跑成带透视的 3/4)?人形比例尺出来没(约 1/20、带 HUMAN 1.8M caption)?底部五物种比例条 + 角落 hex 色板条清晰落实了吗(易弱实现/糊掉)?caption 标签可读吗(1K 常糊,要可读得上 2K)?净底浮空、删光环境了吗?(六视图)TOPPLED 两格姿态对不对?

---

## 图型 16 · 生物侧身正交全景

**何时用**:给一只巨型生物出纯侧视、工程级正视图供建模——单视图,但要求绝对正交、无透视压缩、主体居中占满、信息全可读。区别于多视图一页式(图型 15):这是单视图正交全景,把生物完整轮廓 + 全部肢体 + 头部结构平铺在一张图里当建模底图。

**命门**:
1. **机位写成几何约束**:不写"侧视",而写 `Camera positioned at low eye-level approximately 80 meters from the creature, perfectly perpendicular to the creature's body axis — pure side view, no perspective foreshortening`。"80m 外 + 垂直身体轴线"这组几何描述是消除透视收缩、换来近正交纯侧视的命门句,删掉就跑回带透视的近平视。
2. **精确数值规格当骨架**:`35 meters long / 8 meters tall / nine heavily armored dorsal segments / eighteen limbs total`——用量化规格钉死体量结构,引导走"技术参考"而非"美术插画"。
3. **构图锁死**:`fills approximately 85% of the frame width and is centered horizontally and vertically`——占 85% 宽、水平垂直居中,保证全身可读不被裁。
4. **Use Case 明示技术用途**:写明"strict orthographic side profile reference,供 PD 与 VFX 建模",把模型从棚拍 turnaround 拉向工程正视参考。
5. **去元素 + 全清晰**:净背景、无遮挡(no text/logos/figures/vegetation/dust/motion)、全身锐焦(sharp focus across the entire body)。
6. **比例口径要统一**:生成前把元信息与正文的 aspect ratio 统一,别让两处打架导致出图偏宽。

**填空骨架**:
```
模式:文生图(单视图正交侧身全景设定图)
size 16:9 / quality / Thinking Mode 开
用途:strict orthographic side profile reference,供 PD/VFX 建模,信息全可读优先

【PROMPT 正文】
<标题 · 设定图 vN>
Scene: <环境一句:vast arid desert / overcast diffused daylight,concept-art 光揭示形体,minimal harsh shadows>.
Subject: A colossal <生物类比> standing fully exposed, photographed in STRICT SIDE PROFILE.
约 <长> meters long and <高> meters tall. Body consists of <N 节装甲段 forming continuous arched spine>.
The head end faces frame-left; the rear faces frame-right. Stationary, all limbs visible and planted.
Important Details: <逐项锁:每节一对肢=共 N 肢 / 铲状口器无眼 / 甲壳石质风化 / 寄生附着物在第几节 / 关节膜组织 / 腹面>.
Use Case: Creature concept design sheet for a sci-fi film. Strict orthographic side profile reference for the
production design team and VFX vendor to model accurately. Must show the complete silhouette, all limbs,
head structure, body proportions clearly.
Constraints: Wide horizontal composition. Camera at low eye-level approximately 80 meters from the creature,
perfectly perpendicular to the creature's body axis — pure side view, no perspective foreshortening. The
creature fills approximately 85% of the frame width, centered horizontally and vertically. Photorealistic,
35mm film grain, neutral color grading. Clean uncluttered background, only flat sand and distant horizon.
No text, no logos, no human figures, no other creatures, no vegetation. No dust, no motion, no atmospheric
effects obscuring the subject. Sharp focus across the entire creature body. No artistic stylization — strict
photoreal creature design reference quality.
```

**校对清单**:纯侧视近正交、机位几何约束生效无透视收缩;主体占 85% 宽水平垂直居中全身可读;全部肢体可见无遮漏;头部结构清晰;背景干净无文字/人形/植被/尘雾;全身锐焦无大景深虚化;元信息与正文 aspect ratio 一致。

---

## 图型 17 · 纪实实景陈列(反棚拍)

**何时用**:给一只生物出设定页,但刻意不要棚拍 turnaround 那种"干净灰底悬浮"的工业感,而要一组像探险队/剧组在真实外景实拍的纪实照片摊在一页上。专治"AI 默认把生物设定图跑成 3D 渲染/CG 模型/概念美术"的审美偏置,用"反棚拍"框架强行拉回真实外景照片质感。

**命门**:
1. **"反 turnaround"框架开宗明义 + 禁项写满**:开头声明 `documentary-style, on-location PHOTOGRAPHS … as if a film crew or expedition photographed this`,紧接 `Every panel is a REAL PHOTOGRAPH … NOT a 3D render, NOT a studio turnaround, NOT a CG model display, NOT concept art, NOT an illustration`。正向定义 + 负向排除成对出现是反棚拍第一关,少一组就回棚拍。
2. **实景光逐条对冲棚拍光**:`real desert canyon in soft early-morning light, natural directional sunlight, real cast shadows, real bounced environmental light and faint atmospheric dust haze — NOT flat studio lighting, NOT uniform global illumination, NOT a neutral seamless backdrop`。每个棚拍光特征都配一个实景反义。
3. **跨照片一致性**:`The same creature stays perfectly consistent across every photograph`。
4. **"必须读作 X 不是 Y"对比锁定句**:专治模型对某体型的物种/材质偏置(蛇形巨物天然往虫/沙虫跑)。如 `Its overall read must be unmistakably DRAGON, not worm` + `NOT a smooth limp worm tube`;材质同理 `a real living skin surface, NOT exposed muscle, NOT a flayed body, NOT carved stone`。物种偏置压不住是头号坑,要加强显性物种特征的视觉权重 + Avoid 前置错误物种 silhouette + 多刷挑帧。
5. **多照片版面 = 一张主环境照 + 多张局部特写**:`MAIN (large)` 宽环境照(用环境宽度做尺度)+ `JAW & FACE / EYE-SOCKET / SKIN MACRO` 局部实拍,每张配 caption。
6. **PHOTOGRAPHIC TONE 强调"真相机真镜头 + 不完美"**:`shot on a real camera with a real lens … slightly soft and imperfect like a real photo`,把"不完美"当目标对抗 AI 过锐,别被它吓到去加锐化。

**填空骨架**:
```
模式:文生图(纪实实景多照片设定页 · 反棚拍)
size 16:9 / quality / 2K(细节多,建议上 2K)
用途:on-location documentary photographs 摊一页,反 turnaround/反棚拍,要真实外景照质感

【PROMPT 正文】
Create a sheet of documentary-style, on-location PHOTOGRAPHS of a real <生物名> — as if a film crew or
expedition photographed this enormous real creature out in a real <实景环境> and laid several photographs
on one sheet. Every panel is a REAL PHOTOGRAPH shot on location with natural light — NOT a 3D render,
NOT a studio turnaround, NOT a CG model display, NOT concept art, NOT an illustration. Photographed in a
real <环境> in the soft light of <时段>, with natural directional sunlight, real cast shadows, real bounced
environmental light and faint atmospheric dust haze — NOT flat studio lighting, NOT uniform global
illumination, NOT a neutral seamless backdrop. The same creature stays perfectly consistent across every photograph.
CREATURE — <生物详述;若易读错物种/材质,加"必须读作 X 不是 Y"对比锁定句>.
SKIN/材质 — <活体质感细节 + subsurface scattering,逐条 NOT 排除剥皮/石雕/CG-plastic>.
PHOTOGRAPHS ON THE SHEET:
1. MAIN (large) — wide environmental photograph,<全身在实景,用 canyon walls/环境宽度做尺度>.
2. <局部特写A — 同自然光下怼近拍某结构>.
3. <局部特写B>.
4. <MACRO 材质微距>.
LABELS — short clean English labels under each photograph.
PHOTOGRAPHIC TONE: every image is a real on-location photograph shot on a real camera with a real lens,
natural daylight, real cast shadows and environmental bounce light, natural film grain, realistic lens depth of
field, slightly soft and imperfect like a real photo. <主体读作活体真实材质,逐条 NOT CG/雕塑/剥皮>.
Avoid: 3D render, CG model, ZBrush/Blender/octane render, studio lighting, flat lighting, uniform global
illumination, neutral seamless backdrop, product-shot lighting, turnaround sheet, VFX reference board,
video-game render, unreal-engine look, clean 3D render, illustration, drawing, painting, concept-art, cartoon,
anime, cel-shaded, sketch, <错误物种 silhouette / 错误材质>, oversharpening, HDR effect, plastic smoothing,
oversaturation, default model aesthetic bias.
```

**校对清单**:整体像真外景实拍照(没跑成 CG/turnaround/概念美术/插画);实景光到位(方向光 + 真实投影 + 环境反弹 + 尘霾,非平棚光/无缝灰底);多张里是同一只生物;物种读对(易翻:蛇形被读成虫/沙虫);材质对(活体 + subsurface scattering,没滑向剥皮/石雕/CG-plastic);主环境照用环境宽度做尺度;每张配 caption。

---

## 图型 18 · 载具设计图(vehicle design sheet · 2×2 四视图)

**何时用**:给一件载具出工业级正交设计 sheet(SIDE / FRONT / TOP / 3-4 四视图),供美术/建模/道具组当蓝图。结构、尺度、机制正确优先于美感。独门武器是"失败模式→补救句"迭代纠偏 SOP:把最高风险点(单人载具尺度,极易跑成多人战舰)前置标注,出图后照清单逐项核验追加。

**命门**:
1. **2×2 均等四格 + 每格点名视角与朝向**:`Top-left SIDE(primary broadside) / Top-right FRONT / Bottom-left TOP-DOWN / Bottom-right 3/4 PERSPECTIVE(hero shot)`,每格写清主体朝向与取景。
2. **尺度是最大风险,用绝对数值 + 跨物种类比 + 海量 NOT 三重压**:`approximately 2.5 meters long … land-windsurfer board crossed with a small dugout canoe crossed with a sand sled … NOT a Viking longship, NOT a Mad Max truck, single-pilot scale only`。
3. **结构借真实参考物,材质/世界观 DNA 自定义**:功能逻辑借现代陆地帆板/独木舟/沙橇,但材质统一锁到部族青铜 patina `#7A6845 / #846035` + 三角 lateen 帆 + 船首小图腾。
4. **功能优先级要显式写死**:凡"A 是主、B 是辅"的机制(runner vs wheel、帆 vs 驱动器),模型默认会平权甚至反置 → 必须 `PRIMARY motion via single central runner/skid, wheels are only auxiliary stabilizers`。
5. **附"失败模式→补救句"映射表**:主 prompt 后挂一张表,每种典型跑偏各配一句可直接追加的强约束语——把"靠运气"变"靠 SOP"。

**填空骨架**:
```
模式:文生图(载具设计 sheet)
size 16:9 横版 / 最高分辨率

A vehicle design reference sheet. **Horizontal 16:9. Maximum resolution output.**
Pure solid neutral light-warm-grey studio backdrop. Single-sided side-rim backlight camera-right 45°
behind subject, no fill / no front light. Same studio environment as the <同系列角色 sheet>.
【Layout】2x2 equal grid: Top-left SIDE(primary broadside) / Top-right FRONT / Bottom-left TOP-DOWN /
Bottom-right 3/4 PERSPECTIVE(hero shot). Thin grey dividing lines, vehicle centered each panel.
【Subject — same vehicle across all 4 panels】<载具一句定位 + 战术逻辑>.
**Overall form (CRITICAL silhouette and scale)**:<绝对尺寸数值> + <跨物种剪影类比 A crossed with B crossed with C>.
<船体/底盘机制/动力/帆或推进/图腾/操作位/战利品 逐块>. <材质 hex 锁部族 DNA>.
【4 Panels detail】逐格写朝向 + 该格要看清的结构(3/4 格放 hero shot,帆/翼展开)
【Critical consistency】SAME individual vehicle — identical 尺寸/图腾/机制/装饰/底盘配置.
【Lighting / Style / Quality / Panel Labels(SIDE/FRONT/TOP/3-4 VIEW)+ Title】
【Constraints】**Scale & crew**:NOT multi-crew / NOT longship-sized(must single-pilot)/…
            **Form factor**:NOT 水船 / NOT 纯轮车 / …  **Aesthetic**:NOT steampunk / NOT chrome / …

【出图后 SOP — 失败模式→补救句映射表(按风险优先级)】
- 跑成多人战舰(MAX)→ "STRICTLY single-pilot vessel, 2.5m long, NOT multi-crew, NOT longship-sized"
- 跑成纯轮车 → "PRIMARY motion via single central runner/skid, wheels are only auxiliary stabilizers"
- 跑成水船 → "DESERT SAND vehicle riding on top of sand via runner, NOT a water boat"
- 跑成现代 land windsurfer → "ancient tribal hand-crafted hardwood hull with bronze fittings, NOT modern fiberglass board"
- 跑成 steampunk → "ancient lost-tech bronze mechanical drive, NOT Victorian industrial steampunk"
- 跑成大 beast-skull figurehead → "small horn totem on prow only, NOT large skull figurehead"
- 跑成精良战舰 → "war-torn salvage tribal handcraft with mismatched repairs, NOT factory-precision boat-building"
```

**校对清单**:尺度对不对(头号风险:跑成多人战舰/longship/big rig → 追加 single-pilot 补救句);主推进机制对(central runner/skid 主 + 轮子辅,非纯轮车);不是水船(沙橇滑沙);材质/世界观 DNA 一致(部族青铜 patina,非 fiberglass/steampunk/chrome);装饰克制(船首小 horn totem 非大兽颅、战利品 sparse 2-3);2×2 四格 + 朝向 + 标签 + 标题到位,3/4 格是 hero shot 帆展开。

---

## 图型 19 · 机械兽形态设计图(creature war-mount design sheet · 2×2 四视图)

**何时用**:给一只机械生物/战兽出独立形态(standalone / dormant)的 2×2 四视图设定图,供建模与后续"合体外骨骼形态"参考。共用图型 18 的版式与光照,但主体是有明确生物原型的机械兽。最大特点也是最大坑:每只兽都有一个唯一识别特征(标 MAX 风险),模型极易把它跑成普通近亲物种。

**命门**:
1. **唯一识别特征标 MAX + "缺了即设计失败"判据**:把那个最难、最易丢的物种灵魂特征点名为 `mandatory recognition feature, if missing the design fails`(如长鼻类的下垂长 proboscis;奔跑鸟的 lean predatory sprinter silhouette + spear beak with terminal hook)。把"主观像不像"变成"客观成/败"。
2. **失败模式 → 补救句映射表(按风险优先级,MAX 在前)**:MAX 风险特征跑歪时判据直接是"整图失败重做";逐风险一句追加语(鼻/角跑歪、体型跑马、生物机改、看不到 cockpit)。
3. **"纯机械、无生物组织"必须反复压**:`fully mechanical construction with no organic components … bronze panel armor "fur"/"feathers" NOT real fur/feathers`——极易跑成"毛皮+装甲"的生物机改,要把每处表面点名为 bronze panel。
4. **背部 cockpit hatch = 世界观钩子,必须在 TOP/3-4 panel 可见**:这是合体外骨骼系统的接口,本张兽形态 hatch CLOSED(dormant),但必须画出。

**填空骨架**:
```
模式:文生图(creature design sheet · 兽独立形态 / hatch CLOSED)
size 16:9 横版 / 最高分辨率

A creature design reference sheet. **Horizontal 16:9. Maximum resolution output.**
Pure solid neutral light-warm-grey backdrop. Single-side rim backlight camera-right 45° behind, no fill/front.
Same studio environment as the <同系列角色/载具/兽 sheet>.
【Layout】2x2 equal grid: Top-left SIDE(primary) / Top-right FRONT(把唯一特征怼脸) / Bottom-left TOP-DOWN(看 cockpit) / Bottom-right 3/4(hero, 动态半步).
【Subject — same creature across all 4 panels】<机械兽一句 + 生物原型>.
**SPECIES IDENTIFICATION (CRITICAL)**:<原型物种 + 解剖学特征逐条>.
  —— <唯一识别特征>:the most critical recognition marker — if missing, **the design fails**.
**Construction (CRITICAL)**: Fully mechanical, no biological tissue. bronze armature + bronze panel "fur/feathers"(NOT real). <hex DNA #7A6845/#846035 + verdigris + runic glyph>.
**Eyes**: glowing cyan #4FC3D9(同源科技钩子).
**Cockpit/合体接口**: dorsal hatch human-torso-sized, CLOSED(dormant), MUST be visible in TOP & 3/4.
【4 Panels detail / Critical consistency / Lighting / Style(参考真实物种 wildlife photo)/ Quality / Labels SIDE/FRONT/TOP/3-4 + Title】
【Constraints】**Species accuracy(MOST CRITICAL)**:MUST be <物种>, <唯一特征> mandatory. NOT <近亲物种一串>.
            **Mechanical purity**:NO biological tissue. **Cockpit hatch presence**. **Layout/lighting NOT…**

【出图后 SOP — 失败模式→补救句(按风险优先级,MAX 在前)】
- <唯一特征>跑成普通近亲(MAX)→ 整图失败重做 + "<特征> is mandatory, MUST be visibly <描述>, NOT a normal <近亲>"
- <次特征>跑歪 → "…"  /  跑成生物机改 → "all bronze panels, NO biological tissue"
- 看不到 cockpit → "dorsal hatch clearly visible in TOP-DOWN and 3/4"
```

**校对清单**:唯一识别特征出现了吗(MAX 风险,缺了即失败重做);次级特征(角/喙/尾/翅)对吗;纯机械无生物组织(没跑成毛皮+装甲的生物机改);背部 cockpit hatch 在 TOP/3-4 可见;青铜 patina + cyan 眼 DNA 一致;2×2 四格同一只兽、朝向/标签/标题到位、3/4 是 hero。

---

## 图型 20 · 武器四视图(借结构换材质 · 2×2 设计表)

**何时用**:给一件武器/道具出博物馆级产品摄影四视图设计表(FULL FRONT / FULL SIDE / VENT DETAIL / GRIP DETAIL),供建模与材质参考。product photography 路线。招牌手法是"结构借母本、材质全改写":逐部件 1:1 锁定一个现成设计的结构,同时把材质语言系统性翻译成自有世界观——换皮不换骨。

**命门**:
1. **2×2 四个具名视角格,每格写清朝向 + 取景距离**:`TOP LEFT "FULL FRONT" / TOP RIGHT "FULL SIDE"(engine-side reveal) / BOTTOM LEFT "VENT DETAIL"(macro) / BOTTOM RIGHT "GRIP DETAIL"(macro)`。竖版整剑与超宽横置整剑(刃左柄右)按需选。
2. **借结构换材质 = 两层指令分开写**:一层逐部件 `the same … as the original`(锁结构);一层 `the material language is the key transformation, instead of X every surface is Y`(改材质,如 → 青铜六边形板 #7A6845/#846035 + cyan #4FC3D9 seam + 铜握柄 #A85530)。两层别混成一句。
3. **连对比角色一起映射**:母本里起对比作用的材质区(如红漆),要显式翻译成自有体系里承担同样对比作用的区(深铜绿氧化区),否则改完材质会丢掉原设计的视觉层次。
4. **四格材质一致性是关键命门**:正文结尾必留收束句 `the consistency of … material across all four panels is critical`,真实博物馆产品摄影框架对抗 3D/CG 味。
5. **借参考图时材质全外包给图**:图生图版反复 `every detail exactly per the reference image, do not redesign, do not stylize`,材质细节交给参考图而非文字。首版定材质(文字自描述)→ 复用图扩视角/换画幅,材质最稳。
6. **微距格吃分辨率**:VENT/GRIP DETAIL 是 macro,4K 才能读清叠片与 cyan 缝,1K 会糊。

**填空骨架**:
```
模式:文生图(自描述材质)/ 图生图(武器 ref → 四视图,材质全交参考图)
size 16:9 或 4×16:9 超宽 / 4K(微距可读)

A weapon/character design reference sheet displayed on a clean off-white studio background #F0EDE7
with grid-divided panels, museum-quality product photography, photographic still life of a real physical
handcrafted weapon prop, real material textures through a camera lens, NOT 3D/CG/digital painting,
soft diffused studio lighting from upper left, subtle drop shadow.
Title text at top center reading "<名 — 拼音 — XXX DESIGN SHEET>". Four panels in a 2x2 grid, each
labeled at bottom center.
[TOP LEFT PANEL — "FULL FRONT"] <整件武器朝向 + 一比一锁母本结构逐部件> + <材质改写:母本材质语言 → 自有 hex 材质,连对比角色一并映射>
[TOP RIGHT PANEL — "FULL SIDE"] <侧/引擎侧 reveal,看清厚度与管路>
[BOTTOM LEFT PANEL — "VENT DETAIL"] <macro,喷口阵列,cyan 内辉,no inscriptions>
[BOTTOM RIGHT PANEL — "GRIP DETAIL"] <macro,握柄/配重球,暖铜 vs 冷铜绿对比>
Overall: off-white #F0EDE7, soft upper-left light, subtle film grain, photographic DOF each panel sharp,
**material consistency across all 4 panels is critical**.
（图生图版追加：every detail exactly per the reference image, do not redesign / stylize / add elements not in reference）
```

**校对清单**:四格视角 + 朝向对(FULL FRONT / FULL SIDE 引擎侧 reveal / VENT macro / GRIP macro;横置整剑刃左柄右);母本结构 1:1 保留(喷口阵列/信息面板/管路/握柄配重球逐部件核);材质全改写到位连对比角色都映射(原 gunmetal+crimson → 青铜六边片+铜握柄,原红漆区→深铜绿氧化区);四格材质一致性(头号命门);顶部标题清晰无乱码;读作真实博物馆产品摄影非 3D/CG;够清(4K 优先,1K 微距格糊)。

---

## 图型 21 · 比例尺立绘(人剑等高 · 1:1 高度对照)

**何时用**:给一件巨型武器/巨物和持有它的角色出一张等高比例对照立绘,让人一眼读出"这把剑和人一样高"的尺度关系。full-body character concept art(3:4 竖版,off-white 影棚底,high-fashion costume photography 路线),核心诉求不是姿态美而是比例可对照。命门极反直觉:要让"人剑等高"成立,武器必须竖立体侧 + 剑尖触地,而不是斜搭肩(斜搭肩会被透视压缩,等高读不出来)。

**命门**:
1. **CRITICAL PROPORTION ANCHOR——给人和武器都标同一绝对身高**:`<角色> is 165cm tall. The weapon she holds is also approximately 165cm tall, almost exactly equal to her own height … tip-to-pommel = head-to-foot`。把抽象巨物尺度转成可对照的 1:1 等高。绝对数值 + 双标 + 同高度收束句三件套,缺一面就压不住透视。
2. **武器必须竖立体侧 + 剑尖触地 + 无透视压缩**(等高成立的唯一姿势):`the weapon stands vertically next to her body, parallel to her standing posture, no foreshortening, no perspective compression … the lower tip rests on the ground at her side … the top reaches the same height as the top of her head or slightly above`。斜搭肩/背扛虽好看,但透视一压等高彻底读不出。
3. **同高度收束句锁画框**:把头顶/剑顶、脚底/剑尖各自拉到同一水平线(`both at full height … reaching the same horizontal level`)。
4. **武器外形完全外包给参考图,文字只管姿态与比例**:`The weapon must match the design reference image exactly — all structure/proportion/color/material determined entirely by the reference image and not by this text`。避免文字描述与参考图打架。
5. **身份锁定 + 体型基调正向写**:`@token` + `face/eye/hair must match base reference with absolute precision` + `slim slender feminine, NO athletic musculature, NO six-pack`(女角色易被默认跑成肌肉/六块腹肌,正反向都压)。
6. **2K 起步**:同时要看清人脸身份 + 武器青铜微距,1K 两头都糊。

**填空骨架**:
```
模式:图生图(身份 ref + 武器设计 ref → 等高比例立绘)
size 3:4 竖版 / 2K(优先,比 1K 清)

A single full-body character concept art illustration in 3:4 vertical portrait, on a clean off-white
studio background #F0EDE7, high-fashion character design photography, real material textures through a
camera lens, NOT 3D/CG/anime, soft key from upper left + warm rim upper right, subtle film grain.
The subject is <角色 @token> in <形态>. <catwalk contrapposto S-curve 姿态> + <身份锁:face/hair/eye must match base reference with absolute precision>. Camera angle slightly low looking up.
CRITICAL PROPORTION ANCHOR: <角色> is <Xcm> tall. The weapon is also approximately <Xcm> tall,
almost exactly equal to her own height — tip-to-pommel = head-to-foot. The weapon stands VERTICALLY
next to her body, parallel to her posture, NO foreshortening, NO perspective compression. Her hand grips
near where blade meets grip, the weapon's lower tip rests on the ground at her side, the top reaches the
same height as the top of her head or slightly above. This is a one-to-one height comparison composition.
The weapon must match the design reference image exactly — all structure/proportion/color/material
determined entirely by the reference image, NOT by this text.
<体型基调:slim slender feminine, NO athletic musculature / NO six-pack>.
Composition: <角色> and the vertical weapon as two parallel vertical anchors of EQUAL height — top of
head and top of weapon at the same horizontal level, both feet/tip at the same bottom ground line.
CHARACTER IDENTITY:unmistakably the same person, only clothing changed.
CRITICAL RENDERING:photorealistic studio fashion photography of a real human model, NOT 3D/CG/anime.
```

**校对清单**:武器竖立体侧 + 剑尖触地(头号命门:斜搭肩/背扛会被透视压缩,等高读不出);人剑顶端在同一水平线、脚底/剑尖在同一底线;无透视压缩武器长度;武器外形与设计参考图 1:1 一致(文字不复述);身份锁住没串脸;体型基调对(slim slender feminine,没跑成肌肉壮/六块腹肌);够清(2K 优先,1K 微距糊)。

---

## 图型 22 · 同物种变体(兽王/精英)

**何时用**:已有一只"普通"生物的设定图,要派生出同物种的兽王/精英/首领个体——既要一眼可辨是头领,又绝不能跑成完全不同的生物。核心矛盾:既要"明显不同"又要"还是同种"。用 Edit 模式基于原版参考图,PRESERVE 锁底层物种解剖 + 编号差异要点堆叠两手并用。

**命门**:
1. **一句话框死核心矛盾**:`SAME SPECIES, but visibly DISTINCT as the king — a viewer must read it as "the same kind of creature, but unmistakably the chieftain, different at a glance."` 后面所有差异点都服务它。
2. **PRESERVE 只锁"底层物种解剖",用 `only`**:`Keep the underlying species anatomy of Image 1 (<逐项底层解剖>)` + 结尾复述 `Preserve from Image 1 ONLY the fundamental species body plan … so it stays the same species`。"only" 是关键——只锁身体方案,把颜色/角/体量留给差异化。PRESERVE 写太宽会导致变体跟原版没区别。
3. **编号差异逐条堆叠 + 点出 headline difference**:`1. HORNS (the headline difference — it must grow horns)` / `2. COLOR` / `3. SIZE & SILHOUETTE` / `4. BATTLE-WORN ELDER MARKS`。把最显著差异标成 headline、写 `it must grow X` / `the common one has none`,先立住"一眼可辨";其余差异叠加。这是从普通个体派生任何精英变体的通用打法。
4. **每条差异都"在同一世界里推开"**:如颜色 `shift the palette to set it apart while staying in the same earthy world … still a real weathered mineral/stone material in the same family`——差异化但不脱离原物种材质家族,防跑成异类。
5. **四视图网格 + 逐格 caption + 净底**:`Four-panel grid (2×2): SIDE / FRONT / 3-4 VIEW / DETAIL`,`keep all four panels the SAME creature, consistent design and scale`,净棚灰底、`no rider or equipment`、`no environment`。

**填空骨架**:
```
模式:Edit(基于原版物种参考图,设计同物种变体)
size 21:9 / quality medium / jpeg / Thinking Mode 开
用途:从普通个体派生兽王/精英,要"同种但一眼可辨",净底四视图设定sheet

【参考图标注】
Image 1: the base <物种> — 物种骨架基准。变体须是同物种,但在颜色/外形/头角上要有一眼可辨的明显差异。

【PROMPT 正文】
This is a creature design reference sheet that may appear slightly soft like a real studio-photographed maquette
— this softness is intentional. Design a <CHIEFTAIN/KING/ELITE> individual of the <物种> species shown in
Image 1, presented as a clean creature design sheet on a neutral light-gray seamless studio background, soft
natural studio lighting, a caption label under each panel. Four-panel grid (2×2): top-left "SIDE", top-right
"FRONT", bottom-left "3/4 VIEW", bottom-right "DETAIL — <差异部位>".
SAME SPECIES, but visibly DISTINCT as the <king> — a viewer must read it as "the same kind of creature,
but unmistakably the <chieftain>, different at a glance."
Keep the underlying species anatomy of Image 1 (<逐项列底层解剖:甲壳/头/腿/体型 plan>), but push clear
visual differences in the following ways:
1. <HEADLINE 差异 (the headline difference — it must <grow X>)>: <详述;the common one has none>. <次级差异>.
2. COLOR — shift the palette to set it apart while staying in the same earthy world: <调暗/换色,but still a
   real weathered material in the same family>.
3. SIZE & SILHOUETTE: <更大更高/更具压迫感的轮廓>.
4. <ELDER/精英 标记>: <战损/老者印记/共生附着物堆叠>.
Its bearing reads as <dominant, ancient, imposing>.
Preserve from Image 1 ONLY the fundamental species body plan (<逐项>) so it stays the same species — but
the <差异点 A、B、C> clearly distinguish it as the <king>.
Constraints: keep all four panels the SAME creature, consistent design and scale; clean neutral studio sheet,
no environment, no desert landscape, no sky; no extra creatures; no rider or equipment; keep it a real
biological/mineral creature, not a glossy toy.
PHOTOGRAPHIC TONE: real studio-photographed design maquette, slightly soft, not tack-sharp, photographically
captured not 3D-rendered/AI-stylized, colors restrained not oversaturated.
Avoid: oversharpening, artificial sharpness, heavy digital grain, HDR, AI-generated aesthetic, overpolished
studio look, plastic smoothing, oversaturation, glossy highlight blowout, generic AI image quality, default
model aesthetic bias.
```

**校对清单**:还是同一物种吗(底层 body plan 没变,没跑成异类);一眼可辨是头领吗(headline 差异立住,`the common one has none` 的特征确实长出来了);编号差异逐条兑现(角/调暗色板/增大体量/老者战损四条都在);差异化没脱离原物种材质家族(色变深但仍是同类风化矿物/石质);四视图是同一只(四格 design & scale 一致);净底、无环境/骑手/装备、caption 四格齐。
