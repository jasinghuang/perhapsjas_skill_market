// M4 Task 3 一致性校验（计划 §Global Constraints：顺序推进 vs 独立 mount 的像素一致性）——
// 同一 step 以"键盘顺序推进到达"与"直接 jumpTo 到达（= 主流程截图）"两条路径取图，逐字节比对；
// 不一致即非零退出（这是 M5 渲染模型 = 独立 mount 的前置门禁）。
//
// 关键取舍（实现者报告）：
//   1. **独立 mount 参考 = captureSteps 的既有产出**（<outDir>/shots/<chapterId>/<step>.png）：
//      那正是主流程"jumpTo 逐帧"的实况图，再截一遍只会引入第二份真相（还可能截出与主流程
//      不一致的参考）。故本模块只新增"顺序推进"这一条路径，回读磁盘上的参考图比对字节。
//   2. **顺序推进 = 真键盘事件**（page.keyboard.press("ArrowRight")）而非内部接口调 next()：
//      App 的键盘监听（←/→/Home/End）就是"用户顺看片子"的路径，且能暴露"键盘焦点/监听被
//      禁用"这类真实回归（计划 §自检 4 已提示验证）。每步到达后 await ready()，模拟"在每一步
//      停下来看"的推进节奏。
//   3. **氛围步免比对（Ruling M4-2 / 计划 Step 6）**：已声明 ambient 的步其像素本就允许随时间
//      漂移（氛围微动），两条路径的静置时刻不同 → 比对结果只作参考（exempt / exempt-info），
//      不进退出码。报告显式注明。
//   4. **容忍页面自动推进**：预览态音频兜底估时会在 ~2s 后自动 next()（useAudioPlayer），
//      顺序推进途中若被自动推进抢先，游标会跳到目标之后。故推进循环**读实际游标**向左收敛
//      （while cur < target 才按键），越过目标则响亮失败（明确指到"自动推进抢先"，不静默给
//      假绿）——这比假设"时间窗口足够短"更诚实。
//   5. **纯函数面外置**：compareShotBytes / summarizeVerification 不碰浏览器，单测直接覆盖
//      （浏览器驱动部分靠冒烟与 M5 复用验证）。
//   6. **不在本模块引入 capture.ts 的私有 helper**：capture.ts 是对外冻结的消费契约（Task 2），
//      其 goto/ready 细节不外借；此处按同一语义最小复刻三段（错误文案保持可读），避免为复用
//      而扩冻结面。

import * as fs from "node:fs";
import type { Browser, Page } from "playwright";
import {
  DEFAULT_VIEWPORT,
  READY_TIMEOUT_MS,
  assertCursorStill,
  chromiumMissingError,
  isMissingBrowserError,
  shotPath,
  withHeadless,
  type ShotSpec,
} from "./capture";

export type VerifyStatus = "match" | "mismatch" | "exempt" | "exempt-info";

export interface VerifyVerdict extends ShotSpec {
  chapterId: string;
  status: VerifyStatus;
  /** 人读结论（一致 = 字节相同；不一致 = 字节摘要） */
  detail: string;
  /** 氛围步免比对（Ruling M4-2）——true 时不影响退出码 */
  exempt: boolean;
}

// ── 纯函数（单测面） ──

/** 逐字节比对（长度不同也算不一致；detail 给首个差异偏移/长度差，方便定位假红真因）。 */
export function compareShotBytes(
  a: Uint8Array,
  b: Uint8Array,
): { equal: boolean; detail: string } {
  if (a.length !== b.length) {
    const common = Math.min(a.length, b.length);
    let offset = -1;
    for (let i = 0; i < common; i++) {
      if (a[i] !== b[i]) {
        offset = i;
        break;
      }
    }
    return {
      equal: false,
      detail:
        `长度 ${a.length} vs ${b.length} 字节` +
        (offset >= 0 ? `，首个差异字节偏移 ${offset}` : "（公共前缀相同，仅尾部多寡不同）"),
    };
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return { equal: false, detail: `首个差异字节偏移 ${i}（长度 ${a.length}）` };
    }
  }
  return { equal: true, detail: "" };
}

export interface VerificationReport {
  lines: string[];
  exitCode: number;
  mismatches: VerifyVerdict[];
  exempt: VerifyVerdict[];
}

const STATUS_TAG: Record<VerifyStatus, string> = {
  match: "match",
  mismatch: "mismatch",
  exempt: "exempt",
  "exempt-info": "exempt-info",
};

/**
 * 结论 → 报告行 + 退出码。非豁免不一致 = 非零退出（差异步与字节摘要逐条列出）；
 * 氛围步免比对只记录、不判负，并注明原因（Ruling M4-2）。
 */
export function summarizeVerification(verdicts: readonly VerifyVerdict[]): VerificationReport {
  const mismatches = verdicts.filter((v) => v.status === "mismatch");
  const exempt = verdicts.filter((v) => v.exempt);
  const compared = verdicts.length - exempt.length;
  const lines: string[] = [
    `一致性校验（顺序推进 vs 独立 mount）：共 ${verdicts.length} 步（比对 ${compared}，免比对 ${exempt.length}）`,
  ];
  for (const v of verdicts) {
    const where = `章节 ${v.chapter} 第 ${v.step} 步（${v.chapterId}）`;
    const tag = `[${STATUS_TAG[v.status]}]`;
    if (v.status === "match") lines.push(`${tag} ${where}——一致（字节相同）`);
    else if (v.status === "mismatch") lines.push(`${tag} ${where}——不一致：${v.detail}`);
    else lines.push(`${tag} ${where}——${v.detail}`);
  }
  if (exempt.length > 0) {
    lines.push(
      `注：已声明 ambient 的氛围步免比对（氛围微动像素随时间漂移，不代表顺序/独立 mount 有差）——` +
        `${exempt.length} 步：` +
        exempt.map((v) => `章节 ${v.chapter} 第 ${v.step} 步`).join("、"),
    );
  }
  lines.push(
    mismatches.length === 0
      ? `结论：非豁免步全部一致（${compared} 步比对通过）`
      : `结论：${mismatches.length} 步不一致——顺序推进与独立 mount 像素有差（渲染模型 = 独立 mount 的前置门禁未过）`,
  );
  return { lines, exitCode: mismatches.length > 0 ? 1 : 0, mismatches, exempt };
}

// ── 浏览器驱动 ──

export interface VerifySequentialOptions {
  url: string;
  /** 分镜帧序（expandSpecs 的输出——顺序推进按此序前进） */
  specs: readonly ShotSpec[];
  /** 与 specs 的 chapter 下标对位（chapters.map(c => c.id)） */
  chapterIds: readonly string[];
  /** 免比对的氛围步键：`${chapter}:${step}`（已声明 ambient 的步） */
  ambientKeys: ReadonlySet<string>;
  /** 独立 mount 参考图目录（= captureSteps 的 outDir，即 <outDir>/shots/... 所在） */
  referenceDir: string;
  /** 差异图落盘目录（可选）：不一致时写 <dir>/<chapterId>/<step>-{sequential,independent}.png */
  diffDir?: string;
  viewport?: { width: number; height: number };
}

export function ambientKey(chapter: number, step: number): string {
  return `${chapter}:${step}`;
}

async function launchChromium(): Promise<Browser> {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch();
  } catch (e) {
    if (isMissingBrowserError(e)) throw chromiumMissingError(e);
    throw e;
  }
}

/** goto + 等桥安装（语义同 capture.ts；连不上给 "先 npm run dev" 指引）。 */
async function openPage(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (/ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE/.test(detail)) {
      throw new Error(
        `无法连接 ${url}——请先 \`npm run dev\`（模板 dev server 默认 5174）。原始错误：${detail}`,
      );
    }
    throw e;
  }
  try {
    await page.waitForFunction(() => window.__presentation !== undefined, undefined, {
      timeout: READY_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `页面未安装 window.__presentation 桥（${url}）——确认 URL 带 ?headless=1、dev server 在运行、` +
        `且页面渲染无异常（桥在 App 挂载后安装）`,
    );
  }
}

/** ready() + 超时（桥无内建超时——语义同 capture.ts） */
async function readyWithTimeout(page: Page, where: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `ready() 超时（${READY_TIMEOUT_MS}ms）：${where} 未就绪——页面仍在等 fonts.ready / 图像 load`,
          ),
        ),
      READY_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([page.evaluate(() => window.__presentation!.ready()), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 一致性校验主流程：单浏览器单页，键盘顺序推进逐帧截图 → 与磁盘参考图逐字节比对。
 * 空 specs → 空结论（不开浏览器）。
 */
export async function verifySequential(
  opts: VerifySequentialOptions,
): Promise<VerifyVerdict[]> {
  if (opts.specs.length === 0) return [];
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const url = withHeadless(opts.url);
  const index = new Map<string, number>();
  opts.specs.forEach((s, i) => index.set(ambientKey(s.chapter, s.step), i));

  const readIndex = async (page: Page, where: string): Promise<number> => {
    const st = await page.evaluate(() => window.__presentation!.getState());
    const i = index.get(ambientKey(st.chapter, st.step));
    if (i === undefined) {
      throw new Error(
        `一致性校验：${where} 读到页面游标（章节 ${st.chapter} 第 ${st.step} 步）不在分镜帧集合内` +
          `——键盘推进把游标带出了 specs 范围`,
      );
    }
    return i;
  };

  const browser = await launchChromium();
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await openPage(page, url);
    // 起始游标复位（全新 context 本应是 (0,0)；防御 localStorage 游标恢复带来的起点漂移）。
    // 注意（评审 F6）：起点帧 (0,0) 无"顺序来路"可走——它的"顺序路径"就是这次 jumpTo + 页面
    // 初始 mount 的产出，故该帧两路径的比对强度**等同于参考图自身**（不给顺序推进额外证据）。
    // 真正带键盘推进信息的比对从 step ≥ 1 起（多步章则从第 2 帧起）。
    await page.evaluate(() => window.__presentation!.jumpTo(0, 0));
    await readyWithTimeout(page, "起始游标");

    const verdicts: VerifyVerdict[] = [];
    let presses = 0;
    const maxPresses = opts.specs.length * 2 + 8;

    for (const spec of opts.specs) {
      const chapterId = opts.chapterIds[spec.chapter];
      if (chapterId === undefined) {
        throw new Error(
          `一致性校验：chapterIds 无第 ${spec.chapter} 项（章节 ${spec.chapter} 第 ${spec.step} 步）` +
            `——须与章节 manifest 等长对位`,
        );
      }
      const where = `章节 ${spec.chapter} 第 ${spec.step} 步（${chapterId}）`;
      const target = index.get(ambientKey(spec.chapter, spec.step))!;

      // 键盘顺序推进到目标（容忍页面自动推进：只朝目标按，越过即响亮失败）
      let cur = await readIndex(page, where);
      while (cur < target) {
        await page.keyboard.press("ArrowRight");
        presses += 1;
        if (presses > maxPresses) {
          throw new Error(
            `一致性校验：顺序推进按键超过 ${maxPresses} 次仍未到达 ${where}——推进循环未收敛，` +
              `疑似键盘监听未生效或游标被反复重置`,
          );
        }
        await readyWithTimeout(page, `${where}（顺序推进第 ${presses} 次按键后）`);
        cur = await readIndex(page, where);
      }
      if (cur > target) {
        throw new Error(
          `一致性校验：顺序推进越过目标 ${where}——按键时页面游标已在前方（预览态音频兜底估时的` +
            `自动推进抢先）。请重跑：本步暴露的是页面自动推进时序，不是顺序/独立 mount 差异`,
        );
      }

      const seqBytes = await page.screenshot();
      // 截图后回读（评审 F1）：自驱推进若在截图窗口抢先，这张图是别的步 → 会与参考图不同，
      // 但归因是"页面自驱推进"而非"顺序/独立 mount 有差"（假红源头）。故先回读再比对。
      assertCursorStill(spec, await page.evaluate(() => window.__presentation!.getState()));

      const refPath = shotPath(opts.referenceDir, chapterId, spec.step);
      if (!fs.existsSync(refPath)) {
        throw new Error(
          `一致性校验：参考图不存在（${refPath}）——请先跑主流程截图（npm run storyboard），` +
            `本模式比对的是"顺序推进"与"主流程 jumpTo 产出"两条路径`,
        );
      }
      const refBytes = fs.readFileSync(refPath);
      const { equal, detail } = compareShotBytes(refBytes, seqBytes);
      const exempt = opts.ambientKeys.has(ambientKey(spec.chapter, spec.step));

      if (!equal && opts.diffDir !== undefined) {
        const dir = `${opts.diffDir.replace(/[/\\]+$/, "")}/${chapterId}`;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(`${dir}/${spec.step}-sequential.png`, seqBytes);
        fs.writeFileSync(`${dir}/${spec.step}-independent.png`, refBytes);
      }

      if (exempt) {
        verdicts.push({
          chapter: spec.chapter,
          step: spec.step,
          chapterId,
          status: equal ? "exempt" : "exempt-info",
          detail: equal
            ? "氛围步免比对（已声明 ambient）；参考结果：顺序与独立 mount 字节一致"
            : `氛围步免比对（已声明 ambient）；参考结果（info，不影响退出码）：${detail}`,
          exempt: true,
        });
      } else {
        verdicts.push({
          chapter: spec.chapter,
          step: spec.step,
          chapterId,
          status: equal ? "match" : "mismatch",
          detail: equal ? "" : detail,
          exempt: false,
        });
      }
    }
    return verdicts;
  } finally {
    await browser.close();
  }
}
