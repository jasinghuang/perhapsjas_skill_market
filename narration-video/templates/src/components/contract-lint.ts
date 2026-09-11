// 组件契约 lint（§11.1 #9 内核）：组件 CSS 只消费 token——禁裸色值、禁裸 font-family、禁裸动画时长。
// M3a 门禁与本章节测试共用同一实现。
// Why here: 依赖 Vite ?raw 管线（src 内），不随内部件收纳（故留在 components/ 根，而非 _internal/）。
// Ruling P2-8：不用 node:fs + __dirname（ESM 无 __dirname、无 @types/node，tsc 必挂），
// 改用 Vite `?raw` 显式导入 44 个组件 CSS，lint 扫描这些字符串。

import { COMPONENTS, cssPathOf } from "./manifest";
import heroTitleCss from "./text/HeroTitle.css?raw";
import kickerCss from "./text/Kicker.css?raw";
import bodyCopyCss from "./text/BodyCopy.css?raw";
import quoteBlockCss from "./text/QuoteBlock.css?raw";
import numberPillCss from "./text/NumberPill.css?raw";
import deltaTextCss from "./text/DeltaText.css?raw";
import heroNumberCss from "./data/HeroNumber.css?raw";
import counterCss from "./data/Counter.css?raw";
import barGrowCss from "./data/BarGrow.css?raw";
import donutMeterCss from "./data/DonutMeter.css?raw";
import statCardCss from "./data/StatCard.css?raw";
import statCellCss from "./data/StatCell.css?raw";
import statInlineCss from "./data/StatInline.css?raw";
import yearBarGroupCss from "./data/YearBarGroup.css?raw";
import dataItemRowCss from "./data/DataItemRow.css?raw";
import cardCss from "./structure/Card.css?raw";
import ruleCss from "./structure/Rule.css?raw";
import gridCss from "./structure/Grid.css?raw";
import stagePadCss from "./structure/StagePad.css?raw";
import tableCss from "./structure/Table.css?raw";
import splitCompareCss from "./structure/SplitCompare.css?raw";
import jisCheckCss from "./structure/JisCheck.css?raw";
import stepCardCss from "./structure/StepCard.css?raw";
import motionCellCss from "./structure/MotionCell.css?raw";
import revealTextCss from "./reveal/RevealText.css?raw";
import revealListCss from "./reveal/RevealList.css?raw";
import stepSequenceCss from "./reveal/StepSequence.css?raw";
import staggerRowCss from "./reveal/StaggerRow.css?raw";
import decorDotCss from "./decor/DecorDot.css?raw";
import decorBarCss from "./decor/DecorBar.css?raw";
import decorRingCss from "./decor/DecorRing.css?raw";
import stackedBlocksCss from "./decor/StackedBlocks.css?raw";
import markerBlockCss from "./decor/MarkerBlock.css?raw";
import stepStairsCss from "./decor/StepStairs.css?raw";
import postItCss from "./decor/PostIt.css?raw";
import figureCss from "./media/Figure.css?raw";
import typedTerminalCss from "./media/TypedTerminal.css?raw";
import pathDrawCss from "./media/PathDraw.css?raw";
import seededParticlesCss from "./ambient/SeededParticles.css?raw";
import breatheCss from "./ambient/Breathe.css?raw";
import kenBurnsCss from "./ambient/KenBurns.css?raw";
import timelineTrackCss from "./chrome/TimelineTrack.css?raw";
import progressDotsCss from "./chrome/ProgressDots.css?raw";
import eChartCss from "./chart/EChart.css?raw";

/** 44 份组件 CSS 的 `?raw` 文本。键 = "组/导出名.css"（与 manifest cssPathOf 同格式）。
    静态 import 保留（Vite 需静态可解析的 ?raw）；此处仅收进 Record，装配清单由 manifest 派生。 */
const RAW: Record<string, string> = {
  "text/HeroTitle.css": heroTitleCss,
  "text/Kicker.css": kickerCss,
  "text/BodyCopy.css": bodyCopyCss,
  "text/QuoteBlock.css": quoteBlockCss,
  "text/NumberPill.css": numberPillCss,
  "text/DeltaText.css": deltaTextCss,
  "data/HeroNumber.css": heroNumberCss,
  "data/Counter.css": counterCss,
  "data/BarGrow.css": barGrowCss,
  "data/DonutMeter.css": donutMeterCss,
  "data/StatCard.css": statCardCss,
  "data/StatCell.css": statCellCss,
  "data/StatInline.css": statInlineCss,
  "data/YearBarGroup.css": yearBarGroupCss,
  "data/DataItemRow.css": dataItemRowCss,
  "structure/Card.css": cardCss,
  "structure/Rule.css": ruleCss,
  "structure/Grid.css": gridCss,
  "structure/StagePad.css": stagePadCss,
  "structure/Table.css": tableCss,
  "structure/SplitCompare.css": splitCompareCss,
  "structure/JisCheck.css": jisCheckCss,
  "structure/StepCard.css": stepCardCss,
  "structure/MotionCell.css": motionCellCss,
  "reveal/RevealText.css": revealTextCss,
  "reveal/RevealList.css": revealListCss,
  "reveal/StepSequence.css": stepSequenceCss,
  "reveal/StaggerRow.css": staggerRowCss,
  "decor/DecorDot.css": decorDotCss,
  "decor/DecorBar.css": decorBarCss,
  "decor/DecorRing.css": decorRingCss,
  "decor/StackedBlocks.css": stackedBlocksCss,
  "decor/MarkerBlock.css": markerBlockCss,
  "decor/StepStairs.css": stepStairsCss,
  "decor/PostIt.css": postItCss,
  "media/Figure.css": figureCss,
  "media/TypedTerminal.css": typedTerminalCss,
  "media/PathDraw.css": pathDrawCss,
  "ambient/SeededParticles.css": seededParticlesCss,
  "ambient/Breathe.css": breatheCss,
  "ambient/KenBurns.css": kenBurnsCss,
  "chrome/TimelineTrack.css": timelineTrackCss,
  "chrome/ProgressDots.css": progressDotsCss,
  "chart/EChart.css": eChartCss,
};

// 完整性断言（宁炸不假绿）：RAW 键集必须与 manifest 的 cssPath 集严格相等——
// 漏收一份新组件 CSS（或键名与 manifest 失同步）在此抛错，而不是让 lint 静默少扫一份。
const MANIFEST_CSS_PATHS = COMPONENTS.map(cssPathOf);
{
  const rawKeys = new Set(Object.keys(RAW));
  const missing = MANIFEST_CSS_PATHS.filter((p) => !rawKeys.has(p));
  const extra = Object.keys(RAW).filter((k) => !MANIFEST_CSS_PATHS.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      "contract-lint RAW 与 manifest.ts 失同步：" +
        `缺少 [${missing.join(", ")}]；多余 [${extra.join(", ")}]（缺一即炸——防 lint 假绿）`,
    );
  }
}

/** 装配清单由 manifest 派生（键 = "组/导出名.css"，与 index.ts 的 ./<组>/<导出名>.css 对齐）。 */
export const COMPONENT_CSS: Array<{ file: string; css: string }> = COMPONENTS.map((c) => {
  const file = cssPathOf(c);
  return { file, css: RAW[file] };
});

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
