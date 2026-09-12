// 引擎单一常量源：运行时与渲染共用同一份值，杜绝双处漂移（§8.1 细节一致性）。

/** 引擎版本（scaffold 写入 .engine-version，check 对比提示升级） */
export const ENGINE_VERSION = "0.1.0";

/** 停留垫引擎默认（§3.1 已定；档案可覆盖、分镜每帧可调） */
export const DEFAULT_HOLD_MS = 400;

/** 音频缺失时的估时兜底：字数 × 250ms，下限 1500ms（继承原版 App.tsx）。
 *  公式本体只有一份，在 `hold.ts` 的 `estimateNarrationMs`（预览与渲染共用；M5a Task 2 / Ruling R5）。 */
export const AUDIO_ESTIMATE_CHAR_MS = 250;
export const AUDIO_ESTIMATE_MIN_MS = 1500;

/** 空 narration 无声过场步的默认停留 */
export const EMPTY_NARRATION_MIN_MS = 1500;

/** 渲染采样帧率 */
export const SAMPLE_FPS = 30;

/** localStorage 游标 key 前缀 */
export const CURSOR_KEY_PREFIX = "presentation-cursor";
