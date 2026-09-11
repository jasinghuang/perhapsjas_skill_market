/**
 * collectors：无头门禁的**页面侧收集器**（M3b Task 7 建面，Task 8 追加三个）。
 *
 * ## 为什么收集器是"源码字符串"而不是真函数（本计划的硬约束，不是风格偏好）
 *
 * tsx 用 esbuild 且**硬编码 `keepNames: true`**（`node_modules/tsx/dist/*.mjs`，CLI 无开关可关）：
 * 函数体内的**具名函数表达式 / 赋给 const 的箭头**会被改写成 `__name(…)` 调用。若把这样一个
 * 真函数交给 `page.evaluate(fn, args)`，Playwright 用 `fn.toString()` 把源码序列化进浏览器——
 * 而浏览器里没有 `__name` → **`ReferenceError: __name is not defined`，`npm run check` 真机必崩**。
 * 而 **vitest 不做 keepNames**，进程内单测全绿也发现不了（"测试通过、交付件必崩"的陷阱）。
 *
 * 故本模块把收集器做成 `String.raw` 模板里的**源码文本**：esbuild 看不见它的内容，注入物无从产生；
 * 调用侧一律 `page.evaluate("(" + SRC + ")(" + JSON.stringify(args) + ")")`。
 *   · 推论一：源码串内**不得出现反引号与 `${`**（否则 String.raw 模板被截断/插值）——
 *     串内一律用字符串拼接，不写模板字面量（collectors.test.ts 钉死）。
 *   · 推论二：Node 侧用 `fromSrc`（`new Function("return (" + src + ")")()`）取**同一份文本**
 *     的实现做单测——两侧跑同一文本，不存在"测的是一份、跑的是另一份"。
 *
 * ## 本任务落的收集器（#16 第②条：被画布截断 → blocker）
 *
 * `COLLECT_OVERFLOW_SRC`：页面级溢出（documentElement 滚动面 > 视口）+ 元素级被画布截断。
 * **元素级的完整口径归 Task 8**（更细的排除面），本任务只落"能跑通 + 非空护栏"的最小面，
 * 但最小面也必须有判别力：真机负样本（`left:-200` 的含文本元素）必须报出来
 * （Step 5 真机正反样本逐条取证）。
 *
 * 关键取舍：
 *  1. **画布根 = `[data-testid="stage-frame"]`**（Stage.tsx 的稳定钩子；1920×1080 舞台，其
 *     `overflow:hidden` 就是"截断者"本体）。找不到画布根 → `examined === 0` + blocker
 *     ——收集器没有任何可检查的面（非空护栏）；**步级零元素是合法态**（该步没有子元素不报）。
 *  2. **裁剪祖先内的越界不报**（反向护栏）：`overflow:hidden` 祖先（KenBurns 放大内层、
 *     自绘图表裁切）里的元素越出画布是**设计**，不是内容被截断——不排除它，任何 scale 动画
 *     都会变成假 blocker。
 *  3. **可见性先于几何**：零矩形（display:none / 空盒子）与 `visibility:hidden` 的元素不作为
 *     截断候选（不可见的内容谈不上"被裁掉"）。
 *  4. **容差 `tolerancePx`（默认 1）**：布局取整的亚像素差不得制造假 blocker。
 *  5. **量化输出**（Global Constraints）：每条 finding 带 px 数值，报告可直接对照修改。
 */

/** 收集器 finding 的分级（比 FindingBag 多一档 info：不可判定/环境噪音，计数但不进退出码）。 */
export type CollectorSeverity = "blocker" | "warning" | "info";

/** 收集器的 finding（结构对齐 src 侧 Finding，多一档 info；severity 的取舍见 headless.ts）。 */
export interface CollectorFinding {
  rule: string;
  severity: CollectorSeverity;
  location: string;
  message: string;
}

/** 收集器返回值：findings + examined（非空护栏的计数面——收集器级 `examined === 0` → blocker）。 */
export interface CollectorResult {
  findings: CollectorFinding[];
  examined: number;
}

/** 画布根选择器（Stage.tsx 的 stage-frame；`stageConfig.dims` 就是它的尺寸）。 */
export const STAGE_SELECTOR = '[data-testid="stage-frame"]';

/** 元素级截断的规则名（§11.1 #16 第②条：被画布截断 → blocker）。 */
export const OVERFLOW_RULE = "被画布截断";

/** 页面级溢出的规则名（documentElement 滚动面 > 视口）。 */
export const PAGE_OVERFLOW_RULE = "页面溢出";

/**
 * 页面侧收集器（`function (args) { … }` 源码文本）——参数/返回：
 *   args = { canvasSelector?: string; tolerancePx?: number }
 *   → { findings: CollectorFinding[]; examined: number }
 * 串内不写模板字面量（见文件头推论一）。
 */
export const COLLECT_OVERFLOW_SRC = String.raw`function (args) {
  var opts = args || {};
  var canvasSelector =
    typeof opts.canvasSelector === "string" && opts.canvasSelector !== ""
      ? opts.canvasSelector
      : '[data-testid="stage-frame"]';
  var tolerancePx = typeof opts.tolerancePx === "number" ? opts.tolerancePx : 1;
  var findings = [];
  var examined = 0;

  function push(rule, severity, location, message) {
    findings.push({ rule: rule, severity: severity, location: location, message: message });
  }

  function describe(el) {
    var out = el.tagName ? el.tagName.toLowerCase() : "?";
    if (el.id) out += "#" + el.id;
    var testid = el.getAttribute ? el.getAttribute("data-testid") : null;
    if (testid) out += "[data-testid=" + testid + "]";
    if (!el.id && !testid && el.classList && el.classList.length > 0) {
      out += "." + el.classList[0];
    }
    return out;
  }

  function isClipValue(v) {
    return v === "hidden" || v === "clip" || v === "auto" || v === "scroll";
  }

  function clips(el) {
    var st = getComputedStyle(el);
    return isClipValue(st.overflow) || isClipValue(st.overflowX) || isClipValue(st.overflowY);
  }

  function isInvisible(el) {
    var st = getComputedStyle(el);
    return st.visibility === "hidden" || st.visibility === "collapse" || st.display === "none";
  }

  var canvas = document.querySelector(canvasSelector);
  if (!canvas) {
    // 非空护栏：没有画布根 = 收集器什么都没检查（页面未挂载 / 选择器与页面失配）。
    push(
      "被画布截断",
      "blocker",
      canvasSelector,
      "未找到画布根（" + canvasSelector + "）——收集器没有可检查的面（非空护栏）：" +
        "页面未挂载、?render=1 下 Stage 未渲染，或选择器与页面结构失配"
    );
    return { findings: findings, examined: examined };
  }

  // ① 页面级溢出：文档滚动面超出视口（右/下向的溢出才会长大 scrollWidth/Height）
  var de = document.documentElement;
  if (de) {
    var overX = de.scrollWidth - window.innerWidth;
    var overY = de.scrollHeight - window.innerHeight;
    if (overX > tolerancePx || overY > tolerancePx) {
      push(
        "页面溢出",
        "blocker",
        "documentElement",
        "文档滚动面超出视口：横向 " + Math.round(overX) + "px（scrollWidth " + de.scrollWidth +
          " > 视口 " + window.innerWidth + "）、纵向 " + Math.round(overY) + "px（scrollHeight " +
          de.scrollHeight + " > 视口 " + window.innerHeight + "）——页面级溢出：必有内容落在画布之外"
      );
    }
  }

  // ② 元素级：越出画布且**没有被裁剪祖先承接**的可见元素 = 内容被画布裁掉
  var canvasRect = canvas.getBoundingClientRect();
  var nodes = canvas.querySelectorAll("*");
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    examined++;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // 未布局/空盒子
    var dl = canvasRect.left - r.left;
    var dr = r.right - canvasRect.right;
    var dt = canvasRect.top - r.top;
    var db = r.bottom - canvasRect.bottom;
    var over = Math.max(dl, dr, dt, db);
    if (!(over > tolerancePx)) continue; // 含 NaN 兜底：NaN 比较为 false → 视为不越界
    if (isInvisible(el)) continue;
    var clipped = false;
    for (var p = el.parentElement; p && p !== canvas; p = p.parentElement) {
      if (clips(p)) {
        clipped = true;
        break;
      }
    }
    if (clipped) continue; // 裁剪祖先已显式承接：越出画布是设计（如放大内层）
    var edges = [];
    if (dl > tolerancePx) edges.push("左 " + Math.round(dl) + "px");
    if (dr > tolerancePx) edges.push("右 " + Math.round(dr) + "px");
    if (dt > tolerancePx) edges.push("上 " + Math.round(dt) + "px");
    if (db > tolerancePx) edges.push("下 " + Math.round(db) + "px");
    push(
      "被画布截断",
      "blocker",
      describe(el),
      "元素越出画布（" + edges.join("、") + "，画布 " + Math.round(canvasRect.width) + "×" +
        Math.round(canvasRect.height) + "）——画布的 overflow:hidden 会把落在框外的内容裁掉，" +
        "观众看不到；请把元素移回画布内（或让最近的定位祖先显式裁剪承接）"
    );
  }

  return { findings: findings, examined: examined };
}`;

/**
 * 源码串 → 可调用实现（Node 侧单测用；与浏览器侧**同一份文本**）。
 * 说明：这里刻意不用模板字面量拼串——保持与页面侧调用同型（`"(" + src + ")"`）。
 */
export function fromSrc<T>(src: string): T {
  return new Function("return (" + src + ")")() as T;
}
