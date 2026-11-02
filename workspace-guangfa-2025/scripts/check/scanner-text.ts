/**
 * scanner-text：narrations 文本扫描器（M3a 静态门禁，§11.1 #1/#11 + §12b V3）。
 *
 * 规则（Finding.rule → severity）：
 *   manifest一致性 blocker  #1   steps !== narrations.length——manifest 的 define() 已派生
 *                                steps（注册即校验），此处是导入数据坏状态的运行时防线；
 *   文案反AI味    warning  #11  五类句式正则（十词 + 变体「归根到底」），每条 narrations
 *                                命中 → warning（定位 chapter.id + 索引）；
 *   字幕结尾标点  warning  V3   narrations 末字符 ∈ 。，、》…（省略号「……」末字符同为 …）。
 *                                V3 原文禁「句号/逗号/书名号」；？/！结尾的疑问/感叹句在
 *                                口播中常见，任务规格明示不查 ？！。
 *
 * 与 scanner-css / scanner-tsx 同构：纯 TS、无 DOM 依赖——tsx（node）与 vitest 双环境消费。
 */

import type { ChapterDef } from "../../src/chapters/manifest";
import type { Finding } from "./findings";

// ── #11 反 AI 味：五类句式正则（十词 + 变体） ──

/**
 * 反 AI 味十词（research-notes/04-improvements.md 同源 + 任务规格增补「不得不说/
 * 众所周知/毋庸置疑」）+ 变体「归根到底」。子串匹配天然覆盖自然变体（说白了就是/
 * 恰恰相反/正是因为/我必须要/众所周知的是/毋庸置疑的是……）。
 */
const AI_PHRASES = [
  "说白了",
  "本质上",
  "恰恰",
  "反而",
  "正是因为",
  "归根结底",
  "归根到底", // 变体（同义成语）
  "我必须",
  "不得不说",
  "众所周知",
  "毋庸置疑",
];

const AI_PHRASE_RE = new RegExp(AI_PHRASES.join("|"), "g");

// ── V3 字幕结尾禁标点 ──

/** V3：末字符 ∈ 。，、》…（「……」末字符同为 …）。？！ 结尾口播常见，规格明示不查。 */
const ENDING_PUNCT_RE = /([。，、》…])$/;

// ── 入口 ──

export function scanNarrations(chapters: ChapterDef[]): Finding[] {
  if (chapters.length === 0) {
    throw new Error("scanNarrations：chapters 数组为空（非空护栏，空输入不扫描）");
  }
  const findings: Finding[] = [];
  for (const chapter of chapters) {
    // #1 manifest 一致性（blocker）——define() 已派生 steps，此处只防导入坏数据
    if (chapter.steps !== chapter.narrations.length) {
      findings.push({
        rule: "manifest一致性",
        severity: "blocker",
        location: chapter.id,
        message:
          `steps=${chapter.steps} 与 narrations.length=${chapter.narrations.length} 不符` +
          "（#1：steps 由 manifest define() 派生，导入数据坏状态）",
      });
    }
    chapter.narrations.forEach((text, i) => {
      // #11 反 AI 味——单句命中多词合并一条，消息列出全部词（Set 去重）
      const phraseHits = [...new Set([...text.matchAll(AI_PHRASE_RE)].map((m) => m[0]))];
      if (phraseHits.length > 0) {
        findings.push({
          rule: "文案反AI味",
          severity: "warning",
          location: `${chapter.id}:narrations[${i}]`,
          message:
            `命中 AI 句式 ${phraseHits.map((p) => `「${p}」`).join("")}` +
            "（#11 五类句式正则）",
        });
      }
      // V3 字幕结尾禁标点——尾随空白不掩标点（trimEnd 后查末字符）
      const ending = text.trimEnd().match(ENDING_PUNCT_RE);
      if (ending !== null) {
        findings.push({
          rule: "字幕结尾标点",
          severity: "warning",
          location: `${chapter.id}:narrations[${i}]`,
          message:
            `结尾「${ending[1]}」（V3：字幕结尾禁句号/逗号/书名号/省略号；？！ 疑问感叹结尾豁免）`,
        });
      }
    });
  }
  return findings;
}
