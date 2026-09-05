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

  return register({
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
}
