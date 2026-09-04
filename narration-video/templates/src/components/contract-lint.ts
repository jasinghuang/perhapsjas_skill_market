// 组件契约 lint（§11.1 #9 内核）：组件 CSS 只消费 token——禁裸色值、禁裸 font-family、禁裸动画时长。
// M3a 门禁与本章节测试共用同一实现。
// Ruling P2-8：不用 node:fs + __dirname（ESM 无 __dirname、无 @types/node，tsc 必挂），
// 改用 Vite `?raw` 显式导入 14 个组件 CSS，lint 扫描这些字符串。

import heroTitleCss from "./text/HeroTitle.css?raw";
import kickerCss from "./text/Kicker.css?raw";
import bodyCopyCss from "./text/BodyCopy.css?raw";
import quoteBlockCss from "./text/QuoteBlock.css?raw";
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

const COMPONENT_CSS: Array<{ file: string; css: string }> = [
  { file: "text/HeroTitle.css", css: heroTitleCss },
  { file: "text/Kicker.css", css: kickerCss },
  { file: "text/BodyCopy.css", css: bodyCopyCss },
  { file: "text/QuoteBlock.css", css: quoteBlockCss },
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
];

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const RGB_RE = /rgba?\(/;
const HSL_RE = /hsla?\(/;
const NAMED_COLOR_RE = /\b(red|blue|green|yellow|orange|purple|pink|cyan|magenta|tomato|gold|silver)\b/;
const FONT_RE = /font-family\s*:\s*(?!var\()/;
const DUR_RE = /animation-duration\s*:\s*(?!var\()/;
const TRANSITION_DUR_RE = /transition-duration\s*:\s*(?!var\()/;

export function lintComponentCss(): string[] {
  const violations: string[] = [];
  for (const { file, css } of COMPONENT_CSS) {
    const lines = css.split("\n");
    lines.forEach((line, i) => {
      const loc = `${file}:${i + 1}`;
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
  }
  return violations;
}
