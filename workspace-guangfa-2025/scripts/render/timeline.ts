// M5a Task 1 时间轴表：**渲染链的地基**——成片每一段的时长都由它算，预览与成片同源
// （设计 §8 音画同步构造保证 / §3.1 三层时间模型）。
//
// 纯 TS、无 DOM / 无浏览器依赖——vitest（jsdom/Node）与 tsx（渲染 CLI）双环境消费。
//
// 模型：
//   步长 stepMs = max(音频时长, 动画窗口) + 停留垫
//     · 音频时长：public/audio-durations.json 实测；未合成（null）→ 与运行时**同一个**估时函数
//       （engine/hold.ts 的 estimateNarrationMs，评审 I4 / Ruling R5）
//     · 动画窗口：animMsByStep（T2 真机预扫的唯一产出；本任务只冻结形状，不自采）
//     · 停留垫：resolveHoldMs（引擎侧唯一解析器：timing.json > 档案 > 默认 400ms）
//   帧数 frameCount = 窗口帧 + 静置帧
//     · 窗口帧 = Math.ceil(animMs × fps / 1000)  ← **乘法式**：1000/fps 不可精确表示，
//       写成 animMs / (1000/fps) 会在整秒窗口上差一帧（两轮质检的实测结论）
//     · 静置帧 = holdMs > 0 ? 1 : 0            ← holdMs === 0 = 窗口盖住整步 → 无静置期可覆盖
//   静置时长 holdMs = max(0, stepMs − 窗口帧时长)
//     · 语义：**末帧要盖住的"窗口之后"时长**（静置 + 垫）。音频长于窗口的步（最常见：
//       静态步 + 一段口播）holdMs 远大于 dwellMs——静置帧要盖住整段口播尾巴，
//       否则成片比音轨短，mux -shortest 会**截掉音频**、产物自校验（T6）时长对不上。
//     · 编解码根据（M5a T5 定稿）：concat 清单**末帧**条目 duration = max(0, stepMs/1000 −
//       (frameCount−1)/fps)（= R3 统一式）⇒ 每步声明总时长精确 stepMs。计划式的
//       `holdMs/1000 − 1/fps` 已废弃：它假设每步末尾再补一条重复行来还那 1/fps，而中段重复行实测
//       会让后续包 AV_NOPTS_VALUE（T5 的 R2 矩阵）；且 stepMs<窗口帧时长（dwell≤slack）时它取 0。
//       ⚠️ 式里的 stepMs 必须由调用方逐字传入——`CapturedStep` 反推（frameCount/fps）会逐步漂。
//     · dwellMs 单列：解析出来的**数据**原值（300/400/600…），供报告/审计与 dwell 层对齐；
//       二者相等仅当动画窗口恰好整除步长（例如整秒窗口 + 无音频溢出）。
//   audioMs 只陈述**实测**事实（未合成 = null）；估时只在 stepMs 内部兜底，不冒充实测。
//
// 依赖方向：scripts/ → src/engine/（仓库既有惯例，如 storyboard/data.ts 引 constants）；
// src/ 不反向 import scripts/。音频时长对位复用 storyboard/data.ts 的
// normalizeDurations / resolveAudioMs——"非空 narration 顺序对位"口径只此一份，分镜与渲染不得各写一套。

import { estimateNarrationMs, resolveHoldMs, type TimingFile } from "../../src/engine/hold";
import { captionChunkDurations } from "../../src/engine/captionChunks";
import { SAMPLE_FPS } from "../../src/engine/constants";
import { normalizeDurations, resolveAudioMs } from "../storyboard/data";

/** 渲染采样帧率（= 引擎 SAMPLE_FPS，同一份常量；时间轴表默认 fps）。 */
export const RENDER_FPS = SAMPLE_FPS;

export interface TimelineStep {
  /** 章节下标（游标坐标系） */
  chapter: number;
  step: number;
  /** 章节目录名（帧目录 frames/<chapterId>/<step>/ 的组成部分） */
  chapterId: string;
  /** 步起点（ms）= 前序步长前缀和 */
  startMs: number;
  /** 音频实测时长（ms）；null = 未合成 / 无声过场（stepMs 内部走估时兜底） */
  audioMs: number | null;
  /** 动画窗口（ms）= T2 预扫产出 */
  animMs: number;
  /** 停留垫解析值（ms）：timing.json > 档案 > 默认（数据原值，不是编解码参数） */
  dwellMs: number;
  /** 步长（ms）= max(音频, 窗口) + 垫 */
  stepMs: number;
  /** 落盘 PNG 数：窗口帧 + 静置帧（holdMs=0 时无静置帧） */
  frameCount: number;
  /** 静置帧的 seek 时刻（ms，步内相对；首值恒 animMs，其后为字幕块边界 ∈ (animMs, stepMs)）。
   *  每块一帧 → 停留期字幕随块推进（M6 Checkpoint C 用户硬性要求：字幕不要太长）。
   *  时长分配见 encode.buildVideoConcatList（首段吃窗口网格 slack，Σ = stepMs − 窗口帧时长）。 */
  holdFrameMs: number[];
  /** 末帧要盖住的"窗口之后"时长（ms）：concat 末帧 duration 由 `stepMs` 与帧数算出（见文件头），
   *  `holdMs` 只陈述"窗口之后还有多长"这个事实，不直接进编码参数 */
  holdMs: number;
}

export interface BuildTimelineInput {
  chapters: readonly {
    id: string;
    folder: string;
    steps: number;
    narrations: readonly string[];
  }[];
  /** 已 JSON.parse 的 public/audio-durations.json；null/undefined = 文件不存在（合法：未跑 TTS） */
  durations: unknown;
  /** chapterId → timing.json 解析结果；缺键 = 该章无 timing.json（全默认） */
  timings: Record<string, TimingFile | undefined>;
  /** 窗口预扫产出（T2）：[chapterIndex][step] → 动画窗口 ms */
  animMsByStep: readonly (readonly number[])[];
  /** 档案覆盖（RuntimeConfig.holdMs；scaffold 按平台节奏写） */
  profileHoldMs?: number;
  /** 采样帧率（默认 RENDER_FPS） */
  fps?: number;
}

export interface Timeline {
  steps: TimelineStep[];
  /** 成片总时长（ms）= Σ 步长 */
  totalMs: number;
  fps: number;
}

/**
 * 无音频步的估时——**转发**引擎侧唯一实现（`src/engine/hold.ts` 的 `estimateNarrationMs`，
 * 评审 I4 / Ruling R5：公式文本从两处收敛到一处，运行时预览与渲染共用同一个函数）。
 *
 * 名字沿用计划冻结的接口面（接口约定 1 的 `estimateMsFromNarration`）；本文件不再持有公式文本，
 * `timeline.test.ts` 用**引用相等**断言钉死"同一个函数"（重抄一份公式即红）。
 */
export const estimateMsFromNarration = estimateNarrationMs;

/**
 * 动画窗口的宽松读取：缺位 / 非法（非有限非正数）→ 0（无动画窗口）。
 * 预扫（T2）是机器产出且自己校验长度，此处不重复严格校验——但也不炸渲染：
 * 宁可少算窗口（成片冻住）也不让 CLI 半路死在组装阶段；窗口真伪由 T4 的
 * "帧目录帧数 == frameCount / captured.animMs === timeline.animMs" 同源断言兜。
 */
function readAnimMs(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 组装时间轴表。空 chapters → 空表（非空护栏，不抛）。
 * durations 形态非法 → throw（坏数据不静默，与分镜侧同源同一张守卫）。
 */
export function buildTimeline(input: BuildTimelineInput): Timeline {
  const fps = input.fps ?? RENDER_FPS;
  const durations = normalizeDurations(input.durations);
  // 对位警示的出参在时间轴表接口里无处安放（Timeline 无 warnings）——丢弃；
  // 取值语义仍与分镜侧同一份实现（条目取不到 = 该步未合成 → 估时兜底）。
  const audioByChapter = resolveAudioMs(input.chapters, durations, []);

  const steps: TimelineStep[] = [];
  let startMs = 0;

  input.chapters.forEach((chapter, chapterIndex) => {
    const windowOfChapter = input.animMsByStep[chapterIndex] ?? [];
    chapter.narrations.forEach((narration, step) => {
      const audioMs = audioByChapter[chapterIndex]?.[step] ?? null;
      const animMs = readAnimMs(windowOfChapter[step]);
      const dwellMs = resolveHoldMs(input.timings[chapter.id], step, input.profileHoldMs);
      const speechMs = audioMs ?? estimateMsFromNarration(narration);
      const stepMs = Math.max(speechMs, animMs) + dwellMs;

      const windowFrames = Math.ceil((animMs * fps) / 1000);
      const holdMs = Math.max(0, stepMs - (windowFrames * 1000) / fps);
      // 字幕块边界（估算口径 captionChunkDurations——与预览/渲染/SRT 同一份）：
      // 落进窗口网格之后的边界各成一帧，停留期字幕随块推进。
      // **边界向上吸附到帧网格**（M6 真机臂实测）：非帧对齐的段时长让 CFR 编码逐段取整，
      // 150+ 段系统性漏帧（实测 −20 帧 / −667ms，mux -shortest 截音轨尾）——吸附后段时长
      // 全是整帧，只剩每步末段一个部分帧（模板原模型的既有形态，随机抵消）。
      // 吸附误差 ≤ 1 帧（33.3ms），字幕换块与估算边界的漂移不可感知；SRT 仍用未吸附估算值。
      const frameMs = 1000 / fps;
      const gridEnd = windowFrames * frameMs;
      const captionMs = captionChunkDurations(narration, estimateMsFromNarration(narration));
      const boundaries: number[] = [];
      let acc = 0;
      for (let i = 0; i < captionMs.length - 1; i++) {
        acc += captionMs[i];
        // 吸附帧网格后**取整到整数毫秒**：33.333… 帧长在二进制里不精确，吸附值带
        // 4e-13 级浮点噪声（4000.0000000000005），会让下游的 0.5 帧余数系统性向下
        // 取整（实测整片 −100ms）——整数毫秒后余数精确 0.5，round 方向对半开
        const snapped = Math.round((Math.ceil(acc / frameMs) * frameMs) * 1000) / 1000;
        // 落在窗口网格内的边界由窗口帧的字幕承接（无需静置帧）；与前一吸附点重合则去重
        if (snapped > gridEnd && snapped < stepMs && snapped !== boundaries[boundaries.length - 1]) {
          boundaries.push(snapped);
        }
      }
      const holdFrameMs = holdMs > 0 ? [animMs, ...boundaries] : [];

      steps.push({
        chapter: chapterIndex,
        step,
        chapterId: chapter.id,
        startMs,
        audioMs,
        animMs,
        dwellMs,
        stepMs,
        frameCount: windowFrames + holdFrameMs.length,
        holdMs,
        holdFrameMs,
      });
      startMs += stepMs;
    });
  });

  return { steps, totalMs: startMs, fps };
}
