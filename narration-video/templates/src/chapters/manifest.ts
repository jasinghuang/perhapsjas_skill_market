import type { ComponentType } from "react";
import type { TimingFile } from "../engine/hold";
import { ExampleChapter, exampleNarrations, exampleTiming } from "./01-example";

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
    id: "example",
    folder: "01-example",
    narrations: exampleNarrations,
    timing: exampleTiming,
    Component: ExampleChapter,
  }),
];
