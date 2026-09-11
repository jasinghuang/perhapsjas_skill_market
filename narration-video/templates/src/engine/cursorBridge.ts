// M4 游标桥（§7 决策 1）：window.__presentation 确定性控制接口——分镜截图（M4 Task 2）、
// 无头门禁（M3b）与渲染管线（M5）共用的"时间机器"入口。接口约定跨计划冻结，逐字落实：
// jumpTo / getState / ready / animations。仅显式安装（App 在 ?headless=1 或 dev 模式调用
// installBridge）；生产构建不暴露——模块导入本身无任何副作用。

/** 就绪语义：双 rAF（等 React commit 落定）→ document.fonts.ready + 所有 img 就绪 */
export interface PresentationBridge {
  /** 同步定位（React 状态更新后由 ready() 等待落定） */
  jumpTo(chapter: number, step: number): void;
  getState(): { chapter: number; step: number };
  /** 双 rAF + fonts.ready + 所有 img.complete */
  ready(): Promise<void>;
  /** document.getAnimations() 计数（分镜门禁/覆盖率断言共用；jsdom 无此 API → 0） */
  animations(): number;
}

declare global {
  interface Window {
    __presentation?: PresentationBridge;
  }
}

/** 已安装的桥（uninstall 时比对身份，避免误删后装者） */
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

/** document.getAnimations() 计数（jsdom 无 WAAPI 查询面 → 0） */
export function animations(): number {
  if (typeof document.getAnimations !== "function") return 0;
  return document.getAnimations().length;
}
