#!/usr/bin/env node
/**
 * 真相源生成器：script.md（Checkpoint B 已确认）→ 各章 narrations.generated.ts。
 *
 * - 章节切分（beat 区间）与 outline.md 的章节边界一致；改稿 = 回 Phase 1 改
 *   script.md → 重跑本脚本（生成物不得手改）。
 * - narrations 文本 = 节拍原文，仅按 V3 字幕规则剥结尾标点（。，、…；？！豁免）。
 * - 空节拍保留为空串（无声过场），不跳过。
 *
 * 用法：node scripts/gen-narrations.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");

/** 章节注册表（folder / narrations 导出名 / script.md 节拍区间，1-based 闭区间） */
const CHAPTERS = [
  { folder: "01-coldopen", exportName: "coldopenNarrations", beats: [1, 4] },
  { folder: "02-market-engine", exportName: "marketEngineNarrations", beats: [5, 6] },
  { folder: "03-self-trading", exportName: "selfTradingNarrations", beats: [7, 10] },
  { folder: "04-cash-contrast", exportName: "cashContrastNarrations", beats: [11, 14] },
  { folder: "05-leverage-risk", exportName: "leverageRiskNarrations", beats: [15, 18] },
  { folder: "06-shareholder", exportName: "shareholderNarrations", beats: [19, 22] },
];

const scriptPath = path.join(ROOT, "script.md");
const raw = readFileSync(scriptPath, "utf8");
const blocks = raw.split("\n").reduce(
  (acc, line) => {
    if (line.trim() === "---") acc.push([]);
    else acc[acc.length - 1].push(line);
    return acc;
  },
  [[]],
);
const beats = blocks.slice(1).map((lines) =>
  lines
    .join("\n")
    .trim()
    .replace(/[。，、…]+$/, ""), // V3 字幕结尾禁句号/逗号/书名号/省略号；？！豁免
);
if (beats.length !== 22) {
  console.error(`✗ script.md 节拍数 ${beats.length} ≠ 22（Checkpoint B 已确认）`);
  process.exit(1);
}

let covered = new Set();
for (const { folder, exportName, beats: [from, to] } of CHAPTERS) {
  const narrations = beats.slice(from - 1, to);
  for (let i = from; i <= to; i++) covered.add(i);
  const body = `// 机器生成（scripts/gen-narrations.mjs ← script.md，Checkpoint B 已确认）。
// 章节 agent 不得手改——改稿 = 回 Phase 1 改 script.md → 重跑生成器 → 增量重合成。
export const ${exportName} = ${JSON.stringify(narrations, null, 2)};
`;
  const file = path.join(ROOT, "src", "chapters", folder, "narrations.generated.ts");
  console.log(`${dryRun ? "[dry-run] " : ""}${folder}: ${narrations.length} narrations → ${path.relative(ROOT, file)}`);
  if (!dryRun) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
}
if (covered.size !== 22) {
  const missing = Array.from({ length: 22 }, (_, i) => i + 1).filter((i) => !covered.has(i));
  console.error(`✗ 节拍覆盖不全：未覆盖 ${missing.join(",")}`);
  process.exit(1);
}
console.log(`${dryRun ? "[dry-run] " : ""}✓ 22 节拍全部归章`);
