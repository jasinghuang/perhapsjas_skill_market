// 主题效果页（M2b 验收用；dev-only，不入章节层）。
// ?showcase=1 渲染：25 屏 1920×1080 slide deck——每屏带统一 chrome frame
// （topbar 48px/64px + 内容带 96px gutter、垂直 y 112–934 + 字幕保留区 y[958,1038]；meta 页码条已删）。
// 构图纪律（用户反馈终审）：十五轮 F3 定稿 10 屏 + 十八轮新增 4 屏（外挂模板构图灵感，本主题 token/组件渲染）+
// 二十三轮新增 6 屏（财报解读系列，真实年报数据）→ 二十四轮（M2b showcase refine）：
// 删财报封面（用户拍板复用 S1 封面排版）、S15 KEY METRICS 改 S3 同构 2×2 统计格、A股涨橙跌绿语义落地、
// 新增 6 创意屏（A 菜单 / B 海报 / C 终端 / D 路线图 / E 墨底 / F 简报）——共 25 屏，序号连续 1-25。
// 二十五轮（视觉终审）：S11 海报重设为信息流五段式（Kicker 眉标 + display-1 双行大标题单强调色 + hairline/lede
// + 底部 mono 注 + 徽章弱化为 NO.01，删四行逐词堆叠）；S14 路线图下移（节点行中心 ≈ y480）；
// S19 简报标题行净空 + 阶梯卡组收编 StepStairs（左高右低 24px 步进、墨/cream 交替）；
// S3/S20 统计格收编 StatCell（delta 右置头行、up 橙 down 绿）；SplitCompare 中分界 3px→4px。
// S1=参考 s1 封面 / S2=参考 s2 章节开篇 / S3=参考 s3 数据屏（2×2 满幅零阴影网格）/ S4=参考 s4 系统示意（StackedBlocks 组件）/
// S5=参考 s5 柱状图（4 行横向条）/ S6=参考 s6 流程屏（4 步卡 + dashed 线，箭头已按用户拍板删除）/
// S7=参考 s7 对比屏（彩色列表格，徽章已按用户拍板删除）/ S8=媒体 3:4 素材（用户点名竖屏占位）/
// S9=动效实验室（全部动效词汇）/
// S10=新屏 A 内容菜单（supper-club 菜单排版：mono 编号 + 条目 + 虚线引导 + 价格式数值）/
// S11=新屏 B 海报宣言（bold-poster 信息流五段式——二十五轮 F1 重设：Kicker 眉标 + display-1 双行单强调色 + hairline/lede + mono 注 + NO.01 徽章）/ S12=新屏 C 复古终端（窗口面板 + TypedTerminal + 状态行 + 网格底）/
// S13=参考 scatterbrain s1 便签墙（5 便签微旋转 + 图钉 + 底部 mono 注）/
// S14=新屏 D 路线图（pin-and-paper：图钉 + CSS 虚线串联 5 节点药丸；二十五轮 F3 下移——节点行中心 ≈ y480）/ S15=参考 sakura-chroma s3/s7 规格清单（产品图 + SC-01 + 6 行规格 JIS 勾选框 + 底部 ledger 表）/
// S16=参考 editorial-forest s5/s7 季度回顾（图例 + 4 行成对横条 + KPI 大数字行）/
// S17=参考 scatterbrain s9 Before/After（左右分屏 + 中缝 VS 圆章）/
// S18=新屏 E 墨底大字（整屏反色 surface-3 + cream 标语 + 单强调色条）/ S19=新屏 F 研究简报（cobalt-grid 网格底 + StepStairs 阶梯卡组 + FIG 注；二十五轮 F4 标题行净空 + 卡组下移）/
// S20=核心指标（S3 同构 2×2 统计格：角标/数字/标签/描述四件套 + 涨跌标签橙字——A股红涨语义）/
// S21=参考 emerald-editorial s5 双年对比（双色柱组 + y 轴刻度 + 图例）/ S22=业务分部（分类条形逐类一色——季度规则复用）/
// S23=资产负债表速览（结构条 84/16 两段 + 三数字）/ S24=参考 monochrome s6 年度亮点（有序列表 + 页边注窄栏）/
// S25=参考 s8 收尾屏（绿底 + stamp 标题 + 印章 25/25）。
// 用色语义规则（二十四轮入册，控制器同步设计文档 §12）：财报/金融数据语义色——上涨 = 红色系
// （本主题 accent-3 橙 #E85A1F）、下跌 = 绿色系（accent-1）；delta 标签 / KPI 附注统一按此（涨橙/跌绿），
// 系列色（年份柱/分类条）非涨跌语义不受影响。
// 安全框规格（用户终审裁定）：① chrome 元素水平距边缘 ≥64px；② 内容元素落在内容带内
// （底边 ≤934 = 字幕区上缘 958 − 24；24px 阴影落点亦算占位，不越界）；③ 氛围背景层与 CaptionLayer 自身豁免。
// ?showcase=1&guides=1 叠加安全框参考线（96 内容带 + 64 chrome 带 + 字幕区 958 线，pointerEvents none）。
// 严守用色纪律（每屏 2-3 个强调色）；舞台尺寸 / chrome frame / 印章等 dev 工具页家具用 inline style；
// 场景内构图与配色走组件 + token，需要局部配色时用 scope() 注入 CSS 自定义属性（token 覆写，不改组件本体）。
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPrimitive } from "./components/factory";
import { CaptionLayer } from "./engine/CaptionLayer";
import {
  BarGrow,
  BodyCopy,
  Breathe,
  Card,
  Counter,
  DecorBar,
  DecorDot,
  DonutMeter,
  Figure,
  Grid,
  HeroNumber,
  HeroTitle,
  KenBurns,
  Kicker,
  MarkerBlock,
  NumberPill,
  PathDraw,
  ProgressDots,
  QuoteBlock,
  Rule,
  SeededParticles,
  SplitCompare,
  StackedBlocks,
  StagePad,
  StatCell,
  StepStairs,
  Table,
  TimelineTrack,
  TypedTerminal,
} from "./components";

/** 局部 token 覆写：向子树注入 CSS 自定义属性（dev 页合法手段，不改组件本体） */
const scope = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties;

/** 含中文的 mono 文案字体栈：拉丁走 JetBrains Mono，CJK 落 Noto Sans SC（避免 generic monospace 抢先命中） */
const MONO_CN = '"JetBrains Mono", "Noto Sans SC", "SF Mono", monospace';

/** 24px 双层硬阴影（featured 专用；offset 色按屏纪律选） */
const SHADOW_ORANGE = "24px 24px 0 var(--accent-3), 24px 24px 0 4px var(--surface-3)";
const SHADOW_PINK = "24px 24px 0 var(--accent-2), 24px 24px 0 4px var(--surface-3)";

/** 展示页 stagger 行（十二轮 F3）：factory 原语 stagger 对直接子元素逐个错峰 reveal（铁律 5 语义） */
const StaggerRow = createPrimitive("showcase-stagger-row", {
  tag: "div",
  variants: ["default"],
  defaultVariant: "default",
});

/** dev 页结构性微调（零颜色，仅尺寸/字体）；自含 <style>，不入组件 CSS */
const SHOWCASE_TWEAKS = `
.sg-compare-table { height: 100%; }
.sg-compare-table thead th { height: 96px; }
.sg-compare-table thead th:first-child, .sg-compare-table tbody td:first-child { width: 30%; }
.sg-compare-table tbody td:first-child { background: var(--surface); font-weight: 700; }
.sg-bar-rows .cdp-bar-grow { height: 56px; }
/* S17 分部条：56px 行高（同 S5 季度条节奏） */
.sg-seg-rows .cdp-bar-grow { height: 56px; }
/* S12 成对横条：48px 行高（同列双条同高——审计断言依据） */
.sg-yoy-rows .cdp-bar-grow { height: 48px; }
/* S11 ledger 表：mono 数据风格 + 紧凑行高 + 首/末列定宽 */
.sg-spec-table tbody td { font-family: var(--font-mono); font-size: var(--t-label); }
.sg-spec-table th, .sg-spec-table td { padding: 4px var(--space-3); }
.sg-spec-table thead th:first-child, .sg-spec-table tbody td:first-child { width: 120px; }
.sg-spec-table thead th:last-child, .sg-spec-table tbody td:last-child { width: 120px; }
`;

/* ── 安全框可视化（?showcase=1&guides=1 dev-only） ── */

/** 模块加载时读一次查询参数（与 main.tsx 的 showcase 短路同级，dev 页专用） */
const GUIDES_ON = new URLSearchParams(window.location.search).has("guides");

/**
 * 安全框参考线：96px 内容带（x 96/1824 · y 112/934）+ 字幕保留区线 958（CAPTION）+ 64px chrome 带（x 64/1856 · topbar 48）。
 * 纯视觉叠加层：pointerEvents none，不参与布局、不遮挡交互。
 */
function SafetyGuides({ color }: { color: string }) {
  if (!GUIDES_ON) return null;
  const line: CSSProperties = { position: "absolute", pointerEvents: "none" };
  const label: CSSProperties = {
    position: "absolute",
    fontFamily: "var(--font-mono)",
    fontSize: 16,
    lineHeight: 1,
    color,
    pointerEvents: "none",
    whiteSpace: "nowrap",
  };
  return (
    <div data-testid="safety-guides" style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none" }}>
      {/* chrome 带 64：两侧竖线 + topbar 上沿线（meta 页码条已删除，底部归字幕保留区） */}
      <div style={{ ...line, top: 0, bottom: 0, left: 64, borderLeft: `2px dashed ${color}` }} />
      <div style={{ ...line, top: 0, bottom: 0, right: 64, borderRight: `2px dashed ${color}` }} />
      <div style={{ ...line, top: 48, left: 64, right: 64, borderTop: `2px dashed ${color}` }} />
      {/* 内容带 96：两侧竖线 + 顶 112 / 底 934 限位线 + 字幕保留区 958（字幕区上缘 958 − 24 = 内容底 934） */}
      <div style={{ ...line, top: 0, bottom: 0, left: 96, borderLeft: `2px dashed ${color}` }} />
      <div style={{ ...line, top: 0, bottom: 0, right: 96, borderRight: `2px dashed ${color}` }} />
      <div style={{ ...line, top: 112, left: 96, right: 96, borderTop: `2px dashed ${color}` }} />
      <div style={{ ...line, bottom: 118, left: 96, right: 96, borderTop: `2px dashed ${color}` }} />
      <div style={{ ...line, bottom: 142, left: 96, right: 96, borderTop: `2px dashed ${color}` }} />
      {/* mono 小标注 */}
      <span style={{ ...label, top: 8, left: 68 }}>CHROME 64</span>
      <span style={{ ...label, top: 8, left: 252 }}>CONTENT 96</span>
      <span style={{ ...label, top: 8, right: 68 }}>64</span>
      <span style={{ ...label, top: 8, right: 100 }}>96</span>
      <span style={{ ...label, top: 96, left: 100 }}>112</span>
      <span style={{ ...label, bottom: 102, left: 100 }}>CAPTION 958</span>
      <span style={{ ...label, bottom: 122, left: 100 }}>934</span>
    </div>
  );
}

/* ── chrome frame（每屏必有） ── */
interface SlideShellProps {
  index: string; // "01".."25"
  topbar: ReactNode;
  pill: string;
  caption: string; // 该屏口播台词（CaptionLayer 字幕保留区 y[972,1032]）
  bg?: string; // 屏底色（默认 cream；S5 绿底）
  invert?: boolean; // 绿底屏 chrome 反色（cream 字 + cream 框 pill）
  children: ReactNode;
}

function SlideShell({
  index,
  topbar,
  pill,
  caption,
  bg = "var(--surface)",
  invert = false,
  children,
}: SlideShellProps) {
  const chrome = invert ? "var(--surface)" : "var(--surface-3)";
  return (
    <section
      data-testid={`slide-${index}`}
      style={{
        ...scope({ "--font-mono": MONO_CN }),
        position: "relative",
        width: 1920,
        height: 1080,
        flexShrink: 0,
        boxSizing: "border-box",
        background: bg,
        border: "4px solid var(--surface-3)", // 画布边框（非投影；画布无彩色投影——F2 裁定）
        overflow: "hidden",
      }}
    >
      {/* topbar：48px top / 64px 两侧；左 mono 标签（0.08em 字距）+ 右 pill（2px 墨框 999 圆角） */}
      <div
        data-testid="chrome-topbar"
        style={{
          position: "absolute",
          top: 48,
          left: 64,
          right: 64,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: MONO_CN,
            fontSize: 24,
            lineHeight: "24px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: chrome,
            whiteSpace: "nowrap",
          }}
        >
          {topbar}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 24,
            lineHeight: "24px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: chrome,
            border: `2px solid ${chrome}`,
            borderRadius: 999,
            padding: "6px 14px",
            whiteSpace: "nowrap",
          }}
        >
          {pill}
        </span>
      </div>
      {/* 内容层：StagePad（96px gutter）+ 安全框内容带（topbar 底 88 + 24 = 顶 112；
          字幕区上缘 958 − 24 = 底 934——八轮 F1 字幕 4px 粗描边后实测同步） */}
      <StagePad>
        <div
          style={{
            height: "calc(100% - var(--stage-pad-y) - var(--space-5) - 14px)",
            display: "flex",
            flexDirection: "column",
            paddingTop: "var(--space-5)",
            paddingBottom: "var(--space-3)",
          }}
        >
          {children}
        </div>
      </StagePad>
      {/* 字幕层（真实 CaptionLayer 组件；视频场景中底部属于字幕——meta 页码条已删除）。
          九轮 F1：白底墨字墨边在任何屏底色上均成立（S8 绿底亦然）——无需覆写；
          真实章节深色 slide 的对比度由 M3b 门禁 #18 兜底 */}
      <CaptionLayer text={caption} />
      {/* 安全框可视化（?showcase=1&guides=1） */}
      <SafetyGuides color={chrome} />
    </section>
  );
}

/* ── Slide 1 · 封面（强调色：pink + orange） ── */
function CoverSlide() {
  return (
    <SlideShell
      index="01"
      topbar="CREATIVE MODE · 创意模式"
      pill="SHOWCASE / M2B"
      caption="把口播稿，做成会动的网页"
    >
      <div
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "var(--space-5)",
        }}
      >
        <Kicker variant="block">CHAPTER 01 · 主题</Kicker>
        {/* 主标题区（featured）：MarkerBlock invert 外壳（二十二轮 F1——封面主角块主色禁粉，墨底符合主题墨线语言）+ HeroTitle 双语双行 */}
        <MarkerBlock variant="invert" data-testid="featured-title">
          <HeroTitle size="display-1" latin="CREATIVE" cn="创意模式" />
        </MarkerBlock>
        {/* 装饰行：accent 色条 + glow 圆点 + solid 色条 */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "auto" }}>
          <DecorBar variant="accent" style={{ background: "var(--accent-2)" }} />
          <DecorDot variant="glow" style={{ background: "var(--accent-2)", boxShadow: "0 0 var(--space-4) var(--accent-2)" }} />
          <DecorBar variant="solid" />
        </div>
        {/* 宣言（十五轮 F2：rule 左粗条无底色——组件既有变体零覆写；--accent-1 → pink 保持 S1 用色纪律） */}
        <div style={scope({ "--accent-1": "var(--accent-2)" })}>
          <QuoteBlock variant="rule">把口播稿，做成会动的网页。</QuoteBlock>
        </div>
        {/* 印章（右下角）：pink 方块 -6deg + cream 圆环 + 40px mono 小字；内移 32px 使旋转 bbox 落回内容带 */}
        <div
          data-testid="stamp"
          style={{
            position: "absolute",
            right: "var(--space-4)",
            bottom: "var(--space-4)",
            width: 340,
            height: 340,
            background: "var(--accent-2)",
            border: "4px solid var(--surface-3)",
            transform: "rotate(-6deg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "68%",
              height: "68%",
              border: "4px solid var(--surface)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 40,
                letterSpacing: "0.08em",
                color: "var(--surface-3)",
              }}
            >
              M2B
            </span>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 2 · 章节开篇 = 参考 s2（强调色：green + orange） ── */

const CHAPTER_POINTS = ["口播稿决定节奏", "组件构图决定视觉", "引擎驱动全部动效"];

function ChapterSlide() {
  return (
    <SlideShell index="02" topbar="SECTION 01" pill="CHAPTER OPENER" caption="先说明一件事">
      <div style={{ flex: 1, display: "flex", gap: "var(--space-6)" }}>
        {/* 左栏：headline（display-2 96px）+ 开场白段落（--t-body 28px）+ 三要点（--t-h3 40px）。
            十轮 F2：headline 与正文间距加大到 64px（容器 gap 32 + 标题 marginBottom 32） */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
            先说明一件事。
          </HeroTitle>
          <BodyCopy style={{ maxWidth: 760, marginBottom: "var(--space-4)" }}>
            这是一套把口播稿变成会动网页的工作流。后面的数据、流程与对比，都是同一主题的不同切片。先记住一句话：节奏由稿子决定。
          </BodyCopy>
          {/* 三要点：NumberPill plain 序号（十轮 F4 收编——替代 RevealList numbered 的薄弱序号） */}
          <div data-testid="chapter-points" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {CHAPTER_POINTS.map((point, i) => (
              <div key={point} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <NumberPill number={`0${i + 1}`} data-testid={`chapter-point-${i + 1}`} />
                <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--t-h3)", lineHeight: 1, color: "var(--text)" }}>
                  {point}
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* 右栏：featured marker 块（green 底 cream 字 + 24px orange 硬阴影——S1 同款 featured 处理） */}
        <div style={{ width: 560, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div
            data-testid="featured-marker"
            style={{
              background: "var(--accent-1)",
              border: "4px solid var(--surface-3)",
              boxShadow: SHADOW_ORANGE,
              padding: "28px 44px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-2)",
              color: "var(--surface)",
            }}
          >
            <Kicker variant="plain">FLIP THE SWITCH.</Kicker>
            <div
              style={{
                fontFamily: "var(--font-display-cn)",
                fontWeight: 900,
                fontSize: 46,
                lineHeight: 1,
                color: "var(--surface)",
              }}
            >
              打开开关
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 3 · 数据冲击 = 参考 s3（二十二轮 F3 单填充色对角收敛：green + cream） ── */

/** 数据格 = StatCell 组件（二十五轮 F5 收编——原本地 StatCell 函数组件化）。
    二十二轮 F3 配色 = 一种填充色 + 无填充——TL/BR accent-1 green 填充 cream 字（scope 注入 --text* 反色，组件本体不改）、
    TR/BL 无填充（StatCell 自然态 cream 墨字）。S3 四格无 delta。 */
function DataSlide() {
  return (
    <SlideShell index="03" topbar="BY THE NUMBERS" pill="SHOWCASE / M2B" caption="四个数字，讲一个故事">
      {/* 氛围层（豁免安全框）：种子粒子尘，低透明度铺满整屏 */}
      <div
        data-testid="particles-layer"
        style={{ position: "absolute", inset: 0, opacity: 0.18, pointerEvents: "none" }}
      >
        <SeededParticles seed={42} count={40} />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* headline 单行（视觉终审二轮 F1：右侧空间足够，display-2 96px 单行放下 9 字 + 2 标点） */}
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          四个数字，一个故事。
        </HeroTitle>
        {/* 2×2 满幅网格：StatCell 组件零阴影（组件级——网格单元纪律）、格间隙 var(--grid-gutter) 28px */}
        <Grid
          variant="even"
          columns={2}
          data-testid="stat-grid"
          style={{ flex: 1, marginBottom: "var(--space-3)", gridTemplateRows: "1fr 1fr" }}
        >
          <StatCell
            index="/01"
            value="42%"
            label="参与度提升"
            desc="参与度相对基线提升 42 个百分点。"
            data-testid="stat-cell-1"
            style={{ background: "var(--accent-1)", ...scope({ "--text": "var(--surface)", "--text-2": "var(--surface)", "--text-mute": "var(--surface)" }) }}
          />
          <StatCell
            index="/02"
            value="2.7×"
            label="吞吐倍数"
            desc="同一份口播稿的产出吞吐提升 2.7 倍。"
            data-testid="stat-cell-2"
          />
          <StatCell
            index="/03"
            value="118"
            label="活跃占位"
            desc="活跃占位组件 118 个，随稿迭代。"
            data-testid="stat-cell-3"
          />
          <StatCell
            index="/04"
            value="$9.4M"
            label="样本总值"
            desc="样本数据总值 940 万美元。"
            data-testid="stat-cell-4"
            style={{ background: "var(--accent-1)", ...scope({ "--text": "var(--surface)", "--text-2": "var(--surface)", "--text-mute": "var(--surface)" }) }}
          />
        </Grid>
        {/* 底部一行（二十一轮 F3：只留动效完成度条——Counter 卡/DonutMeter 移除（用户拍板"不知道为什么放这里"），
            BarGrow 全宽与网格同幅，视觉平衡） */}
        <div style={{ display: "flex", alignItems: "flex-end", marginBottom: "var(--space-2)" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <Kicker variant="block" style={{ alignSelf: "flex-start" }}>
              70% · 动效完成度
            </Kicker>
            <BarGrow value={0.7} variant="accent" />
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 4 · 系统示意 = 参考 s4（强调色：pink + yellow + orange） ── */

const LAYER_NAMES = ["引擎层 — 时间与步进", "组件层 — 构图与组件", "主题层 — token 与配色", "流程层 — 章节与成片"];

/** 层次图例（十二轮 F2）：色块序列与 StackedBlocks 同源（pink/yellow/orange/cream-2） */
const LAYER_LEGEND = [
  { mono: "LAYER 01", name: "引擎层", swatch: "var(--accent-2)" },
  { mono: "LAYER 02", name: "组件层", swatch: "var(--accent-4)" },
  { mono: "LAYER 03", name: "主题层", swatch: "var(--accent-3)" },
  { mono: "LAYER 04", name: "流程层", swatch: "var(--surface-2)" },
];

function DiagramSlide() {
  return (
    <SlideShell index="04" topbar="SYSTEM DIAGRAM" pill="SCHEMATIC / A" caption="一层叠一层的结构">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* 十轮 F1：headline 单行（display-2 96px 档，9 字实测放下） */}
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>一层叠一层的结构。</HeroTitle>
        <div style={{ flex: 1, display: "flex", gap: "var(--space-6)" }}>
          {/* 左栏：描述 + 四层名单（NumberPill accent 序号——十轮 F4；--accent-1 → orange 本屏纪律） */}
          <div
            style={{ width: 700, display: "flex", flexDirection: "column", gap: "var(--space-4)", ...scope({ "--accent-1": "var(--accent-3)" }) }}
          >
            <BodyCopy style={{ maxWidth: 640 }}>
              四层各司其职：引擎层排时间，组件层出构图，主题层管配色，流程层串成片。每层只做一件事，叠起来就是一条流水线。
            </BodyCopy>
            <div data-testid="layer-list" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              {LAYER_NAMES.map((name, i) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                  <NumberPill number={`0${i + 1}`} variant="accent" data-testid={`layer-pill-${i + 1}`} />
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--t-h3)", lineHeight: 1, color: "var(--text)" }}>
                    {name}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {/* 右栏：大 panel——header（Kicker + hairline）+ 两栏（StackedBlocks / 4 行层次图例）。
              十二轮 F2：清晰层次图重排，PathDraw 移除（S9 动效实验室已有） */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Card
              variant="plain"
              data-testid="system-panel"
              style={{ width: 820, padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
            >
              <Kicker variant="plain" style={{ fontSize: "var(--t-label)" }}>
                SCHEMATIC / A
              </Kicker>
              <Rule variant="solid" style={scope({ "--rule-w": "3px", margin: "0 0 var(--space-3)" })} />
              <div data-testid="system-split" style={{ display: "flex", gap: "var(--space-6)", alignItems: "flex-start" }}>
                <StackedBlocks data-testid="stacked-blocks" />
                <div data-testid="layer-legend" style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                  {LAYER_LEGEND.map((layer) => (
                    <div key={layer.mono} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                      <div
                        style={{ width: 16, height: 16, flexShrink: 0, background: layer.swatch, border: "2px solid var(--text)" }}
                      />
                      {/* 十四轮 F1：图例行单行——色块 + LAYER NN + 层名同一行（StackedBlocks 使用约定） */}
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", lineHeight: 1, letterSpacing: "0.08em", color: "var(--text)", whiteSpace: "nowrap" }}>
                        {layer.mono}
                      </span>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--t-label)", lineHeight: 1, color: "var(--text-mute)", whiteSpace: "nowrap" }}>
                        {layer.name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 5 · 柱状图 = 参考 s5（强调色：green + pink + orange 交替） ── */

const BAR_ROWS = [
  // 二十二轮 F2：季度/分类类条形图每季一色（四强调色序列——此规则优先于"每屏 2-3 强调色"通用纪律，分类色彩编码是语义需求）
  // tone = null 表示吃默认 accent-1（green）——不可 scope 覆写 --accent-1: var(--accent-1)（自引用循环 → 透明）
  { label: "Q1 '24", value: 0.34, text: "34", tone: null }, // accent-1 绿
  { label: "Q2 '24", value: 0.48, text: "48", tone: "var(--accent-2)" }, // 粉
  { label: "Q3 '24", value: 0.61, text: "61", tone: "var(--accent-3)" }, // 橙
  { label: "Q4 '24", value: 0.55, text: "55", tone: "var(--accent-4)" }, // 黄
];

function ChartSlide() {
  return (
    <SlideShell index="05" topbar="QUARTERLY READOUT" pill="BARS" caption="季度读数">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="h1" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>季度读数。</HeroTitle>
        {/* 4 行横向条形图（参考 s5：mono 标签 + BarGrow accent + mono 数值；行高 56px dev 微调） */}
        <div
          data-testid="bar-rows"
          className="sg-bar-rows"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}
        >
          {BAR_ROWS.map((row) => (
            <div key={row.label} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.1em", width: 140 }}>
                {row.label}
              </span>
              <div style={{ flex: 1, ...(row.tone ? scope({ "--accent-1": row.tone }) : undefined) }}>
                <BarGrow value={row.value} variant="accent" />
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", width: 48, textAlign: "right" }}>
                {row.text}
              </span>
            </div>
          ))}
        </div>
        {/* 图注（参考 s5 note） */}
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-label)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-mute)",
          }}
        >
          FIG. 01 — 数值为占位样例 · SOURCE: SAMPLE DATASET / INTERNAL
        </span>
      </div>
    </SlideShell>
  );
}

/* ── Slide 6 · 流程 = 参考 s6（强调色：cream + pink + yellow + green 收尾） ── */

interface StepDef {
  n: string;
  title: string;
  desc: string;
  tone: "cream" | "pink" | "yellow" | "green";
}

const STEP_DEFS: StepDef[] = [
  { n: "01", title: "写稿", desc: "口播稿定节奏，一句一拍，每句拆成独立一步。", tone: "cream" },
  { n: "02", title: "构图", desc: "为每一步选组件，套用主题 token 与配色纪律。", tone: "pink" },
  { n: "03", title: "动画", desc: "引擎驱动全部动效，可暂停、可快进、可复演。", tone: "yellow" },
  { n: "04", title: "成片", desc: "录屏导出成片，一张网页承载完整表达。", tone: "green" },
];

/** 流程步骤卡：大 mono 序号（display-2 96px 档）+ Kicker 标题 + 描述两句。
    配色序列 cream → pink（墨字）→ yellow（墨字）→ green（cream 字）收尾；零阴影（参考构图无投影）。
    视觉终审三轮 F1：步骤卡间三角箭头已删除（用户拍板），卡片间距保持 Grid gutter 28px */
function StepCard({ def }: { def: StepDef }) {
  const variant = def.tone === "green" ? "accent" : "plain";
  const bg =
    def.tone === "pink" ? "var(--accent-2)" : def.tone === "yellow" ? "var(--accent-4)" : undefined;
  const creamText = def.tone === "green";
  return (
    <Card
      variant={variant}
      data-testid={`step-card-${def.tone}`}
      style={{
        position: "relative",
        height: 320,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: 28,
        ...(bg ? { background: bg } : {}),
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--t-display-2)",
          lineHeight: 0.85,
          color: creamText ? "var(--surface)" : "var(--text)",
        }}
      >
        {def.n}
      </span>
      <Kicker
        variant="plain" // 十三轮一致性：plain 变体颜色继承（green 卡 accent 变体自动 cream 字）
        style={{
          fontSize: 34,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: "0.04em",
        }}
      >
        {def.title}
      </Kicker>
      <BodyCopy style={{ fontSize: 24, lineHeight: 1.4, color: creamText ? "var(--surface)" : "var(--text-2)" }}>
        {def.desc}
      </BodyCopy>
    </Card>
  );
}

function FlowSlide() {
  return (
    <SlideShell index="06" topbar="HOW IT WORKS" pill="FOUR STEPS" caption="从稿子到成片，一共四步">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>一个四步流程。</HeroTitle>
        {/* 流程 slide 的 signature：3px dashed 墨线分隔（参考 s6 header-line） */}
        <Rule variant="dashed" data-testid="flow-rule" style={scope({ "--rule-w": "3px", margin: "0 0 var(--space-4)" })} />
        <Grid variant="even" columns={4} data-testid="step-cards" style={{ marginBottom: "var(--space-4)", ...scope({ "--shadow-card-sm": "none" }) }}>
          {STEP_DEFS.map((def) => (
            <StepCard key={def.n} def={def} />
          ))}
        </Grid>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-6)", marginTop: "auto" }}>
          <div style={{ flex: 1 }}>
            <TimelineTrack points={["稿", "镜", "画", "声", "片"]} activeIndex={3} data-testid="flow-timeline" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <ProgressDots total={5} current={4} data-testid="flow-progress" />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--t-label)", // F2：与 TimelineTrack 标签同升 24px（mono 注册表档）
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--text-mute)",
              }}
            >
              PIPELINE · 五节点
            </span>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 7 · 对比 = 参考 s7（强调色：pink/green/orange 彩色列） ── */

const COMPARE_ROWS = [
  ["速度", "快", "更快", "最快"],
  ["足迹", "轻", "中", "重"],
  ["投入", "低", "中", "高"],
  ["结果", "样例", "样例", "样例"],
];

function CompareSlide() {
  return (
    <SlideShell index="07" topbar="SIDE BY SIDE" pill="COMPARISON" caption="三个选项，逐项对比">
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="h1" style={{ lineHeight: 0.95, maxWidth: 1100, marginBottom: "var(--headline-gap)" }}>
          三个选项，逐项对比。
        </HeroTitle>
        {/* 视觉终审三轮 F2：-4deg "选一个" 徽章已删除（用户拍板），headline 与表格保持现有布局 */}
        {/* 大表格（Table columns 变体）：cream-2 底 4px 墨框 + 彩色数据列（pink 墨字 / green cream 字 / orange cream 字） */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            background: "var(--surface-2)",
            border: "4px solid var(--surface-3)",
          }}
        >
          <Table
            variant="columns"
            className="sg-compare-table"
            header={["属性", "方案 A", "方案 B", "方案 C"]}
            rows={COMPARE_ROWS}
            data-testid="compare-table"
          />
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 8 · 媒体 3:4 素材 = 竖屏占位展示（十轮 F5；强调色：green 点缀） ── */

const PORTRAIT_ITEMS = [
  { id: "01", kind: "figure" as const },
  { id: "02", kind: "figure" as const },
  { id: "03", kind: "figure" as const },
  { id: "04", kind: "kenburns" as const },
];

function MediaSlide() {
  return (
    <SlideShell index="08" topbar="MEDIA · PORTRAIT" pill="3:4 ASSETS" caption="竖屏素材，各归其位">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="h1" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>竖屏素材，各归其位。</HeroTitle>
        {/* 3 个 3:4 竖屏 Figure placeholder（frame 变体 + ratio="3 / 4" 组件级 aspect——十三轮一致性零覆写，
            自然 24px 硬阴影保留；gap 32 容纳阴影落点）+ 第 4 个 KenBurns 无 src placeholder（布局容器控尺寸）。
            十二轮 F3：StaggerRow 逐个错峰 rise 入场，KenBurns 保持 slow 缓推 */}
        <StaggerRow
          stagger
          reveal="rise"
          duration="mid"
          data-testid="portrait-row"
          style={{ display: "flex", gap: "var(--space-4)", alignItems: "flex-start" }}
        >
          {PORTRAIT_ITEMS.map((item) => (
            <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", width: 400 }}>
              {item.kind === "figure" ? (
                <Figure variant="bare" ratio="3 / 4" data-testid={`portrait-${item.id}`} /> // 十四轮 F4：占位图卡片无阴影（组件级 bare 变体，非 dev 覆写）
              ) : (
                <div style={{ width: 400, height: "calc(400px * 4 / 3)", boxSizing: "border-box" }}>
                  <KenBurns duration="slow" variant="framed" data-testid="portrait-kenburns" /> {/* 十五轮 F1：组件级 framed 边框，与 Figure bare 一致；十六轮 F2：高度与 ratio 3/4 精确对齐 */}
                </div>
              )}
              <span
                style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.1em", color: "var(--text-mute)" }}
              >
                {item.kind === "figure" ? `素材 / ${item.id}` : "KEN BURNS · 缓推"}
              </span>
            </div>
          ))}
        </StaggerRow>
      </div>
    </SlideShell>
  );
}

/* ── Slide 9 · 动效实验室 = 全部动效词汇陈列（十轮 F5；强调色：green + pink 点缀） ── */

function MotionCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "4px solid var(--surface-3)",
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <span
        style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-mute)" }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1 }}>{children}</div>
    </div>
  );
}

function MotionLabSlide() {
  return (
    <SlideShell index="09" topbar="MOTION LAB" pill="PRESETS" caption="动效，各就各位">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="h1" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>动效，各就各位。</HeroTitle>
        <Grid
          variant="even"
          columns={3}
          data-testid="motion-grid"
          style={{ flex: 1, ...scope({ "--shadow-card-sm": "none", "--shadow-card": "none" }) }}
        >
          <MotionCell label="COUNTER · 滚动计数">
            <Counter to={47} />
          </MotionCell>
          <MotionCell label="COUNT UP · 大数字">
            <HeroNumber value="+47%" countUp />
          </MotionCell>
          <MotionCell label="TYPEWRITER · 打字机">
            <TypedTerminal lines={["motion-lab --presets", "6 presets · components"]} />
          </MotionCell>
          <MotionCell label="PATH DRAW · 折线自绘">
            <div style={{ width: 200 }}>
              <PathDraw d="M 8 88 L 30 20 L 55 60 L 92 12" />
            </div>
          </MotionCell>
          <MotionCell label="BREATHE / DOTS · 呼吸与进度">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
              <Breathe cycles={3} />
              <ProgressDots total={5} current={2} />
            </div>
          </MotionCell>
          <MotionCell label="BAR / DONUT · 条与环">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", width: "100%" }}>
              <div style={{ flex: 1 }}>
                <BarGrow value={0.7} variant="accent" />
              </div>
              <DonutMeter value={0.42} label="42" />
            </div>
          </MotionCell>
        </Grid>
      </div>
    </SlideShell>
  );
}

/* ── Slide 10 · 内容菜单 = 新屏 A（supper-club 菜单排版；强调色：orange 单点缀） ── */

const MENU_ITEMS = [
  { n: "01", name: "口播稿", note: "一句一拍 · 节奏由稿子决定", price: "¥ 09" },
  { n: "02", name: "分镜", note: "每步一屏 · 组件负责构图", price: "¥ 16" },
  { n: "03", name: "动效", note: "引擎驱动 · 可停可快进", price: "¥ 25" },
  { n: "04", name: "主题", note: "token 换肤 · 一键切换", price: "¥ 36" },
  { n: "05", name: "成片", note: "录屏导出 · 一张网页承载", price: "¥ 49" },
];

function MenuSlide() {
  return (
    <SlideShell index="10" topbar="CONTENT MENU" pill="A LA CARTE" caption="一份菜单，五道菜">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          内容菜单。
        </HeroTitle>
        {/* 菜单式居中窄栏（supper-club 排版）：mono 编号 + 条目名 + 注 + 虚线引导（border-bottom dotted）+ 右侧价格式数值 */}
        <div
          data-testid="menu-list"
          style={{ width: 1000, alignSelf: "center", display: "flex", flexDirection: "column", gap: "var(--space-4)", marginTop: "var(--space-4)" }}
        >
          {MENU_ITEMS.map((item, i) => (
            <div key={item.n} data-testid={`menu-row-${i + 1}`} style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.08em", color: "var(--text-mute)", width: 48 }}>
                {item.n}
              </span>
              <span style={{ fontFamily: "var(--font-display-cn)", fontWeight: 900, fontSize: 48, lineHeight: 1 }}>{item.name}</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 24, lineHeight: 1, color: "var(--text-mute)", whiteSpace: "nowrap" }}>
                {item.note}
              </span>
              {/* 虚线引导：flex:1 撑满剩余宽度（border-bottom dotted 2px faint 墨） */}
              <span
                aria-hidden="true"
                style={{ flex: 1, alignSelf: "baseline", borderBottom: "2px dotted var(--text-faint)", transform: "translateY(-4px)" }}
              />
              <span
                data-testid={`menu-price-${i + 1}`}
                style={{ fontFamily: "var(--font-mono)", fontSize: 28, fontWeight: 700, letterSpacing: "0.04em", color: "var(--accent-3)" }}
              >
                {item.price}
              </span>
            </div>
          ))}
        </div>
        {/* 底部 mono 注 */}
        <span
          data-testid="menu-note"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-label)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-mute)",
            alignSelf: "center",
            marginTop: "auto",
            marginBottom: "var(--space-2)",
          }}
        >
          MENU · 章节菜单
        </span>
      </div>
    </SlideShell>
  );
}

/* ── Slide 11 · 海报宣言 = 新屏 B（bold-poster 信息流五段式——二十五轮 F1 重设；强调色：orange 单色） ── */

function PosterSlide() {
  return (
    <SlideShell index="11" topbar="POSTER" pill="MANIFESTO" caption="大字，就要大声">
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* ⑤ 右上 -4deg 旋转徽章（装饰弱化，不抢信息流：透明底 2px 墨框 mono "NO.01"；
            内移 32px 使旋转 bbox 落回内容带） */}
        <div
          data-testid="poster-badge"
          style={{
            position: "absolute",
            top: "var(--space-2)",
            right: "var(--space-4)",
            transform: "rotate(-4deg)",
            border: "2px solid var(--surface-3)",
            borderRadius: 999,
            background: "transparent",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: 24,
            lineHeight: 1,
            letterSpacing: "0.08em",
            padding: "10px 20px",
            whiteSpace: "nowrap",
          }}
        >
          NO.01
        </div>
        {/* ① 顶部 Kicker mono 眉标 */}
        <Kicker variant="plain" data-testid="poster-kicker" style={{ fontSize: "var(--t-label)", letterSpacing: "0.14em" }}>
          MANIFESTO · POSTER NO.01
        </Kicker>
        {/* ② 主体大字区：display-1 双行——"口播视频" 墨 + "稿子成片" accent-3 橙（单强调色语义）；行距紧凑 0.92 */}
        <div data-testid="poster-title" style={{ display: "flex", flexDirection: "column", marginTop: "var(--space-4)" }}>
          <HeroTitle size="display-1" data-testid="poster-line-1" style={{ lineHeight: 0.92 }}>
            口播视频
          </HeroTitle>
          <HeroTitle size="display-1" data-testid="poster-line-2" style={{ lineHeight: 0.92, color: "var(--accent-3)" }}>
            稿子成片
          </HeroTitle>
        </div>
        {/* ③ 大字下 3px hairline + BodyCopy lede 一句副题 */}
        <Rule
          variant="solid"
          data-testid="poster-rule"
          style={scope({ "--rule-w": "3px", margin: "var(--space-4) 0 var(--space-3)" })}
        />
        <BodyCopy variant="lede" data-testid="poster-lede" style={{ maxWidth: 760 }}>
          从一份稿子，到一条会动的视频。
        </BodyCopy>
        {/* ④ 底部 mono 注 */}
        <span
          data-testid="poster-note"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-label)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-mute)",
            marginTop: "auto",
            alignSelf: "flex-start",
          }}
        >
          POSTER · 2026
        </span>
      </div>
    </SlideShell>
  );
}

/* ── Slide 12 · 复古终端 = 新屏 C（retro-windows 窗口面板；强调色：三色小方块装饰） ── */

const TERMINAL_LINES = ["$ m2b render --theme creative-mode", "compiling slides ... 25 found", "export ./out/demo.mp4 — done"];

function TerminalSlide() {
  return (
    <SlideShell index="12" topbar="RETRO WINDOW" pill="TERMINAL.EXE" caption="老窗口，新引擎">
      {/* 氛围层（豁免安全框）：窗口外淡背景网格线（CSS 细线 1px 网格，极淡墨） */}
      <div
        data-testid="terminal-grid"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "linear-gradient(rgba(15, 15, 15, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 15, 15, 0.05) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* 大窗口面板：4px 墨框 + 标题条（墨底 cream mono "TERMINAL.EXE" + 三个小方块）+ TypedTerminal + 状态行 */}
        <div
          data-testid="terminal-window"
          style={{
            alignSelf: "center",
            width: 1100,
            marginTop: "auto",
            marginBottom: "auto",
            display: "flex",
            flexDirection: "column",
            border: "4px solid var(--surface-3)",
            background: "var(--surface)",
            padding: "var(--space-3)",
          }}
        >
          <div
            data-testid="terminal-titlebar"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              background: "var(--surface-3)",
              color: "var(--surface)",
              fontFamily: "var(--font-mono)",
              fontSize: 24,
              lineHeight: 1,
              letterSpacing: "0.08em",
              padding: "12px var(--space-3)",
            }}
          >
            {/* 三个小方块装饰（经典窗口红黄绿，本主题三强调色） */}
            <span aria-hidden="true" style={{ width: 14, height: 14, background: "var(--accent-3)" }} />
            <span aria-hidden="true" style={{ width: 14, height: 14, background: "var(--accent-4)" }} />
            <span aria-hidden="true" style={{ width: 14, height: 14, background: "var(--accent-1)" }} />
            <span style={{ flex: 1, textAlign: "center" }}>TERMINAL.EXE</span>
          </div>
          <div style={{ marginTop: "var(--space-3)" }}>
            <TypedTerminal lines={TERMINAL_LINES} duration="slow" data-testid="terminal-body" />
          </div>
          {/* 底部 mono 状态行 */}
          <span
            data-testid="terminal-status"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 24,
              letterSpacing: "0.08em",
              color: "var(--text-mute)",
              marginTop: "var(--space-3)",
            }}
          >
            READY · PRESS ANY KEY
          </span>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 13 · 便签墙 = 参考 scatterbrain s1（五色便签 + 图钉） ── */

interface PostItDef {
  id: string;
  label: string;
  text: string;
  tone: "pink" | "yellow" | "green" | "orange" | "cream";
  width: number;
  height: number;
  left: number;
  top: number;
  /** 构图级微旋转（印章同款构图 transform 许可——旋转 bbox 落带内为安全框验收项） */
  rotate: number;
}

/** 便签墙 5 卡错落排布：主角卡 520×320 居中偏上，4 张小卡 240×240 四角环绕（左右镜像对称）；
    wall 坐标 x[0,1728] × y[0,~623]——位置已按旋转 bbox（+4~5px 扩展）预演算在带内 */
const POST_IT_DEFS: PostItDef[] = [
  { id: "hero", label: "BIG IDEA", text: "别让想法溜走", tone: "yellow", width: 520, height: 320, left: 604, top: 24, rotate: -2 },
  { id: "pink", label: "NOTE 01", text: "先把想法贴墙", tone: "pink", width: 240, height: 240, left: 80, top: 100, rotate: -3 },
  { id: "green", label: "NOTE 02", text: "组件负责构图", tone: "green", width: 240, height: 240, left: 1408, top: 100, rotate: 2 },
  { id: "orange", label: "NOTE 03", text: "引擎驱动动效", tone: "orange", width: 240, height: 240, left: 320, top: 372, rotate: 2 },
  { id: "cream", label: "NOTE 04", text: "配色听 token 的", tone: "cream", width: 240, height: 240, left: 1168, top: 372, rotate: -2 },
];

const POST_IT_BG: Record<PostItDef["tone"], string> = {
  pink: "var(--accent-2)",
  yellow: "var(--accent-4)",
  green: "var(--accent-1)",
  orange: "var(--accent-3)",
  cream: "var(--surface)",
};

/** 便签卡：Card accent + inline 底色覆写（S6 步卡先例——四色显式覆写、零改组件）；
    亮底（yellow/cream）用 plain 变体保持墨字对比度，深色三色用 accent 变体 cream 字 */
function PostIt({ def }: { def: PostItDef }) {
  const darkInk = def.tone === "yellow" || def.tone === "cream";
  return (
    <Card
      variant={darkInk ? "plain" : "accent"}
      data-testid={`post-it-${def.id}`}
      style={{
        position: "absolute",
        left: def.left,
        top: def.top,
        width: def.width,
        height: def.height,
        boxSizing: "border-box", // 外框 = 构图尺寸（内衬/边框计入——旋转 bbox 预演算依据）
        transform: `rotate(${def.rotate}deg)`,
        background: POST_IT_BG[def.tone],
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      {/* 图钉（CSS 几何）：8px 墨点居中于左上卡角（卡角 = padding 框外缘 -4px 边框；-4 边框 − 4 半径 = -8；随卡旋转） */}
      <div
        data-testid={`post-it-pin-${def.id}`}
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -8,
          left: -8,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "var(--surface-3)",
        }}
      />
      <Kicker variant="plain" style={{ fontSize: "var(--t-label)" }}>
        {def.label}
      </Kicker>
      <span
        style={{
          fontFamily: "var(--font-display-cn)",
          fontWeight: 900,
          fontSize: def.id === "hero" ? 44 : 28,
          lineHeight: 1.15,
        }}
      >
        {def.text}
      </span>
    </Card>
  );
}

function StickyWallSlide() {
  return (
    <SlideShell index="13" topbar="STICKY WALL" pill="NOTES" caption="想法，先贴上墙">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          想法，先贴上墙。
        </HeroTitle>
        {/* 便签墙：零硬阴影（构图纪律——贴墙便签平面感，S3 网格同款 scope 覆写，报告记录在案） */}
        <div
          data-testid="sticky-wall"
          style={{ position: "relative", flex: 1, minHeight: 0, ...scope({ "--shadow-card-sm": "none" }) }}
        >
          {POST_IT_DEFS.map((def) => (
            <PostIt key={def.id} def={def} />
          ))}
        </div>
        {/* 底部 mono 小注 */}
        <span
          data-testid="sticky-note"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-label)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-mute)",
            alignSelf: "center",
            marginTop: "var(--space-2)",
          }}
        >
          REMEMBER THIS · 便签墙
        </span>
      </div>
    </SlideShell>
  );
}

/* ── Slide 14 · 路线图 = 新屏 D（pin-and-paper：图钉 + CSS 虚线串联；强调色：orange 单色） ── */

const ROADMAP_NODES = [
  { n: "01", name: "写稿", note: "口播稿定节奏" },
  { n: "02", name: "分镜", note: "每步一屏构图" },
  { n: "03", name: "动效", note: "引擎驱动全部" },
  { n: "04", name: "主题", note: "token 一键换肤" },
  { n: "05", name: "成片", note: "录屏导出成片" },
];

function RoadmapSlide() {
  return (
    <SlideShell index="14" topbar="ROADMAP" pill="FIVE STOPS" caption="一条线，串起五站">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          一条线，串起五站。
        </HeroTitle>
        {/* 水平路线图：3px dashed 墨线横向贯穿（串联各站图钉），5 节点列 space-between 均布。
            二十五轮 F3：整体下移——route top 48→136 / nodes top 40→128，节点行中心落在页面垂直中点偏上（≈ y480） */}
        <div data-testid="roadmap" style={{ position: "relative", flex: 1 }}>
          <div
            data-testid="roadmap-route"
            style={{ position: "absolute", top: 136, left: "var(--space-5)", right: "var(--space-5)", borderTop: "3px dashed var(--text)" }}
          />
          <div
            data-testid="roadmap-nodes"
            style={{
              position: "absolute",
              top: 128,
              left: "var(--space-5)",
              right: "var(--space-5)",
              display: "flex",
              justifyContent: "space-between",
              ...scope({ "--accent-1": "var(--accent-3)" }), // 药丸 accent → orange（本屏单强调色）
            }}
          >
            {ROADMAP_NODES.map((node, i) => (
              <div
                key={node.n}
                data-testid={`roadmap-node-${i + 1}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)", width: 200 }}
              >
                {/* 图钉（CSS 几何）：16px 墨点 + 2/3px 短线硬阴影（墨点短线阴影 = 钉感），中心压在虚线上 */}
                <div
                  data-testid={`roadmap-pin-${i + 1}`}
                  aria-hidden="true"
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "var(--surface-3)",
                    boxShadow: "2px 3px 0 rgba(15, 15, 15, 0.35)",
                  }}
                />
                <NumberPill number={node.n} variant="accent" data-testid={`roadmap-pill-${i + 1}`} />
                {/* 节点名（新屏 D 规格：NumberPill + Kicker 节点名 + 小注——S6 步卡 Kicker 先例） */}
                <Kicker variant="plain" style={{ fontSize: 44, lineHeight: 1, fontWeight: 700, letterSpacing: "0.04em" }}>
                  {node.name}
                </Kicker>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, lineHeight: 1, letterSpacing: "0.04em", color: "var(--text-mute)", whiteSpace: "nowrap" }}>
                  {node.note}
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* 底部 mono 注 */}
        <span
          data-testid="roadmap-note"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-label)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-mute)",
            alignSelf: "center",
            marginTop: "var(--space-2)",
          }}
        >
          ROADMAP · 路线图
        </span>
      </div>
    </SlideShell>
  );
}

/* ── Slide 15 · 规格清单 = 参考 sakura-chroma s3/s7（强调色：green + orange 点缀） ── */

const SPEC_ROWS = [
  { label: "DIMENSIONS", value: "140 × 96 × 38 MM", checked: true },
  { label: "WEIGHT", value: "1.2 KG", checked: true },
  { label: "POWER", value: "9V DC · 300 MA", checked: true },
  { label: "CONNECT", value: "TRS / MIDI", checked: true },
  { label: "COLOR", value: "MINT GREEN", checked: true },
  { label: "EDITION", value: "2026 SPRING", checked: false },
];

/** 底部 ledger 表数据（参考 s7：编号/日期/名称/版本 4 列 3 行） */
const SPEC_LEDGER = [
  ["SC-01", "2026-09-01", "BLOOM PEDAL", "V2.1"],
  ["SC-02", "2026-08-14", "TAP TEMPO", "V1.4"],
  ["SC-03", "2026-07-30", "CASCADE REVERB", "V3.0"],
];

/** JIS 勾选框（CSS 几何，dev 页）：24×24 墨框方块；checked = 墨底 + cream 对勾
    （12×7 L 形 3px 左/下边框，rotate -45deg） */
function JisCheck({ checked, testid }: { checked: boolean; testid?: string }) {
  return (
    <div
      data-testid={testid}
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        flexShrink: 0,
        border: "2px solid var(--text)",
        background: checked ? "var(--text)" : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
    >
      {checked ? (
        <div
          style={{
            width: 12,
            height: 7,
            boxSizing: "border-box",
            borderLeft: "3px solid var(--surface)",
            borderBottom: "3px solid var(--surface)",
            transform: "rotate(-45deg) translateY(-1px)",
          }}
        />
      ) : null}
    </div>
  );
}

function SpecSheetSlide() {
  return (
    <SlideShell index="15" topbar="SPEC SHEET" pill="CATALOGUE" caption="一张规格表，说清一切">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          一张规格表，说清一切。
        </HeroTitle>
        {/* 紧凑两栏（十九轮 F2）：左栏 440 = Figure 400×533 + SC-01 + 品名；右栏剩余全宽 = 清单 6 行 + ledger 表
            （400×533 + 全宽底表 + headline 超出 818 内容预算——表入右栏底部与图底对齐，报告记录在案）；
            图与清单间距 var(--grid-gutter) 28——中缝无大空区 */}
        <div data-testid="spec-main" style={{ flex: 1, display: "flex", gap: "var(--grid-gutter)" }}>
          <div style={{ width: 440, display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
            <div style={{ width: 400 }}>
              <Figure variant="bare" ratio="3 / 4" data-testid="spec-figure" />
            </div>
            <span
              data-testid="spec-code"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.12em", color: "var(--text)" }}
            >
              SC-01
            </span>
            <Kicker variant="plain" data-testid="spec-name" style={{ fontSize: "var(--t-label)" }}>
              BLOOM PEDAL
            </Kicker>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div data-testid="spec-list" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {SPEC_ROWS.map((row, i) => (
                <div
                  key={row.label}
                  data-testid={`spec-row-${i + 1}`}
                  style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", height: 56 }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--t-label)",
                      letterSpacing: "0.08em",
                      color: "var(--text-mute)",
                      width: 200,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.label}
                  </span>
                  <span
                    style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: "var(--t-body)", color: "var(--text)", whiteSpace: "nowrap" }}
                  >
                    {row.value}
                  </span>
                  <JisCheck checked={row.checked} testid={`jis-check-${i + 1}`} />
                </div>
              ))}
            </div>
            {/* ledger 表（参考 s7）：mono 数据风格 4 列 3 行，右栏底部与图底对齐 */}
            <div style={{ marginTop: "auto" }}>
              <Table
                variant="bordered"
                className="sg-spec-table"
                header={["NO.", "DATE", "NAME", "VER."]}
                rows={SPEC_LEDGER}
                data-testid="spec-ledger"
              />
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 16 · 季度回顾 = 参考 editorial-forest s5/s7（强调色：green + orange 涨橙 KPI） ── */

const YOY_ROWS = [
  { label: "Q1", thisYear: 0.62, lastYear: 0.48 },
  { label: "Q2", thisYear: 0.74, lastYear: 0.55 },
  { label: "Q3", thisYear: 0.81, lastYear: 0.67 },
  { label: "Q4", thisYear: 0.88, lastYear: 0.72 },
];

const YOY_KPIS = [
  // tone = accent-3 橙（二十四轮 A股红涨语义：年增 KPI 附注属涨跌语义标注——涨橙/跌绿，控制器同步设计文档 §12）；
  // 当季数非涨跌语义，保持墨色
  { value: "+42%", label: "ACTIVE ACCOUNTS · 年增", tone: "var(--accent-3)" },
  { value: "+18%", label: "NET RETENTION · 年增", tone: "var(--accent-3)" },
  { value: "92", label: "PEOPLE SERVED · 当季", tone: null },
];

function QuarterlyReviewSlide() {
  return (
    <SlideShell index="16" topbar="QUARTERLY REVIEW" pill="YOY" caption="今年，比去年快一点">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          今年，比去年快一点。
        </HeroTitle>
        {/* 列头式图例（十九轮 F3；二十一轮 F2 补色块——图例色块与条色同步：今年绿/去年墨）：
            仅第一对条上方放列头，与条列水平对齐——与数据行同一 flex 骨架，组左缘精确对齐 */}
        <div
          data-testid="yoy-colheads"
          style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-2)" }}
        >
          <span style={{ width: 96 }} />
          <div data-testid="yoy-colhead-this" style={{ flex: 1, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <div style={{ width: 16, height: 16, background: "var(--accent-1)", border: "2px solid var(--text)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text-mute)" }}>
              THIS YEAR
            </span>
          </div>
          <div data-testid="yoy-colhead-last" style={{ flex: 1, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <div style={{ width: 16, height: 16, background: "var(--surface-3)", border: "2px solid var(--text)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text-mute)" }}>
              LAST YEAR
            </span>
          </div>
          <span style={{ width: 64 }} />
          <span style={{ width: 64 }} />
        </div>
        {/* 4 行成对横条（参考 s5 bar-pair）：今年 accent（green）/ 去年 solid（surface-3 墨）；同列双条等高（.sg-yoy-rows 48px） */}
        <div
          data-testid="yoy-rows"
          className="sg-yoy-rows"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
        >
          {YOY_ROWS.map((row) => (
            <div key={row.label} data-testid={`yoy-row-${row.label}`} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <span
                style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.1em", width: 96, color: "var(--text)" }}
              >
                {row.label}
              </span>
              <div style={{ flex: 1 }}>
                <BarGrow value={row.thisYear} variant="accent" data-testid={`yoy-bar-${row.label}-this`} />
              </div>
              {/* 去年条：二十一轮 F2 改墨色（solid 自然态 = surface-3——与图例色块同步，今年绿/去年墨对比鲜明） */}
              <div style={{ flex: 1 }}>
                <BarGrow value={row.lastYear} variant="solid" data-testid={`yoy-bar-${row.label}-last`} />
              </div>
              <span
                style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", width: 64, textAlign: "right", color: "var(--accent-1)" }}
              >
                {row.thisYear.toFixed(2)}
              </span>
              <span
                style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", width: 64, textAlign: "right", color: "var(--text-mute)" }}
              >
                {row.lastYear.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
        {/* KPI 行（参考 s7 three-numbers）：3px 墨 hairline（二十轮 F1 去粉）+ 三个墨色大数字（十九轮 F3 去粉）+ mono 标注
            ——本屏无 pink 残留（收敛为绿 + 墨 + cream，无刻意点缀） */}
        <div style={{ marginTop: "auto" }}>
          <Rule variant="solid" style={scope({ "--rule-w": "3px", margin: "0 0 var(--space-3)" })} />
          <div data-testid="yoy-kpis" style={{ display: "flex", gap: "var(--space-6)" }}>
            {YOY_KPIS.map((kpi) => (
              <div
                key={kpi.value}
                style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)", ...(kpi.tone ? scope({ "--text": kpi.tone }) : undefined) }}
              >
                <HeroNumber value={kpi.value} variant="plain" />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text-mute)" }}>
                  {kpi.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 17 · Before / After = 参考 scatterbrain s9（强调色：green + pink） ── */

const BEFORE_ITEMS = ["散落的文档", "模糊的归属", "不一致的流程", "被动救火", "部门孤岛"];
const AFTER_ITEMS = ["一份稿子驱动", "角色清晰", "流程一致", "主动推进", "一条流水线"];

function BeforeAfterSlide() {
  return (
    <SlideShell index="17" topbar="BEFORE / AFTER" pill="VS" caption="同一份稿子，两种样子">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          同一份稿子，两种样子。
        </HeroTitle>
        {/* 十九轮 F4：SplitCompare 组件（单一面板 + 3px 中分界 + 中缝 VS 圆章）；二十二轮 F4：align="center"
            （文案短 → 两半居中）；before 灰语义经 --split-before-text scope 覆写；面板 1560×560 居中 */}
        <div
          data-testid="ba-split"
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...scope({ "--split-before-text": "var(--text-faint)" }),
          }}
        >
          <SplitCompare
            before={BEFORE_ITEMS}
            after={AFTER_ITEMS}
            align="center"
            data-testid="before-after-panel"
            style={{ width: 1560, height: 560 }}
          />
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 18 · 墨底大字 = 新屏 E（studio 整屏反色；强调色：orange 单色装饰条） ── */

function InkSlide() {
  return (
    <SlideShell index="18" topbar="INK MODE" pill="INVERTED" caption="反白，也是态度" bg="var(--surface-3)" invert>
      <div
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          ...scope({ "--text": "var(--surface)", "--text-2": "var(--surface)" }), // 墨底上组件自设色子元素回归 cream（MarkerBlock 同款手法）
        }}
      >
        {/* cream 大字标语 + 单强调色装饰条（orange，本屏唯一强调色） */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          <DecorBar variant="accent" data-testid="ink-bar" style={{ background: "var(--accent-3)", width: 96, height: 24 }} />
          <HeroTitle size="display-1" data-testid="ink-title" style={{ lineHeight: 0.95 }}>
            一句话，就够了。
          </HeroTitle>
        </div>
        <BodyCopy style={{ marginTop: "var(--space-4)", fontSize: 32, lineHeight: 1.4, maxWidth: 980, color: "var(--surface)" }}>
          整屏反色，是为了让一句话站到台前。白底字幕框在墨底上依旧成立。
        </BodyCopy>
        {/* 右下小 mono 注 */}
        <span
          data-testid="ink-note"
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-label)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--surface)",
          }}
        >
          INK — 墨底大字
        </span>
      </div>
    </SlideShell>
  );
}

/* ── Slide 19 · 研究简报 = 新屏 F（cobalt-grid 图纸网格 + StepStairs 阶梯卡组；强调色：orange 单色） ── */

const BRIEF_BLOCKS = [
  { label: "01", value: "42%", note: "参与度提升" },
  { label: "02", value: "2.7×", note: "吞吐倍数" },
  { label: "03", value: "25", note: "屏数 · 本套" },
];

function BriefingSlide() {
  return (
    <SlideShell index="19" topbar="RESEARCH BRIEF" pill="FIG. A" caption="简报，也是一张画">
      {/* 氛围层（豁免安全框）：淡网格底（CSS 细线 1px 网格，极淡墨） */}
      <div
        data-testid="brief-grid"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "linear-gradient(rgba(15, 15, 15, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 15, 15, 0.05) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* 二十五轮 F4：标题行净空——headline 独占整行（右侧无任何元素），间距 --headline-gap */}
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          研究简报。
        </HeroTitle>
        {/* 下方行：左栏 Kicker/导语 + 右栏阶梯卡组（整体再下沉一个 --space-3——距 headline = --headline-gap + --space-3） */}
        <div style={{ flex: 1, display: "flex", gap: "var(--space-6)", minHeight: 0, marginTop: "var(--space-3)" }}>
          <div style={{ width: 620, display: "flex", flexDirection: "column" }}>
            <Kicker variant="plain" data-testid="brief-kicker" style={{ fontSize: 24, letterSpacing: "0.12em", color: "var(--text-mute)" }}>
              BRIEF — 数据速读
            </Kicker>
            <BodyCopy style={{ marginTop: "var(--space-3)", maxWidth: 560 }}>
              三个读数，一级一阶。把关键数字排成可以扫读的阶梯，就是一张简报。
            </BodyCopy>
          </div>
          {/* StepStairs 阶梯卡组（二十五轮 F4 收编组件：左高右低 24px 步进 + 墨/cream 交替 + 零阴影）；
              --accent-1 → orange 使 NumberPill accent 走本屏单强调色 */}
          <div
            data-testid="brief-steps"
            style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", ...scope({ "--accent-1": "var(--accent-3)" }) }}
          >
            <StepStairs items={BRIEF_BLOCKS} data-testid="brief-stairs" />
          </div>
        </div>
        {/* 底部 hairline 数据注 */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: "var(--space-4)" }}>
          <Rule variant="solid" style={scope({ "--rule-w": "3px", margin: "0 0 var(--space-2)" })} />
          <span
            data-testid="brief-fig"
            style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.06em", color: "var(--text-mute)" }}
          >
            FIG. A — 阶梯读数
          </span>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 20 · 核心指标 = 参考 emerald-editorial s7 + S3 同构统计格（KPI 四格 + delta 涨跌标签；涨橙跌绿语义） ── */

const KPI_CELLS = [
  { index: "/01", label: "营业收入 · 百万元", value: "27,930", delta: "▲ +9.52%", desc: "收入规模稳步抬升，再上台阶。" },
  { index: "/02", label: "归母净利 · 百万元", value: "13,702", delta: "▲ +42.18%", desc: "利润增速领跑，成色十足。" },
  { index: "/03", label: "总资产 · 百万元", value: "975,484", delta: "▲ +28.57%", desc: "资产盘子继续扩张，逼近万亿。" },
  { index: "/04", label: "归母权益 · 百万元", value: "156,111", delta: "▲ +27.93%", desc: "股东权益同步增厚，家底更实。" },
];

function KeyMetricsSlide() {
  return (
    <SlideShell index="20" topbar="KEY METRICS" pill="FY2025" caption="四个数字，看懂一年">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          四个数字，看懂一年。
        </HeroTitle>
        {/* 2×2 满幅网格——与 S3 BY THE NUMBERS 同构 StatCell（二十四轮 M2b：角标/数字/标签/描述四件套 + delta 标签；
            二十五轮 F5 收编组件：delta 右置头行、up 橙字——A股涨橙语义）；
            cream 底（无对角填充——财报屏克制，涨跌语义色已由 delta 橙字承载） */}
        <Grid
          variant="even"
          columns={2}
          data-testid="kpi-grid"
          style={{ flex: 1, marginBottom: "var(--space-3)", gridTemplateRows: "1fr 1fr" }}
        >
          {KPI_CELLS.map((cell, i) => (
            <StatCell
              key={cell.label}
              index={cell.index}
              value={cell.value}
              label={cell.label}
              desc={cell.desc}
              delta={cell.delta}
              deltaTone="up"
              data-testid={`kpi-cell-${i + 1}`}
            />
          ))}
        </Grid>
        {/* 底部数据来源小注 */}
        <BodyCopy data-testid="kpi-source" style={{ fontSize: 24, lineHeight: 1.3, marginBottom: "var(--space-2)", color: "var(--text-mute)" }}>
          数据取自 2025 年年度报告 · 示例解读。
        </BodyCopy>
      </div>
    </SlideShell>
  );
}

/* ── Slide 21 · 双年对比柱状图 = 参考 emerald-editorial s5（双色柱组 + y 轴 + 图例；强调色：green） ── */

const YOY_GROUPS = [
  { group: "营业收入", year24: 25502, year25: 27930 },
  { group: "归母净利", year24: 9637, year25: 13702 },
];
const YOY_MAX = 30000; // 千元上限：y 轴 0/10,000/20,000/30,000 百万元
const YOY_TICKS = [0, 10000, 20000, 30000];

/** 双年柱组：2024 灰 surface-2 柱 + 2025 绿 accent-1 柱（4px 墨框）；柱高 = 数值 / YOY_MAX（审计断言依据）。
    组容器须显式 height 100%（% 柱高的解析基准——父级 flex 不撑高会致 % 解析为 0） */
function YearBarGroup({ group }: { group: (typeof YOY_GROUPS)[number] }) {
  const slug = group.group === "营业收入" ? "rev" : "profit";
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-2)", height: "100%" }}>
      <div
        data-testid={`yoy-bar-${slug}-24`}
        style={{ width: 140, height: `${(group.year24 / YOY_MAX) * 100}%`, background: "var(--surface-2)", border: "4px solid var(--text)" }}
      />
      <div
        data-testid={`yoy-bar-${slug}-25`}
        style={{ width: 140, height: `${(group.year25 / YOY_MAX) * 100}%`, background: "var(--accent-1)", border: "4px solid var(--text)" }}
      />
    </div>
  );
}

function YearOverYearSlide() {
  return (
    <SlideShell index="21" topbar="YEAR ON YEAR" pill="2024 VS 2025" caption="两年对比，看增长成色">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          两年对比，看增长成色。
        </HeroTitle>
        {/* 图表区（flex:1）：左 y 轴 mono 刻度（0/10,000/20,000/30,000 百万元）+ 右绘图区（网格线 + 两组双柱） */}
        <div data-testid="yoy-chart" style={{ flex: 1, position: "relative" }}>
          <span
            style={{
              position: "absolute",
              top: -32,
              left: 0,
              width: 150,
              fontFamily: "var(--font-mono)",
              fontSize: 18,
              letterSpacing: "0.08em",
              color: "var(--text-mute)",
            }}
          >
            百万元
          </span>
          {/* y 轴刻度：与网格线同 top% 定位（0%/33.33%/66.67%/100%），translateY(-50%) 居中于线 */}
          <div data-testid="yoy-axis" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 150 }}>
            {YOY_TICKS.map((v, i) => (
              <span
                key={v}
                style={{
                  position: "absolute",
                  top: `${i * (100 / (YOY_TICKS.length - 1))}%`,
                  right: 0,
                  transform: "translateY(-50%)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 24,
                  letterSpacing: "0.04em",
                  color: "var(--text-mute)",
                }}
              >
                {v.toLocaleString("en-US")}
              </span>
            ))}
          </div>
          {/* 绘图区：left 170（轴区 150 + 20 间隙）；网格线 3px surface-2 + 柱组 space-around 贴底 */}
          <div data-testid="yoy-plot" style={{ position: "absolute", top: 0, bottom: 0, left: 170, right: 0 }}>
            {YOY_TICKS.map((_, i) => (
              <div
                key={i}
                style={{ position: "absolute", top: `${i * (100 / (YOY_TICKS.length - 1))}%`, left: 0, right: 0, borderTop: "3px solid var(--surface-2)" }}
              />
            ))}
            <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "space-around", alignItems: "flex-end" }}>
              {YOY_GROUPS.map((g) => (
                <YearBarGroup key={g.group} group={g} />
              ))}
            </div>
          </div>
        </div>
        {/* x 轴组标：与柱组同骨架（paddingLeft 170 + space-around），组标居中对齐柱组中心 */}
        <div style={{ display: "flex", justifyContent: "space-around", paddingLeft: 170, marginTop: "var(--space-2)" }}>
          {YOY_GROUPS.map((g) => (
            <span
              key={g.group}
              style={{ width: 288, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.1em", color: "var(--text)" }}
            >
              {g.group}
            </span>
          ))}
        </div>
        {/* 图例行：2024 灰块 / 2025 绿块（16px 色块 + 2px 墨框，S4 图例格式）+ mono 标签 */}
        <div
          data-testid="yoy-legend"
          style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "var(--space-5)", marginTop: "var(--space-3)" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <div data-testid="yoy-legend-24" style={{ width: 16, height: 16, background: "var(--surface-2)", border: "2px solid var(--text)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.08em", color: "var(--text-mute)" }}>2024 年</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <div data-testid="yoy-legend-25" style={{ width: 16, height: 16, background: "var(--accent-1)", border: "2px solid var(--text)" }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.08em", color: "var(--text-mute)" }}>2025 年</span>
          </div>
        </div>
        {/* 图注：2024 推算值 + 数据诚实小注 */}
        <span
          data-testid="yoy-note"
          style={{
            display: "block",
            marginTop: "var(--space-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 24,
            letterSpacing: "0.06em",
            color: "var(--text-mute)",
          }}
        >
          2024 为按同比推算值 · 数据取自 2025 年年度报告 · 示例解读
        </span>
      </div>
    </SlideShell>
  );
}

/* ── Slide 22 · 业务分部 = 分类条形逐类一色（季度规则复用；强调色：四色序列语义） ── */

const SEG_ROWS = [
  // 分类/季度类条形图每季一色（二十二轮 F2 规则，优先于每屏 2-3 强调色纪律）；tone = null 吃默认 accent-1 绿
  { label: "经纪及财富管理", value: 0.38, text: "38%", tone: null }, // 绿
  { label: "投资银行", value: 0.22, text: "22%", tone: "var(--accent-2)" }, // 粉
  { label: "资产管理", value: 0.26, text: "26%", tone: "var(--accent-3)" }, // 橙
  { label: "自营投资", value: 0.14, text: "14%", tone: "var(--accent-4)" }, // 黄
];

function BusinessSegmentsSlide() {
  return (
    <SlideShell index="22" topbar="BUSINESS SEGMENTS" pill="FOUR LINES" caption="四条业务线，各撑一片天">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          四条业务线，各撑一片天。
        </HeroTitle>
        {/* 4 行横向条形图：mono 标签 + BarGrow accent（逐类一色 scope）+ mono 占比数值；行高 56px（.sg-seg-rows） */}
        <div
          data-testid="seg-rows"
          className="sg-seg-rows"
          style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "var(--space-3)" }}
        >
          {SEG_ROWS.map((row, i) => (
            <div key={row.label} data-testid={`seg-row-${i + 1}`} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.08em", width: 240, color: "var(--text)" }}>
                {row.label}
              </span>
              <div style={{ flex: 1, ...(row.tone ? scope({ "--accent-1": row.tone }) : undefined) }}>
                <BarGrow value={row.value} variant="accent" />
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, width: 64, textAlign: "right", color: "var(--text)" }}>
                {row.text}
              </span>
            </div>
          ))}
        </div>
        {/* 底部 mono 注（占比口径 + 数据诚实小注） */}
        <span
          data-testid="seg-note"
          style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.06em", color: "var(--text-mute)", marginTop: "var(--space-3)" }}
        >
          收入贡献占比 · 示例数据 · 数据取自 2025 年年度报告
        </span>
      </div>
    </SlideShell>
  );
}

/* ── Slide 23 · 资产负债表速览 = 结构条 84/16 两段 + 三数字（强调色：green） ── */

const BS_NUMBERS = [
  { value: "975,484", label: "总资产 · 百万元" },
  { value: "≈819,373", label: "总负债 · 百万元 · 按同比推算" },
  { value: "156,111", label: "归母权益 · 百万元" },
];

function BalanceSheetSlide() {
  return (
    <SlideShell index="23" topbar="BALANCE SHEET" pill="SNAPSHOT" caption="资产负债，一眼看清">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          资产负债，一眼看清。
        </HeroTitle>
        {/* 结构条 + 三数字作为居中单元（flex:1 垂直居中）；note 行贴底 */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {/* 两段式结构条：负债段墨 84.0% + 权益段绿 16.0%，4px 墨框（审计断言 84/16） */}
          <div data-testid="bs-bar" style={{ display: "flex", height: 72, border: "4px solid var(--text)" }}>
            <div
              data-testid="bs-liab"
              style={{
                width: "84%",
                background: "var(--surface-3)",
                color: "var(--surface)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.08em" }}>负债 84.0%</span>
            </div>
            <div
              data-testid="bs-equity"
              style={{
                flex: 1,
                background: "var(--accent-1)",
                color: "var(--surface)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.08em" }}>权益 16.0%</span>
            </div>
          </div>
          {/* 三数字行：HeroNumber + mono 标签（总负债为按同比推算值，≈ 标注） */}
          <div data-testid="bs-numbers" style={{ display: "flex", gap: "var(--space-6)", marginTop: "var(--space-5)" }}>
            {BS_NUMBERS.map((n) => (
              <div key={n.value} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <HeroNumber value={n.value} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.08em", color: "var(--text-mute)" }}>
                  {n.label}
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* note 行：杠杆比率 + 数据诚实小注 */}
        <span
          data-testid="bs-note"
          style={{ fontFamily: "var(--font-mono)", fontSize: 24, letterSpacing: "0.06em", color: "var(--text-mute)", marginTop: "var(--space-3)" }}
        >
          净资产/负债比率 27.93% · 净资本/负债 20.00% · 数据取自 2025 年年度报告
        </span>
      </div>
    </SlideShell>
  );
}

/* ── Slide 24 · 年度亮点与展望 = 参考 monochrome s6（有序列表 + 页边注窄栏；强调色：green） ── */

const HIGHLIGHT_ITEMS = [
  { title: "净利 +42.18%", desc: "增幅领跑。" },
  { title: "每股收益 1.68 元", desc: "同比 +46.09%。" },
  { title: "总资产 975,484 百万元", desc: "逼近万亿。" },
  { title: "ROE 10.16%", desc: "稳步向上。" },
  { title: "每股权益 17.07 元", desc: "扣永续债口径。" },
];

/** A股涨跌语义（二十四轮全局落地）：文本内 "+NN.NN%" 增减片段 → accent-3 橙字
    （涨橙/跌绿规则，本 deck 无跌例）；无涨跌片段的文本原样 */
function DeltaText({ text }: { text: string }) {
  const m = text.match(/\+[0-9]+(?:\.[0-9]+)?%/);
  if (!m || m.index === undefined) return <>{text}</>;
  return (
    <>
      {text.slice(0, m.index)}
      <span style={{ color: "var(--accent-3)" }}>{m[0]}</span>
      {text.slice(m.index + m[0].length)}
    </>
  );
}

function HighlightsSlide() {
  return (
    <SlideShell index="24" topbar="HIGHLIGHTS & OUTLOOK" pill="FIVE NOTES" caption="五个亮点，一个展望">
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <HeroTitle size="display-2" style={{ lineHeight: 0.95, marginBottom: "var(--headline-gap)" }}>
          五个亮点，一个展望。
        </HeroTitle>
        {/* 主体：五条有序列表（NumberPill accent 1-5 + Kicker 标题 + BodyCopy 一句）+ 右侧页边注窄栏 */}
        <div style={{ flex: 1, display: "flex", gap: "var(--space-5)", alignItems: "stretch" }}>
          <div data-testid="hl-list" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "var(--space-4)" }}>
            {HIGHLIGHT_ITEMS.map((item, i) => (
              <div key={item.title} data-testid={`hl-item-${i + 1}`} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
                <NumberPill number={`0${i + 1}`} variant="accent" data-testid={`hl-pill-${i + 1}`} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Kicker variant="plain" style={{ fontSize: 34, lineHeight: 1, fontWeight: 700, letterSpacing: "0.04em" }}>
                    <DeltaText text={item.title} />
                  </Kicker>
                  <BodyCopy style={{ fontSize: 24, lineHeight: 1.4, color: "var(--text-2)" }}>
                    <DeltaText text={item.desc} />
                  </BodyCopy>
                </div>
              </div>
            ))}
          </div>
          {/* 页边注窄栏：280px（hairline 3px 墨左边线 + mono 小注） */}
          <aside
            data-testid="hl-sidebar"
            style={{
              width: 280,
              boxSizing: "border-box", // 页边注窄栏实测 280px（含 3px hairline + 内衬——审计断言依据）
              borderLeft: "3px solid var(--text)",
              paddingLeft: "var(--space-3)",
              display: "flex",
              alignItems: "flex-start",
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 20, lineHeight: 1.6, letterSpacing: "0.04em", color: "var(--text-mute)" }}>
              注：数据取自 2025 年年度报告，供示例解读使用
            </span>
          </aside>
        </div>
        {/* 底部展望一行 */}
        <BodyCopy data-testid="hl-outlook" style={{ marginTop: "var(--space-4)" }}>
          展望：财富管理转型与国际化布局，仍是主线。
        </BodyCopy>
      </div>
    </SlideShell>
  );
}

/* ── Slide 25 · 收尾 = 参考 s8（整屏绿底；强调色：pink 印章） ── */

function ClosingSlide() {
  return (
    <SlideShell
      index="25"
      topbar="END OF DECK"
      pill="FIN."
      caption="谢谢观看"
      bg="var(--accent-1)"
      invert
    >
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* 主标题（featured）：stamp 变体（墨底 cream 字）+ 24px pink 硬阴影——本屏 featured 独一份 */}
        <HeroTitle
          variant="stamp"
          size="display-1"
          style={{
            lineHeight: 1,
            alignSelf: "flex-start",
            marginTop: "var(--space-5)",
            boxShadow: SHADOW_PINK,
          }}
        >
          谢谢观看。
        </HeroTitle>
        {/* strap 一句（cream 字，四轮 F2：与 headline 拉开 96px——用户仍嫌 48px 近） */}
        <BodyCopy
          style={{
            marginTop: "var(--headline-gap)", // 十一轮 F1：96 → 64 统一（旧值注释见报告）
            maxWidth: 1000,
            fontSize: 32,
            lineHeight: 1.4,
            color: "var(--surface)",
          }}
        >
          把口播稿，做成会动的网页。这是 creative-mode 主题的完整视觉表达。
        </BodyCopy>
        {/* 印章（参考 s8 stamp）：pink 方块 -6deg + cream 圆环内框 + mono "25/25" + "M2B"；
            内移 32px 使旋转 bbox 落回内容带 */}
        <div
          data-testid="closing-seal"
          aria-hidden="true"
          style={{
            position: "absolute",
            right: "var(--space-4)",
            bottom: "var(--space-4)",
            width: 340,
            height: 340,
            background: "var(--accent-2)",
            border: "4px solid var(--surface)",
            transform: "rotate(-6deg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "68%",
              height: "68%",
              border: "4px solid var(--surface)",
              borderRadius: "50%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 48,
                lineHeight: 1,
                letterSpacing: "0.04em",
                color: "var(--surface)",
              }}
            >
              25/25
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 24,
                letterSpacing: "0.12em",
                color: "var(--surface)",
              }}
            >
              M2B
            </span>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/** 主题效果页（?showcase=1 dev-only 验收工具，与 FontPreview 同级） */
export function ThemeShowcase() {
  // 十二轮 F3：8 秒循环重播——main 挂 key 强制整组 slide 重挂，入场动画/氛围微动循环重播
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setCycle((c) => c + 1), 8000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div style={{ minHeight: "100vh", background: "var(--shell)", paddingTop: 64, paddingBottom: 120 }}>
      <style>{SHOWCASE_TWEAKS}</style>
      <header
        style={{
          width: 1920,
          margin: "0 auto 72px",
          padding: "0 96px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--surface)",
          }}
        >
          creative-mode · 主题效果页 · 25 屏 slide deck · 参考构图 s1–s8 + scatterbrain / sakura-chroma / editorial-forest / emerald-editorial / monochrome + supper-club / bold-poster / retro-windows / pin-and-paper / studio / cobalt-grid · 动画每 8 秒循环重播
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--surface)",
            border: "2px solid var(--surface)",
            borderRadius: 999,
            padding: "6px 14px",
          }}
        >
          DEV-ONLY · ?showcase=1&guides=1
        </span>
      </header>
      <main key={cycle} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 96 }}>
        <CoverSlide />
        <ChapterSlide />
        <DataSlide />
        <DiagramSlide />
        <ChartSlide />
        <FlowSlide />
        <CompareSlide />
        <MediaSlide />
        <MotionLabSlide />
        <MenuSlide />
        <PosterSlide />
        <TerminalSlide />
        <StickyWallSlide />
        <RoadmapSlide />
        <SpecSheetSlide />
        <QuarterlyReviewSlide />
        <BeforeAfterSlide />
        <InkSlide />
        <BriefingSlide />
        <KeyMetricsSlide />
        <YearOverYearSlide />
        <BusinessSegmentsSlide />
        <BalanceSheetSlide />
        <HighlightsSlide />
        <ClosingSlide />
      </main>
    </div>
  );
}
