# 手艺全集(craft library)

> 引擎调你来挖某一项细节时读这里;也可出图前整体过一遍。
> 本文覆盖 §八.1~§八.14(手艺全集)+ §八·进阶.1~§八·进阶.10(进阶补遗)。

## 目录

- [八.1 六段式骨架细则](#八1-六段式骨架细则)
- [八.2 双寄存器 + 模型分工(改图模板)](#八2-双寄存器--模型分工改图模板)
- [八.3 参考图锁定 + 多角色防串脸](#八3-参考图锁定--多角色防串脸)
- [八.4 颜色锁成系统(双区分轴)](#八4-颜色锁成系统双区分轴)
- [八.5 高度/位置用构图关系(别用米数)](#八5-高度位置用构图关系别用米数)
- [八.6 特效质感正负词库](#八6-特效质感正负词库)
- [八.7 粒子感 ≠ 整图噪点](#八7-粒子感--整图噪点)
- [八.8 清爽明亮调 vs 压抑调](#八8-清爽明亮调-vs-压抑调)
- [八.8.1 角色帧必有光影立体感 + 大光圈背景虚化](#八81-角色帧必有光影立体感--大光圈背景虚化每条角色-prompt-都写)
- [八.9 反 AI 味词库 + 电影感签名块](#八9-反-ai-味词库--电影感签名块)
- [八.10 资产设定图(四视图/比例尺/灰底物料)](#八10-资产设定图四视图比例尺灰底物料)
- [八.11 二次优化治糊(升清晰度 + 高清重制)](#八11-二次优化治糊升清晰度--高清重制)
- [八.12 数量弱项 + 九宫格边界 + 高风险特征必出 SOP](#八12-数量弱项--九宫格边界--高风险特征必出-sop)
- [八.13 角色关系驱动姿态/demeanor](#八13-角色关系驱动姿态demeanor)
- [八.14 prompt 精简原则(短优于长 / 朴素优于术语)](#八14-prompt-精简原则短优于长--朴素优于术语)
- [进阶.1 API 参数建议(完整段)](#进阶1-api-参数建议完整段)
- [进阶.2 hex 色板全档(强度递增 6 级)](#进阶2-hex-色板全档强度递增-6-级)
- [进阶.3 DP 三位调性表 + 两条显影链](#进阶3-dp-三位调性表--两条显影链)
- [进阶.4 题材级负向 Avoid(定制点名,不抄通用)](#进阶4-题材级负向-avoid定制点名不抄通用)
- [进阶.5 参考图风格冲突会整批塌方](#进阶5-参考图风格冲突会整批塌方)
- [进阶.6 三大原理 + 资产收敛链 5 步](#进阶6-三大原理--资产收敛链-5-步)
- [进阶.7 多动作叠加衰减(一次只压一个主动作)](#进阶7-多动作叠加衰减一次只压一个主动作)
- [进阶.8 "softness is intentional and desired" 锚点](#进阶8-softness-is-intentional-and-desired-锚点)
- [进阶.9 CONSTRAINTS 三种否定句式](#进阶9-constraints-三种否定句式)
- [进阶.10 渲染精确 HEX/文字不可靠](#进阶10-渲染精确-hex文字不可靠)

---

## 八.1 六段式骨架细则

- **【参考图标注】**——给每张参考图分**唯一职责** + **排他声明**。一图一职:构图图只管站位、角色图只管某人样貌、色卡图只管调色、场景图只管背景。排他声明("仅作为…""不提供…")是分工真正生效的关键:它不仅说"你管这个",还说"你别管那个"。凡没分配的维度,模型一定自作主张。
- **[主体]**——一句话:景别 + 机位/视角 + 谁在哪做什么 + 环境。位置/高度用构图关系(§八.5)。
- **[特效层]**——参考图里没有、全靠文字堆的东西。颜色 + 质感(§八.6)+ 体量。多角色逐个写,**显式写颜色/形态对比**。
- **【锁定】**——内部分两层:**保留 PRESERVE**(身份/影调/构图等不变量)+ **硬约束 CONSTRAINTS**(逻辑/形态/数量禁令)。⚠ 形态锁·数量锁·NO-FACE 必须进 CONSTRAINTS,不能塞进 TONE/Avoid。**表情这一维:别写"复刻表情",写具名特征**(厚唇/眼白/挑眉/眯眼)。
- **【PHOTOGRAPHIC TONE】**——基调 + 天空 + 光 + 调色板 + 清晰度质感。**含角色帧必有光影立体感 + 大光圈虚化**(§八.8.1),朴素一句,别堆术语。
- **【Avoid】**——结果导向写负向("确保画面里没有任何刀"比"删掉那把刀"扫得全)。

---

## 八.2 双寄存器 + 模型分工(改图模板)

- **重型英文 prompt = 建**(图生图,出场景/关键帧/定调)→ **Neo Image 2**。
- **中文一句话 = 改**(在现成图上迭代微调)→ **Neo Nano Pro**。

**改图中文模板(三种重量)**:
- 轻量锁:`不改变[五官]和[发型]和[光线]和[调色]和[构图],让<改动项>。`
- 单点定向 + 兜底:`<改一处>。其他不作任何改动。`(最安全)
- 方位定向:`修改右下角的<X>,改成<Y>,除此之外不要做任何改动。`

**7 类高频微调动作**(中文一句话,均配"其余不变"):

| 动作 | 中文模板 |
|---|---|
| 镜头远近 | `把镜头拉远/推近一点,其余不变。` |
| 居中/构图 | `把人物居中(或挪到左/右),其余不变。` |
| 景别 | `从全身改成半身特写(或反之),其余不变。` |
| 表情 | `表情改成<具名特征:眯眼/挑眉/厚唇>,其余不变。` |
| 材质改写 | `把<部件>材质改成<X>,结构不变,其余不变。` |
| 去元素 | `去掉<X>,改成<替代状态>,其余不变。` |
| 换元素 | `把<A>换成<B>(双@:@基底 @样式来源),其余不变。` |

两条规则:**删元素必给替代状态**(去丝袜→"光脚",别只说"去掉");**改动必给物理因果**(湿身→"衣袖紧贴皮肤"),否则模型把反常理细节"合理化"抹平。

**何时"接着微调" vs "重起重型"**:只动 1 个变量、底图基本满意 → 微调。要同时改 ≥3 件事 / 换姿态 / 换结构 / 换机位 / 连续微调后开始熔脸串身份 → 停手,回 Image 2 重起。

---

## 八.3 参考图锁定 + 多角色防串脸

核心:**创作权在文本和参考图间显式分配。文本只锁"什么不变/改哪里/放在哪",内容外包给参考图。** 没显式分配的维度必漂。

- **一图一职 + 排他声明**。
- **位置用图像坐标**:需要精确站位时,在构图参考图上打点(白点)+ 文字"标记 = 谁的落点" + 补"其余区域填什么"。
- **位置 ≠ 身份**:打点只锁"在哪",身份得另靠角色参考图 + 排他声明咬死。

**多角色防串脸三件套**(多角色最易身份贴反):
1. 逐张角色参考图**排他 + 绑画面位置**:`Image 1 对应画面左上方的男人 / Image 2 对应画面右下方的女人`。
2. 锁定段写`不要两人互相串脸`。
3. Avoid 写 `the two faces swapped or merged`。

出图后逐个核身份;串了就加强方位绑定或用打点。

---

## 八.4 颜色锁成系统(双区分轴)

颜色一旦开工就**锁死成系统**,不许逐张漂。多方对垒靠**两根轴**拉开:

- **轴一·色相/饱和度**:每方一个固定色。相邻色(都偏蓝)就拉开饱和度(一方饱和青蓝、一方淡白)。
- **轴二·形态/质地**(比颜色更强):软流动粒子 vs 硬结晶尖锐;气态 vs 固态。即便都偏蓝白,"软的在翻卷 / 硬的在立墙"一眼能分。

**做法**:开工前先定一张"色卡"(每个角色/能力 = 颜色 + 形态),写进项目档案,每镜照搬。**适度重复=注意力强化**:同一条配色/形态铁律,要在 **[特效层](正面)+【锁定】(禁令)+【Avoid】(负向)三处各说一遍**。某镜配色漂掉,多半是只写了一处。

---

## 八.5 高度/位置用构图关系(别用米数)

模型对"飞 10 米"锚不住。**把"高"翻译成空间关系**:

- 楼顶/地面在**他脚下**、压到画面**下方一条**、又小又远。
- 脚和楼顶之间留**一大段空旷天空**(空气间隙)。
- 他在画面**上半部、四周是天空**。
- **低角度仰拍**(从下往上看他、背景是天)→ 读作"高",又不变成俯瞰地图。

"再高一点"给可对照量 + 锁机位:`离地约 10 米出头 + 保持平视/仰拍 + 绝不要鸟瞰`。"凌空"要写`脚不沾任何东西 / NOT on any surface`。

---

## 八.6 特效质感正负词库

**正向(要)**:translucent, semi-transparent, airy, open with clear GAPS, see-through (sky visible through it), particulate, made of fine particles / dust motes / glowing specks, soft flowing ribbons, luminous from within, light passing through, energetic.

**负向(避,放 Avoid)**:dense opaque wall, solid glass tube, dense water rope, smooth solid ribbons, thin weak wisps / faint, neon glowing tube, plastic / CGI / video-game look, muddy.

**两个平衡**:① 又要"加足"又要"通透":`HUGE/voluminous/intense/wide-coverage/packed with particles` + 同时 `OPEN/AIRY/GAPS/translucent`。② "密不透风"的解法 = 拉开间隙 + 降密度 + 能透过看到背景,**不是**减少风量。

---

## 八.7 粒子感 ≠ 整图噪点

两件事,别混:

- **整图胶片颗粒/噪点(film grain / photo noise)**:一层噪点铺满全图——多数不要,删词即走。
- **特效里的粒子感**:风/能量**本身**由无数细小尘埃/光点构成——要。

prompt 里**分作用域写**:TONE 段 `the overall PHOTO is clean/sharp, NO film grain, no photo noise`;特效层段 `the WIND is particulate, full of fine swirling particles`;并加 `(the particles belong to the WIND only, not a grain layer over the image)`。

---

## 八.8 清爽明亮调 vs 压抑调

调子是基调级决策,先定再出图。

- **清爽明亮**(蓝天/通透/干净):**删** `Dune 2021 / skip-bleach LUT / film grain / dust haze`。**改** `bright clean fresh daylight + clear/soft light-blue sky + white clouds + high clarity + shallow DoF`。冷特效靠 **teal-orange 互补**(暖背景 vs 冷特效)。蓝天别过饱和(`not over-saturated`)。
- **压抑/末世**(沙尘/冷峻):才用 `Dune aesthetic + Kodak Vision3 500T + skip-bleach + analog grain + dusty haze + desaturated`。

特效冷色在清爽蓝天下要够亮(`bright luminous`)才不被天空吃掉。

---

## 八.8.1 角色帧必有光影立体感 + 大光圈背景虚化(每条角色 prompt 都写)

**铁律**:角色帧(特写/中景/越肩/全身/双人/多格分镜板)的【TONE】段必须钉死 **4 件**:**光从哪儿来 / 哪半脸亮哪半脸暗 / 哪儿有暖高光点 / 背景大光圈虚化**。只写"暖光/candlelit"等基调词 = 平光 + 背景清晰抢戏 = 像定妆照不像电影帧。

**用人话写朴素一句**(直接抄改):
```
Warm light from camera-right. Right half of her face brightly lit, left half in warm shadow.
Highlights on cheekbone, nose bridge, lips, collarbone. Shallow DoF, wide aperture, background
heavily out of focus.
```
4 件分别钉:① **光从哪儿来**(`from camera-right` 等,必指方向);② **半脸光**(哪半亮哪半暗,暗部加 `warm shadow, not crushed black`);③ **高光点**(`highlights on cheekbone, nose bridge, lips, collarbone`,点具体位置);④ **大光圈虚化**(`shallow DoF / wide aperture / background heavily out of focus`,**别堆术语**)。

**例外**:四视图定妆(摄影棚中性底)、色卡、灰底物料 → 不需要。**凡有角色 + 真实场景背景都要大光圈虚化。** 光影 + 虚化段合计 ≤ 80 词,超了就剪。

---

## 八.9 反 AI 味词库 + 电影感签名块

**反 AI 味结尾(Avoid 常驻)**:overpolished studio look, plastic smoothing skin, oversaturation of non-red elements, glossy highlight blowout, generic AI image quality, HDR glow, doll-like skin, 3D rendered look, cartoon / anime / video-game render。

**电影感"签名块"**(口诀:**摆→色→谁拍→拿啥拍→封口**):构图流派 + hex 色板 + DP 摄影师署名(`Greig Fraser Dune 2021` 这种"DP+代表作+年代"比单写人名稳)+ 胶片型号/画幅 + 反 AI 味封口。五个锚点指向同一种真实成像物理,互相纠偏。DP 署名要和胶片/画幅自洽(写 Deakins 冷峻就别叠高饱和 HDR)。清爽调时整套签名按 §八.8 减负。

---

## 八.10 资产设定图(四视图/比例尺/灰底物料)

- **正交无畸变**(`orthographic, no perspective distortion`),戏剧透视留给海报——两者互斥。
- **四视图/多视图**:整张当不可分割底图,一次只叠**单一变量** + 保留清单。逐格塞多项不同指派模型吃不全。
- **比例尺**控体量:放人形剪影/等高武器/多物种条当"参照锚",把"多大"从形容词降维成图内可对照量。
- **灰底物料图**:`单独抠出<X>放灰底,干净可复用,no environment`。
- **缺全身只有半身肖像** → 先出一张全身/四视图设定图当复用基准,再做动作镜头,否则下半身漂。

---

## 八.11 二次优化治糊(升清晰度 + 高清重制)

"噪点多/糊/脏"多数是分辨率不够,不是真噪点。

- **第一招·升清晰度**:size 拉到 2K/4K。细节越密(多格/小标签/hex 码),size 越大。
- **第二招·高清重制**:把已出好的图喂回去当底图,中文只下 `重绘 + 高清重制 + 真人电影质感,去掉噪点和颗粒。严格保持人物/脸/姿态/构图/配色/特效全部不变,只提升画质。` + 升 size。
- **配锁定防漂**:升质=重绘=会顺手重新创作,二次优化句**必须带"保持…全部不变"**;只改局部就用方位词框死。

---

## 八.12 数量弱项 + 九宫格边界 + 高风险特征必出 SOP

- **硬数量是 Neo Image 2 死穴**:"九套/3×3/N 个不同"连跑两次都不准,靠"逐格点名 + 多跑筛"。
- **九宫格只适合"同主体多视图"**(四视图/turnaround/同角色多表情)。**不适合"多个完全不同的镜头"**(每格不同机位/动作/角色 → 数量翻车 + 逐格指派吃不全 + 每格只剩 1/9 分辨率)。多分镜 → **一镜一出**。
- **高风险特征"必出" SOP**:① 把关键形态特征前置标 `if missing the design fails`;② 预想它最可能翻成什么,写"失败模式 → 补救句"映射;③ 出图后逐项对账;④ 没到位就**真重跑 + 追加补救句**,别凑合。形态/特征值得这套对账;表情/画风靠具名特征 + 多跑筛。

---

## 八.13 角色关系驱动姿态/demeanor

姿态和特效不是孤立美术,是**人物关系的外化**。先想清谁强谁弱、谁主动谁被动:

- **真正的强者:平静、从容、甚至零特效**(强到不需要展示力量)。
- **弱/急的一方:张扬、用力、满身特效**(越使劲越显被压制)。
- 关系定了要**全片一致**,别中途反过来。
- **多人同框:把"关系"翻译成具体 blocking 并写死**。落到"谁坐/卧/倚/立、谁高谁低、谁俯视谁仰视、谁的目光锁在谁脸上"。**漏写体位 → 模型默认全员站立齐高;只写"看向某方向" → 望向虚空而非看人**。双方体位 + 相对高度 + 视线锁定到对方脸,按 正向 + CONSTRAINTS + Avoid 三处复写。

---

## 八.14 prompt 精简原则(短优于长 / 朴素优于术语)

给 AI 读的 prompt **适度重复 = 注意力强化**(同一硬铁律三处复写=加权),但**术语堆叠 ≠ 重复 = 稀释**。把"工程化分项 / 学术英文 / 元指令大段"换成朴素直白的人话,模型反而更服帖。

**5 类常见过度复杂(每写完一稿逐项自查)**:
1. **术语堆叠 vs 朴素一句**:光影别写 `★1/3 warm DIRECTIONAL key light at ~45°...★2/3 chiaroscuro...`,写 `Warm light from camera-right. Right half lit, left half in warm shadow.`。复杂构图时模型注意力被构图段吃掉,长光影段权重稀释。
2. **"族"标签分组 Avoid vs 平铺**:别写 `★(锚点漂移族)...★(视线漂移族)...`,直接平铺 6-12 条核心禁令,无标签。
3. **★★★ 大块开头声明 vs 一行点题**:别在开头堆 4-6 行 `THIS IS X NOT Y ABOVE ALL`,压成一行 + 把强调挪到 CONSTRAINTS。
4. **每张 ref 都长 disclaim vs 只对易漂处**:只对真正易漂的那张写长 disclaim,其他简单一句。
5. **HEX 色板大全堆叠 vs 沿用色卡一句**:第一帧定色卡后,后续仅 `warm crimson-gold per established color bible`,别每帧抄一遍 HEX 全表。

**总字数目标**:复杂帧 ≤ 500 词;简单帧 ≤ 350 词。超了回头剪。**适度重复 ≠ 啰嗦**:三处复写是把同一条信息加权;本节反对的是把一条信息用术语堆叠展开成 5 行。

---

# 进阶补遗(写重型 prompt / 调色板 / 排查翻车时查)

## 进阶.1 API 参数建议(完整段)

`size/quality/output_format` 是"配置即文档"——让 prompt 离开作者也能原样复跑。模板:
```
【API 参数建议】
model: gpt-image-2
[EDIT 类任务(在已有图上改光/改局部)注明:调用 images.edit,不是 generate]
size: [按细节密度给]   quality: medium   output_format: jpeg
Thinking Mode: 开启(复杂合成/多约束/多角色时)
参考图:Image 1 = [职责]   Image 2 = [职责]
【提醒】Preserve list 是核心;若是九宫格,在 PRESERVE 开头加 "preserve the multi-panel grid layout and the content of every panel"。
```
- **images.edit vs generate**:在现成图上改走 `images.edit`;从零建场走 `generate`。建改不分是双寄存器翻车根因。
- **output_format**:成片/物料一律 `jpeg`;要透明底/无损叠层才 `png`。
- **size 按细节密度**:单帧 1K~2K;**九宫格/多视图/群像站位图必须上 1536 长边或 2K+**,否则每格细节糊。
- **quality**:`medium` 是默认甜点;`high` 留最终交付。

---

## 进阶.2 hex 色板全档(强度递增 6 级)

"暖色调"模型有一百种解读,`#A82A2A` 是唯一解。按图值不值得越往下用得越重:

1. **逐元素 hex(嵌进描述)**:`cinnabar red #A82A2A talisman strips`。
2. **整段 color bible(13~22 色)**:TONE 之前列命名色板,每色"功能命名 + HEX":
   ```
   COLOR PALETTE (lock exactly): hot sunlight #F4E6C8, sand midtone #A89472,
   hard shadow #6B5A47, cinnabar accent #A82A2A (sole saturated focal color).
   All other colors restrained, desaturated, within this palette.
   ```
3. **60-30-10 三色英雄律 + 可数约束**:写成可数——`10% 点缀色 appearing at EXACTLY 4 named spots — no more than 4 accent points anywhere`。
4. **Mondrian 计数法**:同尺寸物靠**数量**做色块平衡(`a larger block = cluster of 5-6 identical items`)。
5. **甜区 13~22 色**:太少(<8)锁不住;太多(>25)模型记不住。
6. **黑白片仍给彩色色卡 + 转灰阶层级**:`render as black-and-white but preserve tonal hierarchy(红→中深灰、黑保深、白保亮)`。

> 色板条放在 TONE / 显影链**之前**(先定颜色,再定胶片质感)。

---

## 进阶.3 DP 三位调性表 + 两条显影链

写一个 DP 名 ≈ 一次下达几十条打光/构图/色彩指令的压缩包;胶片型号是比 DP 名更硬的物理锚点。

| DP 署名 | 调出什么 |
|---|---|
| **Greig Fraser**(Dune 2021) | 暖沙金褐、火光内景、低反差柔散光、"被沙漠晒过"质感 |
| **Roger Deakins** | 极简、冷峻、史诗孤独感、大 negative space、硬朗光比、克制色彩 |
| **Hoyte van Hoytema** | 大画幅 IMAX 质感、冷蓝夜景、暗部仍有色彩深度 |

三个名字**可叠用**做"调性配方"。两条显影链(抄走):
```
// 彩色日/夜景显影链(低饱和高对比、跳漂白苍茫硬调)
35mm Kodak Vision3 500T film stock with skip-bleach negative LUT,
analog photochemical grain, single still frame from a feature film.

// 黑白武戏显影链(真实黑白片基灰阶)
Kodak Double-X 5222 black-and-white film stock aesthetic. Anamorphic widescreen lens.
Subtle organic film grain only. Colors restrained, slight gray tone.
```
坑:① 优先用"DP + 公认代表作 + 时间";② DP 署名要和胶片/画幅风格自洽;③ `analog grain` 要配 `Avoid: heavy digital grain`;④ skip-bleach 去饱和会一起吃掉焦点色(焦点色要 `sole saturated / glowing` 显式拔高)。

---

## 进阶.4 题材级负向 Avoid(定制点名,不抄通用)

通用反 AI 味词库防"渲染质感";但模型对每个**题材**有专属俗气模板偏置。出图前问一句"这个题材模型最爱套哪几种俗气模板?"逐个 Avoid 掉。

- **沙漠航拍** → 排 `drone shot of modern desert resort, Burning Man aesthetic, desert wedding, modern military bivouac`。
- **弓箭手** → 排 `fantasy elf archer, 日式弓道家`。

句式贴在通用反 AI 味词库之后。负词不点名 = 不设防(但只是降概率,不是开关)。迁移到新项目时这一档**最需要重写**。

---

## 进阶.5 参考图风格冲突会整批塌方

同一职责喂进**互斥风格**的源(写实真人 vs 卡通),模型整批塌方——连续多条系统性崩,不是偶发。**别在文本上硬磨、别删画风字**(删画风反而放大塌方)——回去换一套**自洽的参考图**重建。根因在输入端(参考图互斥),加禁令/删词都是打补丁治不了上游。

---

## 进阶.6 三大原理 + 资产收敛链 5 步

**三大原理**(双寄存器底层):
1. **滑块原理**:图生图每次在"照抄输入↔自由发挥"间选点,重型 prompt 推向"按我说的造",轻型推向"基本照抄、只动点名处"。建用轻型句 / 改用重型句 = 推错方向。
2. **信息密度 = 可控度**(建必须重):设定表要同时锁解剖/版式/布光/材质/色板/比例尺,没一项能靠"一句话+一张图"。
3. **最小破坏**(改必须轻):图已满意时,prompt 写越多越可能"顺手"重画没让动的地方。

**资产收敛链 5 步(建一次,改十次)**:
```
①重型建参考图 → ②重型建设定表/关键帧 → ③轻型修画质 → ④轻型改单变量 → ⑤轻型清理
```
一旦重型把"身份+形态+比例"钉死,后续全是中文一句话微调。第一步判错"建还是改"是最大时间黑洞。

---

## 进阶.7 多动作叠加衰减(一次只压一个主动作)

叠 ≥3 个微动作做复合情绪,会**衰减**成中性结果,加参考图也救不回。**正解**:一次只压一个主动作/主情绪;表情维度优先靠"表情参考图 + 逐特征点名"(`复刻无奈流泪欲哭无泪的表情和厚嘴唇和明显的眼白和大黑眼珠子`——逐特征点名才奏效,抽象动词"复刻表情"无效)。

---

## 进阶.8 "softness is intentional and desired" 锚点

写 `slightly soft / film-like softness` 时,模型默认会把"soft"当缺陷反手锐化掉。加一句"这柔是故意的、想要的",模型才肯当目标:
```
PHOTOGRAPHIC TONE: this image is a film still ... that may appear slightly soft
and imperfect, like a real photograph — this softness is intentional and desired.
```
只对"刻意柔焦"题材有用;要平面矢量色板/标题卡(本就要 tack-sharp)时**别加**。

---

## 进阶.9 CONSTRAINTS 三种否定句式

CONSTRAINTS 管"叙事/逻辑/物理绝对不能发生的事"(≠ Avoid 管渲染 AI 味)。按纠偏类型用三种句式:

| 句式 | 管什么 | 例 |
|---|---|---|
| **NEVER** | 绝不出现(尺度/逻辑铁律) | `The whole dragon must NEVER be fully visible — only a fragment.` |
| **Do not** | 禁止操作(形态锁/NO-FACE/数量锁) | `Do not show any human facial features — the entire face is and must remain the black LED panel.` |
| **NOT...but...** | 程度纠偏(别走极端) | `Half-ruined, NOT flattened — must still be recognizable.` |

逻辑/形态/数量禁令进 CONSTRAINTS;渲染 AI 味进 Avoid。放错块权重不够会翻车。

---

## 进阶.10 渲染精确 HEX/文字不可靠

让模型把**精确 HEX 码 / 长串精确文字**当像素渲染进图里(色卡卡片、设计稿上的码与标签),文字与色块数量大概率错排。**铁律:以 prompt 里写死的码为准,不要回读出图核对。** prompt 写了 `#A82A2A`,这张图的"真值"就是 `#A82A2A`,哪怕出图上印的是别的码也别据图修正——错的是渲染,不是你的码。
