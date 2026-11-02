// M4 截图模块（时间机器核心，§7 决策 1）——Playwright 逐帧捕捉 + 零动画断言。
//
// 职责：连接 dev server 上已安装游标桥（Task 1 的 window.__presentation）的页面，按
// (chapter, step) 逐帧：jumpTo → ready() → [零动画断言] → 截图（1920×1080 × DSF 1 = 精确
// 1080p）。消费方：storyboard 生成器（M4 Task 3）、无头门禁（M3b）、渲染管线（M5）——
// 接口约定跨计划冻结，签名逐字落实（见 capture.test.ts 的纯函数护栏）。
//
// M3b Task 3（K-21）起：浏览器启停三段、页面驱动（jumpTo / ready / getState / animations）与
// 游标/路径守卫都收进了 ./session，本模块的公开面在下面**再导出**（向后兼容不破）；本模块
// 只剩"分镜语义"——零动画门禁、输出路径、逐帧编排。依赖方向单向：capture.ts → session.ts。
//
// 关键取舍（实现者报告）：
//   1. **截图不做 animations: "disabled"**（Playwright 的 CSS 动画快进选项）：那会把"页面
//      里还有动画"这个事实按回图里（假绿）；零动画由 animations() 断言把关，截图只记录
//      已定下来的状态（M5 非分镜模式 assertNoAnimations=false 时同理）。
//   2. **截图尺寸 = viewport 裁剪**（不 fullPage）：fullPage 在页面可滚动时会产出高于 1080
//      的图，"精确 1080p"的约定即由此失守。
//   3. **chapterIds 为追加字段且 specs 非空时必传**（评审 F1 裁决）：冻结契约（计划 §2）的
//      CaptureOptions 只有 4 个字段，但输出约定要求 `shots/<chapterId>/<step>.png`
//      （chapterId = 章节 id 如 "example"，非数字下标），而 ShotSpec 只有数字游标。
//      此处追加可选字段，**缺省不再是静默数字下标而是 throw**——静默退化会产出与约定
//      不符、事后无人察觉的路径（宁炸不静默）。传 `chapters.map(c => c.id)`。
//   4. **游标回读（评审 F2）+ chapterId 白名单（评审 F3）**：跳转越界被 stepper 静默
//      clamp（要 (5,3) 得 (0,2)）→ 截图悄悄落错帧，故 ready() 后回读 getState 比对；
//      chapterId 直接进输出路径，白名单挡空串 / 分隔符 / `.` `..`（防写出目录外）。
//      守卫本体在 session.ts（两处消费共用），此处只剩调用点。
//   5. **截图后回读（评审 F1）**：F2 的回读发生在 ready() 之后、截图之前——覆盖不了"截图窗口里
//      页面自驱推进（音频兜底估时 → next()）把游标带走"：那样落盘的是别的步，而动画计数可能照样
//      为 0（门禁不会报）。故 screenshot 之后再回读一次，归因单列（assertCursorStill）。
//
// 环境前置：dev server 已运行（连接失败给出 "先 npm run dev" 指引，不自动起服——M5 编排器
// 再考虑自起）；首次执行前需装 Chromium（浏览器缺失抛可读指引错误——安装命令常量
// CHROMIUM_INSTALL_HINT 与错误转换都在 session.ts，本模块不再复述那个字面量）。

import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "playwright";
import {
  assertChapterId,
  assertCursor,
  assertCursorMatch,
  assertCursorStill,
  jumpToStep,
  openSession,
  readAnimations,
  readCursor,
  readyWithTimeout,
  shotPath,
  type ShotSpec,
} from "./session";

// ── 再导出面（K-21 迁移：冻结契约仍可从 capture.ts import——M5/门禁/既有测试的消费路径不变） ──

export {
  CHROMIUM_INSTALL_HINT,
  DEFAULT_VIEWPORT,
  READY_TIMEOUT_MS,
  assertCursorMatch,
  assertCursorStill,
  chromiumMissingError,
  expandSpecs,
  isMissingBrowserError,
  readyWithTimeout,
  shotPath,
  withHeadless,
} from "./session";

// 类型必须走 `export type`：本项目 tsconfig 未开 isolatedModules，写成普通 `export { ShotSpec }`
// tsc 不报错，但 esbuild/tsx 逐文件转译会按"值"去链接而运行期炸（ShotSpec 没有运行期绑定）。
export type { ShotSpec } from "./session";

// ── 冻结契约（计划 §2 接口约定，逐字；本模块自有部分） ──

export interface CaptureOptions {
  url: string;
  outDir: string;
  /** 默认 1920×1080（1080p 分镜约定） */
  viewport?: { width: number; height: number };
  /** 分镜模式 true（零动画门禁）；默认 false（M5 渲染逐帧 seek 时光标停在中途不为 0） */
  assertNoAnimations?: boolean;
  /** 增补（见文件头取舍 3）：章节目录名——`shots/<chapterId>/<step>.png`。
   *  **specs 非空时必传**（评审 F1）：缺省不再是静默数字下标，而是 throw——目录名是分镜页
   *  相对引用的组成部分，静默退化会产出与约定不符、事后无人察觉的路径。传 `chapters.map(c => c.id)`。 */
  chapterIds?: readonly string[];
}

export interface CaptureResult extends ShotSpec {
  file: string;
  animations: number;
}

// ── 逐帧捕捉 ──

/** 单步：跳游标 → 等就绪 → 回读校验 → 零动画断言 → 截图。 */
async function captureOne(
  page: Page,
  spec: ShotSpec,
  opts: CaptureOptions,
  chapterId: string,
): Promise<CaptureResult> {
  const where = `章节 ${spec.chapter} 第 ${spec.step} 步`;

  await jumpToStep(page, spec);
  await readyWithTimeout(page, where);

  // 回读必须在 ready() 之后（getState 是 commit-lagging，跳转刚落定时读到的是跳转前的位置）。
  assertCursorMatch(spec, await readCursor(page));

  const animations = await readAnimations(page);
  if (opts.assertNoAnimations === true && animations > 0) {
    throw new Error(
      `零动画断言失败（分镜阶段禁动画混入）：${where} 检出 ${animations} 个动画——` +
        `WAAPI（document.getAnimations）与引擎注册表之和须为 0（Ruling M4-1）；` +
        `该步的动画属渲染阶段（M5 逐帧 seek），分镜帧须为静帧`,
    );
  }

  const file = shotPath(opts.outDir, chapterId, spec.step);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });

  // 截图后回读（评审 F1）：自驱推进若在这一窗口抢先，落盘的就是别的步（且计数可能照样为 0，
  // 门禁不会报）。此处抛 = 宁炸不静默落错帧。
  assertCursorStill(spec, await readCursor(page));

  return { chapter: spec.chapter, step: spec.step, file, animations };
}

/**
 * 逐帧捕捉：单会话单页面（viewport / headless 归一 / goto 指引 / 等桥都在 openSession 里），
 * specs 顺序即产出顺序。
 * 空 specs → 空结果（不开浏览器）；缺 chapterIds / 非法游标 / 非法 id → throw
 * （全部在**开浏览器之前**，fail fast：参数错误不该先花一次浏览器启停）。
 */
export async function captureSteps(
  specs: readonly ShotSpec[],
  opts: CaptureOptions,
): Promise<CaptureResult[]> {
  if (specs.length === 0) return [];

  const chapterIds = opts.chapterIds;
  if (chapterIds === undefined) {
    throw new Error(
      "captureSteps：缺 chapterIds（specs 非空时必传，评审 F1）——输出约定是 " +
        "shots/<chapterId>/<step>.png（chapterId = 章节 id 如 \"example\"，不是数字下标），" +
        "请传 chapters.map(c => c.id)（与 specs 的 chapter 下标对位）",
    );
  }
  for (const spec of specs) {
    assertCursor(spec.chapter, `captureSteps：坐标 chapter（章节 ${spec.chapter} 第 ${spec.step} 步）`);
    assertCursor(spec.step, `captureSteps：坐标 step（章节 ${spec.chapter} 第 ${spec.step} 步）`);
    const id = chapterIds[spec.chapter];
    if (id === undefined) {
      throw new Error(
        `captureSteps：chapterIds 无第 ${spec.chapter} 项（章节 ${spec.chapter} 第 ${spec.step} 步）` +
          `——chapterIds 须与章节 manifest 等长对位（chapters.map(c => c.id)）`,
      );
    }
    assertChapterId(id, `captureSteps：chapterIds[${spec.chapter}]`);
  }

  const session = await openSession({ url: opts.url, viewport: opts.viewport });
  try {
    const results: CaptureResult[] = [];
    for (const spec of specs) {
      results.push(await captureOne(session.page, spec, opts, chapterIds[spec.chapter]));
    }
    return results;
  } finally {
    await session.close();
  }
}
