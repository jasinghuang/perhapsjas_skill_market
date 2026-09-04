import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStepper } from "./useStepper";

const STEPS = [3, 2]; // 第 0 章 3 步、第 1 章 2 步

beforeEach(() => {
  localStorage.clear();
});

describe("useStepper", () => {
  it("初始 (0,0) 且 atStart", () => {
    const { result } = renderHook(() => useStepper("demo", STEPS, false));
    expect(result.current.chapter).toBe(0);
    expect(result.current.step).toBe(0);
    expect(result.current.atStart).toBe(true);
    expect(result.current.atEnd).toBe(false);
  });

  it("next 跨章推进、末步不越界", () => {
    const { result } = renderHook(() => useStepper("demo", STEPS, false));
    act(() => result.current.next()); // (0,1)
    act(() => result.current.next()); // (0,2)
    act(() => result.current.next()); // (1,0)
    expect(result.current.chapter).toBe(1);
    expect(result.current.step).toBe(0);
    act(() => result.current.next()); // (1,1)
    act(() => result.current.next()); // 越界 → 原地
    expect(result.current.atEnd).toBe(true);
    expect(result.current.step).toBe(1);
  });

  it("prev 回退且首步不越界", () => {
    const { result } = renderHook(() => useStepper("demo", STEPS, false));
    act(() => result.current.jumpTo(1, 1));
    act(() => result.current.prev());
    expect(result.current).toMatchObject({ chapter: 1, step: 0 });
    act(() => result.current.prev());
    expect(result.current).toMatchObject({ chapter: 0, step: 2 });
    act(() => result.current.jumpTo(0, 0));
    act(() => result.current.prev());
    expect(result.current).toMatchObject({ chapter: 0, step: 0 });
  });

  it("jumpTo 越界被 clamp", () => {
    const { result } = renderHook(() => useStepper("demo", STEPS, false));
    act(() => result.current.jumpTo(9, 9));
    expect(result.current).toMatchObject({ chapter: 1, step: 1 });
  });

  it("游标持久化：同 slug 同步数 remount 恢复", () => {
    const first = renderHook(() => useStepper("demo", STEPS, false));
    act(() => first.result.current.next());
    first.unmount();
    const second = renderHook(() => useStepper("demo", STEPS, false));
    expect(second.result.current).toMatchObject({ chapter: 0, step: 1 });
  });

  it("内容 hash 失效：步数变化 → key 变化 → 不恢复旧游标", () => {
    const first = renderHook(() => useStepper("demo", STEPS, false));
    act(() => first.result.current.next());
    first.unmount();
    const second = renderHook(() => useStepper("demo", [4, 2], false));
    expect(second.result.current).toMatchObject({ chapter: 0, step: 0 });
  });

  it("autoFromStart：忽略已存游标从 (0,0) 起播（原版 ?auto=1 续播 bug 修复）", () => {
    const first = renderHook(() => useStepper("demo", STEPS, false));
    act(() => first.result.current.next());
    first.unmount();
    const second = renderHook(() => useStepper("demo", STEPS, true));
    expect(second.result.current).toMatchObject({ chapter: 0, step: 0 });
  });
});
