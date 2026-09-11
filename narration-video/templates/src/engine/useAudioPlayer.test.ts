import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAudioPlayer } from "./useAudioPlayer";
import { register, setRenderMode } from "./animationRuntime";

class FakeAudio {
  static instances: FakeAudio[] = [];
  private _src: string | null = null;
  /** 资源选择失败后置位（真实 HTMLMediaElement.error 同义）；赋新 src 时复归 */
  error: { code: number } | null = null;
  ended = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  playCalls = 0;
  pauseCalls = 0;
  constructor() {
    FakeAudio.instances.push(this);
  }
  get src() {
    return this._src;
  }
  set src(v: string | null) {
    this._src = v;
    this.error = null; // 赋 src 重跑资源选择 → error 复归（浏览器语义）
  }
  play() {
    this.playCalls++;
    this.ended = false;
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls++;
  }
  end() {
    this.ended = true;
    this.onended?.();
  }
  fail() {
    this.error = { code: 4 }; // MEDIA_ERR_SRC_NOT_SUPPORTED（404 同类）
    this.onerror?.();
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

  it("音频加载失败（404）：onerror 视同无音频走估时兜底推进", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.playStep("你好", "1.mp3", 400, onDone);
    });
    const audio = FakeAudio.instances[0];
    expect(audio.src).toBe("1.mp3");

    act(() => { audio.fail(); }); // 模拟 404 加载失败触发 onerror
    vi.advanceTimersByTime(1500); // 估时到点（2 字×250 < 1500 下限）
    vi.advanceTimersByTime(400); // 动画窗口已空 → 直接进停留垫
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("resume 幂等：开头清悬挂计时器，pause 后双击播放不双推进", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    act(() => { result.current.playStep("测试", null, 400, onDone); }); // T1 @1500（估时）
    vi.advanceTimersByTime(500);
    act(() => { result.current.resume(); }); // 无 fix：T1 悬挂（timerRef 被 T2 @2000 顶掉）
    vi.advanceTimersByTime(500);
    act(() => { result.current.pause(); }); // clearTimer 只清最新的 T2，T1 仍悬挂
    vi.advanceTimersByTime(100);
    act(() => { result.current.resume(); }); // 双击播放第 1 次：T3 @2600
    act(() => { result.current.resume(); }); // 双击播放第 2 次：T4 @2700
    vi.advanceTimersByTime(5000);
    expect(onDone).toHaveBeenCalledTimes(1); // 无 fix：T1@1500 推进一次 + T3@2600 再推进 → 2 次
  });

  it("resume-after-404：加载失败后暂停再播放走估时兜底，不卡死", () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useAudioPlayer());
    act(() => {
      result.current.playStep("你好", "1.mp3", 400, onDone);
    });
    const audio = FakeAudio.instances[0];

    act(() => { audio.fail(); }); // 404 → onerror 武装估时计时器
    vi.advanceTimersByTime(200);
    act(() => { result.current.pause(); }); // 用户在估时等待中暂停（计时器被清）
    vi.advanceTimersByTime(5000);
    expect(onDone).not.toHaveBeenCalled();

    act(() => { result.current.resume(); }); // 失败资源上 play() 不再触发 error：无守卫则永久卡死
    vi.advanceTimersByTime(1500 + 50 + 400);
    expect(onDone).toHaveBeenCalledTimes(1); // 无守卫：0 次（死锁）
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
