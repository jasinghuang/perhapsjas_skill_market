/**
 * verify-sequential-negative-control.browser.test.ts（M5b Task 6）：`--verify-sequential` 的
 * **负对照自动化**（M5 遗留 #6）的真机两臂——M4 终审时人工做了一次（篡改一张参考图 →
 * mismatch + 非零退出），本文件把它固化成可回归的自动化。
 *
 * 判据是**两面的**（单臂取证不成立）：
 *   · 正臂：不篡改 → 真 `verifySequential` 全一致、`summarizeVerification().exitCode === 0`
 *     （判据面**不是恒红**）；
 *   · 负臂：篡改一个非豁免步的参考图副本 → 真 `verifySequential` 在**那一步**报 mismatch、
 *     `exitCode === 1`，且**真参考图字节零改动**（篡改只作用于副本，跑完即删——比"改完再还原"
 *     少一个"崩在中途就把分镜页图弄坏"的窗口）。
 * 两条合起来才证明"这个判据既会红也会绿"，任一条单独看都可能是空转。
 *
 * 参考图由真生产者 `captureSteps` 产出（不是手写 PNG）：篡改的是**主流程截图**这条链上的文件，
 * 与 `--verify-sequential` 实跑时的对象同一份。
 *
 * 环境（逐条照 `session.browser.test.ts` 的实测坑）：
 *   · 本文件跑在 **jsdom**（vitest 的 setupFiles 是全局的）；**不得**在文件任何位置写出
 *     environment 标记字面量（vitest 全文扫描，含注释）；
 *   · playwright 的 Node 侧入口在 jsdom 里缺 `TransformStream` → 先补全局再让它加载
 *     （session 对 playwright 是运行期动态 import）。
 *
 * 夹具页是**自造的静态页**（不是真模板应用）：本文件取证的是"参考图字节 → 判定 → 退出码"
 * 这条判据链，与 deck 长什么样无关；真模板应用上的取证由 `npm run storyboard --
 * --verify-sequential --verify-negative-control` 的真机跑承担。
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { TransformStream as NodeTransformStream } from "node:stream/web";
import { afterEach, describe, expect, it } from "vitest";
import { captureSteps } from "./capture";
import { expandSpecs } from "./session";
import {
  summarizeVerification,
  verifySequential,
  verifySequentialNegativeControl,
} from "./verify-sequential";

(globalThis as { TransformStream?: unknown }).TransformStream ??= NodeTransformStream;

const servers: http.Server[] = [];
const tmpDirs: string[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop()!;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function tmpDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `verify-nc-${label}-`));
  tmpDirs.push(dir);
  return dir;
}

/**
 * 夹具页：单章三步，`#slot` 的底色与文本随游标变（步与步之间画面确实不同），
 * 键盘 ArrowRight 真推进游标（`verifySequential` 走的就是键盘路径）。静态渲染、无动画 ⇒
 * 跨会话同刻截图逐字节一致（同 `frames.browser.test.ts` 的确定性前提）。
 */
async function serveDeck(): Promise<string> {
  const html = [
    "<!doctype html><html><head><style>",
    "html,body{margin:0;height:100%;background:#ffffff}",
    "#slot{width:400px;height:200px;font:24px monospace}",
    "</style></head><body>",
    '<div id="slot"></div>',
    "<script>",
    "var colors=['#123456','#654321','#abcdef'];",
    "var st={chapter:0,step:0};",
    "function render(){var s=document.getElementById('slot');s.textContent='step '+st.step;s.style.background=colors[st.step];}",
    "window.__presentation={",
    "  jumpTo:function(c,s){st={chapter:c,step:s};render();},",
    "  getState:function(){return {chapter:st.chapter,step:st.step};},",
    "  ready:function(){return Promise.resolve();},",
    "  animations:function(){return 0;},",
    "  seek:function(){},",
    "  audit:function(){return {waapi:0,owned:0,unowned:0,unownedRunning:0,unownedHints:[],running:0,registry:0,windowMs:0};}",
    "};",
    'window.addEventListener("keydown",function(e){if(e.key==="ArrowRight"){st.step=Math.min(colors.length-1,st.step+1);render();}});',
    "render();",
    "</script></body></html>",
  ].join("\n");
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as { port: number };
  return `http://127.0.0.1:${addr.port}/`;
}

describe("--verify-sequential 负对照（真机两臂：不篡改全一致 / 篡改必 mismatch + 非零退出）", () => {
  it("参考图来自真 captureSteps；负对照在篡改的那一步报 mismatch 且真参考图零改动", async () => {
    const url = await serveDeck();
    const specs = expandSpecs([{ steps: 3 }]);
    const chapterIds = ["fixture"];
    const outDir = tmpDir("ref");

    // 参考图 = 真生产者（主流程截图这条链）
    const captured = await captureSteps(specs, { url, outDir, chapterIds });
    expect(captured.map((c) => c.animations)).toEqual([0, 0, 0]);
    const refFiles = specs.map((s) => path.join(outDir, "shots", chapterIds[s.chapter], `${s.step}.png`));
    for (const f of refFiles) expect(fs.existsSync(f), `参考图未产出：${f}`).toBe(true);
    const before = refFiles.map((f) => fs.readFileSync(f));

    // 正臂：不篡改 → 全一致、退出码 0（判据面不是恒红）
    const clean = await verifySequential({
      url,
      specs,
      chapterIds,
      ambientKeys: new Set<string>(),
      referenceDir: outDir,
    });
    expect(clean.map((v) => v.status)).toEqual(["match", "match", "match"]);
    expect(summarizeVerification(clean).exitCode).toBe(0);

    // 负臂：负对照自己挑一个非豁免步、改它的**副本**，跑同一条真判定链
    const control = await verifySequentialNegativeControl({
      url,
      specs,
      chapterIds,
      ambientKeys: new Set<string>(),
      referenceDir: outDir,
    });
    expect(control.target).toBe("章节 0 第 0 步（fixture）");
    expect(control.exitCode).toBe(1); // summarizeVerification 给的就是非零
    expect(control.verdicts.map((v) => v.status)).toEqual(["mismatch", "match", "match"]);
    expect(control.ok).toBe(true);
    expect(control.lines.join("\n")).toContain("复现");
    expect(control.referenceIntact).toBe(true);
    // 真参考图逐字节未动（跑完还原：篡改只落在副本上）
    expect(refFiles.map((f) => fs.readFileSync(f))).toEqual(before);
  }, 180_000);

  it("非豁免步一个都没有（全免比对）→ 负对照**不静默通过**：明写'无可篡改目标'并判负", async () => {
    const url = await serveDeck();
    const specs = expandSpecs([{ steps: 2 }]);
    const chapterIds = ["fixture"];
    const outDir = tmpDir("all-exempt");
    await captureSteps(specs, { url, outDir, chapterIds });

    const control = await verifySequentialNegativeControl({
      url,
      specs,
      chapterIds,
      ambientKeys: new Set(["0:0", "0:1"]), // 两步全声明 ambient
      referenceDir: outDir,
    });
    expect(control.target).toBeNull();
    expect(control.ok).toBe(false);
    expect(control.lines.join("\n")).toContain("无可篡改目标");
  }, 120_000);
});
