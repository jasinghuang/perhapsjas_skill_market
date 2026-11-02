// 字幕命令式驱动器（M6 字幕切块）：字幕块 = f(text, stepMs, tMs) 纯函数，
// 由桥 seek / 音频时钟**同步直写 DOM**——与动画 seek 同一拍生效，不进 React state。
//
// 为什么不能走 React（全量真机臂实测教训）：setState → re-render 的刷新时机与
// 截图窗口（seek 后 2 rAF）存在竞态——安静环境恒一致、满载（并行 worker + ffmpeg）下
// 随机输给 2 rAF，跨会话重采 md5 不一致（确定性破坏）。动画本身就是命令式
// （WAAPI/canvas currentTime），字幕跟随同一条命令式路径才与截图天然同步。
import { captionChunkIndex, splitCaptionChunks } from "./captionChunks";

let boundEl: HTMLSpanElement | null = null;
let boundText = "";
let boundStepMs = 0;

/** 绑定字幕元素（App 每步挂载时调用；text 为空 = 解绑）。绑定时即驱动 t=0（第 0 块）。 */
export function bindCaptionElement(el: HTMLSpanElement | null, text: string, stepMs: number): void {
  boundEl = el;
  boundText = text;
  boundStepMs = stepMs;
  if (el) driveCaption(0);
}

/** 按步内时刻驱动字幕块（幂等：同一 t 恒同一块——渲染确定性的字幕半边）。 */
export function driveCaption(tMs: number): void {
  if (boundEl === null || boundText === "") return;
  const chunks = splitCaptionChunks(boundText);
  const index = captionChunkIndex(boundText, boundStepMs, tMs);
  boundEl.textContent = chunks[index] ?? boundText;
}
