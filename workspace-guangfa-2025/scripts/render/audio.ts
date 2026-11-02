// M5a Task 5 mock 音轨：**在 TTS 到期之前，让渲染链有一个长度确定的音轨可跑**（真实 TTS 是
// Phase 2 的事，设计 §8 的渲染管线不该等它）。
//
// 产出两条（都是既有约定的生成物，不入库——见 .gitignore）：
//   1. `<repoRoot>/public/audio/<folder>/<step>.mp3`——与 App 的
//      `audioSrc = /audio/<folder>/<step>.mp3` 逐字一致（`src/App.tsx`）；`<step>` 是 0 起编的
//      游标坐标。**空 narration 步不产文件**（App 那一步 audioSrc 就是 null，无声过场由
//      音轨图的 anullsrc 段承担）。模板此前**没有** `public/` 目录 ⇒ 本层负责 mkdir -p。
//   2. `<repoRoot>/public/audio-durations.json`——**ffprobe 实测值**（ms），形态 `{章节 id: 时长[]}`
//      按非空 narration 顺序。T1 的时间轴表只吃实测值（未合成走估时兜底，不冒充）；条目数
//      === 总非空 narrations 数是 #13 / P4-9 的硬契约，故这里用**同一个** `hasAudio` 判空。
//
// 长度取 `estimateNarrationMs`（引擎侧唯一那份估时公式）：mock 的目的是"占位"，让成片节奏与
// 未合成预览（同一公式）**同节奏**——换真实 TTS 之后 durations.json 换成实测值即可，管线不动。
//
// M5b T1 追加 `MockAudioProfile`（mp3 的**形状**：起手静音 / 采样率 / 声道数）：缺省档
// `MOCK_AUDIO_DEFAULT` 与 M5a 逐字一致；`MOCK_AUDIO_REALISTIC` 是"真 TTS 开箱"档，见其注释。
//
// 不做的事（有意）：**不清理**目标目录。`public/audio/` 可能是真实 TTS 产物（用户资产），
// 生成物清理只该发生在自己造的目录（T4 的帧目录）里；多出来的 mp3 由 `staleFiles` 报出
// ——#13 门禁会拦"每章 mp3 数 ≠ 非空 narrations 数"，比静默删用户文件安全。
//
// 依赖方向：scripts/render → scripts/storyboard（hasAudio 单一源头）+ src/engine（估时公式）
// + scripts/render/encode（ffmpeg/ffprobe 命令面，含"缺二进制给 brew 指引"那一份文案）。

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateNarrationMs } from "../../src/engine/hold";
import { hasAudio } from "../storyboard/data";
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, probeDurationMs, runFfmpeg } from "./encode";

/** 章节在本层的最小投影（与 manifest 的 ChapterDef 结构兼容）。 */
export interface MockAudioChapter {
  id: string;
  /** mp3 目录名：`public/audio/<folder>/`（= App 的 `/audio/<folder>/…`） */
  folder: string;
  narrations: readonly string[];
}

/**
 * mock 音轨的档案（M5b T1）：把 mp3 的**形状**参数化。
 *
 * M5a 的 mock 是"lavfi 正弦 48k 立体声、起手即满幅"——便于占位，却**掩盖了真 TTS 的形状**：
 * 真 TTS 的 mp3 常见 44.1k / 单声道 / 头部带 80~200ms 起手静音。后者正是自校验层 K-82③
 * 失明的触发条件（起手静音 ≥50ms ⇒ "步起点 ±50ms"窗口两侧皆静音 ⇒ 该步整条跳过）。
 * 拟真档让"真音频开箱"在秒级、无浏览器的层面可重复：同一个管线、只换 mp3 的形状。
 */
export interface MockAudioProfile {
  /** 起手静音 ms（真 TTS 常见 80~200；拟真档 120——实测 ≥50 即触发上文那条失明） */
  leadSilenceMs: number;
  /** 采样率 Hz（真 TTS 常见 44100；成片规格是 48000，音轨图的 aformat 会归一） */
  sampleRate: number;
  /** 声道数（真 TTS 常见单声道；成片规格是双声道，音轨图的 aformat 会归一） */
  channels: 1 | 2;
}

/** 缺省档：与 M5a 的行为**逐字一致**（0 起手静音 / 48000 / 双声道——不传 profile 即它）。 */
export const MOCK_AUDIO_DEFAULT: MockAudioProfile = {
  leadSilenceMs: 0,
  sampleRate: AUDIO_SAMPLE_RATE,
  channels: AUDIO_CHANNELS,
};

/** 拟真档（`--realistic-audio`）：真 TTS 的典型形状——渲染链的开箱体检档。 */
export const MOCK_AUDIO_REALISTIC: MockAudioProfile = {
  leadSilenceMs: 120,
  sampleRate: 44100,
  channels: 1,
};

export interface SynthesizeMockAudioOptions {
  chapters: readonly MockAudioChapter[];
  /** 模板根（mp3 与 durations.json 的锚点）；默认 `scripts/../..`（= 模板根，与 storyboard.ts 同款） */
  repoRoot?: string;
  /** 覆盖 ffmpeg/ffprobe 可执行（测试用；默认 PATH 上的同名命令） */
  ffmpegPath?: string;
  ffprobePath?: string;
  /** 正弦基频（默认 440Hz；第 k 步 +110Hz——相邻步在听感与频谱读数上都可区分） */
  baseFrequency?: number;
  /** 音轨形状（默认 `MOCK_AUDIO_DEFAULT`——与 M5a 逐字一致；`MOCK_AUDIO_REALISTIC` = 真 TTS 形状） */
  profile?: MockAudioProfile;
}

export interface SynthesizeMockAudioResult {
  /** 写出的 mp3（相对 repoRoot 的路径，按章节/步序） */
  files: string[];
  /** 写出的 durations.json（相对 repoRoot） */
  durationsFile: string;
  /** durations.json 的内容（就是写进文件的那份对象） */
  durations: Record<string, number[]>;
  /** 目标目录里**不是本次写出**的 mp3（上次 deck 的残留 / 真 TTS 产物）——#13 会拦，交调用方告警 */
  staleFiles: string[];
}

/** 模板根（scripts/render/audio.ts → 上两级）；与 `scripts/storyboard.ts` 的 REPO_ROOT 同款。 */
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 音频目录/时长文件的相对路径（单一源：写、stale 扫描、测试断言都走它）。 */
export const AUDIO_DIR = path.posix.join("public", "audio");
export const DURATIONS_FILE = path.posix.join("public", "audio-durations.json");

/**
 * 生成 mock 音轨（真 ffmpeg 调用：每支 mp3 一次 lavfi 正弦编码 + 一次 ffprobe 实测）。
 *
 * 非空护栏：`chapters` 为空 → throw（空跑会写出 `{}` 的 durations.json——门禁 #13 数出 0 条，
 * 而"没章节"在模板里是坏数据不是缺省态）。
 */
export async function synthesizeMockAudio(
  opts: SynthesizeMockAudioOptions,
): Promise<SynthesizeMockAudioResult> {
  if (opts.chapters.length === 0) {
    throw new Error(
      "synthesizeMockAudio：chapters 为空——会写出零条目的 durations.json（#13 条目 0 ≠ 非空 " +
        "narrations N，或让渲染链以为整档无音频），宁炸不静默",
    );
  }
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;
  const base = opts.baseFrequency ?? 440;
  const profile = opts.profile ?? MOCK_AUDIO_DEFAULT;
  const files: string[] = [];
  const durations: Record<string, number[]> = {};
  const written = new Set<string>();

  for (const chapter of opts.chapters) {
    durations[chapter.id] = [];
    // folder 直接进路径（`public/audio/<folder>/`）：带分隔符/`.`/`..` 会写到 public/ 之外，
    // 而 mkdir -p 会**真的**把目录建出去（同 T4 帧目录的越界兜底：破坏性/写出性路径先挡）。
    if (chapter.folder === "" || /[/\\]/.test(chapter.folder) || chapter.folder === "." || chapter.folder === "..") {
      throw new Error(
        `synthesizeMockAudio：${chapter.id} 的 folder ${JSON.stringify(chapter.folder)} 非法` +
          `——它直接进 public/audio/<folder>/ 路径（manifest 的章节目录名，如 "01-example"）`,
      );
    }
    chapter.narrations.forEach((narration, step) => {
      if (!hasAudio(narration)) return; // 无声过场步：不合成（音轨图用 anullsrc 段顶）
      const rel = path.posix.join(AUDIO_DIR, chapter.folder, `${step}.mp3`);
      const abs = path.join(repoRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true }); // 模板此前无 public/：本层首建
      const seconds = (estimateNarrationMs(narration) / 1000).toFixed(3);
      // sine 是单声道 ⇒ 显式 -ac <档案声道数> 到该档案的规格（aformat 在音轨图里还会再兜一层）。
      // 起手静音（>0 时）用 adelay 垫在**文件里**：真 TTS 的静音是 mp3 内容的一部分，
      // 所以它也必须进 ffprobe 实测时长（durations.json 与时间轴都该看见它）。
      const args = [
        "-v", "error",
        "-f", "lavfi",
        "-i", `sine=frequency=${base + step * 110}:sample_rate=${profile.sampleRate}:duration=${seconds}`,
      ];
      if (profile.leadSilenceMs > 0) {
        args.push("-af", `adelay=${profile.leadSilenceMs}:all=1`);
      }
      args.push("-ac", String(profile.channels), "-c:a", "libmp3lame", "-q:a", "9", abs, "-y");
      runFfmpeg(args, opts.ffmpegPath);
      // 写进 durations.json 的必须是**实测**（编解码后 mp3 比请求长度多出帧对齐的零头）
      durations[chapter.id].push(probeDurationMs(abs, opts.ffprobePath));
      files.push(rel);
      written.add(abs);
    });
  }

  const durationsAbs = path.join(repoRoot, DURATIONS_FILE);
  fs.mkdirSync(path.dirname(durationsAbs), { recursive: true });
  fs.writeFileSync(durationsAbs, `${JSON.stringify(durations, null, 2)}\n`);

  return { files, durationsFile: DURATIONS_FILE, durations, staleFiles: scanStale(repoRoot, opts.chapters, written) };
}

/** 目标目录里不属于本次写出的 mp3（只报不删）。 */
function scanStale(
  repoRoot: string,
  chapters: readonly MockAudioChapter[],
  written: ReadonlySet<string>,
): string[] {
  const stale: string[] = [];
  for (const chapter of chapters) {
    const dir = path.join(repoRoot, AUDIO_DIR, chapter.folder);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      if (!name.endsWith(".mp3") || written.has(abs)) continue;
      stale.push(path.posix.join(AUDIO_DIR, chapter.folder, name));
    }
  }
  return stale;
}
