// 运行时配置：模板默认值，scaffold 按档案参数（--slug / --stage）覆盖本文件
// 安全框（safeArea）走单一数字源 deriveSafeArea 派生——不在此处手写 64/96/112/934/958。
import type { SafeArea } from "./safe-area";
import { deriveSafeArea } from "./safe-area";
import type { StageDims } from "./useStageScale";

export interface RuntimeConfig {
  slug: string;
  dims: StageDims;
  /** 安全框（档案绝对值由基准比例折算得出，见 engine/safe-area.ts） */
  safeArea: SafeArea;
}

const dims: StageDims = { width: 1920, height: 1080 };

export const stageConfig: RuntimeConfig = {
  slug: "presentation",
  dims,
  safeArea: deriveSafeArea(dims),
};
