// 停留垫（dwell）解析的**唯一源头**（设计 §3.1 三层停留垫 / M5 遗留 #3）：
//   ① timing.json 的 dwell["<step>"]（分镜每帧可调）> ② 档案 RuntimeConfig.holdMs > ③ 引擎默认 400ms
//
// 消费方（**方向：scripts/ → src/engine/**，仓库既有惯例；src/ 不得反向 import scripts/）：
//   · 运行时预览   src/App.tsx（chapter.timing + stageConfig.holdMs）
//   · 渲染时间轴   scripts/render/timeline.ts（同一份解析 → 预览与成片同节奏）
//   · 分镜数据层   scripts/storyboard/data.ts 的 readDwellMs（**自己再包一层 assert/throw**）
//
// **宽松不抛**是本模块的契约：预览路径拿到手写的坏 timing.json 必须退回默认值，不能白屏
// （用户看得到画面才谈得上改数据）。严格校验（throw）只属于离线门禁——分镜/check 侧自己包一层，
// 见 scripts/storyboard/data.ts 的文件头分工说明。
//
// 非法值 = "没写"：退回**下一级**（档案 → 默认）而不是直接跳默认——一步坏数据不该废掉整档节奏。

import { DEFAULT_HOLD_MS } from "./constants";

/**
 * `src/chapters/<folder>/timing.json` 的形态（设计 §2 数据约定 3；文件可选，缺键 = 缺省）。
 * 键都是"step 序号的字符串形式"（JSON 对象键只能是字符串）。
 *
 * ⚠️ 这是**声明**不是保证：文件由人手写、JSON.parse 不带类型，运行期可能是任何值——
 * 所以本模块一律按 unknown 收（宽松）。严格校验在分镜侧（readDwellMs）。
 */
export interface TimingFile {
  /** 该步停留垫覆盖值（ms；缺省 = 落到下一级） */
  dwell?: Record<string, number>;
  /** 该帧"主导动画词汇"标注（Phase 3 设计、Checkpoint 2 确认的即是它） */
  animation?: Record<string, string>;
  /** 氛围声明（Ruling M4-2）：声明步允许动画计数 > 0，note 显示在分镜帧上 */
  ambient?: Record<string, string>;
}

/** 合法停留垫 = 有限非负数（ms）。0 合法（该步不留垫）；负数 / NaN / Infinity 非法。 */
function isValidHoldMs(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** 读 dwell["<step>"]（宽松：任何形态问题都返回 undefined = 没写，绝不抛）。 */
function readDwellOverride(
  chapterTiming: TimingFile | undefined,
  step: number,
): number | undefined {
  if (typeof chapterTiming !== "object" || chapterTiming === null) return undefined;
  const table = (chapterTiming as { dwell?: unknown }).dwell;
  if (typeof table !== "object" || table === null || Array.isArray(table)) return undefined;
  const raw = (table as Record<string, unknown>)[String(step)];
  return isValidHoldMs(raw) ? raw : undefined;
}

/**
 * 停留垫三级解析（引擎侧唯一源头；**永不抛**）：
 *   timing.json 的逐帧覆盖 → 档案 profileHoldMs → DEFAULT_HOLD_MS。
 * 非法/缺失一律视为"没写"落到下一级。
 */
export function resolveHoldMs(
  chapterTiming: TimingFile | undefined,
  step: number,
  profileHoldMs?: number,
): number {
  const override = readDwellOverride(chapterTiming, step);
  if (override !== undefined) return override;
  if (isValidHoldMs(profileHoldMs)) return profileHoldMs;
  return DEFAULT_HOLD_MS;
}
