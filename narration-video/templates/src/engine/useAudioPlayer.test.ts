import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAudioPlayer } from "./useAudioPlayer";
import { register, setRenderMode } from "./animationRuntime";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string | null = null;
  ended = false;
  onended: (() => void) | null = null;
  playCalls = 0;
  pauseCalls = 0;
  constructor() {
    FakeAudio.instances.push(this);
  }
  play() {
    this.playCalls++;
    this.ended = false;
  }
  pause() {
    this.pauseCalls++;
  }
  end() {
    this.ended = true;
    this.onended?.();
  }
}

function makePendingAnim(durationMs: number) {
  let finished = false;
  const h = register({
    durationMs,
    seek: () => {},
    isFinished: () => finished,
    pause: () => {},
    play: () => {},
  });
  return { ...h, markFinished: () => { finished = true; } };
}

beforeEach(() => {
  vi.useFakeTimers();
  setRenderMode(false);
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAudioPlayer", () => {
  it("有音频：audio.ended 且 动画窗口结束 → 停留垫 → onDone", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    const pending = makePendingAnim(1000);

    act(() => {
      result.current.playStep("你好", "1.mp3", 400, onDone);
    });
    const audio = FakeAudio.instances[0];
    expect(audio.src).toBe("1.mp3");

    act(() => { audio.end(); }); // 音频结束但动画未结束
    vi.advanceTimersByTime(500);
    expect(onDone).not.toHaveBeenCalled(); // 等待动画

    act(() => { pending.markFinished(); });
    vi.advanceTimersByTime(100); // 轮询发现动画结束
    expect(onDone).not.toHaveBeenCalled(); // 还在停留垫
    vi.advanceTimersByTime(400);
    expect(onDone).toHaveBeenCalledTimes(1);
    pending.dispose();
  });

  it("无音频兜底：有文本按 max(1500, 字数×250) 估时", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.playStep("测试", null, 400, onDone);
    });
    vi.advanceTimersByTime(1499);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); // 估时 1500ms 到点（2 字×250 < 1500 下限）
    vi.advanceTimersByTime(50); // 动画窗口已空 → 直接进垫
    vi.advanceTimersByTime(400);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("无音频兜底：空 narration 按 1500ms 默认停留", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.playStep("", null, 400, onDone);
    });
    vi.advanceTimersByTime(1500 + 50 + 400);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("pause 冻结音频与动画；resume 恢复推进（含动画等待中暂停）", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    const pending = makePendingAnim(1000);

    act(() => { result.current.playStep("你好", "1.mp3", 400, onDone); });
    const audio = FakeAudio.instances[0];
    act(() => { audio.end(); }); // 进入动画等待
    act(() => { result.current.pause(); });
    vi.advanceTimersByTime(1000);
    expect(onDone).not.toHaveBeenCalled(); // 暂停期间不推进

    act(() => { pending.markFinished(); });
    act(() => { result.current.resume(); }); // 音频已 ended → 重新等待动画 → 垫 → 推进
    vi.advanceTimersByTime(50 + 400);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(audio.pauseCalls).toBeGreaterThan(0);
    pending.dispose();
  });

  it("stop 清空定时与音频", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    act(() => { result.current.playStep("你好", "1.mp3", 400, onDone); });
    act(() => { result.current.stop(); });
    vi.advanceTimersByTime(10000);
    expect(onDone).not.toHaveBeenCalled();
  });
});
