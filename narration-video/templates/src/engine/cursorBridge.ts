// M4 游标桥（§7 决策 1）：window.__presentation 确定性控制接口——分镜截图（M4 Task 2）、
// 无头门禁（M3b）与渲染管线（M5）共用的"时间机器"入口。接口约定跨计划冻结，逐字落实：
// jumpTo / getState / ready / animations。仅显式安装（App 在 ?headless=1 或 dev 模式调用
// installBridge）；生产构建不暴露——模块导入本身无任何副作用。
//
// M3b Task 5 追加：audit()（动画审计面）。**追加而不破坏**——上述四方法契约逐字不动，
// 只是桥多挂一个成员（与 M4-3 同款追加策略）。
//
// M5a Task 3 追加：seek()（定位面，M5 遗留 #2/#5）。同款追加——六成员集合 ⊇ 原五者。
//
// ready() 无内建超时（契约不含）——消费方（截图模块 / M5 / M3b）需自行包 timeout：
// 停滞的 load（没等到 load 也没等到 error）会一直挂起，这是"等页面定下来"的本意。

import {
  animationWindowMs,
  describeUnownedAnimations,
  registrySize,
  seekAll,
  type WaapiAudit,
} from "./animationRuntime";

/**
 * 动画审计面（M3b Task 5）：WAAPI 查询面的归因计数 + 引擎注册表两项。
 * 与 `animations()` 的区别是**可归因**——后者只求和，无法区分"引擎注册的动画"与
 * "章节层手写/CSS 泄漏的动画"（M4 遗留口径缺口）。
 */
export interface AnimationAudit extends WaapiAudit {
  /** 引擎注册表容量（canvasAnim 等帧函数逃生舱动画也在此计） */
  registry: number;
  /** 注册表声明的最大时长（ms）；空注册表为 0 */
  windowMs: number;
}

/** 就绪语义：双 rAF（等 React commit 落定）→ document.fonts.ready + 所有 img 就绪 */
export interface PresentationBridge {
  /** 同步定位（React 状态更新后由 ready() 等待落定） */
  jumpTo(chapter: number, step: number): void;
  /** 读游标。**commit-lagging**：jumpTo 是 React 状态更新，本函数读到的是已 commit 的值——
   *  跳转后须先 `await ready()` 再读，否则拿到跳转前的位置。 */
  getState(): { chapter: number; step: number };
  /** 双 rAF + fonts.ready + 所有 img.complete（无内建超时，见文件头） */
  ready(): Promise<void>;
  /** document.getAnimations() 计数 + 引擎动画注册表计数（Ruling M4-1：WAAPI 之外的帧函数
   *  逃生舱 canvasAnim 也必须计入，否则"零动画"门禁漏检）。jsdom 无 WAAPI 查询面 → guard
   *  归 0，此时计数全部由注册表部分贡献。（分镜门禁/覆盖率断言共用） */
  animations(): number;
  /** 动画审计面（**M3b Task 5 追加成员**——jumpTo/getState/ready/animations 四方法契约不动）。
   *  把 WAAPI 查询面按"引擎 waapi() 是否打标"拆成 owned / unowned（附至多 5 条可读定位与
   *  running 统计），并补注册表容量与窗口时长。门禁据此区分引擎动画与章节层泄漏的动画。
   *  jsdom 无 WAAPI 查询面 → WAAPI 面全 0（不抛）。 */
  audit(): AnimationAudit;
  /** 定位面（**M5a Task 3 追加成员**，M5 遗留 #2/#5）——**渲染器的唯一定位入口**：
   *  把注册表里全部动画 seek 到 t（ms，相对各自动画起点），负数归零（`seekAll(Math.max(0, tMs))`）。
   *  与 jumpTo 的分工：jumpTo 定"第几步"，seek 定"步内的时刻"。
   *
   *  为什么必须有：`?render=1` 创建即冻结，canvasAnim **从未 draw**——DOM 停在"未 draw 初始态"
   *  （实测 `.cdp-kenburns-inner` 的 transform 是 `none`，而 t=0 组合态是 `scale(1) translate(-2%,0)`，
   *  分镜帧因此差 2% 横移）。帧流逐帧截图**前**调 `seek(0)` 归位，此后每帧 seek(k·1000/fps)。
   *  canvasAnim.seek 每次必调 draw（见 animationRuntime），故归位无需重新挂载组件。 */
  seek(tMs: number): void;
}

declare global {
  interface Window {
    __presentation?: PresentationBridge;
  }
}

/** 最近一次 install 的桥（uninstall 以它为"是否由本模块装上"的判据） */
let installed: PresentationBridge | null = null;

/**
 * 安装条件（逐字契约："URL 含 headless=1 或在 dev 模式"）。
 * 抽成纯函数是为了可测：vite 把 `import.meta.env.DEV` 静态替换成字面量，
 * 非 dev 分支在 vitest 里永远走不到，只有纯函数形式能钉住"生产构建不暴露"。
 */
export function shouldInstallBridge(params: URLSearchParams, dev: boolean): boolean {
  return params.has("headless") || dev;
}

export function installBridge(bridge: PresentationBridge): void {
  installed = bridge;
  window.__presentation = bridge;
}

/** 卸载：**last-install-wins**——清的就是最后装上的那座桥，不论是谁的 cleanup 调的。
 *  当前只有 App 一处安装，够用；多 owner 场景需引入 owner token 才能各清各的。 */
export function uninstallBridge(): void {
  if (installed !== null && window.__presentation === installed) {
    delete window.__presentation;
  }
  installed = null;
}

// ── ready()：确定性等待链（截图前"页面已定"的判据） ──

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** 双 rAF：第一帧覆盖 React 的 commit，第二帧覆盖其后的样式/布局落定 */
async function twoFrames(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

/** document.fonts.ready（jsdom 无此 API → 直接放行；加载失败也不阻塞管线——坏字体不该让截图挂死） */
function fontsReady(): Promise<void> {
  const fonts = document.fonts as FontFaceSet | undefined;
  const readyPromise = fonts?.ready;
  if (!readyPromise || typeof readyPromise.then !== "function") return Promise.resolve();
  return readyPromise.then(
    () => undefined,
    () => undefined,
  );
}

/** 单个图像落定：load 或 error 都算（error 放行，坏图由资产门禁报，不在此挂死管线） */
function settleImage(img: HTMLImageElement): Promise<"load" | "error"> {
  return new Promise((resolve) => {
    const cleanup = () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      resolve("load");
    };
    const onError = () => {
      cleanup();
      resolve("error");
    };
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
  });
}

/**
 * 等 document.images 全部 complete。循环重采（等待期间可能有新图挂载——jumpTo 触发的
 * React commit 就发生在这条链上），error 过的图剔除出待等集合避免死循环。
 */
async function imagesReady(): Promise<void> {
  const failed = new Set<HTMLImageElement>();
  for (;;) {
    const pending = Array.from(document.images).filter((img) => !img.complete && !failed.has(img));
    if (pending.length === 0) return;
    const outcomes = await Promise.all(pending.map(settleImage));
    outcomes.forEach((outcome, i) => {
      if (outcome === "error") failed.add(pending[i]);
    });
  }
}

/**
 * 就绪：帧先落定，再等字体与图像（两者并行）。
 * 帧必须先走——jumpTo 触发的 React commit 在其间落定，新一步挂载的 <img> 才会被看见；
 * 先扫图会让"调用瞬间 DOM 里还没有的图"漏网（M5 逐帧 seek 复用同一条链）。
 */
export function ready(): Promise<void> {
  return twoFrames().then(() => Promise.all([fontsReady(), imagesReady()])).then(() => undefined);
}

/**
 * 动画计数 = document.getAnimations()（CSS/WAAPI 泄漏面）+ 引擎注册表（Ruling M4-1）。
 * 注册表部分不可省：canvasAnim（rAF 帧函数逃生舱）不进 WAAPI 查询面，只靠 getAnimations()
 * 会让"分镜阶段零动画"门禁对帧函数动画失明。jsdom 无 getAnimations → guard 归 0。
 */
export function animations(): number {
  const waapi = typeof document.getAnimations === "function" ? document.getAnimations().length : 0;
  return waapi + registrySize();
}

/**
 * 动画审计面（M3b Task 5 追加；四方法契约不动）：WAAPI 面归因 + 注册表两项。
 * 合成而非重复实现——拆解与定位全在 animationRuntime（打标与同源查询共享一处），
 * 本函数只补注册表容量与窗口时长，保证两处读数永远同一时间点。
 */
export function audit(): AnimationAudit {
  return { ...describeUnownedAnimations(), registry: registrySize(), windowMs: animationWindowMs() };
}

/**
 * 定位面（M5a Task 3 追加；五方法契约不动）：把注册表里全部动画 seek 到 t（负数归零）。
 * **与 ready() 同一时点的关系**：seek 是同步的定位动作，画的是 DOM 样式/画布像素；
 * 要读到落定后的结果仍须 `await ready()`（帧先行那条链），消费顺序 = jumpTo → ready → seek
 * →（截图）——见 M5a T4 的帧流。
 *
 * clamp 收在这一层（而不是只靠下游）：seekAll 与各 handle.seek 也各有 clamp，但桥是契约面，
 * "负数不得进渲染器"是接口语义，不该只在实现深处成立。
 */
export function seek(tMs: number): void {
  seekAll(Math.max(0, tMs));
}
