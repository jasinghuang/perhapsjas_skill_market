// 运行时配置：由 scaffold 按档案参数生成（--slug / --stage），勿手改
// 安全框（safeArea）走单一数字源 deriveSafeArea 派生——档案绝对值由基准比例折算得出，
// 不在此处手写（竖版/小红书档案的绝对值待 M7 档案定稿时由用户确认）。
import type { SafeArea } from "./safe-area";
import { deriveSafeArea } from "./safe-area";
import type { StageDims } from "./useStageScale";

export interface RuntimeConfig {
  slug: string;
  dims: StageDims;
  /** 安全框（档案绝对值由基准比例折算得出，见 engine/safe-area.ts） */
  safeArea: SafeArea;
  /** 停留垫档案覆盖（ms；§3.1 三层停留垫的**中间层**：引擎默认 400ms → 本层 → timing.json
   *  逐帧覆盖）。生产者是 scaffold（按平台节奏写），缺省 = 不覆盖 → 引擎默认。
   *  解析唯一源头：engine/hold.ts 的 resolveHoldMs（运行时与渲染同一条）。
   *  M5a Task 7 补：接口形状必须与模板 src/engine/runtime-config.ts **同形**——本文件由
   *  scaffold 整份重写，字段少一个就是"生成物类型与引擎/渲染消费面不一致"（App.tsx 与
   *  scripts/render.ts 都读 stageConfig.holdMs，缺字段 = 新项目 tsc 直接报 TS2339）。 */
  holdMs?: number;
}

const dims: StageDims = { width: 1920, height: 1080 };

export const stageConfig: RuntimeConfig = {
  slug: "guangfa-2025",
  dims,
  safeArea: deriveSafeArea(dims),
};
