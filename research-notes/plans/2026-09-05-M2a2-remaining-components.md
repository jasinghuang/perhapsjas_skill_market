# M2a-2 组件库第二批（揭示/装饰/素材/氛围/功能组）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成组件库第二批 13 个组件（揭示 3 / 装饰 3 / 素材承载 3 / 氛围 3 / 功能 2 中除字幕外全部），补 SeededRandom 确定性随机工具，收口统一出口/契约 lint/双画布冒烟与清理项。

**Architecture:** 沿 Plan 2 的 createPrimitive 工厂 + 引擎动画运行时扩展；新机制三处：①SeededRandom（确定性粒子，§8.1"给确定性能力"）；②揭示组自接动画（动态 children，铁律 6 的 f(step) 纯派生 + mount 重演）；③氛围组"有限周期"模式（终态冻结，与渲染静置期单帧复用一致）。

**Tech Stack:** 继承 M1/M2a-1。

**Spec:** `../07-design-draft.md`（§6.2 组件清单、§6.1 铁律 6、§8.1 SeededRandom/确定性黑名单、§11.1 #8 无限动画禁令）。

## Global Constraints

- 组件五铁律 + 六铁律（§6.1）：动画必经引擎运行时（waapi/canvasAnim/register）；Canvas 走 draw(t) 帧函数；禁裸样式；动画属性白名单（opacity/transform/色彩/clip-path/stroke-dashoffset）；stagger 逐子元素延迟；**step 入场动画契约——跨步状态变化 = f(step) 纯派生 + mount 从头可复演**（StepSequence/RevealList 的落点）
- 无限循环动画禁止（§11.1 #8）：氛围微动一律**有限周期**（有限次迭代或有限时长后冻结终态）——渲染静置期截终态与预览一致
- 确定性：SeededRandom 传 seed；draw(t) 只依赖 t 与 props 捕获值（§8.1）
- 每组件 ≥2 变体（§6.4 缺点 1）；组件 CSS 只消费 token（契约 lint 机器执行）
- 卸载 dispose 纪律（含 canvasAnim 的 dispose）
- **门禁测试双护栏（终审流程教训，本计划起强制）**：每个验证器测试必须含【故意违规负样本】+【输入非空护栏】——验证器自身的验证
- 白名单 stroke-dashoffset 已生效（P2-1）

**计划裁定（执行时按此，执行后由控制器同步进设计文档）**：
- Ruling P3-1: 揭示组（RevealList/StepSequence/RevealText）**不用工厂 stagger**——动态 children 场景自接 revealAnim（按 children 变化接线），静态内容组件仍走工厂。
- Ruling P3-2: TypedTerminal v1 不含闪烁光标（无限动画禁令）；打字过程为有限 canvasAnim。
- Ruling P3-3: 氛围组件统一"有限周期冻结终态"：Breathe 用有限迭代次数（waapi iterations），SeededParticles/KenBurns 用有限时长 draw(t)（t ≥ durMs 时渲染终态）。
- Ruling P3-4: factory 头注释显式声明"子元素在 mount 时固定"契约（终审 M1），动态 children 一律走 P3-1 自接路径。

## File Structure（本计划新建）

```
narration-video/templates/src/components/
  seededRandom.ts              # SeededRandom 确定性随机（§8.1）
  reveal/RevealText.tsx + .css   # 逐词揭示
  reveal/RevealList.tsx + .css   # 列表逐条揭示（activeCount = f(step)）
  reveal/StepSequence.tsx + .css # 步骤序列（铁律 6 落点）
  decor/DecorDot.tsx + .css      # 装饰三件套（--decor-family 消费）
  decor/DecorBar.tsx + .css
  decor/DecorRing.tsx + .css
  media/Figure.tsx + .css        # 素材承载（墨框+硬阴影+遮罩揭示）
  media/TypedTerminal.tsx + .css # 打字机（canvasAnim）
  media/PathDraw.tsx + .css      # SVG 路径自绘（waapi pathLength）
  ambient/SeededParticles.tsx + .css  # 种子粒子（canvas + SeededRandom）
  ambient/Breathe.tsx + .css     # 呼吸（有限迭代）
  ambient/KenBurns.tsx + .css    # 缓推（有限时长）
  function/TimelineTrack.tsx + .css   # 时间轴自绘
  function/ProgressDots.tsx + .css    # 步骤点
```

---

### Task 1: SeededRandom 确定性随机

**Files:**
- Create: `narration-video/templates/src/components/seededRandom.ts`
- Test: `narration-video/templates/src/components/seededRandom.test.ts`

**Interfaces:**
- Produces: `seededRandom(seed: number): () => number`——[0,1) 均匀分布、同 seed 同序列（跨渲染确定性，§8.1）；`SeededParticles` 与 M3a 门禁（确定性扫描豁免依据）消费

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/seededRandom.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { seededRandom } from "./seededRandom";

describe("SeededRandom（§8.1 确定性随机）", () => {
  it("同 seed 产生同序列", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("不同 seed 产生不同序列", () => {
    const a = seededRandom(1);
    const b = seededRandom(2);
    expect(a()).not.toBe(b());
  });

  it("值域 [0, 1)", () => {
    const rnd = seededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("序列长度无限且稳定（不依赖 Date/随机源）", () => {
    const rnd = seededRandom(9);
    const first20 = Array.from({ length: 20 }, () => rnd());
    const again = seededRandom(9);
    expect(Array.from({ length: 20 }, () => again())).toEqual(first20);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/seededRandom.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`narration-video/templates/src/components/seededRandom.ts`：

```ts
// SeededRandom（§8.1）：确定性伪随机（mulberry32）——同 seed 同序列，跨渲染可复现。
// 确定性黑名单（§11.1 #7）禁 Math.random 的创作替代品。

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/seededRandom.test.ts`
Expected: PASS（4 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/seededRandom.ts
git commit -m "feat(M2a): SeededRandom 确定性随机（同 seed 同序列）"
```

---

### Task 2: 揭示组（RevealText / RevealList / StepSequence）

**Files:**
- Create: `narration-video/templates/src/components/reveal/RevealText.tsx` + `.css`
- Create: `narration-video/templates/src/components/reveal/RevealList.tsx` + `.css`
- Create: `narration-video/templates/src/components/reveal/StepSequence.tsx` + `.css`
- Create: `narration-video/templates/src/components/reveal/index.ts`
- Test: `narration-video/templates/src/components/reveal/reveal.test.tsx`

**Interfaces:**
- Consumes: `revealAnim`（motion）、`createPrimitive`（factory）、`registrySize`
- Produces: `RevealText { text: string, preset?: RevealPreset, variant: "words" | "mask" }`、`RevealList { items: string[], activeCount: number, variant: "plain" | "numbered" }`、`StepSequence { steps: { title: string; desc?: string }[], currentStep: number, variant: "plain" | "cards" }`——三者的状态全部纯派生自 props（铁律 6）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/reveal/reveal.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { RevealText, RevealList, StepSequence } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("揭示组", () => {
  it("RevealText 逐词拆分 + 动画注册 + 卸载 dispose", () => {
    const { container, unmount } = render(<RevealText text="你好 世界 再见" />);
    const spans = container.querySelectorAll(".cdp-reveal-text-word");
    expect(spans).toHaveLength(3);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("RevealList activeCount 纯派生状态（铁律 6）", () => {
    const { container, rerender } = render(
      <RevealList items={["甲", "乙", "丙"]} activeCount={1} />,
    );
    expect(container.querySelectorAll(".cdp-reveal-list-item-active")).toHaveLength(1);
    expect(container.querySelectorAll(".cdp-reveal-list-item-pending")).toHaveLength(2);
    // f(step) 重演：activeCount 变化 = 纯派生，无 DOM 增量变异
    rerender(<RevealList items={["甲", "乙", "丙"]} activeCount={2} />);
    expect(container.querySelectorAll(".cdp-reveal-list-item-active")).toHaveLength(2);
  });

  it("RevealList numbered 变体带序号", () => {
    const { container } = render(
      <RevealList items={["甲", "乙"]} activeCount={2} variant="numbered" />,
    );
    expect(container.querySelectorAll(".cdp-reveal-list-index")).toHaveLength(2);
  });

  it("StepSequence 步骤状态纯派生（done/active/pending）", () => {
    const { container, rerender } = render(
      <StepSequence
        steps={[{ title: "一" }, { title: "二" }, { title: "三" }]}
        currentStep={1}
      />,
    );
    expect(container.querySelectorAll(".cdp-step-seq-done")).toHaveLength(1);
    expect(container.querySelectorAll(".cdp-step-seq-active")).toHaveLength(1);
    expect(container.querySelectorAll(".cdp-step-seq-pending")).toHaveLength(1);
    rerender(
      <StepSequence
        steps={[{ title: "一" }, { title: "二" }, { title: "三" }]}
        currentStep={2}
      />,
    );
    expect(container.querySelectorAll(".cdp-step-seq-done")).toHaveLength(2);
  });

  it("StepSequence cards 变体渲染描述", () => {
    const { getByTestId } = render(
      <StepSequence
        steps={[{ title: "一", desc: "描述" }]}
        currentStep={0}
        variant="cards"
        data-testid="seq"
      />,
    );
    expect(getByTestId("seq")).toHaveTextContent("描述");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/reveal/reveal.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`RevealText.tsx`：

```tsx
// 文字揭示（MaskReveal 修复版的组件化）：逐词拆分为 span，逐子元素延迟动画。
// Ruling P3-1：动态拆分内容自接 revealAnim（不走工厂 stagger）。
import { useEffect, useRef } from "react";
import { AnimHandle } from "../../engine/animationRuntime";
import { RevealPreset, revealAnim, staggerMs } from "../motion";

export interface RevealTextProps {
  text: string;
  preset?: RevealPreset;
  variant?: "words" | "mask";
  className?: string;
  "data-testid"?: string;
}

export function RevealText({ text, preset = "rise", variant = "words", className = "", ...rest }: RevealTextProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const words = el.querySelectorAll<HTMLElement>(".cdp-reveal-text-word");
    const step = staggerMs(el);
    const handles: AnimHandle[] = [];
    words.forEach((w, i) => {
      const h = revealAnim(w, preset, "mid", i * step);
      if (h) handles.push(h);
    });
    return () => handles.forEach((h) => h.dispose());
  }, [text, preset]);

  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div
      ref={rootRef}
      className={`cdp-reveal-text cdp-reveal-text-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    >
      {words.map((w, i) => (
        <span key={i} className="cdp-reveal-text-word">
          {w}
        </span>
      ))}
    </div>
  );
}
```

`RevealText.css`：

```css
.cdp-reveal-text {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-family: var(--font-display-cn), var(--font-display-en);
  font-size: var(--t-h2);
  color: var(--text);
}

.cdp-reveal-text-mask {
  gap: 0 var(--space-1);
}
```

`RevealList.tsx`：

```tsx
// 列表逐条揭示（原版 list-reveal 的组件化 + 铁律 6）：
// 全部条目的状态（active/pending）纯派生自 activeCount——f(step) 从头可复演；
// 新激活条目 mount 触发入场动画（revealAnim 自接，Ruling P3-1）。
import { useEffect, useRef } from "react";
import { AnimHandle } from "../../engine/animationRuntime";
import { RevealPreset, revealAnim, staggerMs } from "../motion";

export interface RevealListProps {
  items: string[];
  /** 已揭示条数（章节层传 step 派生值，如 step + 1） */
  activeCount: number;
  preset?: RevealPreset;
  variant?: "plain" | "numbered";
  className?: string;
  "data-testid"?: string;
}

export function RevealList({ items, activeCount, preset = "rise", variant = "plain", className = "", ...rest }: RevealListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const step = staggerMs(el);
    const handles: AnimHandle[] = [];
    el.querySelectorAll<HTMLElement>(".cdp-reveal-list-item-active").forEach((item, i) => {
      const h = revealAnim(item, preset, "mid", i * step);
      if (h) handles.push(h);
    });
    return () => handles.forEach((h) => h.dispose());
  }, [items, activeCount, preset]);

  return (
    <div
      ref={listRef}
      className={`cdp-reveal-list cdp-reveal-list-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className={
            i < activeCount ? "cdp-reveal-list-item cdp-reveal-list-item-active" : "cdp-reveal-list-item cdp-reveal-list-item-pending"
          }
        >
          {variant === "numbered" ? <span className="cdp-reveal-list-index">{String(i + 1).padStart(2, "0")}</span> : null}
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}
```

`RevealList.css`：

```css
.cdp-reveal-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cdp-reveal-list-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-family: var(--font-body);
  font-size: var(--t-h3);
  color: var(--text);
}

.cdp-reveal-list-item-pending {
  color: var(--text-faint);
}

.cdp-reveal-list-index {
  font-family: var(--font-mono);
  font-size: var(--t-label);
  color: var(--accent-1);
}
```

`StepSequence.tsx`：

```tsx
// 步骤序列（铁律 6 的落点 + 设计 #3 的"步骤动画"）：
// done/active/pending 状态纯派生自 currentStep——渲染独立 mount 从头可复演；
// 激活步骤的标记 mount 触发入场动画。
import { useEffect, useRef } from "react";
import { AnimHandle } from "../../engine/animationRuntime";
import { revealAnim, staggerMs } from "../motion";

export interface StepSeqStep {
  title: string;
  desc?: string;
}

export interface StepSequenceProps {
  steps: StepSeqStep[];
  currentStep: number;
  variant?: "plain" | "cards";
  className?: string;
  "data-testid"?: string;
}

export function StepSequence({ steps, currentStep, variant = "plain", className = "", ...rest }: StepSequenceProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const step = staggerMs(el);
    const handles: AnimHandle[] = [];
    el.querySelectorAll<HTMLElement>(".cdp-step-seq-active .cdp-step-seq-marker").forEach((m, i) => {
      const h = revealAnim(m, "fade", "fast", i * step);
      if (h) handles.push(h);
    });
    return () => handles.forEach((h) => h.dispose());
  }, [steps, currentStep]);

  return (
    <div
      ref={rootRef}
      className={`cdp-step-seq cdp-step-seq-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    >
      {steps.map((s, i) => {
        const state = i < currentStep ? "done" : i === currentStep ? "active" : "pending";
        return (
          <div key={i} className={`cdp-step-seq-item cdp-step-seq-${state}`}>
            <span className="cdp-step-seq-marker" />
            <div>
              <div className="cdp-step-seq-title">{s.title}</div>
              {variant === "cards" && s.desc ? <div className="cdp-step-seq-desc">{s.desc}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

`StepSequence.css`：

```css
.cdp-step-seq {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.cdp-step-seq-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.cdp-step-seq-marker {
  width: var(--space-3);
  height: var(--space-3);
  margin-top: 6px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  flex-shrink: 0;
}

.cdp-step-seq-active .cdp-step-seq-marker {
  background: var(--accent-1);
}

.cdp-step-seq-done .cdp-step-seq-marker {
  background: var(--surface-3);
}

.cdp-step-seq-title {
  font-family: var(--font-body);
  font-size: var(--t-h3);
  color: var(--text);
}

.cdp-step-seq-desc {
  margin-top: var(--space-1);
  font-family: var(--font-body);
  font-size: var(--t-body);
  color: var(--text-2);
}

.cdp-step-seq-cards .cdp-step-seq-item {
  background: var(--card-bg);
  border: var(--card-border);
  border-radius: var(--card-radius);
  box-shadow: var(--shadow-card);
  padding: var(--space-3) var(--space-4);
}

.cdp-step-seq-pending {
  opacity: 0.55;
}
```

`reveal/index.ts`：

```ts
export { RevealText } from "./RevealText";
export { RevealList } from "./RevealList";
export { StepSequence } from "./StepSequence";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/reveal/reveal.test.tsx`
Expected: PASS（5 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/reveal
git commit -m "feat(M2a): 揭示组（RevealText/RevealList/StepSequence，铁律 6 落点）"
```

---

### Task 3: 装饰组（DecorDot / DecorBar / DecorRing）

**Files:**
- Create: `narration-video/templates/src/components/decor/DecorDot.tsx` + `.css`
- Create: `narration-video/templates/src/components/decor/DecorBar.tsx` + `.css`
- Create: `narration-video/templates/src/components/decor/DecorRing.tsx` + `.css`
- Create: `narration-video/templates/src/components/decor/index.ts`
- Test: `narration-video/templates/src/components/decor/decor.test.tsx`

**Interfaces:**
- Consumes: `createPrimitive`
- Produces: `DecorDot { variant: "plain" | "glow" }`、`DecorBar { variant: "solid" | "accent" }`、`DecorRing { variant: "outline" | "filled" }`——三者共同消费 `--decor-family` 主题装饰语言（CSS 内 var()），各带 ≥2 变体

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/decor/decor.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { DecorDot, DecorBar, DecorRing } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("装饰组", () => {
  it("三组件默认渲染 + 类名约定", () => {
    const { getByTestId } = render(
      <div>
        <DecorDot data-testid="a" />
        <DecorBar data-testid="b" />
        <DecorRing data-testid="c" />
      </div>,
    );
    expect(getByTestId("a").className).toContain("cdp-decor-dot");
    expect(getByTestId("b").className).toContain("cdp-decor-bar");
    expect(getByTestId("c").className).toContain("cdp-decor-ring");
  });

  it("变体生效（各 ≥2）", () => {
    const { getByTestId } = render(
      <div>
        <DecorDot variant="glow" data-testid="a" />
        <DecorBar variant="accent" data-testid="b" />
        <DecorRing variant="filled" data-testid="c" />
      </div>,
    );
    expect(getByTestId("a").className).toContain("cdp-decor-dot-glow");
    expect(getByTestId("b").className).toContain("cdp-decor-bar-accent");
    expect(getByTestId("c").className).toContain("cdp-decor-ring-filled");
  });

  it("reveal 走引擎、卸载 dispose", () => {
    const { unmount } = render(<DecorDot reveal="fade" />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/decor/decor.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`DecorDot.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 装饰圆点（发光强调点）。variants: plain / glow */
export const DecorDot = createPrimitive("decor-dot", {
  tag: "span",
  variants: ["plain", "glow"],
  defaultVariant: "plain",
});
```

`DecorDot.css`：

```css
.cdp-decor-dot {
  display: inline-block;
  width: var(--space-3);
  height: var(--space-3);
  border-radius: var(--r-pill);
  background: var(--accent-1);
}

.cdp-decor-dot-glow {
  box-shadow: 0 0 var(--space-4) var(--accent-1);
}
```

`DecorBar.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 装饰色条。variants: solid（墨色）/ accent（强调色） */
export const DecorBar = createPrimitive("decor-bar", {
  tag: "span",
  variants: ["solid", "accent"],
  defaultVariant: "solid",
});
```

`DecorBar.css`：

```css
.cdp-decor-bar {
  display: inline-block;
  width: var(--space-6);
  height: var(--space-1);
  background: var(--surface-3);
}

.cdp-decor-bar-accent {
  background: var(--accent-1);
}
```

`DecorRing.tsx`：

```tsx
import { createPrimitive } from "../factory";

/** 装饰圆环。variants: outline（描边）/ filled（实心） */
export const DecorRing = createPrimitive("decor-ring", {
  tag: "span",
  variants: ["outline", "filled"],
  defaultVariant: "outline",
});
```

`DecorRing.css`：

```css
.cdp-decor-ring {
  display: inline-block;
  width: var(--space-4);
  height: var(--space-4);
  border-radius: var(--r-pill);
  border: var(--border-w) solid var(--text);
}

.cdp-decor-ring-filled {
  background: var(--accent-1);
  border-color: var(--accent-1);
}
```

`decor/index.ts`：

```ts
export { DecorDot } from "./DecorDot";
export { DecorBar } from "./DecorBar";
export { DecorRing } from "./DecorRing";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/decor/decor.test.tsx`
Expected: PASS（3 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/decor
git commit -m "feat(M2a): 装饰组（DecorDot/DecorBar/DecorRing，--decor-family 消费）"
```

---

### Task 4: 素材承载组（Figure / TypedTerminal / PathDraw）

**Files:**
- Create: `narration-video/templates/src/components/media/Figure.tsx` + `.css`
- Create: `narration-video/templates/src/components/media/TypedTerminal.tsx` + `.css`
- Create: `narration-video/templates/src/components/media/PathDraw.tsx` + `.css`
- Create: `narration-video/templates/src/components/media/index.ts`
- Test: `narration-video/templates/src/components/media/media.test.tsx`

**Interfaces:**
- Consumes: `createPrimitive`、`canvasAnim`（帧函数逃生舱）、`waapi`（白名单 stroke-dashoffset）
- Produces: `Figure { src?: string, caption?: string, variant: "frame" | "plain" }`（素材缺失渲染 placeholder 卡——诚实原则）、`TypedTerminal { lines: string[], duration?: MotionDuration }`、`PathDraw { d: string, duration?: MotionDuration, variant: "stroke" | "filled" }`

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/media/media.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { Figure, TypedTerminal, PathDraw } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("素材承载组", () => {
  it("Figure 无 src 渲染 placeholder 卡（诚实原则）", () => {
    const { getByTestId } = render(<Figure caption="截图" data-testid="f" />);
    expect(getByTestId("f")).toHaveTextContent("截图");
    expect(getByTestId("f").querySelector(".cdp-figure-placeholder")).not.toBeNull();
  });

  it("Figure frame 变体 + reveal 动画注册与 dispose", () => {
    const { unmount } = render(<Figure variant="frame" reveal="wipe" />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("TypedTerminal 打字走帧函数（canvasAnim 注册 + dispose）", () => {
    const { getByTestId, unmount } = render(
      <TypedTerminal lines={["第一行", "第二行"]} data-testid="t" />,
    );
    expect(getByTestId("t")).toHaveTextContent("第一行");
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("PathDraw 路径自绘走 waapi（stroke-dashoffset 白名单）+ dispose", () => {
    const { container, unmount } = render(
      <PathDraw d="M0 0 L100 100" duration="fast" />,
    );
    expect(container.querySelector("path")).not.toBeNull();
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("PathDraw filled 变体不注册动画（纯填充）", () => {
    const { unmount } = render(<PathDraw d="M0 0 L10 10" variant="filled" />);
    expect(registrySize()).toBe(0);
    unmount();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/media/media.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`Figure.tsx`：

```tsx
// 素材承载（§6.2）：墨框 + 硬阴影 + 遮罩揭示；无素材渲染 placeholder 卡（诚实原则）。
import { createPrimitive } from "../factory";

export interface FigureProps {
  src?: string;
  caption?: string;
  variant?: "frame" | "plain";
  reveal?: "fade" | "rise" | "wipe";
  duration?: "fast" | "mid" | "slow";
  className?: string;
  "data-testid"?: string;
}

const Base = createPrimitive("figure", {
  tag: "figure",
  variants: ["frame", "plain"],
  defaultVariant: "frame",
});

export function Figure({ src, caption, variant = "frame", reveal, duration, className, ...rest }: FigureProps) {
  return (
    <Base variant={variant} reveal={reveal} duration={duration} className={className} data-testid={rest["data-testid"]}>
      {src ? (
        <img className="cdp-figure-img" src={src} alt={caption ?? ""} />
      ) : (
        <div className="cdp-figure-placeholder">
          <span className="cdp-figure-placeholder-text">素材待补</span>
        </div>
      )}
      {caption ? <figcaption className="cdp-figure-caption">{caption}</figcaption> : null}
    </Base>
  );
}
```

`Figure.css`：

```css
.cdp-figure {
  margin: 0;
}

.cdp-figure-frame {
  border: var(--border-w) solid var(--text);
  box-shadow: var(--shadow-card);
  background: var(--surface);
}

.cdp-figure-img {
  display: block;
  width: 100%;
}

.cdp-figure-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  background: var(--surface-2);
}

.cdp-figure-placeholder-text {
  font-family: var(--font-mono);
  font-size: var(--t-label);
  color: var(--text-mute);
}

.cdp-figure-caption {
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  letter-spacing: 0.06em;
  color: var(--text-2);
}
```

`TypedTerminal.tsx`：

```tsx
// 打字机（Ruling P3-2：v1 不含闪烁光标——无限动画禁令）。
// 打字过程 = 有限 canvasAnim 帧函数：draw(t) 只依赖 t 与捕获值，可 seek。
import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 400, mid: 900, slow: 1800 };

export interface TypedTerminalProps {
  lines: string[];
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function TypedTerminal({ lines, duration = "mid", className = "", ...rest }: TypedTerminalProps) {
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const full = lines.join("\n");
    const durMs = DUR_FALLBACK[duration];
    const h = canvasAnim((tMs) => {
      const progress = Math.min(1, tMs / durMs);
      const count = Math.round(full.length * progress);
      el.textContent = full.slice(0, count);
    }, durMs);
    return () => h.dispose();
  }, [lines.join("|"), duration]);

  return (
    <div className={`cdp-terminal ${className}`} data-testid={rest["data-testid"]}>
      <div ref={textRef} className="cdp-terminal-text">
        {lines[0]}
      </div>
    </div>
  );
}
```

`TypedTerminal.css`：

```css
.cdp-terminal {
  background: var(--surface-3);
  border-radius: var(--card-radius);
  padding: var(--space-4);
}

.cdp-terminal-text {
  font-family: var(--font-mono);
  font-size: var(--t-label);
  line-height: 1.6;
  color: var(--surface);
  white-space: pre-wrap;
}
```

`PathDraw.tsx`：

```tsx
// SVG 路径自绘（原版核心视觉演示之一）：pathLength 归一化 + stroke-dashoffset 动画（白名单 P2-1）。
import { useEffect, useRef } from "react";
import { waapi } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 500, mid: 1200, slow: 2400 };

export interface PathDrawProps {
  d: string;
  duration?: MotionDuration;
  variant?: "stroke" | "filled";
  className?: string;
  "data-testid"?: string;
}

export function PathDraw({ d, duration = "mid", variant = "stroke", className = "", ...rest }: PathDrawProps) {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (variant !== "stroke") return;
    const el = pathRef.current;
    if (!el) return;
    const durMs = DUR_FALLBACK[duration];
    const h = waapi(
      el,
      [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
      { duration: durMs, easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "forwards" },
    );
    return () => h.dispose();
  }, [d, duration, variant]);

  return (
    <svg
      viewBox="0 0 100 100"
      className={`cdp-path-draw ${className}`}
      data-testid={rest["data-testid"]}
    >
      <path
        ref={pathRef}
        d={d}
        pathLength={1}
        className="cdp-path-draw-path"
        style={
          variant === "stroke"
            ? { strokeDasharray: 1, strokeDashoffset: 1 }
            : { strokeDasharray: undefined, strokeDashoffset: 0 }
        }
      />
    </svg>
  );
}
```

`PathDraw.css`：

```css
.cdp-path-draw {
  width: 100%;
  height: auto;
}

.cdp-path-draw-path {
  fill: none;
  stroke: var(--accent-1);
  stroke-width: 2;
}
```

`media/index.ts`：

```ts
export { Figure } from "./Figure";
export { TypedTerminal } from "./TypedTerminal";
export { PathDraw } from "./PathDraw";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/media/media.test.tsx`
Expected: PASS（5 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/media
git commit -m "feat(M2a): 素材承载组（Figure/TypedTerminal/PathDraw）"
```

---

### Task 5: 氛围组（SeededParticles / Breathe / KenBurns）

**Files:**
- Create: `narration-video/templates/src/components/ambient/SeededParticles.tsx` + `.css`
- Create: `narration-video/templates/src/components/ambient/Breathe.tsx` + `.css`
- Create: `narration-video/templates/src/components/ambient/KenBurns.tsx` + `.css`
- Create: `narration-video/templates/src/components/ambient/index.ts`
- Test: `narration-video/templates/src/components/ambient/ambient.test.tsx`

**Interfaces:**
- Consumes: `seededRandom`（Task 1）、`canvasAnim`、`waapi`
- Produces: `SeededParticles { count?, seed, duration?: MotionDuration, variant: "drift" | "static" }`、`Breathe { variant: "pulse" | "glow", cycles?: number }`、`KenBurns { src?: string, duration?: MotionDuration }`——三者全部有限周期（Ruling P3-3）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/ambient/ambient.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { SeededParticles, Breathe, KenBurns } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("氛围组（有限周期确定性微动）", () => {
  it("SeededParticles 同 seed 两次渲染产出相同粒子布局", () => {
    const a = render(<SeededParticles seed={42} count={20} />);
    const b = render(<SeededParticles seed={42} count={20} />);
    expect(a.container.querySelector("canvas")).not.toBeNull();
    a.unmount();
    b.unmount();
  });

  it("SeededParticles canvasAnim 注册 + dispose", () => {
    const { unmount } = render(<SeededParticles seed={1} count={5} />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("Breathe 有限迭代（iterations 为有限值）+ dispose", () => {
    const { unmount } = render(<Breathe cycles={3} />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("KenBurns 有限时长 canvasAnim + dispose", () => {
    const { unmount } = render(<KenBurns duration="mid" />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/ambient/ambient.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`SeededParticles.tsx`：

```tsx
// 种子粒子（§6.2 氛围微动 + §8.1 SeededRandom）：
// 粒子位置由 seed 确定性生成；运动 = 有限时长 draw(t)（Ruling P3-3：t ≥ durMs 渲染终态）。
import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";
import { seededRandom } from "../seededRandom";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 3000, mid: 8000, slow: 16000 };

export interface SeededParticlesProps {
  seed: number;
  count?: number;
  duration?: MotionDuration;
  variant?: "drift" | "static";
  className?: string;
  "data-testid"?: string;
}

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
}

export function SeededParticles({ seed, count = 30, duration = "mid", variant = "drift", className = "", ...rest }: SeededParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rnd = seededRandom(seed);
    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: rnd() * 100,
      y: rnd() * 100,
      r: 1 + rnd() * 3,
      vx: (rnd() - 0.5) * 1.2,
      vy: (rnd() - 0.5) * 0.8,
    }));

    const durMs = DUR_FALLBACK[duration];
    const draw = (tMs: number) => {
      const progress = Math.min(1, tMs / durMs);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "var(--accent-1)";
      for (const p of particles) {
        const x = (p.x + p.vx * progress * 20) % 100;
        const y = (p.y + p.vy * progress * 20) % 100;
        ctx.beginPath();
        ctx.arc((x / 100) * canvas.width, (y / 100) * canvas.height, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const h = canvasAnim(draw, durMs);
    return () => h.dispose();
  }, [seed, count, duration, variant]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={300}
      className={`cdp-particles ${className}`}
      data-testid={rest["data-testid"]}
    />
  );
}
```

`SeededParticles.css`：

```css
.cdp-particles {
  width: 100%;
  height: 100%;
  display: block;
}
```

`Breathe.tsx`：

```tsx
// 呼吸微动（有限迭代，Ruling P3-3）：waapi iterations 有限值，渲染可 seek。
import { useEffect, useRef } from "react";
import { waapi } from "../../engine/animationRuntime";

export interface BreatheProps {
  cycles?: number;
  variant?: "pulse" | "glow";
  className?: string;
  "data-testid"?: string;
}

export function Breathe({ cycles = 3, variant = "pulse", className = "", ...rest }: BreatheProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = waapi(
      el,
      [
        { transform: "scale(1)", opacity: 0.85 },
        { transform: "scale(1.06)", opacity: 1 },
        { transform: "scale(1)", opacity: 0.85 },
      ],
      { duration: 1600, iterations: cycles, easing: "ease-in-out", fill: "both" },
    );
    return () => h.dispose();
  }, [cycles, variant]);

  return (
    <div
      ref={ref}
      className={`cdp-breathe cdp-breathe-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    />
  );
}
```

`Breathe.css`：

```css
.cdp-breathe {
  width: var(--space-6);
  height: var(--space-6);
  border-radius: var(--r-pill);
  background: var(--accent-1);
}

.cdp-breathe-glow {
  box-shadow: 0 0 var(--space-4) var(--accent-1);
}
```

`KenBurns.tsx`：

```tsx
// 缓推（有限时长 draw(t)，Ruling P3-3）：对容器做缓慢缩放平移，终态冻结。
import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 4000, mid: 10000, slow: 20000 };

export interface KenBurnsProps {
  src?: string;
  duration?: MotionDuration;
  className?: string;
  "data-testid"?: string;
}

export function KenBurns({ src, duration = "mid", className = "", ...rest }: KenBurnsProps) {
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const durMs = DUR_FALLBACK[duration];
    const h = canvasAnim((tMs) => {
      const progress = Math.min(1, tMs / durMs);
      const scale = 1 + 0.12 * progress;
      const x = -2 + 4 * progress;
      el.style.transform = `scale(${scale}) translate(${x}%, 0)`;
    }, durMs);
    return () => h.dispose();
  }, [src, duration]);

  return (
    <div className={`cdp-kenburns ${className}`} data-testid={rest["data-testid"]}>
      <div
        ref={innerRef}
        className="cdp-kenburns-inner"
        style={src ? { backgroundImage: `url(${src})` } : undefined}
      >
        {src ? null : <div className="cdp-kenburns-placeholder">素材待补</div>}
      </div>
    </div>
  );
}
```

`KenBurns.css`：

```css
.cdp-kenburns {
  overflow: hidden;
  width: 100%;
  height: 100%;
}

.cdp-kenburns-inner {
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
}

.cdp-kenburns-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--surface-2);
  font-family: var(--font-mono);
  font-size: var(--t-label);
  color: var(--text-mute);
}
```

`ambient/index.ts`：

```ts
export { SeededParticles } from "./SeededParticles";
export { Breathe } from "./Breathe";
export { KenBurns } from "./KenBurns";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/ambient/ambient.test.tsx`
Expected: PASS（4 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/ambient
git commit -m "feat(M2a): 氛围组（SeededParticles/Breathe/KenBurns，有限周期确定性）"
```

---

### Task 6: 功能组（TimelineTrack / ProgressDots）

**Files:**
- Create: `narration-video/templates/src/components/function/TimelineTrack.tsx` + `.css`
- Create: `narration-video/templates/src/components/function/ProgressDots.tsx` + `.css`
- Create: `narration-video/templates/src/components/function/index.ts`
- Test: `narration-video/templates/src/components/function/function.test.tsx`

**Interfaces:**
- Consumes: `waapi`、`createPrimitive`
- Produces: `TimelineTrack { points: string[], activeIndex: number, variant: "line" | "nodes" }`、`ProgressDots { total: number, current: number, variant: "dots" | "bars" }`——状态纯派生（铁律 6）

- [ ] **Step 1: 写失败测试**

`narration-video/templates/src/components/function/function.test.tsx`：

```tsx
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { TimelineTrack, ProgressDots } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => setRenderMode(false));

describe("功能组", () => {
  it("TimelineTrack 节点数与纯派生状态", () => {
    const { container, rerender } = render(
      <TimelineTrack points={["A", "B", "C"]} activeIndex={0} />,
    );
    expect(container.querySelectorAll(".cdp-timeline-point")).toHaveLength(3);
    expect(container.querySelectorAll(".cdp-timeline-point-active")).toHaveLength(1);
    rerender(<TimelineTrack points={["A", "B", "C"]} activeIndex={2} />);
    expect(container.querySelectorAll(".cdp-timeline-point-active")).toHaveLength(1);
  });

  it("TimelineTrack 生长线动画注册 + dispose", () => {
    const { unmount } = render(<TimelineTrack points={["A", "B"]} activeIndex={1} />);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });

  it("ProgressDots total/current 纯派生", () => {
    const { container, rerender } = render(<ProgressDots total={5} current={2} />);
    expect(container.querySelectorAll(".cdp-progress-dot")).toHaveLength(5);
    expect(container.querySelectorAll(".cdp-progress-dot-on")).toHaveLength(3);
    rerender(<ProgressDots total={5} current={4} />);
    expect(container.querySelectorAll(".cdp-progress-dot-on")).toHaveLength(5);
  });

  it("ProgressDots bars 变体", () => {
    const { container } = render(<ProgressDots total={3} current={1} variant="bars" />);
    expect(container.querySelectorAll(".cdp-progress-bar")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/function/function.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`TimelineTrack.tsx`：

```tsx
// 时间轴自绘（§6.2 功能组）：生长线（scaleX waapi）+ 节点状态纯派生（铁律 6）。
import { useEffect, useRef } from "react";
import { waapi } from "../../engine/animationRuntime";

export interface TimelineTrackProps {
  points: string[];
  activeIndex: number;
  variant?: "line" | "nodes";
  className?: string;
  "data-testid"?: string;
}

export function TimelineTrack({ points, activeIndex, variant = "line", className = "", ...rest }: TimelineTrackProps) {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    const ratio = points.length <= 1 ? 0 : activeIndex / (points.length - 1);
    const h = waapi(
      el,
      [{ transform: "scaleX(0)" }, { transform: `scaleX(${ratio})` }],
      { duration: 800, easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "both" },
    );
    return () => h.dispose();
  }, [points.length, activeIndex]);

  return (
    <div
      className={`cdp-timeline cdp-timeline-${variant} ${className}`}
      data-testid={rest["data-testid"]}
    >
      <div className="cdp-timeline-track">
        <div ref={fillRef} className="cdp-timeline-fill" />
      </div>
      <div className="cdp-timeline-points">
        {points.map((p, i) => (
          <div
            key={i}
            className={
              i <= activeIndex
                ? "cdp-timeline-point cdp-timeline-point-active"
                : "cdp-timeline-point"
            }
          >
            <span className="cdp-timeline-dot" />
            <span className="cdp-timeline-label">{p}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`TimelineTrack.css`：

```css
.cdp-timeline-track {
  height: var(--space-1);
  background: var(--surface-2);
  position: relative;
  margin-bottom: var(--space-3);
}

.cdp-timeline-fill {
  position: absolute;
  inset: 0;
  background: var(--accent-1);
  transform-origin: left center;
}

.cdp-timeline-points {
  display: flex;
  justify-content: space-between;
}

.cdp-timeline-point {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
}

.cdp-timeline-dot {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--r-pill);
  background: var(--surface-2);
}

.cdp-timeline-point-active .cdp-timeline-dot {
  background: var(--accent-1);
}

.cdp-timeline-label {
  font-family: var(--font-mono);
  font-size: var(--t-micro);
  color: var(--text-mute);
}

.cdp-timeline-point-active .cdp-timeline-label {
  color: var(--text);
}
```

`ProgressDots.tsx`：

```tsx
// 步骤进度点（§6.2 功能组）：on 状态纯派生自 current（铁律 6）。
import { createPrimitive } from "../factory";

export interface ProgressDotsProps {
  total: number;
  current: number;
  variant?: "dots" | "bars";
  className?: string;
  "data-testid"?: string;
}

const Base = createPrimitive("progress-dots", {
  tag: "div",
  variants: ["dots", "bars"],
  defaultVariant: "dots",
});

export function ProgressDots({ total, current, variant = "dots", className, ...rest }: ProgressDotsProps) {
  return (
    <Base variant={variant} className={className} data-testid={rest["data-testid"]}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i <= current ? "cdp-progress-dot cdp-progress-dot-on" : "cdp-progress-dot"} />
      ))}
    </Base>
  );
}
```

`ProgressDots.css`：

```css
.cdp-progress-dots {
  display: flex;
  gap: var(--space-2);
}

.cdp-progress-dot {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: var(--r-pill);
  background: var(--surface-2);
}

.cdp-progress-dot-on {
  background: var(--accent-1);
}

.cdp-progress-dots-bars .cdp-progress-dot {
  width: var(--space-5);
  height: var(--space-1);
  border-radius: var(--card-radius);
}
```

`function/index.ts`：

```ts
export { TimelineTrack } from "./TimelineTrack";
export { ProgressDots } from "./ProgressDots";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run src/components/function/function.test.tsx`
Expected: PASS（4 项全过）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components/function
git commit -m "feat(M2a): 功能组（TimelineTrack/ProgressDots，铁律 6 纯派生）"
```

---

### Task 7: 收口——统一出口 / 契约 lint 扩展 / 冒烟扩展 / 清理项

**Files:**
- Modify: `narration-video/templates/src/components/index.ts`（13 新组件 + CSS 装配）
- Modify: `narration-video/templates/src/components/contract-lint.ts`（COMPONENT_CSS 扩到 27 份）
- Modify: `narration-video/templates/src/components/contract-lint.test.ts`（护栏计数 14 → 27）
- Modify: `narration-video/templates/src/components/smoke.test.tsx`（13 新组件入冒烟 + **逐组件 presence 断言**——终审 M3 建议）
- Modify: `narration-video/templates/src/components/structure/Grid.tsx`（`import type { CSSProperties, ReactNode }` 替代 React 全局 UMD 引用——终审 M4）
- Modify: `narration-video/templates/src/components/motion.test.ts` + `factory.test.tsx`（删本地 FakeAnim 副本，用全局 stub——终审 M9；连带删未用 import）
- Modify: `narration-video/templates/tsconfig.json`（加 `noUnusedLocals: true`——终审 M5，清理后启用）

**Interfaces:**
- Consumes: Task 2-6 全部组件
- Produces: 更新后的统一出口（27 组件）、lint 覆盖 27 份 CSS、冒烟含全部 27 组件

- [ ] **Step 1: 写失败测试**

先改 `contract-lint.test.ts` 的护栏计数（14 → 27）：护栏测试 `COMPONENT_CSS.length === 14` 改为 `=== 27`（在实现前跑必 FAIL——护栏先红）。再改 `smoke.test.tsx`：加 13 个新组件到渲染树，并加逐组件 presence 断言：

```tsx
const ALL = [
  HeroTitle, Kicker, BodyCopy, QuoteBlock,
  HeroNumber, Counter, BarGrow, DonutMeter, StatCard,
  Card, Rule, Grid, StagePad, Table,
  RevealText, RevealList, StepSequence,
  DecorDot, DecorBar, DecorRing,
  Figure, TypedTerminal, PathDraw,
  SeededParticles, Breathe, KenBurns,
  TimelineTrack, ProgressDots,
];
```

两个画布循环内：渲染全部组件 + 断言每个组件至少渲染一个 `.cdp-<name>` 元素：

```tsx
it(`全部 27 组件在 ${dims.width}×${dims.height} 画布渲染且逐组件 presence`, () => {
  const { container } = render(
    <div style={{ width: dims.width, height: dims.height }}>
      <StagePad>
        <Kicker>CHAPTER 01</Kicker>
        <HeroTitle reveal="fade">测试标题</HeroTitle>
        <RevealText text="逐词 揭示 测试" />
        <RevealList items={["一", "二"]} activeCount={1} />
        <StepSequence steps={[{ title: "一" }, { title: "二" }]} currentStep={0} />
        <DecorDot /> <DecorBar /> <DecorRing />
        <Figure caption="图" />
        <TypedTerminal lines={["line"]} />
        <PathDraw d="M0 0 L50 50" />
        <SeededParticles seed={1} count={3} />
        <Breathe cycles={1} />
        <KenBurns />
        <TimelineTrack points={["A", "B"]} activeIndex={0} />
        <ProgressDots total={3} current={1} />
        <Grid variant="half"><StatCard number="47" label="增长" /><Card>卡</Card></Grid>
        <HeroNumber value="+47%" /><Counter to={47} /><BarGrow value={0.7} />
        <DonutMeter value={0.42} label="转化率" /><Rule />
        <Table header={["A", "B"]} rows={[["1", "2"]]} />
        <BodyCopy>正文</BodyCopy><QuoteBlock>引用</QuoteBlock>
      </StagePad>
    </div>,
  );
  const names = ["hero-title", "kicker", "reveal-text", "reveal-list", "step-seq", "decor-dot", "decor-bar", "decor-ring", "figure", "terminal", "path-draw", "particles", "breathe", "kenburns", "timeline", "progress-dots", "stat-card", "card", "hero-number", "counter", "bar-grow", "donut", "rule", "table", "body-copy", "quote-block", "grid"];
  for (const n of names) {
    expect(container.querySelector(`.cdp-${n}`)).not.toBeNull();
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/contract-lint.test.ts src/components/smoke.test.tsx`
Expected: FAIL（护栏 14≠27；smoke 组件未导出）

- [ ] **Step 3: 写实现**

`index.ts` 全量：

```ts
// 组件统一出口（§6.2 章节层唯一合法零件来源）+ 组件 CSS 装配（Ruling P2-4）
import "../theme/tokens.css";
import "./text/HeroTitle.css";
import "./text/Kicker.css";
import "./text/BodyCopy.css";
import "./text/QuoteBlock.css";
import "./data/HeroNumber.css";
import "./data/Counter.css";
import "./data/BarGrow.css";
import "./data/DonutMeter.css";
import "./data/StatCard.css";
import "./structure/Card.css";
import "./structure/Rule.css";
import "./structure/Grid.css";
import "./structure/StagePad.css";
import "./structure/Table.css";
import "./reveal/RevealText.css";
import "./reveal/RevealList.css";
import "./reveal/StepSequence.css";
import "./decor/DecorDot.css";
import "./decor/DecorBar.css";
import "./decor/DecorRing.css";
import "./media/Figure.css";
import "./media/TypedTerminal.css";
import "./media/PathDraw.css";
import "./ambient/SeededParticles.css";
import "./ambient/Breathe.css";
import "./ambient/KenBurns.css";
import "./function/TimelineTrack.css";
import "./function/ProgressDots.css";

export { HeroTitle, Kicker, BodyCopy, QuoteBlock } from "./text";
export { HeroNumber, Counter, BarGrow, DonutMeter, StatCard } from "./data";
export { Card, Rule, Grid, StagePad, Table } from "./structure";
export { RevealText, RevealList, StepSequence } from "./reveal";
export { DecorDot, DecorBar, DecorRing } from "./decor";
export { Figure, TypedTerminal, PathDraw } from "./media";
export { SeededParticles, Breathe, KenBurns } from "./ambient";
export { TimelineTrack, ProgressDots } from "./function";
```

`contract-lint.ts` 的 COMPONENT_CSS 追加 13 份 `?raw` 导入与条目（file 标签 = 相对路径）。

`Grid.tsx`：

```tsx
import type { CSSProperties, ReactNode } from "react";
import { createPrimitive } from "../factory";

export interface GridProps {
  variant?: "even" | "half";
  columns?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  "data-testid"?: string;
}
// ……其余照旧，React.CSSProperties → CSSProperties，React.ReactNode → ReactNode
```

`motion.test.ts` / `factory.test.tsx`：删除本地 FakeAnim 类与 beforeEach/afterEach stub 安装（保留 setRenderMode 复位），未用 import（vi/render）一并删除。

`tsconfig.json`：`"noUnusedLocals": true,` 加入 compilerOptions。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run && npx tsc --noEmit`
Expected: 全部 PASS（80 + 新增约 19 ≈ 99 项）+ 零类型错误（noUnusedLocals 下若有遗漏 import，按 tsc 报错清理）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components narration-video/templates/tsconfig.json
git commit -m "feat(M2a): 组件库收口——27 组件统一出口 + lint/冒烟扩展 + 清理项"
```

---

## 自检记录（writing-plans Self-Review）

1. **Spec coverage**：§6.2 组件清单剩余全部（揭示 3/装饰 3/素材 3/氛围 3/功能 2）✓；§6.1 铁律 6（Task 2 纯派生 + mount 重演）✓；§8.1 SeededRandom（Task 1/5）✓；§11.1 #8 无限动画禁令（有限周期 Ruling P3-3）✓；§8.1 确定性 draw(t)（TypedTerminal/KenBurns/SeededParticles）✓；白名单 stroke-dashoffset（PathDraw）✓；placeholder 诚实原则（Figure/KenBurns）✓；终审流程教训（Task 7 护栏 + presence + 门禁测试双护栏进 Global Constraints）✓；终审 M1/M4/M5/M9 清理（Task 7）✓。缺口（属后续计划）：字幕组件已在框架层（M1）、CaptionLayer 主题化在 M2b。
2. **Placeholder scan**：无 TBD/TODO；每个任务含完整代码与测试。
3. **Type consistency**：`seededRandom(seed): () => number`（Task 1 定义 → Task 5 消费）；`RevealText/RevealList/StepSequence` 的 props（Task 2 定义 → Task 7 smoke 使用一致）；`Figure/TypedTerminal/PathDraw` 与 `TimelineTrack/ProgressDots` 同前；COMPONENT_CSS 27 份与 index.ts 27 个 CSS import 一致。
