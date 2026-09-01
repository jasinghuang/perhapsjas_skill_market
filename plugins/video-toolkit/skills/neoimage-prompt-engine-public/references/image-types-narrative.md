# 图型模板库 · Ⅰ 叙事画面(图型 01-09)

> Ⅰ 叙事画面 = 成片镜头。分类路由命中图型后,来此取「填空骨架」填空生成,再用「校对清单」逐项对账。

## 目录

- [图型 01 · 上帝视角群像站位图](#图型-01--上帝视角群像站位图blocking-diagram)
- [图型 02 · 彩色叙事关键帧](#图型-02--彩色叙事关键帧参考图锁脸--prompt-管构图)
- [图型 03 · 建场航拍](#图型-03--建场航拍top-down-高空俯瞰-establishing)
- [图型 04 · 黑白武戏静帧](#图型-04--黑白武戏静帧bw-wuxia-action-film-still)
- [图型 05 · 双头沙漠极光帧](#图型-05--双头沙漠极光帧白点定位--22色卡)
- [图型 06 · 角色姿态/表情复刻帧](#图型-06--角色姿态表情复刻帧pose--expression-replication-frame)
- [图型 07 · 从成图抠主体特写](#图型-07--从成图抠主体特写场景内单人切特写)
- [图型 08 · 极限微距叙事帧](#图型-08--极限微距叙事帧extreme-macro--巨物压迫)
- [图型 09 · 重打光 edit](#图型-09--重打光-edit只改光不改内容)

---

## 图型 01 · 上帝视角群像站位图(blocking diagram)

**何时用**:一个空间内 ≥3 角色/生物同框,需锁死"谁站哪、朝向、谁挡谁、远近"。它是站位蓝图,位置/朝向/影调正确优先于美感,不是成片美图。

**命门**:
1. **depth order 逐层声明 + 结尾复述一遍**:从相机往里(前景→近侧→远侧中景→最远→背景)逐层写谁在哪,写完用一句 `So the depth order from camera into the scene is: A → B → C → D → 背景` 复述。
2. **长投影当"站位读取器"**:高空俯瞰靠地面长软影才看得清谁站哪。
3. **巨物横陈做"分割墙"**:有大体量物时让它横贯画面分区 + 做尺度对照。
4. **三件分工**:逐张关键帧标机位职责 + 逐角色一行身份锚 + 色卡。

**填空骨架**:
```
模式:图生图(多关键帧机位图 + 角色参考图 → 合成俯瞰站位图)
size 21:9 超宽 / quality medium / jpeg / Thinking Mode 开
用途:blocking diagram,位置/朝向/影调必须正确,美感其次

【参考图标注 — 务必逐张对应】
- 关键帧1:<从谁背后·越过谁·望向谁 的机位> —— 仅提供机位视角,不提供内容
- 关键帧2:<怼近拍某角色的机位>  - 关键帧3:<拍另一侧的机位>
- 角色参考(逐个一行,仅锁身份):<角色A 一句外观锚>;<角色B…>
- 色卡:整图色彩严格按色卡执行

【PROMPT 正文】
A high-angle bird's-eye establishing shot — an oblique overhead view looking down ... used as a staging / blocking diagram. The entire layout must be read clearly from above. <胶片+调性签名>. 21:9 ultra-widescreen. <环境一句>.
Spatial layout (this is the critical part — lay it out exactly), reading across the depth of the frame:
- FOREGROUND, near side: <最大主体/巨物,横陈做 long horizontal wall 切开画面>
- NEAR side: <角色组A + 朝向 + 状态>  - FAR side / middle distance: <角色组B + 朝向 + 状态>  - FARTHEST back: <角色/物C>
So the depth order from camera into the scene is: <A → B → C → D → 背景>.
Lighting / tone: warm hazy directional light raking from one side, long soft shadows cast across the ground from each figure (the shadows help read the staging from above), low-contrast desaturated tone, strictly following the color card.
PHOTOGRAPHIC TONE: real photographed film still from high above, slightly soft, not tack-sharp.
Avoid: oversharpening, HDR, plastic smoothing, oversaturation, generic AI aesthetic, <题材级负向>.
```

**校对清单**:depth order 几层都读出来了?巨物够大当分割墙没?每个角色身份对、没串脸/贴反?长投影出来没?机位是真·高空斜俯吗?

---

## 图型 02 · 彩色叙事关键帧(参考图锁脸 + prompt 管构图)

**何时用**:单主角(偶尔含巨物道具)、要一张能直接当成片镜头用的彩色关键帧——海报级/章节定帧/情绪英姿,讲究构图张力与冷暖电影感。和图型 01 正相反:这里单人、美感与构图张力优先,脸往往出画或被透视牺牲。

**命门**:
1. **"参考图管脸、prompt 管构图"职责切分,正文开头一句写死**:`以放入的<参考角色>作为参考角色锚定人物长相/发型/服装,本 prompt 只规定构图、姿势、占比、光线、景别与前景,不描述五官`。脸一旦让 prompt 描述就串脸。
2. **Markdown 分节拆功能块**:`# 画幅与镜头 / # 人物占比与构图 / # 衣物的动态 / # 光线与色调 / # 纵深层次与对焦 / # 约束`,最后 `# 约束` 把要点再复述一遍(重复=注意力强化)。
3. **一个"视觉锚点"统管全画面虚实/动势**:唯一对焦高光 / 红飘带横贯动势 / 巨剑怼镜头透视支点——一张图只能有一个这种锚。
4. **正反双管锁着装防脑补换装**:既正向列着装清单,又负向写 `不要无袖战斗装、不要护臂革囊`。
5. **冷暖对撞 + 逆光半剪影做电影感**:暖前景对撞冷背景,人物在亮天映衬下偏暗、留光边。
6. **双人/越肩/对话帧:体位 + 视线锁定必须写死**(单人帧忽略):① 每人体位 + 相对高度(谁坐/卧/倚/立、谁高谁低)——漏写哪个就被默认成站立齐高;② 视线锁到对方脸/眼,写 `gaze LOCKED onto X's face / eyelines meet`,绝不只写模糊的 "look toward / 朝向"。两项按 [正文] +【CONSTRAINTS】+【Avoid】三处复写。
7. **远距离对话帧(隔屋对峙/跨桌)视线锁定难度阶跃,三处复写不够**:远距离一旦超出"一臂之内"就掉控,模型会把两人画成各自低头沉思(看似在看其实没看)。加固:① 正向写 `eyelines MEET across the room, both heads slightly LIFTED to look at each other`;② Avoid 段把"低头沉思"族逐项排除(`looking down at the table / heads bowed / eyes lowered / each lost in their own thoughts / averted gaze`);③ 纯侧脸改 3/4 朝向对方;④ `head TURNED toward the other person, chin slightly LIFTED`。

**填空骨架**:
```
模式:图生图(角色参考图锚脸 + 本 prompt 只管构图)
size 21:9 超宽 / quality 2K / Thinking Mode 开
中文分节式,纯叙事彩色关键帧,脸出画或透视牺牲皆可

[图像生成 prompt — <镜头名> · 参考角色<X> · 无文字]
以放入的<X>作为参考角色锚定人物长相/发型/服装,本 prompt 只规定构图、姿势、占比、
光线、景别与<前景/环境>,不描述五官。画面中不出现任何文字、签名、手写字、水印<、UI/图标/电量/时间>。
# 画幅与镜头:<21:9;机位角度——仰拍/荷兰角/广角畸变;镜头——长焦浅景深 or 广角透视>
# 人物着装(用<X>本身那套,严格锚定):<正向列衣物>;<负向:不要__、不要__>
# 人物占比与构图 / 姿势:<位置(右半/偏右三分之一)+朝向+身体取景段(头出画/只露上半身)+张力姿态>
# 核心视觉锚点:<唯一对焦高光 / 红飘带横贯动势 / 巨剑怼镜头透视支点——三选一,只能一个>
# 衣物的动态:<被风掀动、定格动态模糊、布料绷弧>
# 光线与色调:<冷暖对撞:暖前景 vs 冷/发白背景;逆光半剪影留光边;低饱和>
# 纵深层次与对焦:<最实处是谁、由此向外发散虚化、焦外是谁>
# 约束:<把以上每条要点逐行复述一遍 + "画面只有这一个人物" + 无文字>
```

**校对清单**:脸串了没?唯一视觉锚点立住了吗?冷暖对撞 + 逆光半剪影出来没?着装有没有被脑补换装?构图微指标(护手锁角/朝向/脚出画剑出画)落地几条?强透视镜远端人物还认得出脸吗?双人/越肩帧体位/相对高度对吗、视线真锁到对方脸上吗?远距离对话帧双方头都抬起、视线相接、没人低头看桌/地?人物数对 + 零文字吗?

---

## 图型 03 · 建场航拍(top-down 高空俯瞰 establishing)

**何时用**:给一个聚落/营地/场景做世界观奠基的高空大全景——一张图钉死整个空间的布局/建筑/光照/色板,当 establishing shot 用。几乎没有具名角色(只有 tiny human figures 做生活气),重点是空间组织 + 数量锚定 + 可信生活细节 + 反 AI 航拍味。

**命门**:
1. **空间组织写成一句可读的几何**:如"崖壁蜂窝崖居 + 崖脚中央广场"或"concentric loose rings,最中心一顶仪式大帐,向外环环叠出约 40 顶帐篷"。布局要能一句话画出来。
2. **数量锚定增可信**:`roughly forty individual tents` / `dozens of tiny human figures`,给具体数量模型才不会糊成一团。
3. **散布"signs of life"细节**:炊烟 + 晒肉架 + 打铁火星 + 兽栏 + 沙艇 + 晾染布,反"无人 CGI 沙盘"。
4. **golden hour 低角侧光 + 长影**:`late afternoon golden hour, low warm sun from screen left, casting long crisp shadows`,长影给电影感又帮读建筑体量。
5. **完整摄影签名 + 题材级负向**:加超长 Avoid 专门排掉模型的航拍审美偏置(`drone shot of modern desert resort / 沙漠婚礼 / Burning Man / 现代军营`)。
6. **"唯一焦点色"在同色系里会被吃掉**:暖沙调里钉一抹朱砂红常被环境同化,要抢眼就加面积/提对比/挪到反差位(如旗幡放塔顶)。

**填空骨架**:
```
模式:文生图(单段连贯英文,无需参考图)
size 16:9 / quality 1K-2K
单段叙事式航拍,世界观奠基,钉死布局/建筑/光照/色板

A photorealistic top-down aerial bird's-eye view photograph of <聚落/营地一句话>,
16:9 horizontal cinematic composition.
<空间组织几何:依崖蜂窝 / concentric rings + 中心地标 + 数量锚定 roughly N units>.
<建筑/帐篷材质 + 染色 deep burgundy / dust-cream>.
<中心地标:relic forge / ceremonial tent + 黑烟柱/旗幡>.
<散布道具:沙艇 / 兽栏 / 打铁站 / salvage pile>.
Signs of life: <tiny human figures + 炊烟 + 晒肉架 + 晾染布 + 骑兽者接近>.
Lighting: late afternoon golden hour, low warm sun from screen left, long crisp shadows,
<heat-shimmer + 悬浮尘粒>.
Color palette: <8-10 色逐项 hex,含 cinnabar red #A82A2A 做唯一/重点饱和色>.
PHOTOGRAPHIC TONE: high silent drone or distant cliff perch, 35mm Kodak Vision3,
skip-bleach LUT, organic film grain, aerial atmospheric haze, restrained colors.
Avoid: <反AI味通用串> + drone shot of modern desert resort / Burning Man / 现代军营 等题材级负向.
```

**校对清单**:布局几何对不对?数量锚定兑现了吗(约 40 顶别糊成一片)?signs of life 细节齐不齐?golden hour 长影出来没?唯一/重点饱和焦点色立住了吗(易被暖沙吞掉)?有没有 AI 航拍味/题材跑偏(度假村/婚礼/Burning Man/军营)?中心地标辨认得出吗?

---

## 图型 04 · 黑白武戏静帧(B&W wuxia action film still)

**何时用**:主角持械打斗 / 群战 / 单帧动作高潮,要的是"真实片场拍的黑白武术电影剧照"而非彩色成片或插画——黑白本身就在帮你滤掉 AI 的塑料感与过饱和。两种产出形态:单帧(一招一式定格)与九宫格分镜(一张 prompt 出整段武戏 storyboard,首尾镜像闭环)。借的是动作张力,不是器物结构。

**命门**:
1. **三参考图严格分工,第三张当"灰阶色卡"**:`Image 1 = main character (lock costume design exactly) / Image 2 = heavy mechanical sword (lock weapon design exactly) / Image 3 = color palette for tonal hierarchy in grayscale`——黑白片里仍用彩色色卡把红/黑/白转译成灰阶层级,否则黑白成片糊成一团没层次。
2. **暴力降级句必带(过审命脉)**:`opponents are knocked back by force, not visibly injured. No wounds, no damage, no blood.` 交击帧再叠 `sword meeting sword, NOT sword meeting body`;倒地帧叠 `lying still as if asleep or unconscious, no visible injuries`。
3. **黑白胶片签名固定段**:`Kodak Double-X 5222 black-and-white film stock aesthetic. Anamorphic widescreen lens.` + `Black-and-white grayscale only with full continuous tonal range`(强调连续灰阶,挡 line art / manga)。
4. **力 = 沙墙 + motion blur,不是血**:`the visual focus is on the sand wall and the force of the swing, not on body damage`——用扇形沙墙、运动模糊、弯刀脱手旋飞承载暴力感。
5. **(九宫格专属)全局锁定 + 首尾镜像**:开头一段写死跨格一致性(主角 + N 敌 + 光向 + 风向 + 胶片机型 + 逐材质灰阶映射),再逐格写镜别;`PANEL 09 = EXACT same camera as PANEL 01`,只把敌从逼近变伏地、光从晨变暮,形成叙事闭环。

**填空骨架**:
```
模式:图生图(3 参考图 → 单帧 / 或文生图九宫格)
size 16:9 / quality 2K
用途:黑白武术电影剧照,要真实片场实拍感,非插画/漫画/concept art

【参考图分工 — 黑白武戏铁三件】
- Image 1 = 主角(lock costume design exactly,必要时点名 boots/leg wear/lower coat)
- Image 2 = 武器(lock weapon design exactly)
- Image 3 = color palette for tonal hierarchy in grayscale ← 彩色色卡转译灰阶层级

【PROMPT 正文 · 单帧】
A single 16:9 cinematic black-and-white film still from a live-action martial arts film.
Photorealistic photographic image, NOT illustration, NOT manga, NOT concept art.
Black-and-white grayscale only with full continuous tonal range.
Reference images: <三件分工逐行>.
SHOT: <机位 + 景别 + 构图,如 Extreme low angle, explosive vertical composition>.
The warrior from Image 1 <动作:bursting upward / horizontal swing / kneeling block>,
the heavy mechanical sword from Image 2 <剑的运动 + realistic motion blur>.
<N> desert raiders <被掀飞/格挡的物理动势>, their sabers knocked loose spinning away.
Focus on force, motion, and impact — opponents are knocked back by force, not visibly injured.
No wounds, no damage, no blood. <交击帧加:sword meeting sword, NOT sword meeting body>.
Composition: <能量走向,如 dynamic diagonal sweep lower-left to upper-right>.
PHOTOGRAPHIC TONE: Film still captured during a real shoot — slightly soft and imperfect.
Soft natural lighting with realistic falloff, not HDR. Subtle organic film grain only.
Realistic motion blur on the sword arc and tumbling figures. Natural lens depth of field.
Kodak Double-X 5222 black-and-white film stock aesthetic. Anamorphic widescreen lens.
Colors restrained, slight gray tone.
Avoid: oversharpening, artificial sharpness, heavy digital grain, HDR effect, beauty-filter
skin, AI-generated aesthetic, overpolished studio look, plastic smoothing, oversaturation,
glossy highlight blowout, generic AI image quality, illustration style, manga style, concept
art style. Aspect ratio: 16:9. Output: single cinematic film still.

【九宫格变体】:开头加全局锁定段(N敌+光向+风向+逐材质 GRAYSCALE RENDERING REQUIREMENTS),
逐格 PANEL 01–09 写镜别动作,PANEL 09 镜像 PANEL 01,结尾 CRITICAL FINAL DIRECTIVE 复述
「黑白 / 真实片场 / 编排武打非血腥」。Output: 3x3 grid, 编号 "01"–"09"。
```

**校对清单**:真黑白连续灰阶吗(没跑成 line art/manga/上色;红黑白三档明暗拉开了没)?无伤害降级兑现了吗(无伤口/血;交击帧是剑碰剑还是剑砍身)?服装/重剑身份对不对?力度感出来没(沙墙/motion blur/弯刀旋飞)?Double-X 颗粒 + anamorphic + 微软焦,没被锐成塑料?(九宫格)跨格光向/风向/主角一致、首尾 01↔09 同机位镜像对上没?

---

## 图型 05 · 双头沙漠极光帧(白点定位 + 22色卡)

**何时用**:两个主体(尤其一人一机)在同一空旷画面里,要精确钉死各自 XY 位置 + 各自身份不串的史诗叙事静帧。最大风险是"机器人头被画成人类脸",本图型整套手法就是为攻克这个而生(白点定位 + 逐头身份锚定 + 显式"非人类"声明)。21:9 宽银幕、纯中文重型结构。

**命门**:
1. **白点构图定位图(把 XY 写成可指认坐标)**:专喂一张参考图,两个白点精确标记两个头的最终位置——`左侧白点标记<主体A>的头出现的位置,右侧白点标记<主体B>的头出现的位置,最终画面里两个头必须分别占据与这两个白点完全一致的位置`。这是双主体不挤、不漂、不互换的关键。
2. **逐头身份锚定 + 显式"非人类"声明**:每个头单独一张参考图只锚一个身份,且对机器人明写否定:`<机器人角色>是一个人形机器人而非人类……他不应被生成为人类`。缺它必翻。
3. **姿态写成物理因果,不写"请仰头"**:用"脖子被埋→被迫后仰→这是物理约束自然产生的结果"的因果链让姿态自然成立。
4. **22色环境色卡当影调统帅**:专喂一张色卡,沙漠和夜空严格按 22 色不可偏离;冷青蓝夜色主导、极光带翠绿→紫罗兰渐变作诗性主光源、阴影保留色彩深度而非死黑。
5. **多 DP 署名 + Kodak Vision3 定影调**:Roger Deakins / Greig Fraser / Hoyte van Hoytema 综合视觉语言,低饱和高对比电影暗场,21:9 anamorphic,35mm Kodak Vision3 500T + skip-bleach negative LUT。

**填空骨架**:
```
模式:图生图(4 参考图 → 双主体定位合成)
size 21:9 超宽 / quality 1K / 纯中文重型结构
用途:双主体史诗叙事静帧,精确控 XY 位置 + 身份不串(尤其人机不混)

【参考图分工 — 四件,各司一职】
- 参考图①(构图定位):两个白点精确钉位 ← 左白点=主体A的XY,右白点=主体B的XY
- 参考图②(身份锚A):仅锚 A 身份;若 A 是机器人/非人,显式写「是机器人非人类,不应被生成为人类」
- 参考图③(身份锚B):仅锚 B 身份 + 神态(眼神/表情/发被风吹)
- 参考图④(环境色卡):N 色色卡,沙漠+天空严格按色板不可偏离

【PROMPT 正文】
一张21:9宽银幕电影质感的静态照片,<主体A> 和 <主体B> 从 <环境:夜晚沙漠表面> 露出,
<头顶上方:被极光照亮的辽阔夜空>。
<埋没/约束的物理状态:埋到下颌→看不见脖子→被迫轻微后仰,写成因果链而非指令>。
参考图 严格决定本镜构图空间布局,两个白点精确标记两个头的位置,左白点=<A>的位置,
右白点=<B>的位置,最终画面里两个头必须分别占据与白点完全一致的位置,其余空间由空旷
沙地与夜空填满。
参考图 仅作为 <A> 的视觉锚定,<A 是机器人而非人类……不应被生成为人类>,出现在左白点位置,
机械视觉特征严格保留不做修改。
参考图 仅作为 <B> 的角色锚定,<B 身份 + 神态:眼神清澈警觉、冷静沉着、明确是活着有意识的状态,
长发被夜风从两侧吹拂>,出现在右白点位置。
参考图 作为环境色卡锚定,严格按22色色卡执行不可偏离色板,<主导色调 + 极光主光源 + 星辰
+ 沙地冷光调子 + 阴影保留色彩深度非死黑>。
电影摄影的史诗孤独感,Roger Deakins / Greig Fraser / Hoyte van Hoytema 综合视觉语言,
低饱和高对比电影暗场,21:9 anamorphic,35mm Kodak Vision3 500T + skip-bleach negative LUT,
模拟胶片颗粒,真实电影长片的单帧定格画质。
```

**校对清单**:两个头的 XY 对上白点了吗(有没有漂移/左右互换)?机器人头是不是机械头(没被画成人脸/半人脸;LED 面板/机械颈/眼点在不在)?人类头身份/神态对不对?埋到下颌 + 看不见脖子 + 轻微后仰成立吗?极光 + 22色冷青蓝影调统一吗,阴影是冷青深色还是死黑?宽银幕 anamorphic + Vision3 500T + skip-bleach 低饱和高对比暗场在不在?

---

## 图型 06 · 角色姿态/表情复刻帧(pose & expression replication frame)

**何时用**:已有一张参考图(角色定妆/某情绪定帧),要把它的表情、姿势、构图整套迁移到目标角色身上时,最轻量的一致性手法——一句中文枚举式"完全复刻参考图的 X / Y / Z"。核心教训:笼统说"复刻表情"基本无效,必须把表情拆成"逐特征点名"(具名情绪 + 五官特征清单)才锁得住。

**命门**:
1. **维度枚举清单,越细迁移越彻底**:基础句 `完全复刻参考图的表情，姿势，构图，比例，画面占比，人物造型和服装参考`——把要迁移的维度逐项列全。漏写的维度模型就自由发挥。
2. **"复刻表情"是空话 → 必须逐特征点名才生效(本图型最大命门)**:把抽象表情拆成具名情绪 + 五官特征清单。如 `完全复刻参考图的无奈流泪欲哭无泪的表情和厚嘴唇和明显的眼白和大黑眼珠子和画风` —— 逐项点名才把表情真正搬过来。
3. **轻量句,不挂胶片/反AI味签名**:本型是最小指令集迁移,风格随参考图走。这也意味着它本身不保证"干净设定图"。

**填空骨架**:
```
模式:图生图(角色/造型参考图 + [可选]第二张构图/表情参考图)
size 1:1 / 中文一句式
用途:轻量一致性迁移 / 情绪关键帧采样

【基础句 — 笼统版(只锁大致一致性,表情会丢细节)】
完全复刻参考图的表情，姿势，构图，比例，画面占比,人物造型和服装参考

【强化句 — 逐特征点名版(表情真要锁就用这条)】
完全复刻参考图的 <具名情绪,如:无奈流泪欲哭无泪> 的表情 和 <五官特征1,如厚嘴唇>
和 <五官特征2,如明显的眼白> 和 <五官特征3,如大黑眼珠子> 和画风,姿势,构图,比例,
画面占比,人物造型和服装参考

【双参考图分工变体(跨画风迁移)】
参考图1 = 固定角色造型/服装;参考图2(构图参考)= 迁移画风 + 姿势 + 构图
→ 维度清单按需增删调迁移松紧(留「画风」=连风格一起搬;删「画风」=只搬姿势表情)
```

**校对清单**:表情真的复刻了吗(笼统写多半只搬到大概情绪→改逐特征点名重跑)?五官特征清单逐项兑现没?姿势/构图/比例/占比/造型服装各维度都搬到了吗?身份是不是目标角色(最大坑:表情搬对了但人没搬对)?有没有连参考图的字幕/梗图/水印一起搬过来?

---

## 图型 07 · 从成图抠主体特写(场景内单人切特写)

**何时用**:已有一张多人/双人成图,想从同一场景里"切"出某个主体的中近景或极特写——景别推近、其余主体去掉、背景沿用同一场景但要真景深而非贴图。极轻量的中文一句话改图,靠底图承载场景 + 参考图锁脸。

**命门**:
1. **显式禁"直接挪用背景" + 要"正确景深变化"**:`场景依旧是<原场景>,但是要有正确的景深变化而不是直接挪用背景`——不写这句模型会偷懒把原背景原样贴上,特写就"贴脸"假。
2. **去元素:点名"画面里不要出现 X 的头"**:从双人切单人,必须明确把另一个主体删掉。
3. **景别越近,越要显式要求"光影与背景完美融合"**:推到极特写(头占 1/2)时加 `人脸的光影应当与背景完美融合`,防"贴脸感"。
4. **构图指令与身份锁定拆两路**:位置/占比用 prompt(`占四分之一、左边三分之一`),脸用参考图;切机器人则不需要锁脸参考图。
5. **迭代靠加参考图、不改 prompt**:要改光只追加一张"光影参考"图来修正照明,文本不动。

**填空骨架**:
```
模式:图生图(成图当底图承场景 + 参考图锁脸)
size 21:9 / quality 1K
中文一句话改图,从成图切单人特写

生成这个场景里的<左/右><主体>的<中近景特写/极特写>,
<主体>的头约占画面<四分之一/二分之一>,位于画面<左/右/中间略偏右><三分之一>的位置。
场景依旧是<原场景一句>,但是要有正确的景深变化而不是直接挪用背景<,人脸的光影应当与背景完美融合>。
画面里不要出现<另一主体>的头。<参考图作为五官的参考。>
（推到极特写再追加"光影应与背景融合";要改光只追加一张光影参考图、原句不动）
```

**校对清单**:背景是"真景深"而非直接贴原图吗(贴图会有抠像感/边缘违和)?另一主体去干净了吗?脸锁住了吗、没串?景别/占比对不对?方位落地了吗(中文占比/方位词响应是系统性弱项,偏差大就重刷)?极特写镜:人脸光影和背景融合了吗(有没有贴脸突兀感)?

---

## 图型 08 · 极限微距叙事帧(extreme macro + 巨物压迫)

**何时用**:用一个微观特写讲一句叙事/埋一个危机——蚂蚁爬睫毛、虫子停在五官上这种 extreme macro,既要昆虫纤毫毕现,又要在虚化的画面边缘藏一个"压迫源"(逼近的靴底)暗示危险。极浅景深的微观尺度,主体是昆虫而非人,人只露一小块(睫毛/眼睑)。

**命门**:
1. **把"巨物尺度压迫"做进微距**:让虚化的靴底 `filling roughly the upper 80 percent of the frame's upper region`——微观尺度里一只靴子就是压顶巨物,以微衬大制造危机感。
2. **三层焦点显式分级**:① 昆虫 = 最锐焦点(`sharply in focus, occupies the visual focal center`);② 睫毛 = 第二层焦点(`slightly soft but readable as individual strands`);③ 靴底/天空/皮肤 = 焦外(`heavily blurred / soft pale-warm bokeh`)。谁实谁虚必须钉死。
3. **双参考图分工 + 逐元素 hex 映射**:色板参考图锁色板(逐元素给 hex)+ 锁脸参考图(本帧只露睫毛/眼睑一小块)。
4. **明写主体的生物解剖真实**:`six legs distinctly visible / segmented body, head, thorax, abdomen, antennae all clearly visible` + 负向 `cartoon ant, stylized ant, oversized ant, fantasy creature`。
5. **"刻意微软"对抗过锐 AI 味**:`This image is a real macro photography still that may appear slightly soft and imperfect — this softness is intentional and desired`。

**填空骨架**:
```
模式:文生图 / 图生图(色板参考图 + 锁脸参考图)
size 16:9 / quality 1K-2K
单段英文,extreme macro 叙事帧,昆虫主体 + 压迫源

A photorealistic extreme macro photography film still captured during a real shoot, 16:9,
ultra close-up extreme macro view of <昆虫主体> crawling across <人体局部:睫毛/眼睑>,
camera <角度,如 to the side, angled slightly upward>,
with <压迫源,如 flat sole of a boot> looming heavily blurred filling roughly the upper 80% of the frame,
and <一小块透气元素,如 sliver of bleached sky in a corner>.
参考图 as master color palette anchor, all colors per this N-color palette. Explicit color mapping: <逐元素 hex>.
参考图 as visual identity anchor for <角色>, only a small portion of the face visible: <睫毛/眼睑>.
The subject is <昆虫> — anatomically realistic, six legs visible, segmented body/head/thorax/antennae sharply in focus.
Second layer of focus: <睫毛> slightly soft but readable. Everything else falls into soft bokeh.
Light: <directly overhead noon sunlight + 逐睫毛/逐腿的 micro-shadows>.
Cinematography: nature-documentary / art-house macro, Villeneuve & Fraser Dune tonality, skip-bleach LUT, film grain.
PHOTOGRAPHIC TONE: real macro still, slightly soft & imperfect (intentional), sharp focus ONLY on the insect.
Avoid: <反AI味通用串> + cartoon ant / stylized ant / oversized ant / multiple ants / facial distortion / eye open 等.
```

**校对清单**:主体(昆虫)是不是全图最锐、占视觉中心(头号失败模式:被压迫源/第二焦点淹没)?三层焦点分级对不对(昆虫最锐/睫毛微软可辨/其余 bokeh)?压迫源够不够大、压迫感出来没(占上方约 80%、重虚化)?昆虫解剖真实吗(六腿/分节体可辨,没画成卡通/超大/一群)?色板逐元素 hex 落地了吗?皮肤是真实毛孔还是塑料磨皮?眼睛是不是闭着?

---

## 图型 09 · 重打光 edit(只改光,不改内容)

**何时用**:已有一张成图,只想换光照/时间/调色,内容/构图/几何一个像素都不能动(把白天金光场景重打成清晨晨光这类需求)。走 `images.edit` 模式(不是 generate),正文是 CHANGE / PRESERVE / CONSTRAINTS 三段式。

**命门**:
1. **三段式职责切死,缺一不可**:CHANGE 只描述目标光的情绪并显式对比掉原光(`NOT the strong warm golden daylight of the original`);PRESERVE 逐项点名绝不能动的实体,精确到 `deep red tents stay deep red, only re-lit`;CONSTRAINTS 封死增删改挪(`Do not add or remove / redesign / reshape / move / change composition / add text`)。
2. **开头声明两张图的职责**:`Image 1: the base scene to relight — preserve all content, geometry and composition. Image 2: color palette reference — use ONLY as the target lighting mood and color grade`(色板图只借调性、不借内容)。
3. **挂 `images.edit` 专属参数 + 漂移自检**:调用 `images.edit`(不是 generate),quality medium / jpeg / Thinking Mode 开;跑完对比原图查建筑/帐篷/人有没有被悄悄改形或挪位。
4. **PRESERVE 可补 + 九宫格特例**:特别在意的元素往 PRESERVE 补;若底图是九宫格,PRESERVE 开头加 `preserve the multi-panel grid layout and the content of every panel` 防分格被重排。

**填空骨架**:
```
模式:images.edit(不是 generate!)
quality medium · jpeg · Thinking Mode 开
用途:只改光/时间/调色,内容几何构图一像素不动

[EDIT 模式 · 只改光线]
Image 1: the base scene to relight — preserve all of its content, geometry and composition.
Image 2: color palette reference — use ONLY as the target <目标光> mood and color grade.
--- CHANGE — Change ONLY the lighting, time of day, and overall color grade of Image 1.
<目标光描述:时间/太阳角度/长软影/雾感浮尘/目标色调> — NOT <原光,显式对比掉>.
--- PRESERVE (exactly, no change) — <逐项点名:构图/机位、每栋建筑岩窟、每顶帐篷含其底色(__ stay __, only re-lit)、每个人/物/道具的位置与形态、所有几何透视与细节纹理、整体布局>. Only the light may change.
--- CONSTRAINTS — Do not add or remove any object/person/structure/detail. Do not redesign/reshape/move anything. Do not change composition/framing/crop/layout. Do not add text/label/watermark. Change nothing except lighting, shadow, time-of-day, and color grade.
--- 【参数】images.edit · quality medium · jpeg · Thinking Mode 开
【提醒】PRESERVE 是核心,绝不能动的元素往里补;九宫格底图加 "preserve the multi-panel grid layout and the content of every panel";跑完对比原图查有没有被悄悄改形/挪位。
```

**校对清单**:内容有没有被悄悄改(逐项对比原图:建筑/帐篷/人/道具的位置与形态)?构图/机位/裁切一像素没动?目标光对不对(晨光低角度侧光/长软影/雾感浮尘/skip-bleach 暖灰)?原光被替换掉了吗(CHANGE 里的 NOT 对比生效没)?PRESERVE 里点名的底色守住了吗?有没有多/少东西、有没有乱加文字?用的是 `images.edit` 而不是 generate 吗?
