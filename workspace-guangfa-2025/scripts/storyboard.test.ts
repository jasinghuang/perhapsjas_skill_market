// M4 Task 3 双护栏单测：① 分镜数据组装（buildStoryboardData + 门禁语义，Ruling M4-2）
// ② 分镜页生成（renderStoryboardHtml）③ verify-sequential 的纯函数面（字节比对 + 结论汇总）。
//
// 浏览器路径（captureSteps / verifySequential 的驱动部分）不在本文件——那是冒烟与
// M5/M3b 的事务；此处只钉住可在 vitest 里确定性复现的纪律：字段计算、降级语义、
// 门禁正反样本、HTML 必需元素与转义。

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shotPath } from "./shot/capture";
import {
  ambientKey,
  compareShotBytes,
  summarizeVerification,
  type VerifyVerdict,
} from "./shot/verify-sequential";
import {
  AUDIO_MISSING_TEXT,
  LOCAL_THEME_KEYS,
  SILENT_STEP_TEXT,
  STEP_MS_MISSING_TEXT,
  STORYBOARD_THEME,
  THEME_SNAPSHOT_NOTE,
  THEME_TOKEN_MAP,
  VOCAB_MISSING_TEXT,
  ambientExemptKeys,
  buildStoryboardData,
  gateStoryboard,
  type StoryboardChapter,
  type TimingFile,
} from "./storyboard/data";
import { renderStoryboardHtml } from "./storyboard/html";
import { DEFAULT_HOLD_MS } from "../src/engine/constants";

// ── 夹具 ──

/** 模板 example 章节的实况（step 0 带 KenBurns、step 2 无声过场）+ 一个双步章。 */
const CHAPTERS: StoryboardChapter[] = [
  {
    id: "example",
    folder: "01-example",
    steps: 3,
    narrations: ["这是第一句口播", "这是第二句口播", ""],
  },
  { id: "demo", folder: "02-demo", steps: 2, narrations: ["甲", "乙"] },
];

const EXAMPLE_TIMING: TimingFile = {
  dwell: { "1": 600 },
  animation: { "1": "逐条点亮" },
  ambient: { "0": "KenBurns 背景缓推（引擎测试脚手架）" },
};

/** 同 example 章节但不声明 ambient——门禁负样本（未声明的计数 > 0 才是 blocker）。 */
const UNDECLARED_TIMING: TimingFile = {
  dwell: { "1": 600 },
  animation: { "1": "逐条点亮" },
};

function build(over: Partial<Parameters<typeof buildStoryboardData>[0]> = {}) {
  return buildStoryboardData({
    chapters: CHAPTERS,
    durations: null,
    timings: { example: EXAMPLE_TIMING },
    ...over,
  });
}

/** 未声明 ambient 的版本（step 0 的 KenBurns 无豁免 → 计数 > 0 必报红）。 */
function buildUndeclared(over: Partial<Parameters<typeof buildStoryboardData>[0]> = {}) {
  return build({ timings: { example: UNDECLARED_TIMING }, ...over });
}

/** 捕获结果的最小形态（capture 的 CaptureResult 结构上兼容）。 */
function counts(...pairs: [number, number, number][]) {
  return pairs.map(([chapter, step, animations]) => ({ chapter, step, animations, file: "x" }));
}

// ── buildStoryboardData：帧字段计算 ──

describe("buildStoryboardData：帧集合与字段计算", () => {
  it("帧数 === 总 step 数；坐标/章节 id/截图引用按章节序 × 步序", () => {
    const data = build();
    expect(data.expectedFrames).toBe(5);
    expect(data.frames).toHaveLength(5);
    expect(data.frames.map((f) => [f.chapter, f.step, f.chapterId])).toEqual([
      [0, 0, "example"],
      [0, 1, "example"],
      [0, 2, "example"],
      [1, 0, "demo"],
      [1, 1, "demo"],
    ]);
  });

  it("shot 是分镜页可用的相对引用（与 capture.shotPath 的尾段逐字一致）", () => {
    const data = build();
    expect(data.frames[0].shot).toBe("shots/example/0.png");
    expect(data.frames[3].shot).toBe("shots/demo/0.png");
    for (const f of data.frames) {
      expect(shotPath("/tmp/out", f.chapterId, f.step).endsWith(f.shot)).toBe(true);
    }
  });

  it("dwellMs：timing.json 覆盖优先，缺省用引擎默认 400ms", () => {
    const data = build();
    expect(DEFAULT_HOLD_MS).toBe(400); // 与引擎常量的失同步护栏（本测试断言的默认值来源）
    expect(data.frames[0].dwellMs).toBe(DEFAULT_HOLD_MS);
    expect(data.frames[1].dwellMs).toBe(600); // timing.example.dwell["1"]
    expect(data.frames[3].dwellMs).toBe(DEFAULT_HOLD_MS); // 无 timing 文件 → 全默认
  });

  it("narration 原样进帧；音频未合成 → audioMs/stepMs 全 null（诚实降级，不编造估算值）", () => {
    const data = build();
    expect(data.frames.map((f) => f.narration)).toEqual([
      "这是第一句口播",
      "这是第二句口播",
      "",
      "甲",
      "乙",
    ]);
    for (const f of data.frames) {
      expect(f.audioMs).toBeNull();
      expect(f.stepMs).toBeNull();
      expect(f.animMs).toBeNull(); // 分镜阶段零动画：animMs 恒 null
    }
    expect(data.warnings).toEqual([]); // 未合成是合法状态，不告警
  });

  it("stepMs = audioMs + dwellMs（分镜阶段 animMs = 0）；空 narration 步不吃条目", () => {
    const data = build({ durations: { example: [1000, 2000], demo: [500, 700] } });
    expect(data.frames[1].audioMs).toBe(2000);
    expect(data.frames[1].stepMs).toBe(2000 + 600); // 音频实测 + 覆盖停留垫
    expect(data.frames[0].audioMs).toBe(1000);
    expect(data.frames[0].stepMs).toBe(1000 + DEFAULT_HOLD_MS);
    // 无声过场：无音频可合成 → null（不是"未合成音频"待办）
    expect(data.frames[2].audioMs).toBeNull();
    expect(data.frames[2].stepMs).toBeNull();
    expect(data.warnings).toEqual([]);
  });

  it("单章扁平数组形态：按步序对位到非空 narration（空 narration 步跳过）", () => {
    const data = build({
      chapters: [CHAPTERS[0]],
      durations: [1000, 2000],
      timings: {},
    });
    expect(data.frames.map((f) => f.audioMs)).toEqual([1000, 2000, null]);
  });

  it("对象形态按 chapterId 取；也接受 folder 键（TTS 产物两种命名都见过）", () => {
    const byId = build({ durations: { demo: [500, 700] }, timings: {} });
    expect(byId.frames.map((f) => f.audioMs)).toEqual([null, null, null, 500, 700]);
    const byFolder = build({ durations: { "02-demo": [500, 700] }, timings: {} });
    expect(byFolder.frames.map((f) => f.audioMs)).toEqual([null, null, null, 500, 700]);
  });

  it("条目数对不上 → warning 而非静默/崩溃（P4-9 门禁在 check 层负责 blocker）", () => {
    const data = build({ durations: { example: [1000], demo: [500, 700] }, timings: {} });
    expect(data.frames[1].audioMs).toBeNull(); // 取不到 → 未合成降级
    expect(data.warnings.join("\n")).toContain("example");
    expect(data.warnings.join("\n")).toContain("1");
  });

  it("条目里显式 null = 该条未合成（合法：单条 TTS 失败），其余照常", () => {
    const data = build({ durations: { example: [null, 2000], demo: [500, 700] }, timings: {} });
    expect(data.frames[0].audioMs).toBeNull();
    expect(data.frames[1].audioMs).toBe(2000);
    expect(data.warnings).toEqual([]);
  });

  it("timing.json 的死标注（键超出本章步数）→ warning，不静默忽略", () => {
    const data = build({ timings: { example: { dwell: { "9": 600 } } } });
    expect(data.warnings.join("\n")).toContain("dwell");
    expect(data.warnings.join("\n")).toContain('"9"');
  });

  it("animation / ambient 标注进帧（缺省 null，供分镜页显示'未标注'）", () => {
    const data = build();
    expect(data.frames[0].ambient).toBe("KenBurns 背景缓推（引擎测试脚手架）");
    expect(data.frames[0].animationVocab).toBeNull();
    expect(data.frames[1].animationVocab).toBe("逐条点亮");
    expect(data.frames[1].ambient).toBeNull();
  });

  it("非法 durations（非数字条目 / 字符串 / 嵌套垃圾）→ throw（宁炸不静默）", () => {
    expect(() => build({ durations: { example: ["1.2", 2] } })).toThrow(/音频时长/);
    expect(() => build({ durations: "nope" })).toThrow(/音频时长/);
    expect(() => build({ durations: { example: 1.2 } })).toThrow(/音频时长/);
    expect(() => build({ durations: { example: [1, Number.NaN] } })).toThrow(/音频时长/);
  });

  it("非法 dwell / 章节 steps 与 narrations 失同步 → throw", () => {
    expect(() => build({ timings: { example: { dwell: { "0": -1 } } } })).toThrow(/dwell/);
    // 手写 JSON 的现实：类型说 number，运行期可能是字符串（JSON.parse 不带类型）
    const stringDwell = { dwell: { "0": "600" } } as unknown as TimingFile;
    expect(() => build({ timings: { example: stringDwell } })).toThrow(/dwell/);
    expect(() => build({ chapters: [{ ...CHAPTERS[0], steps: 9 }] })).toThrow(/steps/);
  });

  it("timing.json 顶层非对象（数组 / 字符串 / 数字 / null）→ throw（评审 F4）", () => {
    // 少这道守卫时 `timing?.dwell` 对它们全部静默 undefined（全默认），坏文件被当"没写"
    for (const bad of [[], "nope", 3, null, ["dwell"]]) {
      expect(() =>
        build({ timings: { example: bad as unknown as TimingFile } }),
      ).toThrow(/timing\.json/);
    }
    // 合法空配置仍是"没写"（不 throw）
    expect(() => build({ timings: { example: {} } })).not.toThrow();
  });

  it("expectedFrames = Σ chapters.steps（manifest 声明值，独立于 frames 构建结果）", () => {
    const data = build();
    expect(data.expectedFrames).toBe(CHAPTERS.reduce((n, c) => n + c.steps, 0));
    expect(data.expectedFrames).toBe(data.frames.length);
  });
});

// ── 分镜门禁（Ruling M4-2 氛围豁免） ──

describe("gateStoryboard：零动画门禁 + 帧数校验 + 氛围豁免", () => {
  it("正样本：帧数齐、计数全 0 → 零 blocker，全部 gate=pass", () => {
    const gated = gateStoryboard(
      build(),
      counts([0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 0, 0], [1, 1, 0]),
    );
    expect(gated.findings.filter((f) => f.severity === "blocker")).toEqual([]);
    expect(gated.frames.map((f) => f.gate)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    expect(gated.frames.map((f) => f.animations)).toEqual([0, 0, 0, 0, 0]);
  });

  it("负样本：计数 > 0 且未声明 ambient → blocker，含章节/步骤定位与修复提示", () => {
    const gated = gateStoryboard(
      buildUndeclared(),
      counts([0, 0, 1], [0, 1, 0], [0, 2, 0], [1, 0, 0], [1, 1, 0]),
    );
    const blockers = gated.findings.filter((f) => f.severity === "blocker");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].location).toContain("章节 0 第 0 步");
    expect(blockers[0].location).toContain("example");
    expect(blockers[0].message).toContain("入场动画禁入静态版");
    expect(blockers[0].message).toContain("ambient");
    expect(gated.frames[0].gate).toBe("blocker");
  });

  it("负样本：第 2 章某步计数 > 0 → 定位到那一帧，不带偏其他帧", () => {
    const gated = gateStoryboard(
      build(),
      counts([0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 0, 2], [1, 1, 0]),
    );
    const blockers = gated.findings.filter((f) => f.severity === "blocker");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].location).toContain("章节 1 第 0 步");
    expect(blockers[0].location).toContain("demo");
    expect(gated.frames[3].gate).toBe("blocker");
    expect(gated.frames.map((f) => f.gate).slice(0, 3)).toEqual(["pass", "pass", "pass"]);
  });

  it("声明 ambient 的步：计数 > 0 通过，note 上帧（gate=ambient，note 文本进 findings）", () => {
    const gated = gateStoryboard(
      build(),
      counts([0, 0, 1], [0, 1, 0], [0, 2, 0], [1, 0, 0], [1, 1, 0]),
    );
    expect(gated.findings.filter((f) => f.severity === "blocker")).toEqual([]);
    expect(gated.frames[0].gate).toBe("ambient");
    expect(gated.frames[0].ambient).toContain("KenBurns");
    const note = gated.findings.find((f) => f.location.includes("章节 0 第 0 步"));
    expect(note?.severity).toBe("note");
    expect(note?.message).toContain("KenBurns 背景缓推（引擎测试脚手架）");
  });

  it("声明了 ambient 但计数为 0 → note（声明可能过期），非 blocker", () => {
    const gated = gateStoryboard(
      build(),
      counts([0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 0, 0], [1, 1, 0]),
    );
    expect(gated.findings.filter((f) => f.severity === "blocker")).toEqual([]);
    const note = gated.findings.find((f) => f.location.includes("章节 0 第 0 步"));
    expect(note?.message).toContain("未检出动画");
  });

  it("帧数不符（截图缺失/多出）→ blocker；已截帧的判定照常给出", () => {
    const gated = gateStoryboard(build(), counts([0, 0, 0], [0, 1, 0]));
    const blockers = gated.findings.filter((f) => f.severity === "blocker");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].message).toContain("3");
    expect(blockers[0].message).toContain("5");
    expect(gated.frames[0].gate).toBe("pass");
    expect(gated.frames[2].gate).toBeNull(); // 未捕获的帧不臆造判定
  });

  it("捕获坐标与帧集合错位 → blocker 列出缺帧/多帧", () => {
    // 帧数恰好相等（5=5），但 (1,1) 漏截、(9,9) 越界多截——只数长度会放过这一类
    const gated = gateStoryboard(
      build(),
      counts([0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 0, 0], [9, 9, 0]),
    );
    const blockers = gated.findings.filter((f) => f.severity === "blocker");
    expect(blockers).toHaveLength(1);
    expect(blockers[0].message).toContain("章节 1 第 1 步");
    expect(blockers[0].message).toContain("章节 9 第 9 步");
  });

  it("免比对集合只收 gate=ambient 的步（评审 F2：过期声明不白送豁免），键格式与 verify 一致", () => {
    // step 0 声明 ambient 且计数 1 → gate=ambient；step 1 声明了 ambient 但计数 0（过期）→ gate=pass
    const data = build({
      timings: {
        example: { ambient: { "0": "KenBurns 背景缓推", "1": "呼吸微动（声明过期）" } },
      },
    });
    const gated = gateStoryboard(
      data,
      counts([0, 0, 1], [0, 1, 0], [0, 2, 0], [1, 0, 0], [1, 1, 0]),
    );
    expect(gated.frames[1].ambient).not.toBeNull(); // 声明还在（note 仍上帧）
    expect(gated.frames[1].gate).toBe("pass"); // 但没豁免资格
    expect(ambientExemptKeys(gated)).toEqual(new Set([ambientKey(0, 0)]));
    expect(ambientExemptKeys(gated).has(ambientKey(0, 1))).toBe(false);
  });

  it("reset：门禁不就地改入参（返回新帧对象）", () => {
    const data = build();
    const gated = gateStoryboard(data, counts([0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 0, 0], [1, 1, 0]));
    expect(data.frames[0].animations).toBeNull();
    expect(data.frames[0].gate).toBeNull();
    expect(gated.frames[0]).not.toBe(data.frames[0]);
  });
});

// ── renderStoryboardHtml：自包含离线页 ──

describe("renderStoryboardHtml：每帧图 / 文案 / 时长 / 词汇 / ambient note / 降级提示", () => {
  const data = gateStoryboard(
    build({ durations: { example: [1750, 2000], demo: [500, 700] } }),
    counts([0, 0, 1], [0, 1, 0], [0, 2, 0], [1, 0, 0], [1, 1, 0]),
  );
  const html = renderStoryboardHtml(data);

  it("每帧的截图相对引用与口播文本都在", () => {
    expect(html).toContain('src="shots/example/0.png"');
    expect(html).toContain('src="shots/example/2.png"');
    expect(html).toContain('src="shots/demo/1.png"');
    expect(html).toContain("这是第一句口播");
    expect(html).toContain("第二句口播");
    expect(html).toContain("甲");
  });

  it("音频实测时长 + 停留垫 + 停留时长上帧（stepMs = 音频 + 垫）", () => {
    expect(html).toContain("1.75s"); // 1750ms → 秒（人读优先）
    expect(html).toContain("2000ms"); // 实测原值也留着（核对用）
    expect(html).toContain("600ms"); // timing.dwell["1"] 覆盖
    expect(html).toContain("2600ms"); // stepMs = 2000 + 600
  });

  it("未合成音频的诚实降级 + 无声步区分（不编造估算时长）", () => {
    const missing = renderStoryboardHtml(build());
    expect(missing).toContain(AUDIO_MISSING_TEXT);
    expect(missing).toContain(STEP_MS_MISSING_TEXT);
    expect(missing).not.toMatch(/\d+(\.\d+)?s（估）/); // 不出现估算时长
    expect(renderStoryboardHtml(data)).toContain(SILENT_STEP_TEXT); // 空 narration 步
  });

  it("动画词汇标注 + 缺省'未标注' + ambient note 上帧", () => {
    expect(html).toContain("逐条点亮");
    expect(html).toContain(VOCAB_MISSING_TEXT);
    expect(html).toContain("KenBurns 背景缓推（引擎测试脚手架）");
  });

  it("门禁结论上页：blocker 报红、ambient 步标注已声明", () => {
    const blocked = renderStoryboardHtml(
      gateStoryboard(buildUndeclared(), counts([0, 0, 1], [0, 1, 0], [0, 2, 0], [1, 0, 0], [1, 1, 0])),
    );
    expect(blocked).toContain("blocker");
    expect(blocked).toContain("入场动画禁入静态版");
    expect(blocked).toContain('badge-blocker');
    expect(html).toContain("氛围");
    expect(html).toContain('badge-ambient');
  });

  it("离线自包含：无任何外链（http/https 不出现），主题色是 hex 快照并有声明", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("#efe9d9");
    expect(html).toContain("#0f0f0f");
    expect(html).toContain(THEME_SNAPSHOT_NOTE);
  });

  it("文本转义：narration 里的标签不被当 HTML 执行", () => {
    const evil = build({
      chapters: [{ id: "x", folder: "01-x", steps: 1, narrations: ['<img src="a" onerror="boom()">'] }],
      timings: {},
    });
    const out = renderStoryboardHtml(gateStoryboard(evil, counts([0, 0, 0])));
    expect(out).toContain("&lt;img");
    expect(out).not.toContain('onerror="boom()"');
  });
});

// ── 主题快照漂移护栏（M5 遗留 #4） ──
//
// 问题：`STORYBOARD_THEME` 是 tokens.css 的**离线快照**（分镜页自包含，不引 tokens.css）——
// tokens.css 改色后分镜页会**静默掉色**：没有任何东西会报，页面还是"能看"的（只是配色旧了）。
// 本护栏把"快照 == tokens.css"变成可执行的断言：任何一处 token 改值 → 本文件红。
//
// 读文件的两处环境坑（K-63④）：本文件跑在 jsdom，`new URL("../src/...", import.meta.url)`
// 会被解析成 `http://localhost:3000/...`（jsdom 的 base）——必须 `fileURLToPath` + `path.join`。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS_CSS = path.join(REPO_ROOT, "src", "theme", "tokens.css");

/**
 * 极简 `--name: value;` 提取器（只够本护栏用）：先剥注释（`/* … *\/`，值尾的注释也在此剥掉），
 * 再按声明取第一个候选。**不做**完整 CSS 解析——本护栏只读 tokens.css（`:root` 单块、
 * 每行一条声明），多写一层解析器只会多一处可漂移的实现。
 */
function parseCssCustomProps(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)) {
    out.set(m[1], m[2].trim().toLowerCase());
  }
  return out;
}

describe("STORYBOARD_THEME 快照漂移护栏（tokens.css ↔ 分镜页快照）", () => {
  it("映射到的每个 token 与快照逐字相等（改 tokens.css 一个色值 → 这里必须红）", () => {
    const tokens = parseCssCustomProps(fs.readFileSync(TOKENS_CSS, "utf8"));
    expect(tokens.size).toBeGreaterThan(40); // 解析器没瞎：tokens.css 当前 60+ 条自定义属性
    for (const [key, names] of Object.entries(THEME_TOKEN_MAP)) {
      for (const name of names) {
        const value = tokens.get(name);
        expect(value, `tokens.css 缺 ${name}（快照 ${key} 的映射目标）`).toBeDefined();
        expect(
          STORYBOARD_THEME[key as keyof typeof STORYBOARD_THEME].toLowerCase(),
          `分镜页快照 ${key} = ${STORYBOARD_THEME[key as keyof typeof STORYBOARD_THEME]} ` +
            `与 tokens.css 的 ${name} = ${value} 不一致——分镜页会静默掉色，请同步 data.ts 的快照`,
        ).toBe(value);
      }
    }
  });

  it("覆盖完备：快照的每个键要么映射到 token、要么显式登记为本地色（新增键不登记即红）", () => {
    const covered = new Set<string>([...Object.keys(THEME_TOKEN_MAP), ...LOCAL_THEME_KEYS]);
    expect([...Object.keys(STORYBOARD_THEME)].sort()).toEqual([...covered].sort());
  });

  it("THEME_SNAPSHOT_NOTE 的三个值确实取自快照常量（文案与色值不会只改一侧）", () => {
    expect(THEME_SNAPSHOT_NOTE).toContain(STORYBOARD_THEME.cream);
    expect(THEME_SNAPSHOT_NOTE).toContain(STORYBOARD_THEME.ink);
    expect(THEME_SNAPSHOT_NOTE).toContain(STORYBOARD_THEME.accent);
  });
});

// ── verify-sequential 纯函数面 ──

describe("compareShotBytes：两路径截图的字节比对", () => {
  it("逐字节相同 → equal", () => {
    const a = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
    expect(compareShotBytes(a, Uint8Array.from([137, 80, 78, 71, 1, 2, 3]))).toEqual({
      equal: true,
      detail: "",
    });
  });

  it("长度不同 / 同长不同 → 不等，detail 带长度与首个差异偏移", () => {
    const short = Uint8Array.from([1, 2, 3]);
    const long = Uint8Array.from([1, 2, 3, 4]);
    expect(compareShotBytes(short, long).equal).toBe(false);
    expect(compareShotBytes(short, long).detail).toContain("3");
    expect(compareShotBytes(short, long).detail).toContain("4");

    const drift = compareShotBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 9, 3]));
    expect(drift.equal).toBe(false);
    expect(drift.detail).toContain("1"); // 首个差异偏移
  });
});

describe("summarizeVerification：结论 → 报告行 + 退出码", () => {
  const v = (
    chapter: number,
    step: number,
    status: VerifyVerdict["status"],
    detail = "",
  ): VerifyVerdict => ({ chapter, step, chapterId: "example", status, detail, exempt: status !== "match" && status !== "mismatch" });

  it("全一致 → exit 0，报告含每步一致", () => {
    const report = summarizeVerification([v(0, 0, "match"), v(0, 1, "match")]);
    expect(report.exitCode).toBe(0);
    expect(report.lines.join("\n")).toContain("章节 0 第 0 步");
    expect(report.lines.join("\n")).toContain("一致");
  });

  it("有非豁免不一致 → exit 1，列出差异步与字节摘要", () => {
    const report = summarizeVerification([v(0, 0, "match"), v(0, 1, "mismatch", "长度 3 vs 4")]);
    expect(report.exitCode).toBe(1);
    expect(report.lines.join("\n")).toContain("章节 0 第 1 步");
    expect(report.lines.join("\n")).toContain("长度 3 vs 4");
  });

  it("氛围步免比对：不进差异清单、不影响退出码，报告注明", () => {
    const report = summarizeVerification([
      v(0, 0, "exempt", "氛围步免比对（已声明 ambient）"),
      v(0, 1, "match"),
    ]);
    expect(report.exitCode).toBe(0);
    expect(report.lines.join("\n")).toContain("氛围步免比对");
    expect(report.lines.join("\n")).toContain("章节 0 第 0 步");
  });

  it("免比对步即使字节不同也只记 info（氛围微动随时间漂移，不代表顺序/独立 mount 有差）", () => {
    const report = summarizeVerification([v(0, 0, "exempt-info", "字节不同（info）"), v(0, 1, "match")]);
    expect(report.exitCode).toBe(0);
    expect(report.lines.join("\n")).toContain("info");
  });
});
