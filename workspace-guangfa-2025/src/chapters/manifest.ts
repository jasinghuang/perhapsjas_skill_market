import type { ComponentType } from "react";
import type { TimingFile } from "../engine/hold";
import { ColdopenChapter, coldopenNarrations, coldopenTiming } from "./01-coldopen";
import { MarketEngineChapter, marketEngineNarrations, marketEngineTiming } from "./02-market-engine";
import { SelfTradingChapter, selfTradingNarrations, selfTradingTiming } from "./03-self-trading";
import { CashContrastChapter, cashContrastNarrations, cashContrastTiming } from "./04-cash-contrast";
import { LeverageRiskChapter, leverageRiskNarrations, leverageRiskTiming } from "./05-leverage-risk";
import { ShareholderChapter, shareholderNarrations, shareholderTiming } from "./06-shareholder";

export interface ChapterDef {
  id: string;
  folder: string;
  /** 声明制（§11.1 #1）：steps 由 narrations.length 派生——注册即校验，不扫代码字面量 */
  steps: number;
  narrations: string[];
  /** 该章 timing.json（由章节自己的 index.tsx 静态 import 挂上）——运行时停留垫逐帧覆盖的
   *  载体：`resolveHoldMs(chapter.timing, step, stageConfig.holdMs)` 即预览用的三级解析。
   *  缺省 = 该章无 timing.json（全默认）；分镜/渲染另从 disk 读同一份文件（同一格式）。 */
  timing?: TimingFile;
  Component: ComponentType<{ step: number }>;
}

function define(def: Omit<ChapterDef, "steps"> & { narrations: string[] }): ChapterDef {
  return { ...def, steps: def.narrations.length };
}

export const chapters: ChapterDef[] = [
  define({
    id: "coldopen",
    folder: "01-coldopen",
    narrations: coldopenNarrations,
    timing: coldopenTiming,
    Component: ColdopenChapter,
  }),
  define({
    id: "market-engine",
    folder: "02-market-engine",
    narrations: marketEngineNarrations,
    timing: marketEngineTiming,
    Component: MarketEngineChapter,
  }),
  define({
    id: "self-trading",
    folder: "03-self-trading",
    narrations: selfTradingNarrations,
    timing: selfTradingTiming,
    Component: SelfTradingChapter,
  }),
  define({
    id: "cash-contrast",
    folder: "04-cash-contrast",
    narrations: cashContrastNarrations,
    timing: cashContrastTiming,
    Component: CashContrastChapter,
  }),
  define({
    id: "leverage-risk",
    folder: "05-leverage-risk",
    narrations: leverageRiskNarrations,
    timing: leverageRiskTiming,
    Component: LeverageRiskChapter,
  }),
  define({
    id: "shareholder",
    folder: "06-shareholder",
    narrations: shareholderNarrations,
    timing: shareholderTiming,
    Component: ShareholderChapter,
  }),
];
