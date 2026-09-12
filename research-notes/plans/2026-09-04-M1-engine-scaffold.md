# M1 引擎 + 脚手架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付新视频 skill 的单比例运行时引擎（step 模型 + 音频驱动推进 + 停留垫 + 播放/暂停/停止控制）与 scaffold 脚本，产出可运行、可测试的模板工程。

**Architecture:** 引擎极小化模块化（constants 单一常量源 / animationRuntime 可 seek 动画注册表 / useStepper 游标 / useAudioPlayer 推进 / useStageScale 舞台缩放 / Stage 壳 / 播放控制与字幕框架层）；模板工程以"拷贝模板 + npm install"方式由 scaffold 产出，档案最小参数（slug + 舞台尺寸）写入生成文件。

**Tech Stack:** Vite 5 + React 18.3.1 + TypeScript 5.5 + Vitest 2 + @testing-library/react + jsdom + bash(scaffold)。

**Spec:** `../07-design-draft.md`（定稿设计文档——本计划只实现其中 M1 范围，其余里程碑各有独立计划）

## Global Constraints

- 停留垫引擎默认 **400ms**（§3.1 已定；档案可覆盖、分镜每帧可调，M1 只用引擎默认）
- 运行时推进规则：**`audio.ended` 且 动画窗口结束 → 停留垫 → next()`**（§3.1）
- 动画窗口实测 = **所有有限动画全部 finished 的最早时刻 = 各动画结束时间的最大值**（§8）
- 步长公式：**max(音频时长, 动画窗口) + 停留垫**（§3.1，渲染时间轴表 M5 消费）
- 音频兜底估时：**max(1500, 字数×250ms)**；空 narration 步：**max(1500, 动画窗口) + 垫**（§8，继承原版 App.tsx）
- 渲染采样帧率 **30fps**；16:9 舞台 **1920×1080**、3:4 舞台 **1080×1440**（§8/§2）
- STORAGE_KEY 按**内容 hash 自动失效**（§3.2 A）；`?auto=1` **从 step 0 起播**（原版 bug 修复）
- 章节注册走 **manifest 声明制**（steps === narrations.length 注册即校验，不扫代码字面量；§11.1 #1）
- 渲染模式 **`?render=1` 创建即冻结**（动画不允许自主播放，§8.1）
- 禁 setTimeout/setInterval/Math.random 等黑名单**只约束章节层**；引擎层计时（推进轮询/垫）合法（§11.1 #7 注释精神）
- 引擎 <800 行、`.engine-version` 版本标记（§3.2 C）
- 开发端口 **5174**（§3.2 A 端口统一）
- 技术形态：Vite 模板 + 组件库 + harness 三层（§2）；skill 根目录暂定 `narration-video/`（M7 正式命名）
- 所有 UI 文案中文；M1 的示例章节与样式为**引擎测试脚手架**（M2a 会被 token 化组件替换，不代表最终视觉）

---

### Task 1: 模板工程基线 + 引擎常量

**Files:**
- Create: `narration-video/templates/package.json`
- Create: `narration-video/templates/vite.config.ts`
- Create: `narration-video/templates/tsconfig.json`
- Create: `narration-video/templates/index.html`
- Create: `narration-video/templates/src/main.tsx`
- Create: `narration-video/templates/src/test-setup.ts`
- Create: `narration-video/templates/src/engine/constants.ts`
- Test: `narration-video/templates/src/engine/constants.test.ts`

**Interfaces:**
- Produces: `ENGINE_VERSION / DEFAULT_HOLD_MS / AUDIO_ESTIMATE_CHAR_MS / AUDIO_ESTIMATE_MIN_MS / EMPTY_NARRATION_MIN_MS / SAMPLE_FPS / CURSOR_KEY_PREFIX`（后续所有任务消费）；模板工程（Task 2-7 的文件基座）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/engine/constants.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  AUDIO_ESTIMATE_CHAR_MS,
  AUDIO_ESTIMATE_MIN_MS,
  CURSOR_KEY_PREFIX,
  DEFAULT_HOLD_MS,
  EMPTY_NARRATION_MIN_MS,
  ENGINE_VERSION,
  SAMPLE_FPS,
} from "./constants";

describe("引擎常量（单一源头，值由设计定稿锁定）", () => {
  it("停留垫引擎默认 400ms", () => {
    expect(DEFAULT_HOLD_MS).toBe(400);
  });
  it("估时兜底常量 max(1500, 字数×250)", () => {
    expect(AUDIO_ESTIMATE_CHAR_MS).toBe(250);
    expect(AUDIO_ESTIMATE_MIN_MS).toBe(1500);
  });
  it("空 narration 默认停留 1500ms", () => {
    expect(EMPTY_NARRATION_MIN_MS).toBe(1500);
  });
  it("渲染采样 30fps", () => {
    expect(SAMPLE_FPS).toBe(30);
  });
  it("游标 key 前缀", () => {
    expect(CURSOR_KEY_PREFIX).toBe("presentation-cursor");
  });
  it("引擎版本号符合 semver", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npm install --no-audit --no-fund && npx vitest run src/engine/constants.test.ts`
Expected: FAIL（找不到 `./constants` 模块）

- [ ] **Step 3: 写工程基线与实现**

`narration-video/templates/package.json`：

```json
{
  "name": "presentation-template",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "check": "echo \"check: 静态门禁将在 M3a 实现，当前为占位\" && exit 0",
    "render": "echo \"render: 渲染管线将在 M5 实现，当前为占位\" && exit 0"
  },
  "dependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.6",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.3",
    "vite": "^5.3.3",
    "vitest": "^2.0.2"
  }
}
```

`narration-video/templates/vite.config.ts`：

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
  },
});
```

`narration-video/templates/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`narration-video/templates/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Presentation</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`narration-video/templates/src/main.tsx`：

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/base.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`narration-video/templates/src/test-setup.ts`：

```ts
import "@testing-library/jest-dom";
```

`narration-video/templates/src/engine/constants.ts`：

```ts
// 引擎单一常量源：运行时与渲染共用同一份值，杜绝双处漂移（§8.1 细节一致性）。

/** 引擎版本（scaffold 写入 .engine-version，check 对比提示升级） */
export const ENGINE_VERSION = "0.1.0";

/** 停留垫引擎默认（§3.1 已定；档案可覆盖、分镜每帧可调） */
export const DEFAULT_HOLD_MS = 400;

/** 音频缺失时的估时兜底：字数 × 250ms，下限 1500ms（继承原版 App.tsx） */
export const AUDIO_ESTIMATE_CHAR_MS = 250;
export const AUDIO_ESTIMATE_MIN_MS = 1500;

/** 空 narration 无声过场步的默认停留 */
export const EMPTY_NARRATION_MIN_MS = 1500;

/** 渲染采样帧率 */
export const SAMPLE_FPS = 30;

/** localStorage 游标 key 前缀 */
export const CURSOR_KEY_PREFIX = "presentation-cursor";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/engine/constants.test.ts`
Expected: PASS（7 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates
git commit -m "feat(M1): 模板工程基线 + 引擎单一常量源"
```

---

### Task 2: 动画运行时（seek 注册表）

**Files:**
- Create: `narration-video/templates/src/engine/animationRuntime.ts`
- Test: `narration-video/templates/src/engine/animationRuntime.test.ts`

**Interfaces:**
- Consumes: 无（仅依赖自身）
- Produces: `AnimHandle / setRenderMode / isRenderMode / register / pauseAll / resumeAll / seekAll / animationWindowMs / allFinished / registrySize / waapi / canvasAnim`（Task 4 的推进判定、Task 6 的渲染模式开关、M4/M5 渲染管线消费）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/engine/animationRuntime.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allFinished,
  animationWindowMs,
  canvasAnim,
  register,
  registrySize,
  resumeAll,
  seekAll,
  setRenderMode,
  waapi,
} from "./animationRuntime";

interface FakeAnimState {
  currentTime: number;
  playState: "paused" | "running" | "finished";
}

class FakeAnim {
  state: FakeAnimState = { currentTime: 0, playState: "paused" };
  play() {
    this.state.playState = "running";
  }
  pause() {
    this.state.playState = "paused";
  }
  finish() {
    this.state.playState = "finished";
  }
}

function makeWaapiStub(totalMs: number): { el: Element; anim: FakeAnim } {
  const anim = new FakeAnim();
  const el = {
    animate: (_k: unknown, opts: KeyframeAnimationOptions) => {
      const delay = typeof opts.delay === "number" ? opts.delay : 0;
      anim.state.currentTime = 0;
      (anim as unknown as { totalMs: number }).totalMs = delay + totalMs;
      return anim as unknown as Animation;
    },
  };
  return { el: el as unknown as Element, anim };
}

beforeEach(() => {
  setRenderMode(false);
});
afterEach(() => {
  setRenderMode(false);
});

describe("动画运行时注册表", () => {
  it("register 后可见、dispose 后移除", () => {
    const h = register({ durationMs: 1000, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => {} });
    expect(registrySize()).toBe(1);
    h.dispose();
    expect(registrySize()).toBe(0);
  });

  it("render 模式下创建即冻结（不允许自主播放）", () => {
    setRenderMode(true);
    let playCalls = 0;
    register({ durationMs: 500, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => { playCalls++; } });
    expect(playCalls).toBe(0);
  });

  it("waapi 适配器：seek 扣掉 delay 并 clamp", () => {
    const { el, anim } = makeWaapiStub(1000);
    const h = waapi(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 1000, delay: 200 });
    h.seek(0);
    expect(anim.state.currentTime).toBe(0);
    h.seek(500);
    expect(anim.state.currentTime).toBe(300); // 500 - 200 delay
    h.seek(9999);
    expect(anim.state.currentTime).toBe(1200); // clamp 到 delay+duration
    h.dispose();
  });

  it("animationWindowMs = 各动画结束时间的最大值", () => {
    const a = register({ durationMs: 1000, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => {} });
    const b = register({ durationMs: 2000, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => {} });
    expect(animationWindowMs()).toBe(2000);
    a.dispose();
    b.dispose();
    expect(animationWindowMs()).toBe(0);
  });

  it("allFinished：全部结束才为 true", () => {
    const a = register({ durationMs: 100, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => {} });
    const b = register({ durationMs: 100, seek: () => {}, isFinished: () => true, pause: () => {}, play: () => {} });
    expect(allFinished()).toBe(false);
    a.dispose();
    expect(allFinished()).toBe(true);
    b.dispose();
  });

  it("resumeAll 在 render 模式下不恢复播放", () => {
    setRenderMode(true);
    let playCalls = 0;
    register({ durationMs: 100, seek: () => {}, isFinished: () => false, pause: () => {}, play: () => { playCalls++; } });
    resumeAll();
    expect(playCalls).toBe(0);
  });

  it("canvasAnim：seek 调用 draw(t) 并 clamp 到时长", () => {
    const calls: number[] = [];
    const h = canvasAnim((t) => calls.push(t), 500);
    h.seek(200);
    h.seek(9999);
    expect(calls).toEqual([200, 500]);
    expect(h.isFinished()).toBe(true);
    h.dispose();
  });

  it("seekAll 对全部动画生效且不为负", () => {
    let seeked = 0;
    register({ durationMs: 100, seek: () => { seeked++; }, isFinished: () => false, pause: () => {}, play: () => {} });
    seekAll(-5);
    seekAll(10);
    expect(seeked).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/engine/animationRuntime.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/engine/animationRuntime.ts`：

```ts
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
      (animation.currentTime ?? 0) >= total - 0.5 || animation.playState === "finished",
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/engine/animationRuntime.test.ts`
Expected: PASS（8 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/engine
git commit -m "feat(M1): 动画运行时（seek 注册表 + 创建即冻结）"
```

---

### Task 3: 游标 useStepper

**Files:**
- Create: `narration-video/templates/src/engine/useStepper.ts`
- Test: `narration-video/templates/src/engine/useStepper.test.ts`

**Interfaces:**
- Consumes: `CURSOR_KEY_PREFIX`（Task 1）
- Produces: `Stepper { chapter, step, next, prev, jumpTo, gotoChapter, atStart, atEnd }`（Task 6 App 消费）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/engine/useStepper.test.ts`：

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStepper } from "./useStepper";

const STEPS = [3, 2]; // 第 0 章 3 步、第 1 章 2 步

beforeEach(() => {
  localStorage.clear();
});

describe("useStepper", () => {
  it("初始 (0,0) 且 atStart", () => {
    const { result } = renderHook(() => useStepper("demo", STEPS, false));
    expect(result.current.chapter).toBe(0);
    expect(result.current.step).toBe(0);
    expect(result.current.atStart).toBe(true);
    expect(result.current.atEnd).toBe(false);
  });

  it("next 跨章推进、末步不越界", () => {
    const { result } = renderHook(() => useStepper("demo", STEPS, false));
    act(() => result.current.next()); // (0,1)
    act(() => result.current.next()); // (0,2)
    act(() => result.current.next()); // (1,0)
    expect(result.current.chapter).toBe(1);
    expect(result.current.step).toBe(0);
    act(() => result.current.next()); // (1,1)
    act(() => result.current.next()); // 越界 → 原地
    expect(result.current.atEnd).toBe(true);
    expect(result.current.step).toBe(1);
  });

  it("prev 回退且首步不越界", () => {
    const { result } = renderHook(() => useStepper("demo", STEPS, false));
    act(() => result.current.jumpTo(1, 1));
    act(() => result.current.prev());
    expect(result.current).toMatchObject({ chapter: 1, step: 0 });
    act(() => result.current.prev());
    expect(result.current).toMatchObject({ chapter: 0, step: 2 });
    act(() => result.current.jumpTo(0, 0));
    act(() => result.current.prev());
    expect(result.current).toMatchObject({ chapter: 0, step: 0 });
  });

  it("jumpTo 越界被 clamp", () => {
    const { result } = renderHook(() => useStepper("demo", STEPS, false));
    act(() => result.current.jumpTo(9, 9));
    expect(result.current).toMatchObject({ chapter: 1, step: 1 });
  });

  it("游标持久化：同 slug 同步数 remount 恢复", () => {
    const first = renderHook(() => useStepper("demo", STEPS, false));
    act(() => first.result.current.next());
    first.unmount();
    const second = renderHook(() => useStepper("demo", STEPS, false));
    expect(second.result.current).toMatchObject({ chapter: 0, step: 1 });
  });

  it("内容 hash 失效：步数变化 → key 变化 → 不恢复旧游标", () => {
    const first = renderHook(() => useStepper("demo", STEPS, false));
    act(() => first.result.current.next());
    first.unmount();
    const second = renderHook(() => useStepper("demo", [4, 2], false));
    expect(second.result.current).toMatchObject({ chapter: 0, step: 0 });
  });

  it("autoFromStart：忽略已存游标从 (0,0) 起播（原版 ?auto=1 续播 bug 修复）", () => {
    const first = renderHook(() => useStepper("demo", STEPS, false));
    act(() => first.result.current.next());
    first.unmount();
    const second = renderHook(() => useStepper("demo", STEPS, true));
    expect(second.result.current).toMatchObject({ chapter: 0, step: 0 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/engine/useStepper.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/engine/useStepper.ts`：

```ts
import { useCallback, useEffect, useState } from "react";
import { CURSOR_KEY_PREFIX } from "./constants";

export interface Stepper {
  chapter: number;
  step: number;
  next(): void;
  prev(): void;
  jumpTo(chapter: number, step: number): void;
  gotoChapter(chapter: number): void;
  atStart: boolean;
  atEnd: boolean;
}

interface Pos {
  chapter: number;
  step: number;
}

/** 简单字符串 hash：步数内容变化 → key 变化 → 游标自动失效（不手动 bump，§3.2 A） */
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function cursorKey(slug: string, stepsPerChapter: number[]): string {
  return `${CURSOR_KEY_PREFIX}:${slug}:${simpleHash(JSON.stringify(stepsPerChapter))}`;
}

function restore(key: string, stepsPerChapter: number[]): Pos {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (
        p.chapter >= 0 &&
        p.chapter < stepsPerChapter.length &&
        p.step >= 0 &&
        p.step < stepsPerChapter[p.chapter]
      ) {
        return p;
      }
    }
  } catch {
    // 损坏值按无游标处理
  }
  return { chapter: 0, step: 0 };
}

function clamp(chapter: number, step: number, stepsPerChapter: number[]): Pos {
  const ch = Math.min(stepsPerChapter.length - 1, Math.max(0, chapter));
  const st = Math.min(stepsPerChapter[ch] - 1, Math.max(0, step));
  return { chapter: ch, step: st };
}

export function useStepper(
  slug: string,
  stepsPerChapter: number[],
  autoFromStart: boolean,
): Stepper {
  const key = cursorKey(slug, stepsPerChapter);
  const [pos, setPos] = useState<Pos>(() =>
    autoFromStart ? { chapter: 0, step: 0 } : restore(key, stepsPerChapter),
  );

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(pos));
    } catch {
      // 私密模式等存储不可用，忽略
    }
  }, [key, pos]);

  const total = stepsPerChapter.length;
  const atStart = pos.chapter === 0 && pos.step === 0;
  const atEnd =
    pos.chapter === total - 1 && pos.step === stepsPerChapter[pos.chapter] - 1;

  const next = useCallback(() => {
    setPos((p) => {
      if (p.step + 1 < stepsPerChapter[p.chapter]) return { ...p, step: p.step + 1 };
      if (p.chapter + 1 < total) return { chapter: p.chapter + 1, step: 0 };
      return p;
    });
  }, [stepsPerChapter, total]);

  const prev = useCallback(() => {
    setPos((p) => {
      if (p.step - 1 >= 0) return { ...p, step: p.step - 1 };
      if (p.chapter - 1 >= 0)
        return { chapter: p.chapter - 1, step: stepsPerChapter[p.chapter - 1] - 1 };
      return p;
    });
  }, [stepsPerChapter]);

  const jumpTo = useCallback(
    (chapter: number, step: number) => setPos(clamp(chapter, step, stepsPerChapter)),
    [stepsPerChapter],
  );

  const gotoChapter = useCallback(
    (chapter: number) => setPos(clamp(chapter, 0, stepsPerChapter)),
    [stepsPerChapter],
  );

  return { chapter: pos.chapter, step: pos.step, next, prev, jumpTo, gotoChapter, atStart, atEnd };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/engine/useStepper.test.ts`
Expected: PASS（7 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/engine
git commit -m "feat(M1): 游标 useStepper（内容 hash 自动失效 + auto 从起点）"
```

---

### Task 4: 音频驱动推进 useAudioPlayer

**Files:**
- Create: `narration-video/templates/src/engine/useAudioPlayer.ts`
- Test: `narration-video/templates/src/engine/useAudioPlayer.test.ts`

**Interfaces:**
- Consumes: `AUDIO_ESTIMATE_* / EMPTY_NARRATION_MIN_MS`（Task 1）、`allFinished / pauseAll / resumeAll`（Task 2）
- Produces: `AudioPlayer { playing, playStep(narration, src, holdMs, onDone), pause, resume, stop }`（Task 6 App 消费）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/engine/useAudioPlayer.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAudioPlayer } from "./useAudioPlayer";
import { register, setRenderMode } from "./animationRuntime";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string | null = null;
  ended = false;
  onended: (() => void) | null = null;
  playCalls = 0;
  pauseCalls = 0;
  constructor() {
    FakeAudio.instances.push(this);
  }
  play() {
    this.playCalls++;
    this.ended = false;
  }
  pause() {
    this.pauseCalls++;
  }
  end() {
    this.ended = true;
    this.onended?.();
  }
}

function makePendingAnim(durationMs: number) {
  let finished = false;
  const h = register({
    durationMs,
    seek: () => {},
    isFinished: () => finished,
    pause: () => {},
    play: () => {},
  });
  return { ...h, markFinished: () => { finished = true; } };
}

beforeEach(() => {
  vi.useFakeTimers();
  setRenderMode(false);
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAudioPlayer", () => {
  it("有音频：audio.ended 且 动画窗口结束 → 停留垫 → onDone", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    const pending = makePendingAnim(1000);

    act(() => {
      result.current.playStep("你好", "1.mp3", 400, onDone);
    });
    const audio = FakeAudio.instances[0];
    expect(audio.src).toBe("1.mp3");

    act(() => { audio.end(); }); // 音频结束但动画未结束
    vi.advanceTimersByTime(500);
    expect(onDone).not.toHaveBeenCalled(); // 等待动画

    act(() => { pending.markFinished(); });
    vi.advanceTimersByTime(100); // 轮询发现动画结束
    expect(onDone).not.toHaveBeenCalled(); // 还在停留垫
    vi.advanceTimersByTime(400);
    expect(onDone).toHaveBeenCalledTimes(1);
    pending.dispose();
  });

  it("无音频兜底：有文本按 max(1500, 字数×250) 估时", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.playStep("测试", null, 400, onDone);
    });
    vi.advanceTimersByTime(1499);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); // 估时 1500ms 到点（2 字×250 < 1500 下限）
    vi.advanceTimersByTime(50); // 动画窗口已空 → 直接进垫
    vi.advanceTimersByTime(400);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("无音频兜底：空 narration 按 1500ms 默认停留", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.playStep("", null, 400, onDone);
    });
    vi.advanceTimersByTime(1500 + 50 + 400);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("pause 冻结音频与动画；resume 恢复推进（含动画等待中暂停）", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    const pending = makePendingAnim(1000);

    act(() => { result.current.playStep("你好", "1.mp3", 400, onDone); });
    const audio = FakeAudio.instances[0];
    act(() => { audio.end(); }); // 进入动画等待
    act(() => { result.current.pause(); });
    vi.advanceTimersByTime(1000);
    expect(onDone).not.toHaveBeenCalled(); // 暂停期间不推进

    act(() => { pending.markFinished(); });
    act(() => { result.current.resume(); }); // 音频已 ended → 重新等待动画 → 垫 → 推进
    vi.advanceTimersByTime(50 + 400);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(audio.pauseCalls).toBeGreaterThan(0);
    pending.dispose();
  });

  it("stop 清空定时与音频", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    act(() => { result.current.playStep("你好", "1.mp3", 400, onDone); });
    act(() => { result.current.stop(); });
    vi.advanceTimersByTime(10000);
    expect(onDone).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/engine/useAudioPlayer.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/engine/useAudioPlayer.ts`：

```ts
// 音频驱动推进（§3.1）：audio.ended 且 动画窗口结束 → 停留垫 → onDone（next）。
// 引擎层计时（轮询/垫）合法——确定性黑名单只约束章节层；渲染走时间轴表不经此路径。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUDIO_ESTIMATE_CHAR_MS,
  AUDIO_ESTIMATE_MIN_MS,
  EMPTY_NARRATION_MIN_MS,
} from "./constants";
import { allFinished, pauseAll, resumeAll } from "./animationRuntime";

const POLL_MS = 50;

export interface AudioPlayer {
  playing: boolean;
  playStep(narration: string, src: string | null, holdMs: number, onDone: () => void): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

interface LastStep {
  narration: string;
  src: string | null;
  holdMs: number;
}

export function useAudioPlayer(): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const holdRef = useRef(0);
  const onDoneRef = useRef<() => void>(() => {});
  const lastRef = useRef<LastStep | null>(null);
  const [playing, setPlaying] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  const estimateMs = useCallback((narration: string): number => {
    return narration
      ? Math.max(AUDIO_ESTIMATE_MIN_MS, narration.length * AUDIO_ESTIMATE_CHAR_MS)
      : EMPTY_NARRATION_MIN_MS;
  }, []);

  /** 等动画窗口结束再执行（轮询；渲染路径不经此函数） */
  const afterAnimations = useCallback(
    (fn: () => void) => {
      if (allFinished()) {
        fn();
        return;
      }
      timerRef.current = window.setTimeout(() => afterAnimations(fn), POLL_MS);
    },
    [],
  );

  const scheduleHold = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => onDoneRef.current(), holdRef.current);
  }, [clearTimer]);

  const playStep = useCallback(
    (narration: string, src: string | null, holdMs: number, onDone: () => void) => {
      clearTimer();
      holdRef.current = holdMs;
      onDoneRef.current = onDone;
      lastRef.current = { narration, src, holdMs };
      setPlaying(true);

      if (!src) {
        // 音频缺失兜底：估时（或空步默认）→ 等动画 → 垫
        timerRef.current = window.setTimeout(
          () => afterAnimations(scheduleHold),
          estimateMs(narration),
        );
        return;
      }

      const audio = getAudio();
      audio.src = src;
      audio.onended = () => afterAnimations(scheduleHold);
      void audio.play();
    },
    [afterAnimations, clearTimer, estimateMs, getAudio, scheduleHold],
  );

  const pause = useCallback(() => {
    clearTimer();
    audioRef.current?.pause();
    pauseAll();
    setPlaying(false);
  }, [clearTimer]);

  const resume = useCallback(() => {
    const last = lastRef.current;
    if (!last) return;
    const audio = audioRef.current;
    if (audio?.src) {
      if (audio.ended) {
        // 音频已念完、曾在等待动画中被暂停：重新武装等待链
        afterAnimations(scheduleHold);
      } else {
        void audio.play();
      }
    } else {
      // 兜底估时路径：重新计时（M1 简化，不恢复已流逝部分）
      timerRef.current = window.setTimeout(
        () => afterAnimations(scheduleHold),
        estimateMs(last.narration),
      );
    }
    resumeAll();
    setPlaying(true);
  }, [afterAnimations, estimateMs, scheduleHold]);

  const stop = useCallback(() => {
    clearTimer();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    }
    pauseAll();
    setPlaying(false);
  }, [clearTimer]);

  useEffect(
    () => () => {
      clearTimer();
      audioRef.current?.pause();
    },
    [clearTimer],
  );

  return { playing, playStep, pause, resume, stop };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/engine/useAudioPlayer.test.ts`
Expected: PASS（5 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/engine
git commit -m "feat(M1): 音频驱动推进（ended+动画窗口→垫→next）"
```

---

### Task 5: 舞台缩放与 Stage 壳

**Files:**
- Create: `narration-video/templates/src/engine/useStageScale.ts`
- Create: `narration-video/templates/src/engine/Stage.tsx`
- Create: `narration-video/templates/src/styles/base.css`
- Test: `narration-video/templates/src/engine/useStageScale.test.ts`
- Test: `narration-video/templates/src/engine/Stage.test.tsx`

**Interfaces:**
- Consumes: 无（`TransportControls/CaptionLayer` 为 Task 7 产出——本任务先以 props 槽位 + 临时内联按钮占位，Task 7 替换为正式组件）
- Produces: `StageDims { width, height } / computeScale / useStageScale / Stage`（Task 6 App、scaffold 档案参数消费）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/engine/useStageScale.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { computeScale } from "./useStageScale";

describe("computeScale（缩放纯函数，舞台任意视口 bulletproof）", () => {
  it("16:9 舞台塞进 16:9 视口 = 1", () => {
    expect(computeScale(1920, 1080, { width: 1920, height: 1080 })).toBe(1);
  });
  it("小视口等比缩小取 min", () => {
    expect(computeScale(960, 1080, { width: 1920, height: 1080 })).toBeCloseTo(0.5);
  });
  it("3:4 舞台（1080×1440）在 16:9 视口里由高度决定", () => {
    expect(computeScale(1920, 1080, { width: 1080, height: 1440 })).toBeCloseTo(0.75);
  });
});
```

`narration-video/templates/src/engine/Stage.test.tsx`：

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Stage } from "./Stage";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(public cb: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("getBoundingClientRect", () => ({
    width: 960,
    height: 540,
    top: 0,
    left: 0,
    right: 960,
    bottom: 540,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));
});

describe("Stage", () => {
  it("按舞台尺寸渲染 frame 并应用缩放", () => {
    render(
      <Stage
        dims={{ width: 1920, height: 1080 }}
        caption=""
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      >
        <div data-testid="scene">场景</div>
      </Stage>,
    );
    const frame = screen.getByTestId("stage-frame");
    expect(frame).toHaveStyle({ width: "1920px", height: "1080px" });
    expect(frame).toHaveStyle({ transform: "scale(0.5)" });
    expect(screen.getByTestId("scene")).toBeInTheDocument();
  });

  it("渲染字幕文本", () => {
    render(
      <Stage dims={{ width: 1920, height: 1080 }} caption="当前口播" onPlay={() => {}} onPause={() => {}} onStop={() => {}}>
        <div />
      </Stage>,
    );
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("当前口播");
  });

  it("三个控制按钮回调", () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onStop = vi.fn();
    render(
      <Stage dims={{ width: 1920, height: 1080 }} caption="" onPlay={onPlay} onPause={onPause} onStop={onStop}>
        <div />
      </Stage>,
    );
    fireEvent.click(screen.getByTestId("btn-play"));
    fireEvent.click(screen.getByTestId("btn-pause"));
    fireEvent.click(screen.getByTestId("btn-stop"));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("noUi 模式隐藏控制条（录屏/渲染）", () => {
    render(
      <Stage noUi dims={{ width: 1920, height: 1080 }} caption="" onPlay={() => {}} onPause={() => {}} onStop={() => {}}>
        <div />
      </Stage>,
    );
    expect(screen.queryByTestId("transport")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/engine/useStageScale.test.ts src/engine/Stage.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/engine/useStageScale.ts`：

```ts
import { useEffect, useRef, useState } from "react";

export interface StageDims {
  width: number;
  height: number;
}

/** 缩放纯函数：取宽高比的最小值，舞台任意视口 bulletproof */
export function computeScale(availW: number, availH: number, dims: StageDims): number {
  return Math.min(availW / dims.width, availH / dims.height);
}

export interface StageScale {
  shellRef: React.RefObject<HTMLDivElement>;
  scale: number;
}

/** 三层壳结构（原版继承）：app-shell（视口居中）→ stage-fitter（真实可见 px）→ stage-frame（原尺寸 transform scale） */
export function useStageScale(dims: StageDims): StageScale {
  const shellRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setScale(computeScale(rect.width, rect.height, dims));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims.width, dims.height]);

  return { shellRef, scale };
}
```

`narration-video/templates/src/engine/Stage.tsx`：

```tsx
import type { PropsWithChildren } from "react";
import { StageDims, useStageScale } from "./useStageScale";

export interface StageProps extends PropsWithChildren {
  dims: StageDims;
  /** 录屏/渲染模式隐藏 chrome */
  noUi?: boolean;
  caption: string;
  onPlay(): void;
  onPause(): void;
  onStop(): void;
}

export function Stage({ dims, noUi, caption, onPlay, onPause, onStop, children }: StageProps) {
  const { shellRef, scale } = useStageScale(dims);
  return (
    <div className="app-shell" ref={shellRef}>
      <div
        className="stage-fitter"
        style={{ width: dims.width * scale, height: dims.height * scale }}
      >
        <div
          className="stage-frame"
          data-testid="stage-frame"
          style={{
            width: dims.width,
            height: dims.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
          {caption ? (
            <div className="caption-layer" data-testid="caption-layer">
              <span className="caption-text">{caption}</span>
            </div>
          ) : null}
        </div>
      </div>
      {!noUi && (
        <div className="transport" data-testid="transport">
          <button type="button" data-testid="btn-play" onClick={onPlay}>
            播放
          </button>
          <button type="button" data-testid="btn-pause" onClick={onPause}>
            暂停
          </button>
          <button type="button" data-testid="btn-stop" onClick={onStop}>
            停止
          </button>
        </div>
      )}
    </div>
  );
}
```

> 注：M1 控制条为引擎级内联实现；Task 7 不再重复（合并于本任务）。设计 §9 的"导出"按钮属 M5（渲染服务）。

`narration-video/templates/src/styles/base.css`：

```css
html,
body,
#root {
  height: 100%;
  margin: 0;
}

.app-shell {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  overflow: hidden;
}

.stage-fitter {
  position: relative;
}

.stage-frame {
  position: absolute;
  top: 0;
  left: 0;
  background: #fff;
  overflow: hidden;
}

.caption-layer {
  position: absolute;
  left: 50%;
  bottom: 48px;
  transform: translateX(-50%);
  max-width: 80%;
}

.caption-text {
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 28px;
  line-height: 1.5;
}

.transport {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
}

.transport button {
  font-size: 16px;
  padding: 8px 20px;
  cursor: pointer;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/engine/useStageScale.test.ts src/engine/Stage.test.tsx`
Expected: PASS（7 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/engine narration-video/templates/src/styles
git commit -m "feat(M1): 舞台缩放三层壳 + Stage + 播放控制条/字幕层"
```

---

### Task 6: manifest 声明制 + 示例章节 + App 装配

**Files:**
- Create: `narration-video/templates/src/chapters/manifest.ts`
- Create: `narration-video/templates/src/chapters/01-example/index.tsx`
- Create: `narration-video/templates/src/engine/runtime-config.ts`（模板默认值，scaffold 覆盖）
- Create: `narration-video/templates/src/App.tsx`
- Test: `narration-video/templates/src/App.test.tsx`

**Interfaces:**
- Consumes: `Stepper`（Task 3）、`AudioPlayer`（Task 4）、`Stage/StageDims`（Task 5）、`setRenderMode`（Task 2）、`DEFAULT_HOLD_MS`（Task 1）
- Produces: `ChapterDef / chapters`（M3a 门禁、M4 分镜、Phase 2 extract 消费）；`RuntimeConfig / stageConfig`（scaffold 写入）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/App.test.tsx`：

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string | null = null;
  ended = false;
  onended: (() => void) | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  play() {}
  pause() {}
}

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  FakeAudio.instances = [];
  localStorage.clear();
});

describe("App 装配", () => {
  it("渲染当前章节场景 + 框架层字幕", () => {
    render(<App />);
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("这是第一句口播。");
  });

  it("方向键推进场景（开发调试，藏在无 UI 模式之外不影响）", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("scene-1")).toBeInTheDocument();
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("这是第二句口播。");
  });

  it("停止按钮回到起点", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.click(screen.getByTestId("btn-stop"));
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();
  });

  it("空 narration 步不显示字幕", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("scene-2")).toBeInTheDocument();
    expect(screen.queryByTestId("caption-layer")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/App.test.tsx`
Expected: FAIL（App 不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/chapters/01-example/index.tsx`：

```tsx
// M1 示例章节：仅用于引擎装配验证（M2a 起用 token 化组件替换，非最终视觉）
export const exampleNarrations = ["这是第一句口播。", "这是第二句口播。", ""];

export function ExampleChapter({ step }: { step: number }) {
  if (step === 0) return <div data-testid="scene-0">冷开场</div>;
  if (step === 1) return <div data-testid="scene-1">第二幕</div>;
  return <div data-testid="scene-2">无声过场</div>;
}
```

`narration-video/templates/src/chapters/manifest.ts`：

```ts
import type { ComponentType } from "react";
import { ExampleChapter, exampleNarrations } from "./01-example";

export interface ChapterDef {
  id: string;
  folder: string;
  /** 声明制（§11.1 #1）：steps 由 narrations.length 派生——注册即校验，不扫代码字面量 */
  steps: number;
  narrations: string[];
  Component: ComponentType<{ step: number }>;
}

function define(def: Omit<ChapterDef, "steps"> & { narrations: string[] }): ChapterDef {
  return { ...def, steps: def.narrations.length };
}

export const chapters: ChapterDef[] = [
  define({
    id: "example",
    folder: "01-example",
    narrations: exampleNarrations,
    Component: ExampleChapter,
  }),
];
```

`narration-video/templates/src/engine/runtime-config.ts`：

```ts
// 运行时配置：模板默认值，scaffold 按档案参数（--slug / --stage）覆盖本文件
import type { StageDims } from "./useStageScale";

export interface RuntimeConfig {
  slug: string;
  dims: StageDims;
}

export const stageConfig: RuntimeConfig = {
  slug: "presentation",
  dims: { width: 1920, height: 1080 },
};
```

`narration-video/templates/src/App.tsx`：

```tsx
import { useEffect, useMemo } from "react";
import { chapters } from "./chapters/manifest";
import { setRenderMode } from "./engine/animationRuntime";
import { DEFAULT_HOLD_MS } from "./engine/constants";
import { stageConfig } from "./engine/runtime-config";
import { Stage } from "./engine/Stage";
import { useAudioPlayer } from "./engine/useAudioPlayer";
import { useStepper } from "./engine/useStepper";

const params = new URLSearchParams(window.location.search);

export default function App() {
  const autoFromStart = params.has("auto"); // ?auto=1 从 step 0 起播
  const renderMode = params.has("render"); // ?render=1 创建即冻结

  useEffect(() => {
    setRenderMode(renderMode);
  }, [renderMode]);

  const stepsPerChapter = useMemo(() => chapters.map((c) => c.steps), []);
  const stepper = useStepper(stageConfig.slug, stepsPerChapter, autoFromStart);
  const player = useAudioPlayer();

  const chapter = chapters[stepper.chapter];
  const narration = chapter.narrations[stepper.step] ?? "";
  const audioSrc = narration ? `/audio/${chapter.folder}/${stepper.step}.mp3` : null;

  // 每步推进：音频驱动（audio.ended 且 动画窗口结束 → 停留垫 → next）
  useEffect(() => {
    player.playStep(narration, audioSrc, DEFAULT_HOLD_MS, stepper.next);
    // stepper.chapter/step 变化即进入新的一步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepper.chapter, stepper.step]);

  // 开发调试键盘（←/→/Home/End）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") stepper.next();
      else if (e.key === "ArrowLeft") stepper.prev();
      else if (e.key === "Home") stepper.jumpTo(0, 0);
      else if (e.key === "End")
        stepper.jumpTo(chapters.length - 1, stepsPerChapter[chapters.length - 1] - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepper, stepsPerChapter]);

  const Scene = chapter.Component;

  return (
    <Stage
      dims={stageConfig.dims}
      noUi={renderMode}
      caption={narration}
      onPlay={player.resume}
      onPause={player.pause}
      onStop={() => {
        player.stop();
        stepper.jumpTo(0, 0);
      }}
    >
      <Scene step={stepper.step} />
    </Stage>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/App.test.tsx`
Expected: PASS（4 项全过）

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `cd narration-video/templates && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS + 零类型错误

- [ ] **Step 6: Commit**

```bash
git add narration-video/templates/src
git commit -m "feat(M1): manifest 声明制 + App 装配（音频驱动 + 键盘调试）"
```

---

### Task 7: scaffold 脚本 + 冒烟测试

**Files:**
- Create: `narration-video/scripts/scaffold.sh`
- Create: `narration-video/scripts/scaffold-smoke.sh`

**Interfaces:**
- Consumes: `narration-video/templates/`（Task 1-6 全部产出）、`ENGINE_VERSION`（constants.ts，scaffold 解析写入 .engine-version）
- Produces: `scaffold.sh <目标目录> [--slug 项目名] [--stage 16:9|3:4]`（harness Phase 1.5 的落点；产出一次性项目含 `src/engine/runtime-config.ts`（slug+舞台尺寸）、`.engine-version`、package.json scripts）

- [ ] **Step 1: 写冒烟脚本（失败测试）**

`narration-video/scripts/scaffold-smoke.sh`：

```bash
#!/usr/bin/env bash
# 冒烟：scaffold 到临时目录，校验关键产物；任一断言失败即退出非零
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. 16:9 场景
bash "$SKILL_DIR/scripts/scaffold.sh" "$TMP/demo" --slug demo --stage 16:9 >/dev/null
test -f "$TMP/demo/.engine-version"
test -f "$TMP/demo/src/engine/runtime-config.ts"
grep -q 'slug: "demo"' "$TMP/demo/src/engine/runtime-config.ts"
grep -q 'width: 1920' "$TMP/demo/src/engine/runtime-config.ts"
grep -q '"dev": "vite"' "$TMP/demo/package.json"
grep -q '"test": "vitest run"' "$TMP/demo/package.json"

# 2. 3:4 场景
bash "$SKILL_DIR/scripts/scaffold.sh" "$TMP/tall" --slug tall --stage 3:4 >/dev/null
grep -q 'width: 1080' "$TMP/tall/src/engine/runtime-config.ts"
grep -q 'height: 1440' "$TMP/tall/src/engine/runtime-config.ts"

# 3. 目标已存在 → 拒绝覆盖
if bash "$SKILL_DIR/scripts/scaffold.sh" "$TMP/demo" --slug again --stage 16:9 >/dev/null 2>&1; then
  echo "FAIL: 已存在目录未被拒绝" >&2
  exit 1
fi

# 4. 非法 stage → 报错
if bash "$SKILL_DIR/scripts/scaffold.sh" "$TMP/bad" --slug bad --stage 9:16 >/dev/null 2>&1; then
  echo "FAIL: 非法 stage 未被拒绝" >&2
  exit 1
fi

echo "scaffold smoke: OK"
```

- [ ] **Step 2: 跑冒烟确认失败**

Run: `bash narration-video/scripts/scaffold-smoke.sh`
Expected: FAIL（scaffold.sh 不存在）

- [ ] **Step 3: 写 scaffold 实现**

`narration-video/scripts/scaffold.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

# 用法: scaffold.sh <目标目录> [--slug 项目名] [--stage 16:9|3:4]
# 机制说明（偏离原版 npm create vite）：直接拷贝模板 + npm install——
# 依赖版本由模板 package.json 锁定，确定性优于 create-vite 的时变脚手架。

TARGET=""
SLUG="presentation"
STAGE="16:9"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2 ;;
    --stage) STAGE="$2"; shift 2 ;;
    *) TARGET="$1"; shift ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "用法: scaffold.sh <目标目录> [--slug 项目名] [--stage 16:9|3:4]" >&2
  exit 1
fi

if [[ -e "$TARGET" ]]; then
  echo "错误: 目标目录已存在，拒绝覆盖: $TARGET" >&2
  exit 1
fi

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_DIR="$SKILL_DIR/templates"

case "$STAGE" in
  16:9) DIMS='{ width: 1920, height: 1080 }' ;;
  3:4)  DIMS='{ width: 1080, height: 1440 }' ;;
  *)
    echo "错误: --stage 只支持 16:9 或 3:4" >&2
    exit 1
    ;;
esac

# 1. 拷贝模板
cp -R "$TEMPLATE_DIR" "$TARGET"

# 2. 写运行时配置（slug + 舞台尺寸 = 档案最小参数）
cat > "$TARGET/src/engine/runtime-config.ts" <<EOF
// 运行时配置：由 scaffold 按档案参数生成（--slug / --stage），勿手改
import type { StageDims } from "./useStageScale";

export interface RuntimeConfig {
  slug: string;
  dims: StageDims;
}

export const stageConfig: RuntimeConfig = {
  slug: "$SLUG",
  dims: $DIMS,
};
EOF

# 3. 引擎版本标记（check 对比升级提示）
ENGINE_VERSION="$(grep -o 'ENGINE_VERSION = "[^"]*"' "$TEMPLATE_DIR/src/engine/constants.ts" | cut -d'"' -f2)"
echo "$ENGINE_VERSION" > "$TARGET/.engine-version"

# 4. 依赖安装 + 类型冒烟
(cd "$TARGET" && npm install --no-audit --no-fund && npx tsc --noEmit)

# 5. 下一步指引（给下一个时刻的 agent 看）
cat <<EOF

✅ 项目已创建: $TARGET
   舞台: $STAGE（$DIMS）
   引擎版本: $ENGINE_VERSION

下一步:
   cd $TARGET && npm run dev     # 预览（浏览器即播放器，?auto=1 全自动）
   npm run test                  # 引擎单测
   npm run check                 # 静态门禁（M3a 实现中，当前占位）
   npm run render                # 渲染导出（M5 实现中，当前占位）

章节开发前必读: 渐进式文件读取表（SKILL.md）+ CHAPTER-CRAFT.md
EOF
```

- [ ] **Step 4: 跑冒烟确认通过**

Run: `bash narration-video/scripts/scaffold-smoke.sh`
Expected: 输出 `scaffold smoke: OK`（注：冒烟包含 npm install，首次运行需 1-3 分钟）

- [ ] **Step 5: 手工验证 dev 启动**

Run: `TMP=$(mktemp -d) && bash narration-video/scripts/scaffold.sh "$TMP/demo" --slug demo --stage 16:9 && cd "$TMP/demo" && timeout 15 npm run dev`
Expected: Vite 在 5174 端口启动，无编译错误（页面可打开、自动播放尝试被浏览器拦截属预期，点击"播放"按钮后推进）

- [ ] **Step 6: Commit**

```bash
git add narration-video/scripts
git commit -m "feat(M1): scaffold 脚本（档案参数 + 版本标记 + 冒烟测试）"
```

---

## 自检记录（writing-plans Self-Review）

1. **Spec coverage**：M1 范围逐项——单比例引擎参数化 ✓(Task 5/6 runtime-config)、9 缺陷修复中引擎层项 ✓(STORAGE_KEY hash/auto=1/manifest 声明制/端口 5174)、播放控制 ✓(Task 5)、引擎单测 ✓(Task 1-6)、版本标记 ✓(Task 7)、推进规则与停留垫 ✓(Task 4 + Task 1 常量)、创建即冻结 ✓(Task 2)。其余缺陷（MaskReveal/字体契约/extract 正则）与里程碑 M2a/M4 相关，不在本计划。
2. **Placeholder scan**：check/render 脚本为**设计文档明示的占位**（M3a/M5 计划实现），非计划失败；无 TBD/TODO；所有代码步骤含完整实现。
3. **Type consistency**：`StageDims`（Task 5 定义 → runtime-config/Stage/App 一致）；`Stepper`（Task 3 → App）；`AudioPlayer.playStep(narration, src, holdMs, onDone)`（Task 4 → App 调用一致）；`AnimHandle/register/waapi`（Task 2 → Task 4 消费一致）；`ChapterDef.steps/narrations/Component`（Task 6 → 后续计划）。
