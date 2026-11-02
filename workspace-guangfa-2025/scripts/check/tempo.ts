/**
 * tempo：节奏检查（M3b Task 9）——#17 动画窗口 vs 音频时长 + #19 音频段 ≥15s。
 * 两条都是 §11.1 无头 pass 表的 warning 条目（17/19），都由 `runHeadlessPass` 归袋：
 *   · **#19** 纯 durations 扫描（不需要浏览器）——在开浏览器**之前**先跑，故"无 step 可跑"的
 *     早退路径照样出结论；
 *   · **#17** 吃 `audit().windowMs`（注册表声明窗口，只有真浏览器冻结态给得出）——逐 step 采集，
 *     全套步跑完后与本层的纯判据比对一次。
 *
 * ## #17 的口径（声明面比较，不冒充实测）
 *
 * `windowMs` = 引擎注册表**声明**的最大时长（§8 动画窗口；空注册表 = 0），不是动画真跑了几
 * 毫秒——无头 pass 跑 `?render=1` 冻结态，动画不推进，实测播放时长无从取得。故判据 =
 * "**注册表声明的窗口 > 音频时长**"，报告文案据此写死（消息里明示"声明上界"）。
 * 不报的三种合法态：无音频（`audioMs === null`：未跑 TTS / 无声过场）、窗口 0（无注册动画）、
 * 该帧未被采集（pass 中止 / 未跑到——不是数据问题，不得凭空判）。
 *
 * ## #19 的口径
 *
 * 逐段判（不合并、不取均值）：非空音频段 ≥ `MAX_SEGMENT_MS`（15s）→ warning，**输出实际值**
 * （消息带 `12000ms` 这类实测数字）+ 与下限的对照。缺 durations / 全未合成 → 无可扫面，不报
 * （未合成是合法态，不是缺陷；读数由 `audioTempoStats` 供报告单列）。
 *
 * ## 同源（杜绝语义漂移）
 *
 * 音频对位**不另写一份**：`resolveAudioMs` 从 `scripts/storyboard/data.ts` 外提并导出
 * （名称/参数/warnings 出参逐字保留），分镜页与门禁读同一份对位结果；本模块只消费它。
 *
 * 纯 TS、无 DOM 依赖——node（tsx 无头层）与 vitest 双环境消费。
 */

import { frameLocation, type StoryboardChapter } from "../storyboard/data";
import type { Finding } from "./findings";

// ── 常量与类型 ──

/** #17 的规则名（报告按规则名检索/聚合）。 */
export const ANIMATION_WINDOW_RULE = "动画窗口";

/** #19 的规则名。 */
export const AUDIO_TEMPO_RULE = "音频节奏";

/** #19 的段长下限（ms）：§11.1 #19「音频段 ≥15s 节奏警告」（原版人工校准机器化）。 */
export const MAX_SEGMENT_MS = 15_000;

/** 帧键（`<chapter>:<step>`）：把逐 step 采集到的 windowMs 与音频对位表连起来。 */
export function frameKey(chapter: number, step: number): string {
  return `${chapter}:${step}`;
}

/** #17 的帧定位输入（ShotSpec + 章节 id——定位文案与分镜/无头层逐字同款）。 */
export interface TempoFrame {
  chapter: number;
  step: number;
  chapterId: string;
}

// ── #17 动画窗口 vs 音频时长 ──

/**
 * 逐帧比对"注册表声明的动画窗口"与"该步音频时长"；只有 `windowMs > audioMs` 才报
 * （warning，含差值 ms）。三种合法态见文件头（无音频 / 窗口 0 / 未采集）——都不报。
 */
export function checkAnimationWindow(
  frames: readonly TempoFrame[],
  windowByFrame: ReadonlyMap<string, number>,
  audioByChapter: readonly (readonly (number | null)[])[],
): Finding[] {
  const findings: Finding[] = [];
  for (const f of frames) {
    const windowMs = windowByFrame.get(frameKey(f.chapter, f.step));
    if (windowMs === undefined || windowMs <= 0) continue; // 未采集 / 无注册动画
    const audioMs = audioByChapter[f.chapter]?.[f.step] ?? null;
    if (audioMs === null || windowMs <= audioMs) continue; // 无音频 / 未超出
    findings.push({
      rule: ANIMATION_WINDOW_RULE,
      severity: "warning",
      location: `${frameLocation(f)} · #17`,
      message:
        `注册表声明的动画窗口 ${windowMs}ms > 音频时长 ${audioMs}ms——动效超出人声 ` +
        `${windowMs - audioMs}ms，步长被动画拉长（#17：动画窗口 vs 音频时长；窗口取引擎注册表` +
        `声明上界，非实测播放时长——render 冻结态下动画不推进，实测值无从取得）`,
    });
  }
  return findings;
}

// ── #19 音频段 ≥15s ──

/**
 * 逐段扫描音频时长：非空音频段 ≥ `opts.maxSegmentMs` → warning（消息带实际值）。
 * 方向修正（2026-09-15）：§11.1 #19 原文是"音频段 ≥15s 节奏警告（口播过密 / step 没拆够）"，
 * 初版实现误写成"< 下限（段偏碎）"方向——与规格相反且修法误导（照文档拆 step 会红得更多）。
 * `audioByChapter` 缺章 / 缺步（越界读）→ 视为无音频（不报不抛——它是"未合成"的同一语义）。
 */
export function checkAudioTempo(
  chapters: readonly StoryboardChapter[],
  audioByChapter: readonly (readonly (number | null)[])[],
  opts: { maxSegmentMs: number },
): Finding[] {
  const findings: Finding[] = [];
  chapters.forEach((c, ci) => {
    const audio = audioByChapter[ci] ?? [];
    c.narrations.forEach((_, step) => {
      const audioMs = audio[step] ?? null;
      if (audioMs === null || audioMs < opts.maxSegmentMs) return;
      findings.push({
        rule: AUDIO_TEMPO_RULE,
        severity: "warning",
        location: `${frameLocation({ chapter: ci, step, chapterId: c.id })} · #19`,
        message:
          `音频段 ${audioMs}ms ≥ 上限 ${opts.maxSegmentMs}ms——口播段过密，step 没拆够` +
          `（#19：durations 扫描；原版人工校准的机器化，只判上限不判下限）`,
      });
    });
  });
  return findings;
}

/** #19 的扫描面读数（段数 + 极值）。 */
export interface AudioTempoStats {
  /** 非空音频段数（`audioMs !== null` 的步） */
  segments: number;
  minMs: number;
  maxMs: number;
}

/** #19 读数：无段可扫（durations 缺失 / 全未合成）→ null（合法态，不报）。 */
export function audioTempoStats(
  audioByChapter: readonly (readonly (number | null)[])[],
): AudioTempoStats | null {
  let segments = 0;
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  for (const chapter of audioByChapter) {
    for (const audioMs of chapter) {
      if (audioMs === null) continue;
      segments += 1;
      if (audioMs < minMs) minMs = audioMs;
      if (audioMs > maxMs) maxMs = audioMs;
    }
  }
  return segments === 0 ? null : { segments, minMs, maxMs };
}
