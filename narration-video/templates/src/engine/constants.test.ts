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
