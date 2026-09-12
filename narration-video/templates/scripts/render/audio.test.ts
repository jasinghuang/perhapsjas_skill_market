/**
 * audio.test.ts（M5a Task 5）：mock 音轨的**落盘契约**（真 ffmpeg + 临时 repoRoot）。
 *
 * 为什么值得测：`public/audio/<folder>/<step>.mp3` 的命名与 `public/audio-durations.json` 的
 * 形态是**三条既有管线共同消费**的约定——App 的 `audioSrc = /audio/<folder>/<step>.mp3`、
 * 门禁 #13（每章 mp3 数 === 非空 narrations 数）、分镜/渲染的 durations 对位（P4-9）。
 * 写歪一个字符，坏的不是本模块而是整条链。
 *
 * 全部用例在**临时 repoRoot** 里跑（真实 `public/` 不该被测试写脏）——`repoRoot` 可注入正是
 * 为了这个（T7 的 CLI 传真实模板根）。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { estimateNarrationMs } from "../../src/engine/hold";
import { resolveAudioMs } from "../storyboard/data";
import { probeDurationMs } from "./encode";
import { synthesizeMockAudio } from "./audio";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmpRepo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mock-audio-"));
  tmpDirs.push(d);
  return d;
}

/** 一份"真形状"的章节：三步、第 1 步是无声过场（与模板 example 同构）。 */
const CHAPTERS = [
  { id: "example", folder: "01-example", narrations: ["这是第一句口播", "这是第二句口播", ""] },
];

describe("synthesizeMockAudio", () => {
  it("mp3 落在 public/audio/<folder>/<step>.mp3，空 narration 步不产文件（mkdir 由本层负责）", async () => {
    const repoRoot = tmpRepo();
    const r = await synthesizeMockAudio({ chapters: CHAPTERS, repoRoot });

    expect(fs.existsSync(path.join(repoRoot, "public", "audio", "01-example"))).toBe(true);
    expect(r.files.sort()).toEqual(["public/audio/01-example/0.mp3", "public/audio/01-example/1.mp3"]);
    for (const f of r.files) expect(fs.statSync(path.join(repoRoot, f)).size).toBeGreaterThan(0);
    // 无声过场步（narration ""）没有 mp3（App 的 audioSrc 也是 null——空 narration 不合成）
    expect(fs.existsSync(path.join(repoRoot, "public", "audio", "01-example", "2.mp3"))).toBe(false);
  });

  it("durations.json 的条目数/顺序 = 非空 narrations（#13 / P4-9 口径），值是 ffprobe 实测", async () => {
    const repoRoot = tmpRepo();
    const r = await synthesizeMockAudio({ chapters: CHAPTERS, repoRoot });

    expect(Object.keys(r.durations)).toEqual(["example"]);
    expect(r.durations.example.length).toBe(2);
    const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, "public", "audio-durations.json"), "utf8"));
    expect(raw).toEqual(r.durations);

    // "实测"必须真的是实测：与独立 ffprobe 读数逐条相等，且与估时（mock 的生成长度）同量级
    const measured = [
      probeDurationMs(path.join(repoRoot, "public/audio/01-example/0.mp3")),
      probeDurationMs(path.join(repoRoot, "public/audio/01-example/1.mp3")),
    ];
    expect(r.durations.example).toEqual(measured);
    r.durations.example.forEach((ms, i) => {
      const want = estimateNarrationMs(CHAPTERS[0].narrations[i]);
      // mp3 帧长 26.12ms + 编码器起始延迟：实测比请求长度多出不到 100ms
      expect(Math.abs(ms - want)).toBeLessThan(100);
    });
    expect(r.durationsFile).toBe("public/audio-durations.json");
  });

  it("重跑幂等（同输入同读数）；不动不属于本次写出的 mp3，只报为 staleFiles", async () => {
    const repoRoot = tmpRepo();
    const dir = path.join(repoRoot, "public", "audio", "01-example");
    fs.mkdirSync(dir, { recursive: true });
    // 上一次 deck 更长的残留（或真 TTS 产物）：不该被删，但要能报出来（#13 会拦"多出来的 mp3"）
    fs.writeFileSync(path.join(dir, "9.mp3"), "not-really-mp3");

    const a = await synthesizeMockAudio({ chapters: CHAPTERS, repoRoot });
    const b = await synthesizeMockAudio({ chapters: CHAPTERS, repoRoot });
    expect(b.durations).toEqual(a.durations);
    expect(a.staleFiles).toEqual(["public/audio/01-example/9.mp3"]);
    expect(fs.existsSync(path.join(dir, "9.mp3"))).toBe(true); // 不删用户文件
  });

  it("『有音频』口径与分镜层同源（data.ts 的 hasAudio：trim 判空，不重抄一份）", async () => {
    // 空白串 narration 是关键样本：按"真值"判定会被当成有声（App 的 `narration ? …` 就是这样），
    // 而 #13/P4-9 与分镜层按 trim 判空。本层若各写一套，mock 会多写一支 mp3、durations 条目数
    // 也跟着多 1 —— 门禁直接红。
    const chapters = [{ id: "c", folder: "01-c", narrations: ["有稿", " ", ""] }];
    const repoRoot = tmpRepo();
    const r = await synthesizeMockAudio({ chapters, repoRoot });
    expect(r.files).toEqual(["public/audio/01-c/0.mp3"]);

    // 同源证据：分镜层的对位函数对同一章给出"只有第 0 步有音频"
    const aligned = resolveAudioMs(
      chapters.map((c) => ({ ...c, steps: c.narrations.length })),
      { c: [111] },
      [],
    );
    expect(aligned).toEqual([[111, null, null]]);
  });

  it("ffprobe/ffmpeg 缺失 → 错误文案带 brew install ffmpeg 指引", async () => {
    const repoRoot = tmpRepo();
    await expect(
      synthesizeMockAudio({ chapters: CHAPTERS, repoRoot, ffmpegPath: "/nonexistent-ffmpeg-for-test" }),
    ).rejects.toThrow(/brew install ffmpeg/);
  });
});

describe("synthesizeMockAudio：路径护栏", () => {
  it("folder 带分隔符 / `.` / `..` → throw（路径会写到 public/ 之外，mkdir -p 会真建出去）", async () => {
    const repoRoot = tmpRepo();
    for (const folder of ["../evil", "a/b", ".", "..", ""]) {
      await expect(
        synthesizeMockAudio({ chapters: [{ id: "c", folder, narrations: ["稿"] }], repoRoot }),
      ).rejects.toThrow(/folder/);
    }
  });
});
