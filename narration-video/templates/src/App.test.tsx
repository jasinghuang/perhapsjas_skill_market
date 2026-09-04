import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string | null = null;
  ended = false;
  onended: (() => void) | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  play() {}
  pause() {}
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(public cb: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("Audio", FakeAudio);
  // jsdom 无 ResizeObserver（Stage → useStageScale 挂载即用），与 Stage.test.tsx 同法桩掉
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  FakeAudio.instances = [];
  FakeResizeObserver.instances = [];
  localStorage.clear();
  // Ruling 5: 空 narration 步的兜底 setTimeout（1500ms）用假计时器接住，避免真实计时器泄漏到测试后
  vi.useFakeTimers();
});

afterEach(() => {
  // vitest 未开 globals，RTL 不自动注册 cleanup（见 Stage.test.tsx 注释），必须手动清理
  cleanup();
  vi.useRealTimers();
});

describe("App 装配", () => {
  it("渲染当前章节场景 + 框架层字幕", () => {
    render(<App />);
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("这是第一句口播。");
  });

  it("方向键推进场景（开发调试，藏在无 UI 模式之外不影响）", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("scene-1")).toBeInTheDocument();
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("这是第二句口播。");
  });

  it("停止按钮回到起点", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.click(screen.getByTestId("btn-stop"));
    expect(screen.getByTestId("scene-0")).toBeInTheDocument();
  });

  it("空 narration 步不显示字幕", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByTestId("scene-2")).toBeInTheDocument();
    expect(screen.queryByTestId("caption-layer")).not.toBeInTheDocument();
  });
});
