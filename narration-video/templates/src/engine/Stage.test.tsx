import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Stage } from "./Stage";

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
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  // Ruling 4: jsdom 元素通过原型链调用 getBoundingClientRect，stubGlobal 拦不到，
  // 必须 spy Element.prototype，否则 scale 恒为 0。
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    width: 960,
    height: 540,
    top: 0,
    left: 0,
    right: 960,
    bottom: 540,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

// vitest 未开 globals，RTL 不会自动注册 afterEach(cleanup)；screen 查询会命中
// 上一个用例残留的 DOM（如"Found multiple elements"），必须手动清理。
afterEach(() => {
  cleanup();
});

describe("Stage", () => {
  it("按舞台尺寸渲染 frame 并应用缩放", () => {
    render(
      <Stage
        dims={{ width: 1920, height: 1080 }}
        caption=""
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      >
        <div data-testid="scene">场景</div>
      </Stage>,
    );
    const frame = screen.getByTestId("stage-frame");
    expect(frame).toHaveStyle({ width: "1920px", height: "1080px" });
    expect(frame).toHaveStyle({ transform: "scale(0.5)" });
    expect(screen.getByTestId("scene")).toBeInTheDocument();
  });

  it("渲染字幕文本", () => {
    render(
      <Stage dims={{ width: 1920, height: 1080 }} caption="当前口播" onPlay={() => {}} onPause={() => {}} onStop={() => {}}>
        <div />
      </Stage>,
    );
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("当前口播");
  });

  it("三个控制按钮回调", () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onStop = vi.fn();
    render(
      <Stage dims={{ width: 1920, height: 1080 }} caption="" onPlay={onPlay} onPause={onPause} onStop={onStop}>
        <div />
      </Stage>,
    );
    fireEvent.click(screen.getByTestId("btn-play"));
    fireEvent.click(screen.getByTestId("btn-pause"));
    fireEvent.click(screen.getByTestId("btn-stop"));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("noUi 模式隐藏控制条（录屏/渲染）", () => {
    render(
      <Stage noUi dims={{ width: 1920, height: 1080 }} caption="" onPlay={() => {}} onPause={() => {}} onStop={() => {}}>
        <div />
      </Stage>,
    );
    expect(screen.queryByTestId("transport")).not.toBeInTheDocument();
  });
});
