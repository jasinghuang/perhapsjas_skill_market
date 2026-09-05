// 主题效果页（M2b 验收用；dev-only，不入章节层）。
// ?showcase=1 渲染：两个 1920 宽舞台场景竖排展示，28 组件全部真实出场——
// 入场动画（reveal / counter / 打字机 / 路径自绘）与氛围微动（粒子 / 呼吸 / 缓推）页面打开即播放。
// 舞台尺寸与场景间距用少量 inline style（dev 工具页容器职责），组件本体与场景内构图全部走组件 + token。
import {
  BarGrow,
  BodyCopy,
  Breathe,
  Card,
  Counter,
  DecorBar,
  DecorDot,
  DecorRing,
  DonutMeter,
  Figure,
  Grid,
  HeroNumber,
  HeroTitle,
  KenBurns,
  Kicker,
  PathDraw,
  ProgressDots,
  QuoteBlock,
  RevealList,
  RevealText,
  Rule,
  SeededParticles,
  StagePad,
  StatCard,
  StepSequence,
  Table,
  TimelineTrack,
  TypedTerminal,
} from "./components";

/** 场景一 · 封面（archetype：封面）——CHAPTER kicker + 大标题 + 装饰色条行 + 宣言 + 分割线 */
function CoverScene() {
  return (
    <section
      style={{
        position: "relative",
        width: 1920,
        height: 1080,
        margin: "0 auto",
        boxSizing: "border-box",
        background: "var(--surface)",
        border: "var(--card-border)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      <StagePad>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
          <Kicker variant="block">场景一 · 封面</Kicker>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--space-4)" }}>
            <Kicker variant="pill">CHAPTER 01</Kicker>
            <HeroTitle reveal="rise">创意模式</HeroTitle>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <DecorBar variant="accent" />
              <DecorDot variant="glow" />
              <DecorBar variant="solid" />
            </div>
            <QuoteBlock variant="block">把口播稿，做成会动的网页。</QuoteBlock>
            <Rule />
          </div>
          <Card variant="plain">
            <Kicker variant="block">TOKENS</Kicker>
            <BodyCopy>surface cream · ink 墨 · 四色强调 green / pink / orange / yellow · 4px 墨框 · 24px 硬阴影 · 零圆角</BodyCopy>
          </Card>
        </div>
      </StagePad>
    </section>
  );
}

/** 场景二 · 数据冲击（archetype：数据冲击）——数据卡 + 动效条 + 流程 + 表格 + 媒体与功能组件 */
function DataScene() {
  return (
    <section
      style={{
        position: "relative",
        width: 1920,
        height: 2160,
        margin: "0 auto",
        boxSizing: "border-box",
        background: "var(--surface)",
        border: "var(--card-border)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      {/* 背景氛围块：KenBurns 无 src 走 placeholder，全幅垫底 */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.4 }}>
        <KenBurns duration="slow" />
      </div>
      {/* 顶部绝对定位背景：种子粒子。画布 400×300 等比拉伸（1920×1440 = 4.8× 均匀缩放），圆点不变形 */}
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 1440, opacity: 0.5, pointerEvents: "none" }}>
        <SeededParticles seed={42} count={40} />
      </div>
      <StagePad>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%" }}>
          <Kicker variant="block">场景二 · 数据冲击</Kicker>
          <Grid variant="half">
            <StatCard number="+47%" label="打开率" variant="accent" />
            <StatCard number="12x" label="产出速度" variant="invert" />
            <StatCard number="3.2s" label="首屏动效" variant="plain" />
            <StatCard number="98%" label="脚本贴合" variant="accent" />
          </Grid>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-4)" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <Kicker variant="block">70% · 动效完成度</Kicker>
              <BarGrow value={0.7} variant="accent" />
            </div>
            <HeroNumber value="+47%" variant="accent" countUp />
            <Card variant="plain">
              <Kicker variant="block">FRAMES</Kicker>
              <Counter to={47} />
            </Card>
            <DonutMeter value={0.42} label="转化率" />
            <Breathe cycles={3} />
            <DecorRing />
          </div>
          <Grid variant="half">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <RevealText text="从稿子到成片" preset="rise" />
              <StepSequence
                variant="cards"
                currentStep={2}
                steps={[
                  { title: "稿子", desc: "口播稿定节奏" },
                  { title: "分镜", desc: "每句一步视觉" },
                  { title: "成片", desc: "录制导出成片" },
                ]}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <RevealList
                items={["口播稿 → 步进节奏", "组件构图 → 主题 token", "动画 → 引擎驱动"]}
                activeCount={3}
                variant="numbered"
              />
              <Table
                header={["平台", "时长", "导出"]}
                rows={[
                  ["B站", "16:9", "mp4"],
                  ["小红书", "3:4", "mp4"],
                ]}
                variant="bordered"
              />
              <TimelineTrack points={["稿", "镜", "画", "声", "片"]} activeIndex={2} />
              <ProgressDots total={5} current={3} />
            </div>
          </Grid>
          <Grid variant="half">
            <Figure caption="素材占位" reveal="fade" />
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <TypedTerminal lines={["creative-mode", "四个强调色 · 4px 墨框 · 硬阴影"]} />
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <div style={{ width: 180 }}>
                  <PathDraw d="M 8 88 L 30 20 L 55 60 L 92 12" />
                </div>
                <Kicker variant="pill">PATH · 折线自绘</Kicker>
              </div>
            </div>
          </Grid>
        </div>
      </StagePad>
    </section>
  );
}

/** 主题效果页（?showcase=1 dev-only 验收工具，与 FontPreview 同级） */
export function ThemeShowcase() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--shell)" }}>
      <header
        style={{
          width: 1920,
          margin: "0 auto",
          padding: "48px var(--stage-pad-x) 24px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <Kicker variant="block" style={{ background: "var(--surface)", color: "var(--text)" }}>
            creative-mode 主题效果页
          </Kicker>
          <Kicker variant="pill" style={{ borderColor: "var(--surface)", color: "var(--surface)" }}>
            dev-only · ?showcase=1
          </Kicker>
        </div>
        <BodyCopy variant="lede" style={{ color: "var(--surface)" }}>
          28 组件全展示 · 四色强调 / 4px 墨框 / 24px 硬阴影 —— 入场动画与氛围微动打开即真实播放（M2b 验收用）
        </BodyCopy>
      </header>
      <main style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", padding: "0 0 96px" }}>
        <CoverScene />
        <DataScene />
      </main>
    </div>
  );
}
