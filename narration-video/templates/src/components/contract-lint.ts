// 组件契约 lint（§11.1 #9 内核）：组件 CSS 只消费 token——禁裸色值、禁裸 font-family、禁裸动画时长。
// M3a 门禁与本章节测试共用同一实现。
// Ruling P2-8：不用 node:fs + __dirname（ESM 无 __dirname、无 @types/node，tsc 必挂），
// 改用 Vite `?raw` 显式导入 32 个组件 CSS，lint 扫描这些字符串。

import heroTitleCss from "./text/HeroTitle.css?raw";
import kickerCss from "./text/Kicker.css?raw";
import bodyCopyCss from "./text/BodyCopy.css?raw";
import quoteBlockCss from "./text/QuoteBlock.css?raw";
import numberPillCss from "./text/NumberPill.css?raw";
import heroNumberCss from "./data/HeroNumber.css?raw";
import counterCss from "./data/Counter.css?raw";
import barGrowCss from "./data/BarGrow.css?raw";
import donutMeterCss from "./data/DonutMeter.css?raw";
import statCardCss from "./data/StatCard.css?raw";
import cardCss from "./structure/Card.css?raw";
import ruleCss from "./structure/Rule.css?raw";
import gridCss from "./structure/Grid.css?raw";
import stagePadCss from "./structure/StagePad.css?raw";
import tableCss from "./structure/Table.css?raw";
import splitCompareCss from "./structure/SplitCompare.css?raw";
import revealTextCss from "./reveal/RevealText.css?raw";
import revealListCss from "./reveal/RevealList.css?raw";
import stepSequenceCss from "./reveal/StepSequence.css?raw";
import decorDotCss from "./decor/DecorDot.css?raw";
import decorBarCss from "./decor/DecorBar.css?raw";
import decorRingCss from "./decor/DecorRing.css?raw";
import stackedBlocksCss from "./decor/StackedBlocks.css?raw";
import markerBlockCss from "./decor/MarkerBlock.css?raw";
import figureCss from "./media/Figure.css?raw";
import typedTerminalCss from "./media/TypedTerminal.css?raw";
import pathDrawCss from "./media/PathDraw.css?raw";
import seededParticlesCss from "./ambient/SeededParticles.css?raw";
import breatheCss from "./ambient/Breathe.css?raw";
import kenBurnsCss from "./ambient/KenBurns.css?raw";
import timelineTrackCss from "./function/TimelineTrack.css?raw";
import progressDotsCss from "./function/ProgressDots.css?raw";

export const COMPONENT_CSS: Array<{ file: string; css: string }> = [
  { file: "text/HeroTitle.css", css: heroTitleCss },
  { file: "text/Kicker.css", css: kickerCss },
  { file: "text/BodyCopy.css", css: bodyCopyCss },
  { file: "text/QuoteBlock.css", css: quoteBlockCss },
  { file: "text/NumberPill.css", css: numberPillCss },
  { file: "data/HeroNumber.css", css: heroNumberCss },
  { file: "data/Counter.css", css: counterCss },
  { file: "data/BarGrow.css", css: barGrowCss },
  { file: "data/DonutMeter.css", css: donutMeterCss },
  { file: "data/StatCard.css", css: statCardCss },
  { file: "structure/Card.css", css: cardCss },
  { file: "structure/Rule.css", css: ruleCss },
  { file: "structure/Grid.css", css: gridCss },
  { file: "structure/StagePad.css", css: stagePadCss },
  { file: "structure/Table.css", css: tableCss },
  { file: "structure/SplitCompare.css", css: splitCompareCss },
  { file: "reveal/RevealText.css", css: revealTextCss },
  { file: "reveal/RevealList.css", css: revealListCss },
  { file: "reveal/StepSequence.css", css: stepSequenceCss },
  { file: "decor/DecorDot.css", css: decorDotCss },
  { file: "decor/DecorBar.css", css: decorBarCss },
  { file: "decor/DecorRing.css", css: decorRingCss },
  { file: "decor/StackedBlocks.css", css: stackedBlocksCss },
  { file: "decor/MarkerBlock.css", css: markerBlockCss },
  { file: "media/Figure.css", css: figureCss },
  { file: "media/TypedTerminal.css", css: typedTerminalCss },
  { file: "media/PathDraw.css", css: pathDrawCss },
  { file: "ambient/SeededParticles.css", css: seededParticlesCss },
  { file: "ambient/Breathe.css", css: breatheCss },
  { file: "ambient/KenBurns.css", css: kenBurnsCss },
  { file: "function/TimelineTrack.css", css: timelineTrackCss },
  { file: "function/ProgressDots.css", css: progressDotsCss },
];

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const RGB_RE = /rgba?\(/;
const HSL_RE = /hsla?\(/;
const NAMED_COLOR_RE = /\b(red|blue|green|yellow|orange|purple|pink|cyan|magenta|tomato|gold|silver)\b/;
// 注意：负向前瞻必须写成 (?!\s*var\() 形式。若写成 \s*(?!var\()，
// \s* 可回溯为零宽，前瞻落在空白字符上而非 "var("，导致
// `font-family: var(--font-body)` 这类合规声明被误报（负样本正样本钉出）。
const FONT_RE = /font-family\s*:(?!\s*var\()/;
const DUR_RE = /animation-duration\s*:(?!\s*var\()/;
const TRANSITION_DUR_RE = /transition-duration\s*:(?!\s*var\()/;

// 终审 Recommendation 2：抽出纯函数核心（正则 + 逐行判定 + 违规消息），
// lintComponentCss 只是遍历 COMPONENT_CSS 的薄壳——负样本测试直接钉住核心。
export function lintCssText(css: string, label: string): string[] {
  const violations: string[] = [];
  const lines = css.split("\n");
  lines.forEach((line, i) => {
    const loc = `${label}:${i + 1}`;
    if (HEX_RE.test(line) || RGB_RE.test(line) || HSL_RE.test(line) || NAMED_COLOR_RE.test(line)) {
      violations.push(`${loc} 组件 CSS 出现裸色值（禁硬编码色，§11.1 #2）`);
    }
    if (FONT_RE.test(line)) {
      violations.push(`${loc} 组件 CSS 出现裸 font-family（须走 var(--font-*)，§11.1 #3）`);
    }
    if (DUR_RE.test(line) || TRANSITION_DUR_RE.test(line)) {
      violations.push(`${loc} 组件 CSS 出现裸动画时长（须走 var(--dur-*)，§11.1 #4）`);
    }
  });
  return violations;
}

export function lintComponentCss(): string[] {
  return COMPONENT_CSS.flatMap(({ file, css }) => lintCssText(css, file));
}

// 终审 I2：提取一段 CSS 里全部 var(--…) 引用（去重），供闭合测试
// 断言「组件 CSS 引用 ⊆ tokens.css 定义」。与 theme-validate 的 VAR_RE 同型。
const VAR_REF_RE = /var\(\s*(--[\w-]+)/g;

export function extractVarRefs(css: string): string[] {
  const refs = new Set<string>();
  for (const m of css.matchAll(VAR_REF_RE)) refs.add(m[1]);
  return [...refs];
}
