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

  // M5b Task 3：字幕开关（框架级闸门，章节无权干预）。判据是 caption-layer **在不在 DOM**——
  // 成片是整视口截图，层不在 DOM 才等于"字幕不进片"（隐藏 visibility/CSS 会残留占位与样式面）。
  it("noSubs 时字幕不进 DOM（caption 非空也不渲染）", () => {
    render(
      <Stage noSubs dims={{ width: 1920, height: 1080 }} caption="当前口播" onPlay={() => {}} onPause={() => {}} onStop={() => {}}>
        <div />
      </Stage>,
    );
    expect(screen.queryByTestId("caption-layer")).not.toBeInTheDocument();
  });

  it("缺省 / 显式 noSubs={false} 字幕都照常进 DOM（否定式开关：没打开就不关）", () => {
    render(
      <Stage dims={{ width: 1920, height: 1080 }} caption="当前口播" onPlay={() => {}} onPause={() => {}} onStop={() => {}}>
        <div />
      </Stage>,
    );
    expect(screen.getByTestId("caption-layer")).toHaveTextContent("当前口播");
    cleanup();
    render(
      <Stage noSubs={false} dims={{ width: 1920, height: 1080 }} caption="当前口播" onPlay={() => {}} onPause={() => {}} onStop={() => {}}>
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
    // 导出按钮同属控制条（M5b Task 5）：渲染/录屏态下它不在 DOM，成片里不可能出现"导出"字样
    expect(screen.queryByTestId("btn-export")).not.toBeInTheDocument();
  });

  // ── M5b Task 5：导出按钮（§9 的"导出"控制；新建——T3 之前仓库里没有这个按钮） ──

  it("idle：按钮可点，点击回调一次（页面按钮 → 本地渲染服务）", () => {
    const onExport = vi.fn();
    render(
      <Stage dims={{ width: 1920, height: 1080 }} caption="" onPlay={() => {}} onPause={() => {}} onStop={() => {}} onExport={onExport}>
        <div />
      </Stage>,
    );
    const btn = screen.getByTestId("btn-export");
    expect(btn).toHaveTextContent("导出");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onExport).toHaveBeenCalledTimes(1);
    // idle 下既没有进度读数，也没有下载口
    expect(screen.queryByTestId("export-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("link-export-file")).not.toBeInTheDocument();
  });

  it("running：按钮禁用 + 进度读数（done/total 来自服务端，页面不自己猜）", () => {
    render(
      <Stage
        dims={{ width: 1920, height: 1080 }}
        caption=""
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
        onExport={() => {}}
        exportState="running"
        exportProgress={{ done: 2, total: 3 }}
      >
        <div />
      </Stage>,
    );
    expect(screen.getByTestId("btn-export")).toBeDisabled();
    expect(screen.getByTestId("export-progress")).toHaveTextContent("2/3");
  });

  it("running 且总步数未知：读数不给假分数（显示占位）", () => {
    render(
      <Stage
        dims={{ width: 1920, height: 1080 }}
        caption=""
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
        onExport={() => {}}
        exportState="running"
        exportProgress={{ done: 0, total: 0 }}
      >
        <div />
      </Stage>,
    );
    expect(screen.getByTestId("export-progress")).toHaveTextContent("…");
  });

  it("done：出现取件口（同源 /__export/file，附件下载）", () => {
    render(
      <Stage
        dims={{ width: 1920, height: 1080 }}
        caption=""
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
        onExport={() => {}}
        exportState="done"
      >
        <div />
      </Stage>,
    );
    const link = screen.getByTestId("link-export-file");
    expect(link).toHaveAttribute("href", "/__export/file");
    expect(link).toHaveAttribute("download");
  });

  it("unreachable：给启动指引（命令行）——§9「不可达时页面给出启动指引」", () => {
    const onCopy = vi.fn();
    render(
      <Stage
        dims={{ width: 1920, height: 1080 }}
        caption=""
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
        onExport={() => {}}
        exportState="unreachable"
        onCopyExportCommand={onCopy}
      >
        <div />
      </Stage>,
    );
    const hint = screen.getByTestId("export-hint");
    expect(hint).toHaveTextContent("npm run render"); // 指引只用 CLI（I8：不得写别的入口）
    expect(hint).toHaveTextContent("不可达");
    fireEvent.click(screen.getByTestId("btn-export-copy"));
    expect(onCopy).toHaveBeenCalledTimes(1);
    // 不可达不是终态：按钮仍可点（再点一次即重新探活）
    expect(screen.getByTestId("btn-export")).not.toBeDisabled();
  });

  it("failed：显示服务端给的原因，按钮可重试", () => {
    render(
      <Stage
        dims={{ width: 1920, height: 1080 }}
        caption=""
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
        onExport={() => {}}
        exportState="failed"
        exportMessage="渲染退出码 1"
      >
        <div />
      </Stage>,
    );
    expect(screen.getByTestId("export-message")).toHaveTextContent("渲染退出码 1");
    expect(screen.getByTestId("btn-export")).not.toBeDisabled();
  });
});
