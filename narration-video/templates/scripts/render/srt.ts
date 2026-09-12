// M5b Task 2：SRT 副产物——**纯派生**（narrations × 时间轴表 → 字幕文本），不碰画面、不碰音频。
//
// 三条口径（都是"两处各写一份就会漂"的地方，故在这里钉死并写明理由）：
//
//   1. **空 narration 的判据 = 引擎那份**（`scripts/storyboard/data.ts` 的 `hasAudio`，trim 口径）。
//      本文件**转发同一个函数**而不是重写 `narration.trim() !== ""`：
//        · 渲染链的音频对位（`normalizeDurations` 按非空句顺序消费时长）、App 的音频装配、
//          check 的门禁 #13 都是这个口径——SRT 若用别的口径（例如 JS 裸真值），
//          "   " 这种空白串会**出字幕但不出声音**（或反过来），而且两处都自洽地绿。
//        · 判据是 trim、**输出文本也是 trim**：前后空白在字幕里只是一段视觉偏移，
//          内部空白原样保留（那是作者写的停顿/排版）。
//
//   2. **时间码只来自时间轴表的 `startMs` / `stepMs`**（`[startMs, startMs+stepMs)`）。
//      · 不来自音频实测（`audioMs` 可能是 null——未合成步照样要有字幕）；
//      · 更不来自 verify 的 `expectedMs`：那是"音频**内容**起点"的锚（5ms 判决窗的前沿，
//        比真内容起点早 ≤5ms，见 verify.ts 的口径说明）——拿它当步起点做时间码就是系统性前移。
//      · 起点是前缀和 ⇒ 相邻条目首尾相接、末条终点 === `timeline.totalMs`（与成片同长）。
//      · **传进来的必须是成片那一张表**：`--only` 渲子片时传**子时间轴**（`startMs` 已按被渲的步
//        重算），否则 SRT 指的是另一条时间轴（画面对不上字幕，而两边各自都自洽）。
//
//   3. **非空护栏**：空时间轴 → 空数组 / 空文本（**不抛**——空 deck 的"没有字幕"是合法产物，
//      与 timeline.ts 的 buildTimeline 同款）。反之，结构对不上（章节下标越界 / 步序越界）→ throw：
//      那不是"没有字幕"，是调用方喂错了表——静默丢一条 = 有声无字。
//
// 依赖方向：scripts/render/* → scripts/storyboard/data（音频对位口径的同一份，timeline.ts 的先例）；
// 不 import render.ts（编排层在上游，模块不许反向依赖）。

import { hasAudio } from "../storyboard/data";
import type { Timeline } from "./timeline";

/** 一条字幕：[startMs, endMs) 之间显示 `text`（`index` 为 SRT 的序号，1 起）。 */
export interface SrtCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/**
 * ms → `HH:MM:SS,mmm`（SRT 时间码）。**四舍五入到整毫秒**：时间轴的 `stepMs` 可能带小数
 * （音频实测时长是浮点，前缀和一路带下去），而 SRT 的毫秒位只有三位整数。
 *
 * 分量从**取整后的总量**算（不是各分量各取整）：59999.6 → `00:01:00,000` 而不是 `00:00:59,1000`。
 * 负数 / 非有限 → throw：SRT 无负时间码，静默夹成 `00:00:00,000` 会把坏时间轴藏起来（宁炸不静默）。
 */
export function formatSrtTime(ms: number): string {
  if (!Number.isFinite(ms)) {
    throw new Error(`formatSrtTime：时间必须是有限数（实为 ${String(ms)}）——SRT 时间码无 NaN/Infinity`);
  }
  if (ms < 0) {
    throw new Error(
      `formatSrtTime：负数时间 ${ms}ms——SRT 时间码从 0 起（负值意味着上游时间轴坏了，` +
        `夹成 00:00:00,000 会把它藏起来）；宁炸不静默`,
    );
  }
  const total = Math.round(ms);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  const millis = total % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/**
 * 时间轴 × 章节 narrations → 字幕条目（**非空 narration 步**，按成片顺序）。
 *
 * `chapters` 是 manifest 的最小投影（结构上兼容 `RenderChapter` / `ChapterDef`），
 * 下标 = `TimelineStep.chapter`（游标坐标系）——与 `buildTimeline` 的入参同一套坐标系。
 */
export function buildSrtCues(
  timeline: Timeline,
  chapters: readonly { narrations: readonly string[] }[],
): SrtCue[] {
  const cues: SrtCue[] = [];
  for (const step of timeline.steps) {
    const chapter = chapters[step.chapter];
    if (chapter === undefined) {
      throw new Error(
        `buildSrtCues：时间轴的章节下标 ${step.chapter}（章节 ${step.chapterId} 第 ${step.step} 步）` +
          `不在传进来的章节表里（共 ${chapters.length} 章）——两张表不同源时会静默丢字幕/串稿；宁炸不静默`,
      );
    }
    const narration = chapter.narrations[step.step];
    if (narration === undefined) {
      throw new Error(
        `buildSrtCues：章节 ${step.chapterId} 的第 ${step.step} 步超出该章 narrations` +
          `（共 ${chapter.narrations.length} 条）——时间轴与章节表不同源；静默丢一条 = 有声无字，宁炸不静默`,
      );
    }
    if (!hasAudio(narration)) continue; // trim 口径（与引擎同源，见文件头 ①）
    cues.push({
      index: cues.length + 1, // 1..n 连续：跳号会被读成"缺一条"
      startMs: step.startMs,
      endMs: step.startMs + step.stepMs,
      text: narration.trim(),
    });
  }
  return cues;
}

/**
 * 条目 → SRT 文本。每条一块（序号 / `-->` 时间行 / 文本），**块间空行**、**末尾一个换行**
 * （末块自带换行 + `join("\n")` 之后不再补——`endsWith("\n\n")` 是空块，播放器宽容但 diff 里是噪音）。
 * 空表 → 空串（非空护栏，见文件头 ③）。
 */
export function renderSrt(cues: readonly SrtCue[]): string {
  return cues
    .map(
      (cue) =>
        `${cue.index}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text}\n`,
    )
    .join("\n");
}
