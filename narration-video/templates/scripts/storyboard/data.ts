// M4 Task 3 分镜数据层：章节 manifest + public/audio-durations.json + 各章 timing.json →
// 逐帧模型（buildStoryboardData），以及分镜阶段门禁（gateStoryboard，Ruling M4-2）。
//
// 纯 TS、无 DOM / 无浏览器依赖——tsx（CLI 编排）与 vitest（双护栏单测）双环境消费。
//
// 关键取舍（实现者报告）：
//   1. **音频时长按"非空 narration"对位**：P4-9 契约（check-fast）已钉死 durations 条目数
//      === 总非空 narrations 数（只有非空句才合成 mp3，#13 同款口径），故数组不是按 step 空位
//      对位而是按**非空句顺序**消费——空 narration 步（无声过场）不吃条目，audioMs = null。
//      若按 step 硬对位，示例章节（第 3 步为空）会整章错位一条。
//   2. **未合成 = null，不编造估算**：durations 文件缺失（未跑 TTS 的合法状态）或条目取不到
//      → audioMs/stepMs 全 null，分镜页显式写"未合成音频（Phase 2 后回正）"——估算公式属于
//      运行时兜底（useAudioPlayer），分镜页只陈述实测事实。
//   3. **条目数对不上 → warning 而非 throw**：条目数契约的 blocker 由 check 层（P4-9）负责，
//      分镜页把它降级为可见警示（warning 上页 + CLI 打印），避免同一事实两处报红等级不一。
//      非法值（非数字 / 负数 / NaN）仍然 throw——那是坏数据，不是"没合成"。
//   4. **门禁不用 capture 的 assertNoAnimations 一刀切**：氛围微动（Ruling M4-2 声明豁免）
//      必须逐帧判——count > 0 且该步未声明 ambient → blocker；已声明 → 通过且 note 上帧。
//   5. **animMs 分镜阶段恒 null**（零动画窗口），故 stepMs = audioMs + dwellMs；音频缺失时
//      stepMs 也 null（显示 n/a（未合成））——不用 dwellMs 冒充。
//   6. **门禁不改入参**：返回新帧对象（调用方持有的 plan 仍可复用/重跑）。
//   7. **停留垫解析不在本层（M5a Task 1）**：解析/三级优先只有一份，在引擎侧
//      `src/engine/hold.ts` 的 `resolveHoldMs`（宽松不抛——预览不能白屏）；本层是**离线门禁**，
//      职责相反：把坏数据炸出来（throw）。故 `readDwellMs` = 薄校验包装：先 assert 再委托解析器，
//      两侧分工写死在这里（`storyboard.test.ts:188` 的 throw 契约不得丢）。

import { resolveHoldMs, type TimingFile } from "../../src/engine/hold";

// ── 输入模型 ──

/** 章节 manifest 在分镜层的最小投影（ChapterDef 结构上兼容）。 */
export interface StoryboardChapter {
  id: string;
  folder: string;
  /** 与 narrations.length 失同步即 throw（分镜帧数校验的第一道防线） */
  steps: number;
  narrations: readonly string[];
}

/** timing.json 的形态与解析归属引擎侧（**单一源头**，`src/engine/hold.ts`）——此处只做
 *  转发，保证 `scripts/storyboard.ts` / `storyboard.test.ts` 的既有 import 面不动。
 *  ⚠️ 方向：scripts/ → src/engine/（仓库惯例）；引擎侧不得反向 import 本文件。 */
export type { TimingFile };

/** 单条时长：数字 = 实测 ms；null = 该条未合成（单条 TTS 失败的合法产物）。 */
export type DurationEntry = number | null;

/** `public/audio-durations.json` 的两种形态：对象（chapterId|folder → 条目数组）或单章扁平数组。 */
export type AudioDurations = readonly DurationEntry[] | Record<string, readonly DurationEntry[]>;

// ── 输出模型 ──

export type FrameGate = "pass" | "ambient" | "blocker";

export interface StoryboardFrame {
  /** 章节下标（capture 的游标坐标系） */
  chapter: number;
  step: number;
  /** 章节目录名（shots/<chapterId>/<step>.png 的组成部分） */
  chapterId: string;
  narration: string;
  /** 音频实测时长（ms）；null = 无音频（未合成 / 无声过场） */
  audioMs: number | null;
  /** 停留垫（timing.json 覆盖 或 DEFAULT_HOLD_MS） */
  dwellMs: number;
  /** 动画窗口（ms）——分镜阶段零动画，恒 null */
  animMs: number | null;
  /** 停留时长 = audioMs + dwellMs（分镜阶段 animMs = 0）；无音频时 null */
  stepMs: number | null;
  /** 主导动画词汇（timing.json 标注；缺省 null → 页上显示"未标注"） */
  animationVocab: string | null;
  /** 氛围声明 note（Ruling M4-2；缺省 null） */
  ambient: string | null;
  /** 分镜页相对引用：shots/<chapterId>/<step>.png（与 capture.shotPath 尾段一致） */
  shot: string;
  /** 动画计数（capture 回填；null = 尚未捕获） */
  animations: number | null;
  /** 门禁判定（gateStoryboard 回填；null = 尚未判定） */
  gate: FrameGate | null;
}

/** 门禁/数据发现项（分级比 findings.ts 少一档：本层无 warning——数据警示单列 warnings）。 */
export interface GateFinding {
  severity: "blocker" | "note";
  location: string;
  message: string;
}

export interface StoryboardData {
  frames: StoryboardFrame[];
  /** 总 step 数（Σ chapters.steps）——帧数校验的基准 */
  expectedFrames: number;
  /** 门禁结论（build 阶段为空数组，gateStoryboard 回填） */
  findings: GateFinding[];
  /** 数据警示（如 durations 条目数对不上）——不阻塞产出，上分镜页 */
  warnings: string[];
}

export interface BuildStoryboardInput {
  chapters: readonly StoryboardChapter[];
  /** 已 JSON.parse 的 public/audio-durations.json；null/undefined = 文件不存在（合法：未跑 TTS） */
  durations: unknown;
  /** chapterId → timing.json 解析结果；缺键 = 该章无 timing.json（全默认） */
  timings: Record<string, TimingFile | undefined>;
}

// ── 显示词汇（分镜页与单测共用同一常量——文案不会两侧漂移） ──

/** 音频未合成（有稿子但没合成）时音频字段的诚实降级文案 */
export const AUDIO_MISSING_TEXT = "未合成音频（Phase 2 后回正）";
/** 空 narration 步（无声过场）：没有音频可合成，与"未合成"区分 */
export const SILENT_STEP_TEXT = "无声过场（无音频）";
/** 停留时长缺音频时的文案 */
export const STEP_MS_MISSING_TEXT = "n/a（未合成）";
/** 主导动画词汇未标注 */
export const VOCAB_MISSING_TEXT = "未标注";

/**
 * 主题色静态快照（tokens.css 的 hex 直录）——分镜页离线自包含，不引 tokens.css、
 * 不随主题切换变化；note 文案由快照常量拼出，改色不会只改一侧。
 */
export const STORYBOARD_THEME = {
  cream: "#efe9d9",
  cream2: "#e4dcc4",
  ink: "#0f0f0f",
  ink2: "#2a2a2a",
  muted: "#5c574c",
  faint: "#8f897c",
  accent: "#e85a1f",
  pass: "#1f8a4c",
  blocker: "#c0392b",
} as const;

export const THEME_SNAPSHOT_NOTE =
  `配色为 tokens.css 的离线快照（cream ${STORYBOARD_THEME.cream} / ink ${STORYBOARD_THEME.ink} / ` +
  `accent ${STORYBOARD_THEME.accent}）——不随主题变化`;

// ── 解析与校验 ──

function isDurationEntry(v: unknown): v is DurationEntry {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
}

/** 已解析的 durations → 归一形态；非法值 throw（坏数据不是"没合成"，不静默降级）。 */
export function normalizeDurations(raw: unknown): AudioDurations | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    raw.forEach((v, i) => {
      if (!isDurationEntry(v)) {
        throw new Error(
          `音频时长（public/audio-durations.json）第 ${i} 条非法：${JSON.stringify(v)}——` +
            `须为有限非负数（ms）或 null（该条未合成）`,
        );
      }
    });
    return raw as DurationEntry[];
  }
  if (typeof raw === "object") {
    const out: Record<string, readonly DurationEntry[]> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(value)) {
        throw new Error(
          `音频时长（public/audio-durations.json）键 "${key}" 非法：须为时长数组（ms），` +
            `实为 ${JSON.stringify(value)}`,
        );
      }
      value.forEach((v, i) => {
        if (!isDurationEntry(v)) {
          throw new Error(
            `音频时长（public/audio-durations.json）键 "${key}" 第 ${i} 条非法：${JSON.stringify(v)}——` +
              `须为有限非负数（ms）或 null（该条未合成）`,
          );
        }
      });
      out[key] = value as DurationEntry[];
    }
    return out;
  }
  throw new Error(
    `音频时长（public/audio-durations.json）形态非法：${JSON.stringify(raw)}——` +
      `须为 { chapterId: number[] } 对象或单章扁平数组`,
  );
}

/**
 * 根形态守卫（评审 F4）：timing.json 顶层须为对象。
 * 少了这道守卫，`timing?.dwell` 这类属性读取对数组/字符串/数字都静默返回 undefined（全默认），
 * 坏文件被当成"没写"——与 dwell 值非法的 throw 口径不一致。
 *
 * **导出（M5a Task 1）**：渲染侧（T7 编排 / 将来的 timing 读取）要吃同一张守卫——
 * 另抄一份必漂移，故从模块私有改为导出（行为逐字不变）。
 */
export function normalizeTiming(raw: unknown, chapterId: string): TimingFile | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      `分镜数据：${chapterId}/timing.json 顶层须为对象（dwell / animation / ambient），` +
        `实为 ${JSON.stringify(raw)}——空配置写 {} 而不是 null/数组`,
    );
  }
  return raw as TimingFile;
}

/** 章节 steps 与 narrations 失同步 = 帧集合定义本身坏了，宁炸不静默少帧。 */
function assertChapterSync(c: StoryboardChapter, index: number): void {
  if (!Number.isInteger(c.steps) || c.steps < 0) {
    throw new Error(`分镜数据：第 ${index} 章（${c.id}）的 steps ${c.steps} 非法（须为非负整数）`);
  }
  if (c.steps !== c.narrations.length) {
    throw new Error(
      `分镜数据：第 ${index} 章（${c.id}）steps ${c.steps} 与 narrations ${c.narrations.length} 失同步` +
        `——帧数 = narrations.length 是 manifest 契约（declaration 派生），不在此处自动对齐`,
    );
  }
}

/**
 * 非空 narration = 有音频的步（mp3 只对非空句合成；#13 / P4-9 同款口径）。
 *
 * **导出（M5a Task 5）**：mock 音轨（`scripts/render/audio.ts`）要按**同一个**判空口径决定给
 * 哪些步写 mp3——口径各写一套时，`" "` 这类空白串 narration 会让 mock 多写一支 mp3、
 * durations.json 条目数也跟着多 1，而门禁 #13 与分镜页对位的却是 trim 口径（同一事实两处报红
 * 且等级不一）。谓词只有这一份（与 `normalizeTiming` 同一轮由私有转导出）。
 */
export function hasAudio(narration: string): boolean {
  return narration.trim() !== "";
}

/** 注解读取（dwell / animation / ambient 共用的键校验）。 */
function readStepKey<T>(
  table: Record<string, T> | undefined,
  step: number,
  chapterId: string,
  field: string,
): T | undefined {
  if (table === undefined || table === null) return undefined;
  if (typeof table !== "object" || Array.isArray(table)) {
    throw new Error(`分镜数据：${chapterId}/timing.json 的 "${field}" 须为对象（step → 值）`);
  }
  return table[String(step)];
}

/**
 * 停留垫（分镜侧）：**薄校验包装** —— 先 assert（离线门禁：坏数据宁炸不静默降级），
 * 再把取值/三级优先委托给引擎侧唯一解析器 `resolveHoldMs`（运行时预览用的就是它）。
 * 分工原因见文件头取舍 7：解析逻辑若在本层复制一份，预览与分镜的停留节奏必然漂移。
 */
function readDwellMs(timing: TimingFile | undefined, step: number, chapterId: string): number {
  // 表形态校验（非对象 → throw）仍在 readStepKey 里——那是分镜侧的定位文案，不外包
  const raw = readStepKey(timing?.dwell, step, chapterId, "dwell");
  if (raw !== undefined && (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0)) {
    throw new Error(
      `分镜数据：${chapterId}/timing.json 的 dwell["${step}"] 非法：${JSON.stringify(raw)}——` +
        `停留垫覆盖须为有限非负数（ms）`,
    );
  }
  // 取值与三级优先（timing.json > 档案 > 引擎默认）归引擎侧（此处无档案层，走默认）
  return resolveHoldMs(timing, step);
}

function readAnnotation(
  table: Record<string, string> | undefined,
  step: number,
  chapterId: string,
  field: string,
): string | null {
  const raw = readStepKey(table, step, chapterId, field);
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      `分镜数据：${chapterId}/timing.json 的 ${field}["${step}"] 非法：${JSON.stringify(raw)}——须为非空字符串`,
    );
  }
  return raw;
}

/**
 * 逐章解析音频时长（按非空 narration 顺序对位）。
 * 返回每章一张 `(number|null)[]`（与 narrations 等长，空 narration 位恒 null）。
 *
 * **外提并导出（M3b Task 9）**：无头门禁的 #17（动画窗口 vs 音频）/#19（音频段 ≥15s）要吃
 * 同一份对位结果——另抄一份必漂移，故本函数从模块私有改为导出（名称/参数/warnings 出参
 * **逐字保留**，`buildStoryboardData` 的调用点不动）。分镜页的 warnings 依赖不变。
 */
export function resolveAudioMs(
  chapters: readonly StoryboardChapter[],
  durations: AudioDurations | null,
  warnings: string[],
): (number | null)[][] {
  if (durations === null) {
    return chapters.map((c) => c.narrations.map(() => null));
  }

  if (Array.isArray(durations)) {
    // 扁平形态：按章节序跨章消费（P4-9 口径：条目数 === 总非空 narrations 数）
    const flat = durations;
    const want = chapters.reduce((n, c) => n + c.narrations.filter(hasAudio).length, 0);
    if (flat.length !== want) {
      warnings.push(
        `音频时长条目数 ${flat.length} ≠ 总非空 narrations ${want}（扁平数组形态）——` +
          `按顺序对位，取不到者按未合成降级`,
      );
    }
    let i = 0;
    return chapters.map((c) => c.narrations.map((n) => (hasAudio(n) ? (i < flat.length ? flat[i++] : null) : null)));
  }

  // 走完上面两个分支后只剩对象形态；显式断言是因为 TS 的 Array.isArray 守卫（arg is any[]）
  // 对 readonly 数组不做否分支收窄，else 里 durations 仍是联合类型。
  const byChapter = durations as Record<string, readonly DurationEntry[]>;
  return chapters.map((c) => {
    const arr = byChapter[c.id] ?? byChapter[c.folder];
    if (arr === undefined) {
      warnings.push(
        `音频时长缺章节键 "${c.id}"（也试过 folder "${c.folder}"）——该章按未合成降级`,
      );
      return c.narrations.map(() => null);
    }
    const want = c.narrations.filter(hasAudio).length;
    if (arr.length !== want) {
      warnings.push(
        `音频时长条目数 ${arr.length} ≠ 非空 narrations ${want}（章节 ${c.id}）——` +
          `按顺序对位，取不到者按未合成降级`,
      );
    }
    let i = 0;
    return c.narrations.map((n) => (hasAudio(n) ? (i < arr.length ? arr[i++] : null) : null));
  });
}

/** 死标注巡检：timing.json 的键超出本章步数 = 改稿后没清理的标注（静默忽略会让人以为生效了）。 */
function warnOrphanKeys(
  timing: TimingFile | undefined,
  chapter: StoryboardChapter,
  warnings: string[],
): void {
  if (timing === undefined || timing === null) return;
  for (const field of ["dwell", "animation", "ambient"] as const) {
    const table = timing[field];
    if (table === undefined || table === null || typeof table !== "object") continue;
    for (const key of Object.keys(table)) {
      const n = Number(key);
      if (!Number.isInteger(n) || n < 0 || n >= chapter.steps) {
        warnings.push(
          `${chapter.id}/timing.json 的 ${field}["${key}"] 没有对应步骤（本章 ${chapter.steps} 步）` +
            `——改稿后的死标注？`,
        );
      }
    }
  }
}

// ── buildStoryboardData ──

/** 分镜页相对引用（与 capture.shotPath 的尾段逐字一致；单测断言两侧不会漂移）。 */
export function shotRef(chapterId: string, step: number): string {
  return `shots/${chapterId}/${step}.png`;
}

/** 帧定位文案（门禁 blocker 与分镜页共用——报告能直接指到人看的坐标）。 */
export function frameLocation(f: { chapter: number; step: number; chapterId: string }): string {
  return `章节 ${f.chapter} 第 ${f.step} 步（${f.chapterId}）`;
}

/**
 * 组装分镜数据（未捕获/未判定态：animations 与 gate 为 null）。
 * durations 形态非法 / dwell 非法 / steps 失同步 → throw（坏数据不静默）。
 */
export function buildStoryboardData(input: BuildStoryboardInput): StoryboardData {
  const warnings: string[] = [];
  const durations = normalizeDurations(input.durations);
  const frames: StoryboardFrame[] = [];
  // 一次解析全章（扁平数组形态要跨章顺序消费，逐章调用会把索引拉回 0）
  const audioByChapter = resolveAudioMs(input.chapters, durations, warnings);

  input.chapters.forEach((c, ci) => {
    assertChapterSync(c, ci);
    const timing = normalizeTiming(input.timings[c.id], c.id);
    warnOrphanKeys(timing, c, warnings);
    const audioMsOfChapter = audioByChapter[ci];

    c.narrations.forEach((narration, step) => {
      const audioMs = audioMsOfChapter[step];
      const dwellMs = readDwellMs(timing, step, c.id);
      frames.push({
        chapter: ci,
        step,
        chapterId: c.id,
        narration,
        audioMs,
        dwellMs,
        animMs: null, // 分镜阶段零动画（M5 逐帧 seek 才有窗口）
        stepMs: audioMs === null ? null : audioMs + dwellMs,
        animationVocab: readAnnotation(timing?.animation, step, c.id, "animation"),
        ambient: readAnnotation(timing?.ambient, step, c.id, "ambient"),
        shot: shotRef(c.id, step),
        animations: null,
        gate: null,
      });
    });
  });

  // 评审 F3：expectedFrames 取 **manifest 声明值**（Σ chapters.steps）而非 frames.length——
  // 前者独立于构建路径，门禁拿两者交叉校验才有意义（|frames| 是构建结果，拿它自比是恒真死分支）。
  const expectedFrames = input.chapters.reduce((n, c) => n + c.steps, 0);
  return { frames, expectedFrames, findings: [], warnings };
}

/** 免比对集合（评审 F2）：只收 `gate === "ambient"` 的步——声明**且**计数 > 0。
 *  "声明了但计数为 0"的过期声明步**照常参与**字节比对（门禁自己标了"声明可能过期"，不该白送豁免）。
 *  键格式 `${chapter}:${step}` 与 verify-sequential 的 `ambientKey` 一致（单测两侧对钉）。 */
export function ambientExemptKeys(data: StoryboardData): Set<string> {
  return new Set(
    data.frames.filter((f) => f.gate === "ambient").map((f) => `${f.chapter}:${f.step}`),
  );
}

// ── 分镜门禁（Ruling M4-2） ──

/** capture 结果在本层的最小投影（CaptureResult 结构上兼容，多出的 file 字段无所谓）。 */
export interface CaptureCount {
  chapter: number;
  step: number;
  animations: number;
}

function cursorKey(chapter: number, step: number): string {
  return `${chapter}:${step}`;
}

/**
 * 分镜阶段门禁（逐帧 + 帧数校验；不用 capture 的 assertNoAnimations 一刀切）：
 *   - 帧数 ≠ 总 step 数 / 坐标错位 → blocker（截图缺失或多出，静态分镜不完整）
 *   - 计数 > 0 且未声明 ambient → blocker（入场动画禁入静态版；氛围微动请声明 ambient）
 *   - 计数 > 0 且已声明 ambient → 通过，gate = "ambient"，note 上帧（Ruling M4-2）
 *   - 声明了 ambient 但计数为 0 → note（声明可能过期），非 blocker
 * 返回新 StoryboardData（不就地改入参）。
 */
export function gateStoryboard(
  data: StoryboardData,
  captured: readonly CaptureCount[],
): StoryboardData {
  const findings: GateFinding[] = [];
  const hits = new Map<string, CaptureCount[]>();
  for (const c of captured) {
    const key = cursorKey(c.chapter, c.step);
    const list = hits.get(key);
    if (list === undefined) hits.set(key, [c]);
    else list.push(c);
  }

  // 1) 帧数 + 坐标对位（帧集合是唯一真相源）
  const known = new Set(data.frames.map((f) => cursorKey(f.chapter, f.step)));
  const missing = data.frames
    .filter((f) => !hits.has(cursorKey(f.chapter, f.step)))
    .map((f) => frameLocation(f));
  // 多出来的坐标没有合法 chapterId 可言（正是"不该存在"）——定位只给游标坐标
  const extra = captured
    .filter((c) => !known.has(cursorKey(c.chapter, c.step)))
    .map((c) => `章节 ${c.chapter} 第 ${c.step} 步`);
  // 构建结果 vs manifest 声明值的交叉校验（评审 F3：expectedFrames 取 Σ steps，不是 frames.length
  // ——否则这里是恒真的死分支）。触发的现实面：将来改动构建路径导致某步被静默跳过。
  if (data.frames.length !== data.expectedFrames) {
    findings.push({
      severity: "blocker",
      location: "分镜帧集合",
      message:
        `帧集合 ${data.frames.length} ≠ 总 step 数 ${data.expectedFrames}（Σ chapters.steps）` +
        `——构建出的帧与 manifest 声明不一致（组装异常，宁炸不静默少帧）`,
    });
  }
  if (missing.length > 0 || extra.length > 0 || captured.length !== data.expectedFrames) {
    const parts = [
      `分镜帧数 ${captured.length}${captured.length === data.expectedFrames ? "=" : "≠"}总 step 数 ${data.expectedFrames}`,
    ];
    if (missing.length > 0) parts.push(`缺 ${missing.length} 帧（${missing.join("、")}）`);
    if (extra.length > 0) parts.push(`多 ${extra.length} 帧（${extra.join("、")}）`);
    findings.push({
      severity: "blocker",
      location: "分镜帧数",
      message:
        `${parts.join("；")}——分镜帧数须 === 总 step 数（§11.3 M4 门禁）；` +
        `截图缺失/多出即静态分镜不完整，请核对 chapters manifest 与截图输出`,
    });
  }

  // 2) 逐帧动画计数（Ruling M4-2：氛围声明逐帧豁免）
  const frames = data.frames.map((f): StoryboardFrame => {
    const list = hits.get(cursorKey(f.chapter, f.step));
    if (list === undefined || list.length === 0) {
      return { ...f, animations: null, gate: null };
    }
    const animations = Math.max(...list.map((c) => c.animations));
    const where = frameLocation(f);
    if (animations > 0 && f.ambient === null) {
      findings.push({
        severity: "blocker",
        location: where,
        message:
          `检出 ${animations} 个动画——入场动画禁入静态版（分镜帧须为静帧）；` +
          `若是无入场态的氛围微动（KenBurns/粒子/呼吸等），请在 "timing.json" 的 ` +
          `"ambient": { "${f.step}": "<note>" } 显式声明豁免（Ruling M4-2）`,
      });
      return { ...f, animations, gate: "blocker" };
    }
    if (animations > 0) {
      findings.push({
        severity: "note",
        location: where,
        message: `氛围微动（已声明 ambient）：${f.ambient}——计数 ${animations}，允许（Ruling M4-2）`,
      });
      return { ...f, animations, gate: "ambient" };
    }
    if (f.ambient !== null) {
      findings.push({
        severity: "note",
        location: where,
        message: `已声明 ambient 但未检出动画——声明可能过期（${f.ambient}）；如已移除氛围微动请删掉该声明`,
      });
    }
    return { ...f, animations, gate: "pass" };
  });

  return { ...data, frames, findings };
}

/** 有 blocker 即门禁未通过（CLI 退出码依据）。 */
export function hasBlockers(data: StoryboardData): boolean {
  return data.findings.some((f) => f.severity === "blocker");
}
