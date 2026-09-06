// 主题效果页（M2b 验收用；dev-only，不入章节层）。
// ?showcase=1 渲染：11 屏 1920×1080 slide deck——每屏带统一 chrome frame
// （topbar 48px/64px + 内容带 96px gutter、垂直 y 112–934 + 字幕保留区 y[958,1038]；meta 页码条已删）。
// 构图纪律（用户反馈终审）：九轮补齐参考 8 屏 + 十轮 F5 扩到 11 屏——
// S1=参考 s1 封面 / S2=参考 s2 章节开篇 / S3=参考 s3 数据屏（2×2 满幅零阴影网格）/ S4=参考 s4 系统示意（StackedBlocks 组件）/
// S5=参考 s5 柱状图（4 行横向条）/ S6=参考 s6 流程屏（4 步卡 + dashed 线，箭头已按用户拍板删除）/
// S7=参考 s7 对比屏（彩色列表格，徽章已按用户拍板删除）/ S8=媒体 3:4 素材（用户点名竖屏占位）/
// S9=动效实验室（全部动效词汇）/ S10=语录宣言（情绪收束）/ S11=参考 s8 收尾屏（绿底 + stamp 标题 + 印章）。
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
  NumberPill,
  PathDraw,
  ProgressDots,
  QuoteBlock,
  Rule,
  SeededParticles,
  StackedBlocks,
  StagePad,
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

/** dev 页结构性微调（零颜色，仅尺寸）；自含 <style>，不入组件 CSS */
const SHOWCASE_TWEAKS = `
.sg-compare-table { height: 100%; }
.sg-compare-table thead th { height: 96px; }
.sg-compare-table thead th:first-child, .sg-compare-table tbody td:first-child { width: 30%; }
.sg-compare-table tbody td:first-child { background: var(--surface); font-weight: 700; }
.sg-bar-rows .cdp-bar-grow { height: 56px; }
.sg-portrait .cdp-figure { height: 100%; }
.sg-portrait .cdp-figure-placeholder { min-height: 0; height: 100%; }
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
  index: string; // "01".."11"
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
        {/* 主标题区（featured）：marker-block 式——pink 底 + 24px 双层硬阴影（orange 偏移 + 4px ink 描边） */}
        <div
          data-testid="featured-title"
          style={{
            background: "var(--accent-2)",
            border: "4px solid var(--surface-3)",
            padding: "40px 56px",
            boxShadow: SHADOW_ORANGE,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display-en)",
              fontSize: "var(--t-display-1)", // 六轮 F1：160 硬编码 → token（130px 用户定稿尝试值）
              lineHeight: 0.92,
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
              color: "var(--surface-3)",
            }}
          >
            CREATIVE
          </div>
          <div
            style={{
              fontFamily: "var(--font-display-cn)",
              fontWeight: 900,
              fontSize: "var(--t-display-1)",
              lineHeight: 1,
              color: "var(--surface-3)",
              marginTop: 12,
            }}
          >
            创意模式
          </div>
        </div>
        {/* 装饰行：accent 色条 + glow 圆点 + solid 色条 */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "auto" }}>
          <DecorBar variant="accent" style={{ background: "var(--accent-2)" }} />
          <DecorDot variant="glow" style={{ background: "var(--accent-2)", boxShadow: "0 0 var(--space-4) var(--accent-2)" }} />
          <DecorBar variant="solid" />
        </div>
        {/* 宣言（pink 底墨字） */}
        <QuoteBlock variant="block" style={{ background: "var(--accent-2)", color: "var(--surface-3)" }}>
          把口播稿，做成会动的网页。
        </QuoteBlock>
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
                <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--t-h3)", color: "var(--text)" }}>
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
            }}
          >
            <Kicker style={{ background: "none", color: "var(--surface)", padding: 0 }}>FLIP THE SWITCH.</Kicker>
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

/* ── Slide 3 · 数据冲击 = 参考 s3（强调色：green + pink + orange；yellow 不出场） ── */

/** 数据格（参考 s3 cell）：mono 角标 /0N（右上）+ 大数字 + mono 标签 + 一句描述；
    bg 按参考序列 green → pink → cream → orange；亮底配墨字、green/orange 底配 cream 字 */
function StatCell({
  corner,
  value,
  label,
  desc,
  bg,
  ink = true,
  testid,
}: {
  corner: string;
  value: string;
  label: string;
  desc: string;
  bg: string;
  ink?: boolean;
  testid?: string;
}) {
  const textScope = ink ? {} : scope({ "--text": "var(--surface)", "--text-2": "var(--surface)" });
  return (
    <div style={{ display: "flex", ...textScope }}>
      <Card
        variant="plain"
        data-testid={testid}
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "20px 28px", // 十一轮 F1：收紧使 64px headline-gap 下网格不撑破内容带
          background: bg,
        }}
      >
        <Kicker
          style={{
            position: "absolute",
            top: 20,
            right: 28,
            background: "none",
            color: "inherit",
            padding: 0,
            fontSize: 24,
            letterSpacing: "0.1em",
          }}
        >
          {corner}
        </Kicker>
        <div style={{ paddingTop: 16 }}>
          <HeroNumber value={value} />
        </div>
        <div>
          <Kicker
            style={{ background: "none", color: "inherit", padding: 0, fontSize: 24, letterSpacing: "0.12em" }}
          >
            {label}
          </Kicker>
          <BodyCopy style={{ fontSize: 24, lineHeight: 1.3, marginTop: 4, maxWidth: 520 }}>{desc}</BodyCopy>
        </div>
      </Card>
    </div>
  );
}

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
        {/* 2×2 满幅网格：零阴影（--shadow-card-sm none）、格间隙 var(--grid-gutter) 28px */}
        <Grid
          variant="even"
          columns={2}
          data-testid="stat-grid"
          style={{ flex: 1, marginBottom: "var(--space-3)", gridTemplateRows: "1fr 1fr", ...scope({ "--shadow-card-sm": "none" }) }}
        >
          <StatCell
            corner="/01"
            value="42%"
            label="参与度提升"
            desc="参与度相对基线提升 42 个百分点。"
            bg="var(--accent-1)"
            ink={false}
            testid="stat-cell-1"
          />
          <StatCell
            corner="/02"
            value="2.7×"
            label="吞吐倍数"
            desc="同一份口播稿的产出吞吐提升 2.7 倍。"
            bg="var(--accent-2)"
            testid="stat-cell-2"
          />
          <StatCell
            corner="/03"
            value="118"
            label="活跃占位"
            desc="活跃占位组件 118 个，随稿迭代。"
            bg="var(--surface)"
            testid="stat-cell-3"
          />
          <StatCell
            corner="/04"
            value="$9.4M"
            label="样本总值"
            desc="样本数据总值 940 万美元。"
            bg="var(--accent-3)"
            ink={false}
            testid="stat-cell-4"
          />
        </Grid>
        {/* 底部一行（宽松 gap 48，只放 3 个）：动效完成度条 + 帧计数器 + 转化率环 */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 48,
            marginBottom: "var(--space-2)", // 12px 卡片阴影落点收在内容带内
          }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <Kicker variant="block" style={{ alignSelf: "flex-start" }}>
              70% · 动效完成度
            </Kicker>
            <BarGrow value={0.7} variant="accent" />
          </div>
          <div style={scope({ "--t-display-2": "48px" })}>
            <Card
              variant="plain"
              data-testid="frames-card"
              style={{
                padding: "var(--space-3)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <Kicker variant="block">FRAMES</Kicker>
              <Counter to={47} />
            </Card>
          </div>
          <DonutMeter value={0.42} label="转化率" />
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
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--t-h3)", color: "var(--text)" }}>
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
              <Kicker style={{ background: "none", padding: 0, color: "var(--text)", fontSize: "var(--t-label)" }}>
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
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text)", width: 100 }}>
                        {layer.mono}
                      </span>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: "var(--t-h3)", lineHeight: 1.2, color: "var(--text)" }}>
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
  // tone = null 表示吃默认 accent-1（green）——不可 scope 覆写 --accent-1: var(--accent-1)（自引用循环 → 透明）
  { label: "Q1 '24", value: 0.34, text: "34", tone: null },
  { label: "Q2 '24", value: 0.48, text: "48", tone: "var(--accent-2)" },
  { label: "Q3 '24", value: 0.61, text: "61", tone: "var(--accent-3)" },
  { label: "Q4 '24", value: 0.55, text: "55", tone: null },
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
        style={{
          background: "none",
          color: creamText ? "var(--surface)" : "var(--text)",
          padding: 0,
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
        {/* 3 个 3:4 竖屏 Figure placeholder（frame 变体，零阴影 scope）+ 第 4 个 KenBurns 无 src placeholder。
            十二轮 F3：StaggerRow 逐个错峰 rise 入场，KenBurns 保持 slow 缓推 */}
        <StaggerRow
          stagger
          reveal="rise"
          duration="mid"
          data-testid="portrait-row"
          style={{ display: "flex", gap: "var(--space-4)", ...scope({ "--shadow-card": "none" }) }}
        >
          {PORTRAIT_ITEMS.map((item) => (
            <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div
                className="sg-portrait"
                style={{ width: 400, height: 533, boxSizing: "border-box", border: "4px solid var(--surface-3)" }}
              >
                {item.kind === "figure" ? (
                  <Figure variant="frame" data-testid={`portrait-${item.id}`} />
                ) : (
                  <KenBurns duration="slow" data-testid="portrait-kenburns" />
                )}
              </div>
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

/* ── Slide 10 · 语录宣言 = 杂志正页（十二轮 F4：刊头 + 三行大字错位 + 两栏 + folio + 水印；
     墨/cream 为主 + pink 单点缀） ── */

/** 宣言大字行（display-1 130px / lh 0.92；hanging indent 由 marginLeft 错位） */
function ManifestLine({ text, indent }: { text: string; indent?: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-display-cn)",
        fontWeight: 900,
        fontSize: "var(--t-display-1)",
        lineHeight: 0.92,
        color: "var(--text)",
        marginLeft: indent,
      }}
    >
      {text}
    </div>
  );
}

/** 本期内容六项（页码与屏号对应，11 屏中选六） */
const MANIFESTO_TOC = ["01 封面", "03 数据", "04 结构", "07 对比", "09 动效", "11 收尾"];

function QuoteSlide() {
  return (
    <SlideShell index="10" topbar="MANIFESTO" pill="QUOTE" caption="一句话，就够了">
      <div style={{ position: "relative", flex: 1, display: "flex", gap: "var(--space-6)" }}>
        {/* 超大 "01" 期号水印（cream-2 · display-1 · 右上低透明，渲染在内容之下） */}
        <div
          aria-hidden="true"
          data-testid="manifesto-watermark"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            fontFamily: "var(--font-display-en)",
            fontSize: "var(--t-display-1)",
            lineHeight: 1,
            color: "var(--surface-2)",
            opacity: 0.35,
          }}
        >
          01
        </div>
        {/* 左侧窄栏（~280px 垂直贯穿）：序号 + 栏名 + hairline + 期号 + 专栏小目录 */}
        <div data-testid="manifesto-sidebar" style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <NumberPill number="01" variant="accent" />
          <Kicker style={{ background: "none", padding: 0, color: "var(--text)", fontSize: "var(--t-label)" }}>
            MANIFESTO · 宣言
          </Kicker>
          <Rule variant="solid" style={scope({ "--rule-w": "3px", margin: "var(--space-2) 0 var(--space-3)" })} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text)" }}>
            VOL. 01 — M2B
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
            {["01 稿子", "02 分镜", "03 成片"].map((item) => (
              <span
                key={item}
                style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text-mute)" }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
        {/* 主体杂志正页 */}
        <div data-testid="manifesto-main" style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
          {/* 刊头行：刊名 + hairline + 期号 */}
          <div
            data-testid="manifesto-masthead"
            style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text)", whiteSpace: "nowrap" }}>
              CREATIVE MODE WEEKLY · 宣言专刊
            </span>
            <Rule variant="solid" style={{ flex: 1, ...scope({ "--rule-w": "3px", margin: "0" }) }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text)", whiteSpace: "nowrap" }}>
              VOL.01 · 2026.09.06
            </span>
          </div>
          {/* 三行大字（引号并入首行——正页信息量优先，hanging indent 错位保留） */}
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span
              aria-hidden="true"
              data-testid="manifesto-quote-mark"
              style={{ fontFamily: "var(--font-display-en)", fontSize: "var(--t-display-1)", lineHeight: 0.92, color: "var(--text)" }}
            >
              “
            </span>
            <span style={{ fontFamily: "var(--font-display-cn)", fontWeight: 900, fontSize: "var(--t-display-1)", lineHeight: 0.92, color: "var(--text)" }}>
              节奏，
            </span>
          </div>
          <ManifestLine text="由稿子" indent="var(--space-6)" />
          <ManifestLine text="决定。" indent="var(--space-3)" />
          {/* 大字下方两栏杂志栏（中间 3px hairline；headline-gap 64 对齐 F1） */}
          <div data-testid="manifesto-columns" style={{ marginTop: "var(--headline-gap)", display: "flex", gap: "var(--space-4)" }}>
            <div style={{ flex: 1.3, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <BodyCopy style={{ fontSize: "var(--t-label)", lineHeight: 1.4 }}>
                这是 creative-mode 主题的宣言页。口播稿定节奏，组件出构图，引擎驱动全部动效。
              </BodyCopy>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", lineHeight: 1, letterSpacing: "0.08em", color: "var(--text)" }}>
                FROM THE EDITOR
              </span>
            </div>
            <div style={{ width: 3, alignSelf: "stretch", background: "var(--text)" }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", lineHeight: 1, letterSpacing: "0.08em", color: "var(--text)", marginBottom: "var(--space-1)" }}>
                本期内容
              </span>
              {MANIFESTO_TOC.map((item) => (
                <span key={item} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", lineHeight: 1, letterSpacing: "0.08em", color: "var(--text-mute)" }}>
                  {item}
                </span>
              ))}
              <QuoteBlock
                variant="block"
                data-testid="manifesto-quote"
                style={{
                  background: "var(--accent-2)",
                  color: "var(--surface-3)",
                  padding: "var(--space-1) var(--space-2)",
                  fontSize: "var(--t-label)",
                  alignSelf: "flex-start",
                  marginTop: "var(--space-1)",
                }}
              >
                一句话，就够了。
              </QuoteBlock>
            </div>
          </div>
          {/* 页脚 folio */}
          <div data-testid="manifesto-folio" style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text-mute)" }}>
              CREATIVE MODE WEEKLY
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--t-label)", letterSpacing: "0.08em", color: "var(--text)" }}>
              P.01
            </span>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

/* ── Slide 11 · 收尾 = 参考 s8（整屏绿底；强调色：pink 印章） ── */

function ClosingSlide() {
  return (
    <SlideShell
      index="11"
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
        {/* 印章（参考 s8 stamp）：pink 方块 -6deg + cream 圆环内框 + mono "11/11" + "M2B"；
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
              11/11
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
          creative-mode · 主题效果页 · 11 屏 slide deck · 参考构图 s1–s8 + 素材/动效/语录 · 动画每 8 秒循环重播
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
        <QuoteSlide />
        <ClosingSlide />
      </main>
    </div>
  );
}
