# M2b creative-mode 首套主题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地首套主题 creative-mode 1:1 还原（§5.4）：动效 token 收敛（I1）→ 字体契约（fontsource 自托管五家族）→ creative-mode 主题值覆盖 tokens.css → 验收（校验器 + 全量测试 + 字体配对用户拍板 + 视觉确认）。

**Architecture:** 主题 = 覆盖一份 tokens.css + theme.json，组件零改动（§5.3 换主题机制——本计划本身就是该承诺的第一次实证）。动效收敛把 7 处硬编码时长改为读 `--dur-*` computed style（I1），使 M2b 覆盖动效 token 时全部组件跟手。

**Tech Stack:** 继承；新增 fontsource 包（@fontsource/archivo-black、space-grotesk、jetbrains-mono、noto-sans-sc、noto-serif-sc）。

**Spec:** `../07-design-draft.md`（§5.4 creative-mode DNA、§5.2 字体契约、§5.1 动效 token、§8.1 SeededRandom 已交付）。

## Global Constraints

- 主题值 1:1 还原 creative-mode 模板 DNA（§5.4）：奶油纸底 #EFE9D9 / 墨黑 #0F0F0F / 四色强调（绿 #1F8A4C 粉 #F06CA8 橙 #E85A1F 黄 #F5C518，绿/粉带 dark）/ Archivo Black + Space Grotesk + JetBrains Mono / 4px 墨框 / 24px 双层硬阴影 / 零渐变零圆角（pill 例外）
- **换主题零改动承诺**：组件代码不动，只覆盖 tokens.css + theme.json
- 动效 token 是唯一时间基准（§5.1）：组件动画时长必须来自 `--dur-fast/mid/slow` 档位（I1）
- 字体契约（§5.2）：声明=加载，fontsource 自托管（大陆可达）；theme.json 声明 fonts
- 已知坑（§5.4）：yellow on cream 对比度 ~1.6:1——黄只作背景色块配墨字，禁作文字色（门禁 #18 兜底）
- 密度纪律（§5.4）：还原视觉语言、不还原 slide deck 信息密度——字阶顶档按口播视频裁剪
- 门禁测试双护栏（终审教训）：验证器测试含负样本 + 非空护栏

**计划裁定（执行时按此）**：
- Ruling M2b-1: 氛围/打字类长时长 = 档位值 × 组件语义系数（KenBurns ×10、SeededParticles ×8、TypedTerminal ×3），系数写组件注释——动效 token 仍是唯一基准，换肤按比例跟手。
- Ruling M2b-2: TimelineTrack 的 800ms 归 "mid" 档（700ms）；Breathe 的 1600ms 归 "slow" 档（1400ms）——三套裸时长消灭。
- Ruling M2b-3: BarGrow 收敛到 waapi 适配器（同时解决 easing 硬编码 + isFinished `>=` 不一致 + dispose cancel 三件事，P2-13 已给适配器 cancel）。
- Ruling M2b-4: 字阶顶档 --t-display-1 从 creative-mode 的 220px 裁到 160px（中文口播标题在 1080p 的密度纪律），其余字阶按模板直映射；对比页验收时用户可调。
- Ruling M2b-5: --decor-family = block（creative-mode 色块语言）；P3-10 的六族形态映射在组件参考卡中随本计划定义（block=矩形色块、stamp=旋转印戳——v1 组件消费 block 形态）。
- Ruling M2b-6: 主强调色 --accent-1 = 森林绿（creative-mode 使用频率最高的强调色；四槽位全启用：绿/粉/橙/黄）。

## File Structure（本计划新建/修改）

```
narration-video/templates/
  package.json                      # +fontsource 五包
  src/components/motion.ts          # export durationMs/readTokenMs（I1）
  src/components/data/*.tsx         # 4 组件 DUR_FALLBACK → token（I1）
  src/components/media/*.tsx        # 2 组件同（I1）
  src/components/function/TimelineTrack.tsx  # 同（I1）
  src/components/ambient/*.tsx      # 2 组件同（I1，系数）
  src/theme/fonts.css               # fontsource 五家族装配（新）
  src/theme/tokens.css              # creative-mode 值全量覆盖
  src/theme/theme.json              # name/mood/fonts 声明
  src/font-preview.html             # 字体配对对比页（用户拍板用，dev 路由）
  src/main.tsx                      # 装配 fonts.css
```

---

### Task 1: I1 收敛——动效 token 驱动全部组件动画

**Files:**
- Modify: `narration-video/templates/src/components/motion.ts`（export `durationMs(el, tier)` 与 `readTokenMs`）
- Modify: `data/HeroNumber.tsx`、`data/Counter.tsx`、`data/BarGrow.tsx`、`data/DonutMeter.tsx`
- Modify: `media/TypedTerminal.tsx`、`media/PathDraw.tsx`
- Modify: `function/TimelineTrack.tsx`
- Modify: `ambient/SeededParticles.tsx`、`ambient/KenBurns.tsx`
- Modify: `ambient/Breathe.tsx`（duration 1600 → durationMs slow）
- Test: 相关测试同步（组件测试不改断言语义，仅实现改）

**Interfaces:**
- Produces: `durationMs(el: Element, tier: MotionDuration): number`（读 --dur-* computed style，fallback fast 300/mid 700/slow 1400——motion 既有 fallback 链）；`readTokenMs` 导出（原私有）
- 组件改动模式：effect 内 `const durMs = durationMs(el, duration);` 替代 DUR_FALLBACK 查表（el 为组件 ref 元素；系数：KenBurns ×10、SeededParticles ×8、TypedTerminal ×3，Ruling M2b-1）

- [ ] **Step 1: 写失败测试**

`motion.test.ts` 补 1 项（负样本护栏风格——验证 durationMs 读 token 而非硬编码）：

```ts
import { durationMs } from "./motion";

it("durationMs 读 --dur-* 计算值（jsdom 无计算值走 fallback 300/700/1400）", () => {
  const el = document.createElement("div");
  expect(durationMs(el, "fast")).toBe(300);
  expect(durationMs(el, "mid")).toBe(700);
  expect(durationMs(el, "slow")).toBe(1400);
});
```

组件测试：各组件测试**零改动**（时长语义不进入既有断言）——RED 通过"durationMs 不存在"达成。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd narration-video/templates && npx vitest run src/components/motion.test.ts`
Expected: FAIL（durationMs 未导出）

- [ ] **Step 3: 写实现**

`motion.ts` 追加：

```ts
/** 从元素计算样式读动效档位时长（ms）。组件动画时长的唯一合法来源（§5.1 动效 token，I1）。 */
export function durationMs(el: Element, tier: MotionDuration): number {
  return readTokenMs(el, DUR_TOKEN[tier], tier === "fast" ? 300 : tier === "mid" ? 700 : 1400);
}

export { readTokenMs };
```

各组件 effect 模式（以 Counter 为例，其余同型）：

```tsx
// 前：const durMs = DUR_FALLBACK[duration];
// 后：
const durMs = durationMs(el, duration);  // el = ref 元素
```

- Counter: `durationMs(el, duration)`（删除 DUR_FALLBACK）
- HeroNumber: 同（countUp 分支）
- TypedTerminal: `durationMs(el, duration) * 3`（打字语义系数，Ruling M2b-1，注释）
- PathDraw: `durationMs(el, duration)`；easing `cubic-bezier(0, 0, 0.2, 1)` → 读 `--ease-out` computed style（`getComputedStyle(el).getPropertyValue("--ease-out").trim() || "cubic-bezier(0,0,0.2,1)"`）
- KenBurns: `durationMs(el, duration) * 10`（氛围系数）
- SeededParticles: `durationMs(el, duration) * 8`（氛围系数）
- TimelineTrack: `durationMs(el, "mid")`（Ruling M2b-2，删 800）
- Breathe: `durationMs(el, "slow")`（Ruling M2b-2，删 1600）
- BarGrow: **收敛到 waapi 适配器**（Ruling M2b-3）——`waapi(el, [{transform:"scaleX(0)"},{transform:`scaleX(${value})`}], { duration: durationMs(el, duration), easing: 读 --ease-out, fill: "both" })`，删除内联 register/isFinished/seek 块（dispose cancel + isFinished `>` 语义随适配器自动一致）
- DonutMeter: `waapi(..., { duration: durationMs(el, duration), easing: 读 --ease-out, ... })`（替换 DUR_FALLBACK + 硬编码 easing）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run && npx tsc --noEmit`
Expected: 全量 114 项过（113+1 新 motion 测试）+ 零类型错误

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates/src/components
git commit -m "feat(M2b): I1 收敛——动效 token 驱动全部组件动画（7 处硬编码消灭）"
```

---

### Task 2: 字体契约——fontsource 五家族 + 对比页

**Files:**
- Modify: `narration-video/templates/package.json`（+5 个 fontsource 包）
- Create: `narration-video/templates/src/theme/fonts.css`
- Create: `narration-video/templates/src/font-preview.html`
- Modify: `narration-video/templates/src/main.tsx`（装配 fonts.css）
- Modify: `narration-video/templates/src/theme/theme.json`（fonts 声明字段）

**Interfaces:**
- Produces: 五家族可用（Archivo Black / Space Grotesk / JetBrains Mono / Noto Sans SC 900 / Noto Serif SC 900）；对比页（dev 打开 `/#font-preview` 或独立路由）供用户拍板中文配对

- [ ] **Step 1: 安装字体包**

Run: `cd narration-video/templates && npm install --no-audit --no-fund @fontsource/archivo-black @fontsource/space-grotesk @fontsource/jetbrains-mono @fontsource/noto-sans-sc @fontsource/noto-serif-sc`
Expected: 5 包入 dependencies + lockfile 更新（若 npm cache EACCES 用 `--cache /tmp/npm-cache-m2b`）

- [ ] **Step 2: 写 fonts.css**

```css
/* 字体契约（§5.2）：声明=加载，fontsource 自托管（大陆可达）。
   五家族：Archivo Black（拉丁标题）/ Space Grotesk（正文）/ JetBrains Mono（标签）
   / Noto Sans SC 900 + Noto Serif SC 900（中文标题候选，用户拍板后四坑位定稿）。 */
@import "@fontsource/archivo-black/index.css";
@import "@fontsource/space-grotesk/400.css";
@import "@fontsource/space-grotesk/600.css";
@import "@fontsource/jetbrains-mono/400.css";
@import "@fontsource/noto-sans-sc/900.css";
@import "@fontsource/noto-serif-sc/900.css";
```

`main.tsx` 顶部加 `import "./theme/fonts.css";`（tokens.css 由 components/index.ts 装配——fonts 与 theme 同级，直接 main 装配）。

- [ ] **Step 3: 写对比页**

`narration-video/templates/src/font-preview.html`（Vite 多入口？不——用一个路由参数更简单）：在 App 里加 dev-only 分支（`?font-preview=1` 时渲染对比页组件，替换正常 Stage）。实现：

```tsx
// main.tsx 顶部：font-preview 模式短路
const params = new URLSearchParams(window.location.search);
if (params.has("font-preview")) {
  import("./FontPreview").then(({ FontPreview }) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(<FontPreview />);
  });
} else {
  // 正常 App 渲染
}
```

`src/FontPreview.tsx`（新文件）：

```tsx
// 字体配对对比页（M2b 用户拍板用；dev-only，不入章节层）
export function FontPreview() {
  const sample = "口播视频 从稿子到成片";
  return (
    <div style={{ padding: 48, fontFamily: "sans-serif" }}>
      <h1>中文标题字体配对对比（creative-mode 主题）</h1>
      <div style={{ display: "flex", gap: 64 }}>
        <div>
          <div style={{ fontFamily: '"Noto Sans SC"', fontWeight: 900, fontSize: 72 }}>{sample}</div>
          <p>A. Noto Sans SC 900（黑体）——现代、中性、与 Archivo Black 同气质</p>
        </div>
        <div>
          <div style={{ fontFamily: '"Noto Serif SC"', fontWeight: 900, fontSize: 72 }}>{sample}</div>
          <p>B. Noto Serif SC 900（宋体）——模板官方 CJK 指引推荐，重体宋最接近海报黑体密度</p>
        </div>
      </div>
      <p style={{ marginTop: 48 }}>判定标准：与 Archivo Black 大标题并置时的密度协调度（见下方混合排版）。</p>
      <div style={{ fontFamily: '"Archivo Black"', fontSize: 96 }}>CREATIVE MODE</div>
      <div style={{ fontFamily: '"Noto Sans SC"', fontWeight: 900, fontSize: 96 }}>创意模式</div>
      <div style={{ fontFamily: '"Noto Serif SC"', fontWeight: 900, fontSize: 96 }}>创意模式</div>
    </div>
  );
}
```

> 注：M2b 验收（Task 4）时用户浏览器打开 `npm run dev` 后访问 `?font-preview=1` 拍板；本任务只做页面，不做决策。

`theme.json` 加 fonts 声明：

```json
{
  "name": "m2a-neutral-placeholder",
  "fonts": {
    "declared": [
      { "family": "Archivo Black", "source": "@fontsource/archivo-black" },
      { "family": "Space Grotesk", "source": "@fontsource/space-grotesk" },
      { "family": "JetBrains Mono", "source": "@fontsource/jetbrains-mono" },
      { "family": "Noto Sans SC", "source": "@fontsource/noto-sans-sc", "weights": [900] },
      { "family": "Noto Serif SC", "source": "@fontsource/noto-serif-sc", "weights": [900] }
    ]
  }
}
```

- [ ] **Step 4: 验证**

Run: `cd narration-video/templates && npx vitest run && npx tsc --noEmit && npx vite build`
Expected: 全量 114 项过 + 零类型错误 + build 通过（vite build 验证 fontsource CSS import 装配正确）

- [ ] **Step 5: Commit**

```bash
git add narration-video/templates
git commit -m "feat(M2b): 字体契约——fontsource 五家族自托管 + 配对对比页"
```

---

### Task 3: creative-mode 主题值覆盖

**Files:**
- Modify: `narration-video/templates/src/theme/tokens.css`（全量覆盖）
- Modify: `narration-video/templates/src/theme/theme.json`（name/mood/描述）
- Test: `theme/theme-validate.test.ts` 的 VALID_CSS 与 REQUIRED_TOKENS 断言保持（校验器不变，值变）

**Interfaces:**
- Consumes: 字体配对结果（Task 4 用户拍板后回填 --font-display-cn；本任务先用 Sans 占位，拍板后一行覆盖）

- [ ] **Step 1: 跑基线**

Run: `cd narration-video/templates && npx vitest run src/theme/theme-validate.test.ts src/theme/closure.test.ts`
Expected: 现有测试过（值覆盖前基线）

- [ ] **Step 2: 写实现——tokens.css 覆盖**

关键映射（§5.4 DNA → 槽位）：

```css
:root {
  /* ── 基础 · 色（creative-mode 1:1） ── */
  --surface: #efe9d9;          /* cream */
  --surface-2: #e4dcc4;        /* cream-2 */
  --surface-3: #0f0f0f;        /* ink */
  --text: #0f0f0f;             /* ink */
  --text-2: #2a2a2a;           /* ink-2 */
  --text-mute: #5c574c;
  --text-faint: #8f897c;
  /* 四色强调（Ruling M2b-6：accent-1=森林绿） */
  --accent-1: #1f8a4c;         /* green */
  --accent-1-dark: #136636;
  --accent-2: #f06ca8;         /* pink */
  --accent-2-dark: #d14e8b;
  --accent-3: #e85a1f;         /* orange */
  --accent-4: #f5c518;         /* yellow */
  --rule: #0f0f0f;
  --shell: #0b0b0b;

  /* ── 阴影语言：24px 双层硬偏移（§5.4 修正 3） ── */
  --shadow-card: 24px 24px 0 var(--accent-3), 24px 24px 0 4px var(--surface-3);
  --shadow-stage: 0 8px 40px rgba(0, 0, 0, 0.35);

  /* ── 字阶（creative-mode 直映射；顶档按 Ruling M2b-4 裁剪） ── */
  --t-display-1: 160px;
  --t-display-2: 96px;
  --t-h1: 84px;
  --t-h2: 56px;
  --t-h3: 40px;
  --t-body: 28px;
  --t-label: 24px;
  --t-micro: 18px;

  /* ── 间距（creative-mode 96/64/28/32 体系） ── */
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 48px;
  --space-6: 64px;
  --grid-gutter: 28px;
  --stage-pad-x: 96px;
  --stage-pad-y: 64px;

  /* ── 动效（利落性格；--ease-emph 保持无过冲强缓出） ── */
  --dur-fast: 300ms;
  --dur-mid: 700ms;
  --dur-slow: 1400ms;
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-emph: cubic-bezier(0.16, 1, 0.3, 1);
  --stagger: 120ms;

  /* ── 语义 · 卡片（4px 墨框 + 零圆角） ── */
  --card-bg: var(--surface);
  --card-border: 4px solid var(--text);
  --card-radius: 0px;
  --r-card: 0px;
  --r-pill: 999px;
  --border-w: 4px;

  /* ── 语义 · 表格（4px 外框 + 3px 行线 + 墨底表头） ── */
  --table-border: 3px solid var(--text);
  --table-head-bg: var(--surface-3);
  --table-zebra: var(--surface-2);

  /* ── 语义 · 分割线 ── */
  --rule-w: 4px;
  --rule-style: solid;

  /* ── 语义 · 徽章（墨底奶油字） ── */
  --badge-bg: var(--surface-3);
  --badge-text: var(--surface);

  /* ── 语义 · 大数字（Archivo Black 性格） ── */
  --hero-num-font: var(--font-display-en);
  --hero-num-weight: 400;
  --hero-num-track: 0em;

  /* ── 语义 · 装饰语言（Ruling M2b-5：色块族） ── */
  --decor-family: block;

  /* ── 语义 · 字幕（墨底奶油字，零圆角贴边） ── */
  --caption-bg: rgba(15, 15, 15, 0.85);
  --caption-text: #efe9d9;
  --caption-radius: 0px;
  --caption-size: 30px;

  /* ── 字体四坑位（display-cn 待 Task 4 拍板回填，暂 Sans 900） ── */
  --font-display-cn: "Noto Sans SC", "PingFang SC", sans-serif;
  --font-display-en: "Archivo Black", "Arial Black", sans-serif;
  --font-body: "Space Grotesk", "PingFang SC", sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", monospace;
}
```

> 注意：css 中 font-weight 900 由 fonts.css 的 900 字重文件提供——tokens.css 只声明家族名；组件中 `font-weight: 900` 与字重文件匹配。若最终选 Serif，`--font-display-cn` 一行改 `"Noto Serif SC"`。

`theme.json`：

```json
{
  "name": "creative-mode",
  "nameZh": "创意模式",
  "mood": "graphic / confident / playful——Bauhaus 网格 + 朋克杂志 + 瑞士编辑",
  "bestFor": "设计导向的口播：科技 talk、创意解说、产品发布（四色强调 + 硬阴影的宣言感）",
  "fonts": { "declared": [ ...同上 Task 2... ] }
}
```

- [ ] **Step 3: 跑测试确认通过**

Run: `cd narration-video/templates && npx vitest run && npx tsc --noEmit`
Expected: 全量 114 项过（closure 测试会用真实 tokens.css 校验 61 必填 token 全定义 + 组件 var() 引用闭合——**换主题零改动的机器验证**）+ 零类型错误

- [ ] **Step 4: Commit**

```bash
git add narration-video/templates/src/theme
git commit -m "feat(M2b): creative-mode 主题值（四色强调/4px 墨框/硬阴影/色块装饰）"
```

---

### Task 4: 验收——用户字体拍板 + 视觉确认

**Files:**
- 按用户拍板修改: `narration-video/templates/src/theme/tokens.css`（--font-display-cn 一行）
- 可能: `src/FontPreview.tsx`（拍板反馈）

**这是用户 gate 任务**（SDD 流程暂停点）：
1. 控制器向用户报告：主题已落地，`npm run dev` 打开 `?font-preview=1` 看配对对比 + 打开主页面看样例章节在 creative-mode 下的效果
2. 用户拍板 Sans/Serif → 一行覆盖 --font-display-cn
3. 用户视觉确认主题（换肤验收 = §5.3 主题验收机制的首次执行）→ 定稿

- [ ] **Step 1: 用户拍板字体配对**（控制器向用户呈现，等答复）
- [ ] **Step 2: 按拍板覆盖 --font-display-cn**
- [ ] **Step 3: 全量验证**

Run: `cd narration-video/templates && npx vitest run && npx tsc --noEmit && npx vite build`
Expected: 全绿 + 零错误 + build 过

- [ ] **Step 4: Commit**

```bash
git add narration-video/templates/src/theme
git commit -m "feat(M2b): 中文字体配对定稿（<用户选择>）"
```

---

## 自检记录（writing-plans Self-Review）

1. **Spec coverage**：§5.4 DNA 全维度（色/字/间距/阴影/边框/装饰/字幕/动效性格）✓；§5.2 字体契约（声明=加载 + fontsource）✓；§5.3 换主题零改动（本计划实证 + closure 测试机器验证）✓；I1（动效 token 唯一基准）✓；§5.4 已知坑（yellow 不作文字色——组件层无 yellow 文字用途，门禁 #18 兜底）✓；§5.3 主题验收机制首次执行 ✓。缺口：主题画廊 HTML（设计 Phase 0 机制）依赖 M4 截图模块，v1 单主题用 dev 预览代替（设计已注明退化）。
2. **Placeholder scan**：Task 4 的用户 gate 是流程节点非占位符；无 TBD。
3. **Type consistency**：`durationMs(el, tier)`（Task 1 定义 → 9 组件消费一致）；`readTokenMs` 导出后 motion 内部与外部使用一致；fonts 声明字段与 Task 2 写入一致。
