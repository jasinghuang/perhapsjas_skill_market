// 运行时配置：模板默认值，scaffold 按档案参数（--slug / --stage）覆盖本文件
import type { StageDims } from "./useStageScale";

export interface RuntimeConfig {
  slug: string;
  dims: StageDims;
}

export const stageConfig: RuntimeConfig = {
  slug: "presentation",
  dims: { width: 1920, height: 1080 },
};
