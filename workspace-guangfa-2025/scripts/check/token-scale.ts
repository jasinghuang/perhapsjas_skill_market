/**
 * token-scale：tokens.css 字阶/间距集合解析（Ruling P4-1 + P4-6）。
 *
 * scanner-css（字阶成员/间距成员）与 scanner-tsx（终审 I-2 字号维度）共用同源
 * 集合——主题改档门禁自动跟随，两扫描器单一来源防漂移。
 *
 * 模块相对路径：脚手架复制后脚本随项目走，指向被检项目自身的 tokens.css。
 * 注意不用 `new URL(rel, import.meta.url)`——vitest 的 jsdom 全局 URL 对 file: 基址
 * 会解析成 http://localhost:3000 虚拟 origin；fileURLToPath + path 双环境皆稳。
 *
 * 护栏：tokens.css 读取成功但字阶/间距集合解析为空时宁可炸掉也不假绿/误报（终审 C1 教训）。
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function parsePxValues(css: string, re: RegExp): Set<number> {
  const values = new Set<number>();
  for (const m of css.matchAll(re)) values.add(parseFloat(m[1]));
  return values;
}

const TOKENS_CSS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/theme/tokens.css",
);
let tokensCss: string;
try {
  tokensCss = readFileSync(TOKENS_CSS_FILE, "utf8");
} catch (e) {
  throw new Error(
    `token-scale：无法读取 src/theme/tokens.css（${TOKENS_CSS_FILE}）——` +
      `宁炸不假绿（${e instanceof Error ? e.message : String(e)}）`,
  );
}

export const TYPE_SCALE = parsePxValues(tokensCss, /--t-[\w-]*\s*:\s*([\d.]+)px/g);
export const SPACE_SCALE = parsePxValues(tokensCss, /--space-\d+\s*:\s*([\d.]+)px/g);

// 护栏：tokens.css 读取成功但字阶/间距集合解析为空时宁可炸掉也不假绿/误报（终审 C1 教训）
if (TYPE_SCALE.size === 0 || SPACE_SCALE.size === 0) {
  throw new Error(
    `token-scale：tokens.css 字阶/间距集合解析为空（${TOKENS_CSS_FILE}）——主题档位契约破坏，宁炸不假绿`,
  );
}

export const TYPE_SCALE_LABEL = [...TYPE_SCALE].sort((a, b) => a - b).join("/");
export const SPACE_SCALE_LABEL = [...SPACE_SCALE].sort((a, b) => a - b).join("/");

/** V4：--t-label 全局最小字号（scanner-css 与 scanner-tsx 共用下限）。 */
export const MIN_FONT_PX = 24;
