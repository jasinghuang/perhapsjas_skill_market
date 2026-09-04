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
  const total = delay + duration;
  const animation = el.animate(keyframes, opts);
  animation.pause();

  const handle = register({
    durationMs: total,
    seek: (tMs) => {
      animation.currentTime = Math.min(total, Math.max(0, tMs - delay));
    },
    isFinished: () =>
      Number(animation.currentTime ?? 0) >= total - 0.5 || animation.playState === "finished",
    pause: () => animation.pause(),
    play: () => animation.play(),
  });

  if (!renderMode) animation.play();
  return handle;
}

/** Canvas 帧函数逃生舱适配器：draw(t) 纯函数 + 虚拟时钟（§6.1 铁律 2） */
export function canvasAnim(draw: (tMs: number) => void, durationMs: number): AnimHandle {
  let current = 0;
  return register({
    durationMs,
    seek: (tMs) => {
      current = Math.min(durationMs, Math.max(0, tMs));
      draw(current);
    },
    isFinished: () => current >= durationMs - 0.5,
    pause: () => {},
    play: () => {},
  });
}
