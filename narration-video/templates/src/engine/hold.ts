// 引擎侧**节奏解析/公式的唯一源头**：
//   ① 停留垫（dwell）三级解析（设计 §3.1 / M5 遗留 #3）：
//      timing.json 的 dwell["<step>"]（分镜每帧可调）> 档案 RuntimeConfig.holdMs > 引擎默认 400ms
//   ② 无音频步的估时公式 `estimateNarrationMs`（M5a Task 2 / 评审 I4·Ruling R5 提取至此）：
//      原先 useAudioPlayer.ts 与 scripts/render/timeline.ts **各写一份同一条公式的文本**，
//      常量虽同源、公式却是两份——改一处忘另一处即预览与成片的节奏漂移。
//
// 消费方（**方向：scripts/ → src/engine/**，仓库既有惯例；src/ 不得反向 import scripts/）：
//   · 运行时预览   src/App.tsx（chapter.timing + stageConfig.holdMs）、src/engine/useAudioPlayer.ts（估时兜底）
//   · 渲染时间轴   scripts/render/timeline.ts（同一份解析 + 同一个估时函数 → 预览与成片同节奏）
//   · 分镜数据层   scripts/storyboard/data.ts 的 readDwellMs（**自己再包一层 assert/throw**）
//
// **宽松不抛**是 ① 的契约：预览路径拿到手写的坏 timing.json 必须退回默认值，不能白屏
// （用户看得到画面才谈得上改数据）。严格校验（throw）只属于离线门禁——分镜/check 侧自己包一层，
// 见 scripts/storyboard/data.ts 的文件头分工说明。
//
// 非法值 = "没写"：退回**下一级**（档案 → 默认）而不是直接跳默认——一步坏数据不该废掉整档节奏。

import {
  AUDIO_ESTIMATE_CHAR_MS,
  AUDIO_ESTIMATE_MIN_MS,
  DEFAULT_HOLD_MS,
  EMPTY_NARRATION_MIN_MS,
} from "./constants";

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

/**
 * 无音频步的估时（**唯一一份实现**——运行时预览与渲染时间轴共用，评审 I4 / Ruling R5）：
 * 空 narration（无声过场）→ `EMPTY_NARRATION_MIN_MS`；有稿 → `max(下限, 字数 × 字数单价)`。
 *
 * 消费方：`useAudioPlayer`（音频缺失 / 加载失败时的兜底推进）与 `scripts/render/timeline.ts`
 * （未合成步的 stepMs 兜底——经 `estimateMsFromNarration` 转发，名字是计划冻结的接口面）。
 * 两处若各存一份文本，改单价/下限时必然只改一侧；`timeline.test.ts` 用**引用相等**钉死"同一个函数"。
 */
export function estimateNarrationMs(narration: string): number {
  return narration
    ? Math.max(AUDIO_ESTIMATE_MIN_MS, narration.length * AUDIO_ESTIMATE_CHAR_MS)
    : EMPTY_NARRATION_MIN_MS;
}
