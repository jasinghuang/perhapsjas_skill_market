// M4 Task 3 分镜页生成（纯函数 renderStoryboardHtml）——自包含离线页：每帧 = 截图
// （相对引用 shots/<chapterId>/<step>.png）+ 口播文本 + 音频实测时长 + 停留垫 + 停留时长 +
// 主导动画词汇 + ambient note（Ruling M4-2）+ 门禁判定徽标。
//
// 关键取舍（实现者报告）：
//   1. **纯字符串生成、零外链**：离线双击可开（分镜页在 Checkpoint 2 人审时从磁盘打开）——
//      不引 tokens.css / 字体 / 脚本；配色是 tokens.css 的 hex 快照（见 data.ts
//      STORYBOARD_THEME 与 THEME_SNAPSHOT_NOTE 声明），不随主题切换变化。
//   2. **诚实降级**：无音频 → "未合成音频（Phase 2 后回正）"；停留时长随之 n/a（不拿停留垫
//      冒充步长）；空 narration 步另标"无声过场（无音频）"。分镜页不显示任何估算值。
//   3. **门禁结论上页**：blocker 红条 + 逐帧徽标（通过/已声明氛围/报红）——Checkpoint 2
//      人审时一眼看到哪一帧违规；警告（如 durations 条目数对不上）另列，不与门禁混淆。
//   4. **全字段转义**：narration / 标注都来自作者手写文本，含 < > & " 时按 HTML 转义
//      （分镜页不是注入面）。
//   5. **无时间戳**：产出对同一输入逐字节稳定（便于 diff 与"未变即未变"的判断）。

import {
  AUDIO_MISSING_TEXT,
  SILENT_STEP_TEXT,
  STEP_MS_MISSING_TEXT,
  STORYBOARD_THEME,
  THEME_SNAPSHOT_NOTE,
  VOCAB_MISSING_TEXT,
  frameLocation,
  hasBlockers,
  type FrameGate,
  type StoryboardData,
  type StoryboardFrame,
} from "./data";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 音频字段文案（音频缺失的两种情形分开说——"未合成"与"本来就无声"不是一回事）。 */
function audioText(f: StoryboardFrame): string {
  if (f.audioMs !== null) {
    return `${(f.audioMs / 1000).toFixed(2)}s（${f.audioMs}ms）`;
  }
  return f.narration.trim() === "" ? SILENT_STEP_TEXT : AUDIO_MISSING_TEXT;
}

/** 停留时长字段文案（= 音频实测 + 停留垫；音频缺失时不给估算）。 */
function stepMsText(f: StoryboardFrame): string {
  return f.stepMs === null ? STEP_MS_MISSING_TEXT : `${f.stepMs}ms`;
}

const GATE_LABEL: Record<FrameGate, string> = {
  pass: "通过",
  ambient: "氛围（已声明）",
  blocker: "报红",
};

function gateBadge(f: StoryboardFrame): string {
  if (f.gate === null) return `<span class="badge badge-unknown">未捕获</span>`;
  const count = f.animations === null ? "" : ` · 动画计数 ${f.animations}`;
  return `<span class="badge badge-${f.gate}">${GATE_LABEL[f.gate]}${escapeHtml(count)}</span>`;
}

function findingLines(data: StoryboardData): string {
  if (data.findings.length === 0) return "";
  const items = data.findings
    .map(
      (f) =>
        `<li class="finding finding-${f.severity}">` +
        `<span class="tag">[${f.severity}]</span> ` +
        `<span class="loc">${escapeHtml(f.location)}</span> ` +
        `<span class="msg">${escapeHtml(f.message)}</span></li>`,
    )
    .join("\n      ");
  // 报红程度按实际分级：只有 note 时不该是红框（误导读者以为门禁未过）
  const tone = hasBlockers(data) ? "panel-blockers" : "panel-notes";
  return `<section class="panel panel-findings ${tone}">
    <h2>门禁结论</h2>
    <ul>
      ${items}
    </ul>
  </section>`;
}

function warningLines(data: StoryboardData): string {
  if (data.warnings.length === 0) return "";
  const items = data.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("\n      ");
  return `<section class="panel panel-warnings">
    <h2>数据警告（不阻塞产出）</h2>
    <ul>
      ${items}
    </ul>
  </section>`;
}

function frameHtml(f: StoryboardFrame): string {
  const ambient =
    f.ambient === null
      ? ""
      : `<p class="ambient"><span class="k">氛围声明</span>${escapeHtml(f.ambient)}</p>`;
  const narration =
    f.narration.trim() === ""
      ? `<p class="narration narration-empty">（空 narration——无声过场）</p>`
      : `<p class="narration">${escapeHtml(f.narration)}</p>`;
  return `<figure class="frame" id="frame-${escapeHtml(f.chapterId)}-${f.step}">
      <img src="${escapeHtml(f.shot)}" alt="${escapeHtml(frameLocation(f))} 静态分镜" width="1920" height="1080" loading="lazy" />
      <figcaption>
        <div class="frame-head">
          <span class="where">${escapeHtml(frameLocation(f))}</span>
          ${gateBadge(f)}
        </div>
        ${narration}
        <dl class="meta">
          <div><dt>音频实测</dt><dd>${escapeHtml(audioText(f))}</dd></div>
          <div><dt>停留垫</dt><dd>${f.dwellMs}ms</dd></div>
          <div><dt>停留时长</dt><dd>${escapeHtml(stepMsText(f))}</dd></div>
          <div><dt>主导动画词汇</dt><dd>${escapeHtml(f.animationVocab ?? VOCAB_MISSING_TEXT)}</dd></div>
        </dl>
        ${ambient}
      </figcaption>
    </figure>`;
}

/** 章节分组渲染（帧序 = manifest 章节序 × 步序，与截图/JSON 一致）。 */
function chapterSections(data: StoryboardData): string {
  const order: string[] = [];
  const byChapter = new Map<string, StoryboardFrame[]>();
  for (const f of data.frames) {
    const list = byChapter.get(f.chapterId);
    if (list === undefined) {
      byChapter.set(f.chapterId, [f]);
      order.push(f.chapterId);
    } else list.push(f);
  }
  return order
    .map((id) => {
      const frames = byChapter.get(id)!;
      const chapter = frames[0].chapter;
      return `<section class="chapter">
    <h2 class="chapter-head">章节 ${chapter} · ${escapeHtml(id)} <span class="chapter-meta">${frames.length} 帧</span></h2>
    ${frames.map(frameHtml).join("\n    ")}
  </section>`;
    })
    .join("\n  ");
}

/**
 * 分镜页 HTML（自包含离线页）。
 * 结构：页头（帧数/章节数/门禁计数/主题快照声明）→ 门禁结论 → 数据警告 → 逐章逐帧。
 */
export function renderStoryboardHtml(data: StoryboardData): string {
  const t = STORYBOARD_THEME;
  const blockers = data.findings.filter((f) => f.severity === "blocker").length;
  const notes = data.findings.filter((f) => f.severity === "note").length;
  const chapterCount = new Set(data.frames.map((f) => f.chapterId)).size;
  const blocked = hasBlockers(data);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>静态分镜 · storyboard</title>
<style>
:root {
  --cream: ${t.cream};
  --cream-2: ${t.cream2};
  --ink: ${t.ink};
  --ink-2: ${t.ink2};
  --muted: ${t.muted};
  --faint: ${t.faint};
  --accent: ${t.accent};
  --pass: ${t.pass};
  --blocker: ${t.blocker};
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 48px 24px 96px;
  background: var(--cream);
  color: var(--ink);
  font-family: "Helvetica Neue", Helvetica, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.6;
}
.wrap { max-width: 1180px; margin: 0 auto; }
h1 { font-size: 40px; line-height: 1.1; margin: 0 0 8px; letter-spacing: -0.01em; }
h2 { font-size: 20px; margin: 0 0 12px; }
.head-sub { color: var(--muted); margin: 0 0 4px; }
.head-theme { color: var(--faint); font-size: 13px; margin: 0 0 24px; }
.head-line { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 16px; }
.pill {
  display: inline-block; padding: 4px 12px; border: 2px solid var(--ink);
  background: var(--cream-2); font-size: 14px; font-weight: 700;
}
.pill-blocker { background: var(--blocker); border-color: var(--blocker); color: var(--cream); }
.pill-ok { background: var(--pass); border-color: var(--pass); color: var(--cream); }
.panel { border: 2px solid var(--ink); background: var(--cream-2); padding: 16px 20px; margin: 0 0 24px; }
.panel h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.04em; }
.panel ul { margin: 0; padding-left: 20px; }
.panel li { margin: 4px 0; }
.panel-findings.panel-blockers { border-color: var(--blocker); }
.panel-findings.panel-notes { border-color: var(--accent); }
.finding .tag { font-weight: 700; }
.finding-blocker .tag { color: var(--blocker); }
.finding-note .tag { color: var(--muted); }
.finding .loc { font-weight: 700; }
.panel-warnings { border-color: var(--accent); }
.chapter { margin: 40px 0 0; }
.chapter-head { border-bottom: 4px solid var(--ink); padding-bottom: 8px; }
.chapter-meta { color: var(--muted); font-weight: 400; font-size: 14px; }
.frame { margin: 24px 0 40px; background: var(--cream-2); border: 2px solid var(--ink); box-shadow: 8px 8px 0 var(--accent); }
.frame img { display: block; width: 100%; height: auto; border-bottom: 2px solid var(--ink); background: var(--ink); }
.frame figcaption { padding: 16px 20px 20px; }
.frame-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.where { font-weight: 700; font-size: 18px; }
.badge { font-size: 13px; font-weight: 700; padding: 2px 10px; border: 2px solid var(--ink); }
.badge-pass { background: var(--pass); border-color: var(--pass); color: var(--cream); }
.badge-ambient { background: var(--accent); border-color: var(--accent); color: var(--cream); }
.badge-blocker { background: var(--blocker); border-color: var(--blocker); color: var(--cream); }
.badge-unknown { background: var(--cream); color: var(--muted); }
.narration { font-size: 22px; line-height: 1.4; margin: 0 0 12px; }
.narration-empty { color: var(--faint); font-style: italic; font-size: 18px; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px 24px; margin: 0; padding: 12px 0 0; border-top: 2px solid var(--ink); }
.meta div { display: flex; gap: 8px; align-items: baseline; }
.meta dt { color: var(--muted); font-size: 13px; min-width: 96px; }
.meta dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
.ambient { margin: 12px 0 0; padding: 8px 12px; background: var(--cream); border-left: 6px solid var(--accent); font-size: 14px; }
.ambient .k { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.foot { margin-top: 48px; color: var(--faint); font-size: 13px; border-top: 2px solid var(--ink); padding-top: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>静态分镜</h1>
    <p class="head-sub">${data.frames.length} 帧 · ${chapterCount} 个章节 · Phase 3 静态终态（零动画；氛围微动逐帧声明）</p>
    <p class="head-theme">${escapeHtml(THEME_SNAPSHOT_NOTE)}</p>
    <div class="head-line">
      <span class="pill ${blocked ? "pill-blocker" : "pill-ok"}">门禁 ${blocked ? "未通过" : "通过"}</span>
      <span class="pill">blocker ${blockers}</span>
      <span class="pill">note ${notes}</span>
      <span class="pill">数据警告 ${data.warnings.length}</span>
    </div>
  </header>
  ${findingLines(data)}
  ${warningLines(data)}
  ${chapterSections(data)}
  <p class="foot">由 <code>npm run storyboard</code> 生成（离线自包含页；截图相对引用 shots/，可整目录拷贝）。停留时长 = 音频实测 + 停留垫（分镜阶段 animMs 恒 0，渲染阶段再计入动画窗口）。</p>
</div>
</body>
</html>
`;
}
