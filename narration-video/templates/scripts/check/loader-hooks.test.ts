/**
 * loader-hooks 测试：tsx（node）资产/样式加载钩子（终审 M-6 最大崩溃面修复）。
 *
 * 单元：assetModuleSource（图片占位空字符串 / CSS 文本默认导出 / 非 file: 或未知扩展
 * undefined 交还默认加载器）+ jsonModuleSource（原始 JSON 文本 → format "json" 路径，
 * 见文件头 2026-09-11：JS 源码包装会被 Node 的 JSON 解析器 parse 成语法错）。
 * 集成：spawn 子进程跑真实 tsx（env 剥离 VITEST——钩子只在非 vitest 环境注册，
 * 子进程模拟真实 CLI 环境）：含 `import x from "./x.png"` 的章节源经钩子不崩、
 * 输出可读；对照子进程不注册钩子 → 同源崩溃 ERR_UNKNOWN_FILE_EXTENSION
 * （钉住测试力度——钩子若失效本对照即证明崩溃是真实基线）。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assetModuleSource, jsonModuleSource } from "./loader-hooks";

const CHECK_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(CHECK_DIR, "../..");
const HOOKS_MODULE = path.join(CHECK_DIR, "loader-hooks.ts");

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function makeTmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// ── 单元：assetModuleSource ──

describe("assetModuleSource 单元", () => {
  it("png/svg/jpg/jpeg → 占位空字符串模块（门禁不渲染页面，占位即可）", () => {
    for (const ext of [".png", ".svg", ".jpg", ".jpeg"]) {
      expect(assetModuleSource(`file:///tmp/hero${ext}`)).toBe(`export default ""`);
    }
    // 大小写与 query 后缀同走占位分支
    expect(assetModuleSource("file:///tmp/HERO.PNG")).toBe(`export default ""`);
    expect(assetModuleSource("file:///tmp/hero.png?width=100")).toBe(`export default ""`);
  });

  it("json → 原始文本（format \"json\" 路径；不再是 JS 源码包装）", () => {
    const d = makeTmp("loader-hooks-json-");
    const p = path.join(d, "config.json");
    fs.writeFileSync(p, '{"ok":true}');
    expect(jsonModuleSource(pathToFileURL(p).href)).toBe('{"ok":true}');
    // assetModuleSource 不再管 .json（两条路径分离，见文件头 2026-09-11）
    expect(assetModuleSource(pathToFileURL(p).href)).toBeUndefined();
    expect(jsonModuleSource("file:///tmp/x.webp")).toBeUndefined();
    expect(jsonModuleSource("data:application/json,%7B%7D")).toBeUndefined();
  });

  it("css → 文本默认导出（?raw 与副作用 import 皆通）", () => {
    const d = makeTmp("loader-hooks-css-");
    const p = path.join(d, "a.css");
    fs.writeFileSync(p, "body { margin: 0; }");
    expect(assetModuleSource(pathToFileURL(p).href)).toBe(
      `export default ${JSON.stringify("body { margin: 0; }")}`,
    );
  });

  it("非 file: / 未知扩展名 → undefined（交还默认加载器）", () => {
    expect(assetModuleSource("data:text/plain,hello")).toBeUndefined();
    expect(assetModuleSource("file:///tmp/x.webp")).toBeUndefined();
    expect(assetModuleSource("file:///tmp/x.mp3")).toBeUndefined();
  });
});

// ── 集成：真实 tsx 子进程 ──

describe("子进程集成：png import 章节源经 tsx 不崩", () => {
  const TSX_CLI = path.join(TEMPLATE_ROOT, "node_modules", "tsx", "dist", "cli.mjs");

  interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
  }

  function runTsx(childPath: string, args: string[]): RunResult {
    // 剥离 VITEST——钩子仅在非 vitest 环境注册，子进程须模拟真实 CLI 环境
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env.VITEST;
    const r = spawnSync(process.execPath, [TSX_CLI, childPath, ...args], {
      cwd: TEMPLATE_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      env,
    });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  it("含 import x from './x.png' 的章节源经钩子不崩（可读输出而非裸栈）", () => {
    const d = makeTmp("loader-hooks-int-");
    // type: module——真实项目与模板同型的 ESM 语境（CJS 语境下 tsx 把 import 转 require，
    // 崩溃形态不同，不能代表 Vite 默认 import 写法的真实崩溃面）
    fs.writeFileSync(path.join(d, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(d, "hero.png"), "PNG");
    fs.writeFileSync(path.join(d, "config.json"), '{"ok":true}');
    const chapterPath = path.join(d, "chapter.tsx");
    fs.writeFileSync(
      chapterPath,
      [
        'import hero from "./hero.png";',
        'import cfg from "./config.json";',
        "export const heroLen = (hero as string).length;",
        "export const flag = (cfg as { ok: boolean }).ok;",
      ].join("\n"),
    );
    // async IIFE：子脚本与夹具目录格式解耦（type: module 与否均稳）
    const childPath = path.join(d, "child.ts");
    fs.writeFileSync(
      childPath,
      [
        "const hooksPath = process.argv[2]!;",
        "const chapterPath = process.argv[3]!;",
        "void (async () => {",
        "  await import(hooksPath); // 注册资产钩子（副作用）",
        "  const mod = (await import(chapterPath)) as { heroLen: number; flag: boolean };",
        "  console.log(`STUB_OK ${mod.heroLen} ${mod.flag}`);",
        "})();",
      ].join("\n"),
    );
    const r = runTsx(childPath, [HOOKS_MODULE, chapterPath]);
    expect(r.stderr).not.toContain("ERR_UNKNOWN_FILE_EXTENSION");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("STUB_OK 0 true");
  });

  it("对照：无钩子子进程同源崩溃 ERR_UNKNOWN_FILE_EXTENSION（钉住测试力度）", () => {
    const d = makeTmp("loader-hooks-int-");
    fs.writeFileSync(path.join(d, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(d, "hero.png"), "PNG");
    const chapterPath = path.join(d, "chapter.tsx");
    fs.writeFileSync(
      chapterPath,
      ['import hero from "./hero.png";', "export const heroLen = (hero as string).length;"].join("\n"),
    );
    const childPath = path.join(d, "child-no-hooks.ts");
    fs.writeFileSync(
      childPath,
      [
        "const chapterPath = process.argv[2]!;",
        "void (async () => {",
        "  await import(chapterPath);",
        "  console.log('UNEXPECTED_OK');",
        "})();",
      ].join("\n"),
    );
    const r = runTsx(childPath, [chapterPath]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("ERR_UNKNOWN_FILE_EXTENSION");
    expect(r.stdout).not.toContain("UNEXPECTED_OK");
  });
});
