// 字幕切块（M6 Checkpoint C 用户硬性要求："每一次出现的字幕不要太长"）。
// 纯函数：口播 → 字幕块列表。块 = 一个呼吸单位（≤ MAX_CAPTION_CHARS，术语/数字不拆）。
// 块时长 ∝ 块字数，归一化到该步实测音频时长——步内字幕随时间逐块推进（A′ 静置期每块一帧）。
//
// 切分纪律（SCRIPT-STYLE 断句原则的机器化）：
//   1. 优先在句读（。？！；——，）处断；
//   2. 断点两侧都不短于 6 字（避免碎块——用户裁定"句子切得太碎更像 AI"）；
//   3. 块长上限 16 字（视频号/抖音字幕惯例 + add-subtitle ≤12 字约定的财经放宽）；
//   4. 无句读的长串（术语/数字连排）硬切时避开"同比 +42.2%"这类粘连片段（数字前后优先断）。

export const MAX_CAPTION_CHARS = 16;
export const MIN_CAPTION_CHARS = 6;

/** 句读断点（全角 + 半角） */
const CLAUSE = /([。？！；—…，,])/g;

/** 该位置断开会把"数字+单位/百分号"或术语拆开吗？（粘连保护：断点两侧有数字相关字符相邻即避开） */
function breaksGlue(text: string, index: number): boolean {
  const before = text[index - 1] ?? "";
  const after = text[index] ?? "";
  return /[0-9%+\-.]/.test(before) && /[0-9%+\-.]/.test(after);
}

export function splitCaptionChunks(text: string, maxChars = MAX_CAPTION_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // 候选断点：每个句读之后的空隙
  const cuts: number[] = [];
  let m: RegExpExecArray | null;
  CLAUSE.lastIndex = 0;
  while ((m = CLAUSE.exec(trimmed)) !== null) {
    const cut = m.index + m[0].length; // 断在句读之后
    if (cut >= MIN_CAPTION_CHARS && trimmed.length - cut >= MIN_CAPTION_CHARS && !breaksGlue(trimmed, cut)) {
      cuts.push(cut);
    }
  }

  // 贪心：每块 ≤ maxChars，且尽量贴近 maxChars（块数最少）
  const chunks: string[] = [];
  let start = 0;
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    if (cut - start <= maxChars) continue; // 还能更长
    // 需要在前一个断点收块
    if (i === 0) {
      // 第一块前无更早断点：硬切到 maxChars 内最近的合法位置
      chunks.push(trimmed.slice(0, maxChars));
      start = maxChars;
      continue;
    }
    const prevCut = cuts[i - 1];
    if (prevCut <= start) {
      chunks.push(trimmed.slice(start, maxChars + start));
      start += maxChars;
      continue;
    }
    chunks.push(trimmed.slice(start, prevCut).trim());
    start = prevCut;
    // 重看当前断点
    i--;
  }
  // 尾块
  let rest = trimmed.slice(start).trim();
  while (rest.length > maxChars) {
    // 尾部超长：从后往前找句读断点，没有就硬切
    const tailCuts = [...rest.matchAll(CLAUSE)]
      .map((x) => x.index! + x[0].length)
      .filter((c) => c >= MIN_CAPTION_CHARS && rest.length - c >= MIN_CAPTION_CHARS && !breaksGlue(rest, c));
    const last = tailCuts[tailCuts.length - 1];
    if (last === undefined || last > maxChars) {
      chunks.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars).trim();
    } else {
      chunks.push(rest.slice(0, last).trim());
      rest = rest.slice(last).trim();
    }
  }
  if (rest !== "") chunks.push(rest);
  return chunks;
}

/** 块时长（ms）：按字数占全文字数比例分摊 stepMs——字幕推进与音频同步的确定性来源。 */
export function captionChunkDurations(text: string, stepMs: number, maxChars = MAX_CAPTION_CHARS): number[] {
  const chunks = splitCaptionChunks(text, maxChars);
  if (chunks.length === 0) return [];
  const weights = chunks.map((c) => c.length);
  const total = weights.reduce((n, w) => n + w, 0);
  // 逐块 round，尾块吃剩余（Σ == stepMs 的硬契约）
  const ms: number[] = [];
  let spent = 0;
  for (let i = 0; i < chunks.length; i++) {
    const share = i === chunks.length - 1 ? stepMs - spent : Math.round((stepMs * weights[i]) / total);
    ms.push(share);
    spent += share;
  }
  return ms;
}

/** 当前时刻（步内 ms）对应的字幕块下标（渲染确定性：同一 t 恒同一块）。 */
export function captionChunkIndex(text: string, stepMs: number, tMs: number, maxChars = MAX_CAPTION_CHARS): number {
  const durations = captionChunkDurations(text, stepMs, maxChars);
  if (durations.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < durations.length; i++) {
    acc += durations[i];
    if (tMs < acc) return i;
  }
  return durations.length - 1;
}
