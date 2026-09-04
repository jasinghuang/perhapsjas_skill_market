import type { ComponentType } from "react";
import { ExampleChapter, exampleNarrations } from "./01-example";

export interface ChapterDef {
  id: string;
  folder: string;
  /** 声明制（§11.1 #1）：steps 由 narrations.length 派生——注册即校验，不扫代码字面量 */
  steps: number;
  narrations: string[];
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
    Component: ExampleChapter,
  }),
];
