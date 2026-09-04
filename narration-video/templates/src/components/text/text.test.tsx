import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { HeroTitle, Kicker, BodyCopy, QuoteBlock } from "./";

beforeEach(() => setRenderMode(false));
afterEach(() => {
  setRenderMode(false);
  // vitest 未开 globals，RTL 不自动注册 cleanup（见 Stage.test.tsx 注释），必须手动清理
  cleanup();
});

describe("文字组组件", () => {
  it("四个组件默认变体渲染 + 类名约定", () => {
    const { getByTestId } = render(
      <div>
        <HeroTitle data-testid="t1">大标题</HeroTitle>
        <Kicker data-testid="t2">CHAPTER 01</Kicker>
        <BodyCopy data-testid="t3">正文</BodyCopy>
        <QuoteBlock data-testid="t4">引用</QuoteBlock>
      </div>,
    );
    expect(getByTestId("t1").className).toContain("cdp-hero-title");
    expect(getByTestId("t2").className).toContain("cdp-kicker");
    expect(getByTestId("t3").className).toContain("cdp-body-copy");
    expect(getByTestId("t4").className).toContain("cdp-quote-block");
  });

  it("每组件至少 2 个变体", () => {
    const { getByTestId } = render(
      <div>
        <HeroTitle variant="stamp" data-testid="t1">x</HeroTitle>
        <Kicker variant="pill" data-testid="t2">x</Kicker>
        <BodyCopy variant="lede" data-testid="t3">x</BodyCopy>
        <QuoteBlock variant="block" data-testid="t4">x</QuoteBlock>
      </div>,
    );
    expect(getByTestId("t1").className).toContain("cdp-hero-title-stamp");
    expect(getByTestId("t2").className).toContain("cdp-kicker-pill");
    expect(getByTestId("t3").className).toContain("cdp-body-copy-lede");
    expect(getByTestId("t4").className).toContain("cdp-quote-block-block");
  });

  it("reveal 走引擎注册表、卸载 dispose（抽 HeroTitle 验证）", () => {
    const { unmount } = render(<HeroTitle reveal="rise">x</HeroTitle>);
    expect(registrySize()).toBeGreaterThan(0);
    unmount();
    expect(registrySize()).toBe(0);
  });
});
