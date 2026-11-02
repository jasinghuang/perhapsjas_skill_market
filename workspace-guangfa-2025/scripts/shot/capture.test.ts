import { describe, expect, it } from "vitest";
import {
  assertCursorMatch,
  assertCursorStill,
  captureSteps,
  chromiumMissingError,
  expandSpecs,
  isMissingBrowserError,
  shotPath,
  withHeadless,
  type ShotSpec,
} from "./capture";

describe("expandSpecs：章节 manifest → 全 (chapter, step) 列表", () => {
  it("按章节序 × 步序展开（顺序确定：先章内步序，后章节序）", () => {
    expect(expandSpecs([{ steps: 3 }, { steps: 2 }])).toEqual([
      { chapter: 0, step: 0 },
      { chapter: 0, step: 1 },
      { chapter: 0, step: 2 },
      { chapter: 1, step: 0 },
      { chapter: 1, step: 1 },
    ]);
  });

  it("展开数量 === Σ steps，空章节（steps: 0）不产出任何 spec", () => {
    const specs = expandSpecs([{ steps: 3 }, { steps: 0 }, { steps: 2 }]);
    expect(specs).toHaveLength(5);
    expect(specs.filter((s) => s.chapter === 1)).toEqual([]);
  });

  it("空 chapters → 空列表（合法状态：模板章节清空即可跑）", () => {
    expect(expandSpecs([])).toEqual([]);
  });

  it("非法 steps（负数 / 非整数 / NaN）→ throw 而非静默跳过", () => {
    expect(() => expandSpecs([{ steps: 2 }, { steps: -1 }])).toThrow(/steps/);
    expect(() => expandSpecs([{ steps: 1.5 }])).toThrow(/steps/);
    expect(() => expandSpecs([{ steps: Number.NaN }])).toThrow(/steps/);
  });
});

describe("shotPath：输出路径约定 <outDir>/shots/<chapterId>/<step>.png", () => {
  it("按约定拼接（chapterId 是章节 id，不是数字下标）", () => {
    expect(shotPath("/tmp/sb", "example", 0)).toBe("/tmp/sb/shots/example/0.png");
    expect(shotPath("/tmp/sb", "01-example", 12)).toBe("/tmp/sb/shots/01-example/12.png");
  });

  it("相对 outDir 同样拼接（不解析为绝对路径——调用方给什么拼什么）", () => {
    expect(shotPath("./storyboard", "example", 1)).toBe("./storyboard/shots/example/1.png");
  });

  it("outDir 尾随斜杠不产出双斜杠（分镜页相对引用不会被写坏）", () => {
    expect(shotPath("/tmp/sb/", "example", 2)).toBe("/tmp/sb/shots/example/2.png");
  });

  it("非法 step（负数 / 非整数）→ throw", () => {
    expect(() => shotPath("/tmp/sb", "example", -1)).toThrow(/step/);
    expect(() => shotPath("/tmp/sb", "example", 0.5)).toThrow(/step/);
  });

  it("非法 chapterId → throw（F3：空串 / 分隔符 / 上跳）", () => {
    expect(() => shotPath("/tmp/sb", "", 0)).toThrow(/chapterId/);
    expect(() => shotPath("/tmp/sb", "a/b", 0)).toThrow(/chapterId/);
    expect(() => shotPath("/tmp/sb", "a\\b", 0)).toThrow(/chapterId/);
    expect(() => shotPath("/tmp/sb", "../../etc/x", 0)).toThrow(/chapterId/);
    expect(() => shotPath("/tmp/sb", "..", 0)).toThrow(/chapterId/);
    expect(() => shotPath("/tmp/sb", ".", 0)).toThrow(/chapterId/);
  });
});

describe("assertCursorMatch：回读校验（F2）", () => {
  it("期望 === 实际 → 放行", () => {
    expect(() => assertCursorMatch({ chapter: 0, step: 2 }, { chapter: 0, step: 2 })).not.toThrow();
  });

  it("被 clamp 的越界游标 → throw（带期望/实际双方坐标）", () => {
    // useStepper.clamp 的实况：要 (5,3) 给 (0,2)
    expect(() => assertCursorMatch({ chapter: 5, step: 3 }, { chapter: 0, step: 2 })).toThrow(
      /游标回读不符/,
    );
    expect(() => assertCursorMatch({ chapter: 5, step: 3 }, { chapter: 0, step: 2 })).toThrow(
      /期望 章节 5 第 3 步，实际 章节 0 第 2 步/,
    );
    // 章内步越界同样当场暴露
    expect(() => assertCursorMatch({ chapter: 0, step: 9 }, { chapter: 0, step: 2 })).toThrow(
      /游标回读不符/,
    );
  });
});

describe("assertCursorStill：截图后回读（评审 F1——归因'页面自驱推进'而非分镜内容差异）", () => {
  it("仍停在目标步 → 放行", () => {
    expect(() => assertCursorStill({ chapter: 0, step: 2 }, { chapter: 0, step: 2 })).not.toThrow();
  });

  it("被自驱推进带走 → throw，且文案归因自动推进（不误报成 clamp / 顺序-独立 mount 有差）", () => {
    expect(() => assertCursorStill({ chapter: 0, step: 1 }, { chapter: 0, step: 2 })).toThrow(
      /截图后游标已被带走/,
    );
    expect(() => assertCursorStill({ chapter: 0, step: 1 }, { chapter: 0, step: 2 })).toThrow(
      /页面自驱推进抢先/,
    );
    // 不误归因：F2 的 clamp 文案与 F1 的自动推进文案各说各的
    expect(() => assertCursorStill({ chapter: 0, step: 1 }, { chapter: 0, step: 2 })).not.toThrow(
      /静默 clamp/,
    );
  });
});

describe("withHeadless：URL 归一（桥的安装条件 = URL 含 headless=1）", () => {
  it("无 query → 追加 ?headless=1", () => {
    expect(withHeadless("http://localhost:5174")).toBe("http://localhost:5174/?headless=1");
  });

  it("已有 query → 追加 &headless=1（不破既有参数）", () => {
    expect(withHeadless("http://localhost:5174/?chapter=0&step=1")).toBe(
      "http://localhost:5174/?chapter=0&step=1&headless=1",
    );
  });

  it("已含 headless → 原样（幂等）", () => {
    expect(withHeadless("http://localhost:5174/?headless=1")).toBe(
      "http://localhost:5174/?headless=1",
    );
  });
});

describe("浏览器缺失错误：可读指引（含安装命令）", () => {
  it("chromiumMissingError 文案含 npx playwright install chromium", () => {
    const err = chromiumMissingError();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("npx playwright install chromium");
  });

  it("携带原始错误细节（排查用），仍保留指引", () => {
    const err = chromiumMissingError("Executable doesn't exist at /x/chromium-1208/chrome");
    expect(err.message).toContain("npx playwright install chromium");
    expect(err.message).toContain("/x/chromium-1208/chrome");
  });

  it("isMissingBrowserError 只认浏览器缺失（其余错误原样透传，不吞真因）", () => {
    expect(
      isMissingBrowserError(
        new Error(
          "browserType.launch: Executable doesn't exist at /Users/x/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Chromium.app\n" +
            "Looks like Playwright was just installed or updated.\n" +
            "Please run the following command to download new browsers:\n" +
            "npx playwright install",
        ),
      ),
    ).toBe(true);
    expect(isMissingBrowserError(new Error("net::ERR_CONNECTION_REFUSED at http://localhost:5174"))).toBe(
      false,
    );
    expect(isMissingBrowserError(undefined)).toBe(false);
  });
});

describe("captureSteps：非法输入与空列表（不启浏览器即可判定的分支）", () => {
  it("空 specs → 空结果（不启动浏览器）", async () => {
    await expect(
      captureSteps([], { url: "http://localhost:5174", outDir: "/tmp/never" }),
    ).resolves.toEqual([]);
  });

  it("负 step / 负 chapter → throw（在启动浏览器之前）", async () => {
    const bad = [{ chapter: 0, step: -1 }] as ShotSpec[];
    await expect(
      captureSteps(bad, {
        url: "http://localhost:5174",
        outDir: "/tmp/never",
        chapterIds: ["example"],
      }),
    ).rejects.toThrow(/坐标/);
    await expect(
      captureSteps([{ chapter: -1, step: 0 }], {
        url: "http://localhost:5174",
        outDir: "/tmp/never",
        chapterIds: ["example"],
      }),
    ).rejects.toThrow(/坐标/);
  });

  it("specs 非空但缺 chapterIds → throw（不静默退化为数字下标，F1）", async () => {
    await expect(
      captureSteps([{ chapter: 0, step: 0 }], { url: "http://localhost:5174", outDir: "/tmp/never" }),
    ).rejects.toThrow(/缺 chapterIds/);
    await expect(
      captureSteps([{ chapter: 0, step: 0 }], { url: "http://localhost:5174", outDir: "/tmp/never" }),
    ).rejects.toThrow(/chapters\.map\(c => c\.id\)/);
  });

  it("chapterIds 与章节下标失位（太短）→ throw 且带 chapter/step 定位", async () => {
    await expect(
      captureSteps([{ chapter: 1, step: 0 }], {
        url: "http://localhost:5174",
        outDir: "/tmp/never",
        chapterIds: ["example"],
      }),
    ).rejects.toThrow(/无第 1 项（章节 1 第 0 步）/);
  });

  it("chapterIds 内含非法 id → throw（F3，开浏览器之前就拦住）", async () => {
    await expect(
      captureSteps([{ chapter: 0, step: 0 }], {
        url: "http://localhost:5174",
        outDir: "/tmp/never",
        chapterIds: ["../evil"],
      }),
    ).rejects.toThrow(/chapterIds\[0\]/);
  });
});
