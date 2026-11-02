// 组件注册表（单一事实来源）：组件库结构规范化的中枢——
// smoke.test.tsx 的 presence 清单、contract-lint 的 CSS 装配清单、StyleGuide 的目录
// 数量与组序全部由此派生（新增/改名组件只改本文件，派生点自动跟随；与
// components/index.ts 的静态导出清单由 check-fast 断言对齐）。
// 纯数据、零依赖——浏览器（Vite）与 Node（tsx 门禁/vitest）双环境可 import。

/** 组 id——同时是 components/ 下的目录名（cssPathOf 的路径首段）。 */
export type GroupId =
  | "text"
  | "data"
  | "structure"
  | "reveal"
  | "decor"
  | "media"
  | "ambient"
  | "chrome"
  | "chart";

export interface ComponentEntry {
  /** 导出名（PascalCase）——components/index.ts 的具名导出名。 */
  export: string;
  group: GroupId;
  /** 根类名 slug（.cdp-<class> 的 class 段）。历史例外（与导出名不同形）：
      DonutMeter→"donut"、DataItemRow→"data-item"、TypedTerminal→"terminal"、
      SeededParticles→"particles"、StepSequence→"step-seq"、TimelineTrack→"timeline"、
      KenBurns→"kenburns"、EChart→"echart"——以 smoke.test.tsx 既有 ALL_NAMES 为准。 */
  class: string;
}

/** 组展示顺序（TEXT → CHART）——StyleGuide 组标题与展示顺序的唯一来源。 */
export const GROUPS: { id: GroupId; labelEn: string; labelZh: string }[] = [
  { id: "text", labelEn: "TEXT", labelZh: "文字" },
  { id: "data", labelEn: "DATA", labelZh: "数据" },
  { id: "structure", labelEn: "STRUCTURE", labelZh: "结构" },
  { id: "reveal", labelEn: "REVEAL", labelZh: "揭示" },
  { id: "decor", labelEn: "DECOR", labelZh: "装饰" },
  { id: "media", labelEn: "MEDIA", labelZh: "素材" },
  { id: "ambient", labelEn: "AMBIENT", labelZh: "氛围" },
  { id: "chrome", labelEn: "CHROME", labelZh: "功能" },
  { id: "chart", labelEn: "CHART", labelZh: "图表" },
];

/** 44 组件（36 + 三十四轮 M2b 收编 8 内部件）。
    序 = smoke.test.tsx 既有 ALL_NAMES（class 序，逐条配对无遗漏无多余）——
    smoke 的 presence 遍历序因此逐字不变。 */
export const COMPONENTS: ComponentEntry[] = [
  { export: "StagePad", group: "structure", class: "stage-pad" },
  // TEXT · 文字（6）
  { export: "HeroTitle", group: "text", class: "hero-title" },
  { export: "Kicker", group: "text", class: "kicker" },
  { export: "BodyCopy", group: "text", class: "body-copy" },
  { export: "QuoteBlock", group: "text", class: "quote-block" },
  { export: "NumberPill", group: "text", class: "number-pill" },
  { export: "DeltaText", group: "text", class: "delta-text" },
  // DATA · 数据（9）
  { export: "HeroNumber", group: "data", class: "hero-number" },
  { export: "Counter", group: "data", class: "counter" },
  { export: "BarGrow", group: "data", class: "bar-grow" },
  { export: "DonutMeter", group: "data", class: "donut" },
  { export: "StatCard", group: "data", class: "stat-card" },
  { export: "StatCell", group: "data", class: "stat-cell" },
  { export: "StatInline", group: "data", class: "stat-inline" },
  { export: "YearBarGroup", group: "data", class: "year-bar-group" },
  { export: "DataItemRow", group: "data", class: "data-item" },
  // STRUCTURE · 结构（9）
  { export: "Card", group: "structure", class: "card" },
  { export: "Rule", group: "structure", class: "rule" },
  { export: "Grid", group: "structure", class: "grid" },
  { export: "Table", group: "structure", class: "table" },
  { export: "SplitCompare", group: "structure", class: "split-compare" },
  { export: "JisCheck", group: "structure", class: "jis-check" },
  { export: "StepCard", group: "structure", class: "step-card" },
  { export: "MotionCell", group: "structure", class: "motion-cell" },
  // REVEAL · 揭示（4）
  { export: "RevealText", group: "reveal", class: "reveal-text" },
  { export: "RevealList", group: "reveal", class: "reveal-list" },
  { export: "StepSequence", group: "reveal", class: "step-seq" },
  { export: "StaggerRow", group: "reveal", class: "stagger-row" },
  // DECOR · 装饰（7）
  { export: "DecorDot", group: "decor", class: "decor-dot" },
  { export: "DecorBar", group: "decor", class: "decor-bar" },
  { export: "DecorRing", group: "decor", class: "decor-ring" },
  { export: "StackedBlocks", group: "decor", class: "stacked-blocks" },
  { export: "MarkerBlock", group: "decor", class: "marker-block" },
  { export: "StepStairs", group: "decor", class: "step-stairs" },
  { export: "PostIt", group: "decor", class: "post-it" },
  // MEDIA · 素材（3）
  { export: "Figure", group: "media", class: "figure" },
  { export: "TypedTerminal", group: "media", class: "terminal" },
  { export: "PathDraw", group: "media", class: "path-draw" },
  // AMBIENT · 氛围（3）
  { export: "SeededParticles", group: "ambient", class: "particles" },
  { export: "Breathe", group: "ambient", class: "breathe" },
  { export: "KenBurns", group: "ambient", class: "kenburns" },
  // CHROME · 功能（2）
  { export: "TimelineTrack", group: "chrome", class: "timeline" },
  { export: "ProgressDots", group: "chrome", class: "progress-dots" },
  // CHART · 图表（1）
  { export: "EChart", group: "chart", class: "echart" },
];

/** 组件 CSS 路径（相对 components/）——"组/导出名.css"，与 index.ts 装配路径同格式。 */
export function cssPathOf(c: ComponentEntry): string {
  return `${c.group}/${c.export}.css`;
}
