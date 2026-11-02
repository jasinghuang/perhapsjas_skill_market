// 一切组件动画必经的注册表（seek 运行时，§3.1）。
// render 模式（?render=1）下动画"创建即冻结"：不允许自主播放，由渲染器逐帧 seek（§8.1）。

export interface AnimHandle {
  readonly id: symbol;
  /** 动画总时长（含 delay），ms */
  readonly durationMs: number;
  /** 将动画定位到 t（ms，相对动画起点） */
  seek(tMs: number): void;
  /** 是否已播放完毕 */
  isFinished(): boolean;
  pause(): void;
  play(): void;
  /** 释放注册（组件卸载时调用） */
  dispose(): void;
}

const registry = new Map<symbol, AnimHandle>();
let renderMode = false;

export function setRenderMode(on: boolean): void {
  renderMode = on;
}

export function isRenderMode(): boolean {
  return renderMode;
}

export function register(anim: Omit<AnimHandle, "id" | "dispose">): AnimHandle {
  const id = Symbol("anim");
  const handle: AnimHandle = { ...anim, id, dispose: () => registry.delete(id) };
  registry.set(id, handle);
  if (renderMode) {
    // 创建即冻结：渲染模式下动画不得自主播放
    handle.pause();
  }
  return handle;
}

export function pauseAll(): void {
  registry.forEach((a) => a.pause());
}

export function resumeAll(): void {
  if (renderMode) return; // 渲染模式下永不自主播放
  registry.forEach((a) => a.play());
}

export function seekAll(tMs: number): void {
  registry.forEach((a) => a.seek(Math.max(0, tMs)));
}

/** 所有有限动画全部 finished 的最早时刻 = 各动画结束时间的最大值（§8） */
export function animationWindowMs(): number {
  let max = 0;
  registry.forEach((a) => {
    max = Math.max(max, a.durationMs);
  });
  return max;
}

export function allFinished(): boolean {
  let ok = true;
  registry.forEach((a) => {
    if (!a.isFinished()) ok = false;
  });
  return ok;
}

export function registrySize(): number {
  return registry.size;
}

// ── M3b Task 5：动画审计面（audit() 的 WAAPI 侧） ──
// M4 遗留口径缺口：animations() 只是求和，无法归因"引擎注册的动画"与"章节层手写/CSS 泄漏的
// 动画"。本模块给 waapi() 创建的底层动画打模块内 Symbol 标记（OWNED），
// describeUnownedAnimations() 据此把 document.getAnimations() 拆成 owned / unowned，
// 并给出至多 5 条可读定位与 running 统计——门禁（M3b）据此判定泄漏面。

/** 打标用的模块内 Symbol：只有经本模块 waapi() 创建的底层 Animation 带它 */
const OWNED = Symbol("waapi-owned");

/** unownedHints 条数上限：门禁报错够定位即可，不逐条刷屏 */
const UNOWNED_HINT_LIMIT = 5;

/** 单条 hint 字符上限：怪异 target 的巨型 className 不得撑爆门禁报告 */
const HINT_MAX_CHARS = 80;

/** WAAPI 查询面的审计计数（M3b Task 5）。cursorBridge.audit() 在其上补注册表两项。 */
export interface WaapiAudit {
  /** document.getAnimations() 计数（jsdom 无此 API → 0） */
  waapi: number;
  /** 其中经本模块 waapi() 适配器创建的（已打标） */
  owned: number;
  /** waapi − owned：未注册动画 = 章节层手写/CSS 泄漏面 */
  unowned: number;
  /** 未注册动画中 playState === "running" 的数量 */
  unownedRunning: number;
  /** 未注册动画的可读定位，至多 5 条 */
  unownedHints: string[];
  /** 全部 WAAPI 动画中 running 的数量 */
  running: number;
}

/** 打标：不可扩展/冻结的 Animation 替身退化为"未打标"——方向是宁误报不漏报（门禁安全侧） */
function markOwned(animation: Animation): void {
  try {
    (animation as unknown as Record<symbol, boolean>)[OWNED] = true;
  } catch {
    /* 保留未打标态：审计会把该引擎动画计入 unowned，不影响其它路径 */
  }
}

function isOwned(anim: unknown): boolean {
  return (
    anim !== null && typeof anim === "object" && (anim as Record<symbol, unknown>)[OWNED] === true
  );
}

function isRunning(anim: unknown): boolean {
  return (
    anim !== null && typeof anim === "object" && (anim as { playState?: unknown }).playState === "running"
  );
}

/** document.getAnimations() 查询面：jsdom 无此 API → 空（guard 风格同 cursorBridge.animations） */
function queryAnimations(): unknown[] {
  const get = document.getAnimations;
  if (typeof get !== "function") return [];
  const list = get.call(document);
  return Array.isArray(list) ? list : [];
}

function clip(s: string): string {
  return s.length > HINT_MAX_CHARS ? `${s.slice(0, HINT_MAX_CHARS)}…` : s;
}

/** 读属性（元素替身可能没有 getAttribute、也可能抛错）：任何异常一律归空串 */
function attr(el: object, name: string): string {
  const get = (el as { getAttribute?: unknown }).getAttribute;
  if (typeof get !== "function") return "";
  try {
    const value = (get as (n: string) => unknown).call(el, name);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/**
 * effect.target → 可读选择器 `tag#id.class`（类名至多 2 个）。
 * **逐层兜底**：无 target / 文本节点 / 非元素 / 无 tagName / 属性读取抛错，一律给标签化兜底串。
 * 本函数是门禁判据来源，任何怪异 target 都不允许让它抛错。
 */
function selectorOf(target: unknown): string {
  if (target === null || typeof target !== "object") return "(no-target)";
  try {
    const nodeType = (target as { nodeType?: unknown }).nodeType;
    if (nodeType === 3) return "#text";
    if (nodeType !== 1) return "(non-element)";
    const tagName = (target as { tagName?: unknown }).tagName;
    if (typeof tagName !== "string" || tagName === "") return "(element)";
    const id = attr(target, "id");
    const classes = attr(target, "class").split(/\s+/).filter(Boolean).slice(0, 2);
    const selector = tagName.toLowerCase() + (id ? `#${id}` : "") + classes.map((c) => `.${c}`).join("");
    return clip(selector);
  } catch {
    return "(unreadable)";
  }
}

/** 单条动画的可读定位：CSS 动画取 animationName，其余取 effect.target 的选择器 */
function describeAnimation(anim: unknown): string {
  try {
    const name = (anim as { animationName?: unknown } | null)?.animationName;
    if (typeof name === "string" && name !== "") return `css:${clip(name)}`;
    const effect = (anim as { effect?: unknown } | null)?.effect;
    const target = (effect as { target?: unknown } | null | undefined)?.target ?? null;
    return `waapi:${selectorOf(target)}`;
  } catch {
    return "waapi:(unreadable)";
  }
}

/**
 * 审计面（M3b Task 5）：把 document.getAnimations() 按 OWNED 标记拆成 owned / unowned，
 * 给出未注册动画的 running 数与至多 5 条可读定位。jsdom 无 WAAPI 查询面 → 全 0 且不抛。
 */
export function describeUnownedAnimations(): WaapiAudit {
  const all = queryAnimations();
  let owned = 0;
  let unowned = 0;
  let unownedRunning = 0;
  let running = 0;
  const unownedHints: string[] = [];

  for (const anim of all) {
    const animRunning = isRunning(anim);
    if (animRunning) running++;
    if (isOwned(anim)) {
      owned++;
      continue;
    }
    unowned++;
    if (animRunning) unownedRunning++;
    if (unownedHints.length < UNOWNED_HINT_LIMIT) unownedHints.push(describeAnimation(anim));
  }

  return { waapi: all.length, owned, unowned, unownedRunning, running, unownedHints };
}

/** WAAPI 适配器：把 element.animate 包装进注册表（预览自动播放；render 模式创建即冻结） */
export function waapi(
  el: Element,
  keyframes: Keyframe[],
  opts: KeyframeAnimationOptions,
): AnimHandle {
  const delay = typeof opts.delay === "number" ? opts.delay : 0;
  const duration = typeof opts.duration === "number" ? opts.duration : 0;
  // P3-7：total 计入有限 iterations（WAAPI currentTime 跨迭代累加，delay 只计一次）。
  // 仅正有限值参与计算（Infinity 会污染 animationWindowMs 的 max）；
  // 无限 iterations 由组件层禁止（氛围组件只传有限 cycles），兜底按 1 轮计。
  const iterations =
    typeof opts.iterations === "number" && Number.isFinite(opts.iterations) && opts.iterations > 0
      ? opts.iterations
      : 1;
  const total = delay + duration * iterations;
  const animation = el.animate(keyframes, opts);
  markOwned(animation); // M3b Task 5：审计面据此把引擎动画与章节层泄漏的动画区分开
  animation.pause();

  const handle = register({
    durationMs: total,
    seek: (tMs) => {
      // WAAPI 的 currentTime 时间轴已内置 delay（active 阶段在 [delay, delay+duration]），
      // "t 相对动画起点"即直接映射，不再重复扣除 delay。
      animation.currentTime = Math.min(total, Math.max(0, tMs));
    },
    isFinished: () =>
      // 严格大于：currentTime 到达总时长才算 finished（WAAPI 真实语义）；
      // 0.5ms 容差只吸收 seek 抖动，恰在 total - 0.5 时仍在播放。
      Number(animation.currentTime ?? 0) > total - 0.5 || animation.playState === "finished",
    pause: () => animation.pause(),
    play: () => animation.play(),
  });

  if (!renderMode) animation.play();
  // register 的 dispose 只反注册，不取消底层动画：组件卸载后 WAAPI 动画仍在
  // 内存中存活（DonutMeter 与工厂 reveal 全依赖此路径），dispose 必须同时 cancel。
  return {
    ...handle,
    dispose: () => {
      handle.dispose();
      animation.cancel();
    },
  };
}

/** Canvas 帧函数逃生舱适配器：draw(t) 纯函数 + 虚拟时钟（§6.1 铁律 2）。
 * P3-12：play() = rAF 驱动的真实时钟（预览模式播放）。引擎层 rAF 合法——
 * 确定性黑名单只约束章节层；render 模式下 register 已冻结（play 不会被调用），
 * 渲染器仍走 seek，确定性不受影响。 */
export function canvasAnim(draw: (tMs: number) => void, durationMs: number): AnimHandle {
  let current = 0;
  let rafId: number | null = null;
  // rAF 时钟基准：posBase = play 起点虚拟时间；tsBase = 基准帧时间戳（首帧建立）。
  // 帧 t = posBase + (ts - tsBase)，clamp 到 [0, durationMs]。
  let posBase = 0;
  let tsBase: number | null = null;

  const frame = (ts: number) => {
    if (tsBase == null) tsBase = ts;
    const t = Math.min(durationMs, Math.max(0, posBase + (ts - tsBase)));
    current = t;
    draw(t);
    if (t >= durationMs) {
      rafId = null; // 到点：终态 draw(durationMs) 已画，停（不再排帧）
      return;
    }
    rafId = requestAnimationFrame(frame);
  };

  const handle = register({
    durationMs,
    seek: (tMs) => {
      current = Math.min(durationMs, Math.max(0, tMs));
      draw(current);
      // 重置时钟基准：后续 play 的帧从 seek 位置继续（首帧 t = current）
      posBase = current;
      tsBase = null;
    },
    isFinished: () => current >= durationMs - 0.5,
    pause: () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
    play: () => {
      if (rafId != null) return; // 幂等：已在播放
      posBase = current; // 从当前（可能被 seek 过）位置继续
      tsBase = null;
      rafId = requestAnimationFrame(frame);
    },
  });

  // I-1：镜像 waapi——非 render 模式创建即播（预览触发断链修复）。帧函数组件
  // mount 即开始排帧，不再依赖任何外部 play 调用；play 幂等，且 render 模式下
  // register 的 pause 对 rafId=null 是 no-op、play 不被调用，渲染器仍只走 seek，
  // 创建即冻结的确定性边界不变。
  if (!isRenderMode()) handle.play();
  return handle;
}
