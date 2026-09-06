// 组件统一出口（§6.2 章节层唯一合法零件来源）+ 组件 CSS 装配（Ruling P2-4）
// Ruling P2-4：主题 CSS 随组件统一出口装配——章节层 import components 即得全部样式。
// 共 31 份组件 CSS（30 + 十六轮 F3 收编 MarkerBlock，磁盘实数为准）。
import "../theme/tokens.css";
import "./text/HeroTitle.css";
import "./text/Kicker.css";
import "./text/BodyCopy.css";
import "./text/QuoteBlock.css";
import "./text/NumberPill.css";
import "./data/HeroNumber.css";
import "./data/Counter.css";
import "./data/BarGrow.css";
import "./data/DonutMeter.css";
import "./data/StatCard.css";
import "./structure/Card.css";
import "./structure/Rule.css";
import "./structure/Grid.css";
import "./structure/StagePad.css";
import "./structure/Table.css";
import "./reveal/RevealText.css";
import "./reveal/RevealList.css";
import "./reveal/StepSequence.css";
import "./decor/DecorDot.css";
import "./decor/DecorBar.css";
import "./decor/DecorRing.css";
import "./decor/StackedBlocks.css";
import "./decor/MarkerBlock.css";
import "./media/Figure.css";
import "./media/TypedTerminal.css";
import "./media/PathDraw.css";
import "./ambient/SeededParticles.css";
import "./ambient/Breathe.css";
import "./ambient/KenBurns.css";
import "./function/TimelineTrack.css";
import "./function/ProgressDots.css";

export { HeroTitle, Kicker, BodyCopy, QuoteBlock, NumberPill } from "./text";
export { HeroNumber, Counter, BarGrow, DonutMeter, StatCard } from "./data";
export { Card, Rule, Grid, StagePad, Table } from "./structure";
export { RevealText, RevealList, StepSequence } from "./reveal";
export { DecorDot, DecorBar, DecorRing, StackedBlocks, MarkerBlock } from "./decor";
export { Figure, TypedTerminal, PathDraw } from "./media";
export { SeededParticles, Breathe, KenBurns } from "./ambient";
export { TimelineTrack, ProgressDots } from "./function";
