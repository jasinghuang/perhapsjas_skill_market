import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { registrySize, setRenderMode } from "../../engine/animationRuntime";
import { HeroTitle, Kicker, BodyCopy, QuoteBlock, NumberPill, DeltaText } from "./";

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

  describe("HeroTitle", () => {
    it("reveal 走引擎注册表、卸载 dispose（抽 HeroTitle 验证）", () => {
      const { unmount } = render(<HeroTitle reveal="rise">x</HeroTitle>);
      expect(registrySize()).toBeGreaterThan(0);
      unmount();
      expect(registrySize()).toBe(0);
    });

    it("HeroTitle size prop 映射字阶类名（默认 display-1）", () => {
      const { getByTestId } = render(
        <div>
          <HeroTitle data-testid="s0">默认</HeroTitle>
          <HeroTitle size="display-2" data-testid="s1">x</HeroTitle>
          <HeroTitle size="h1" data-testid="s2">x</HeroTitle>
          <HeroTitle size="h2" data-testid="s3">x</HeroTitle>
        </div>,
      );
      expect(getByTestId("s0").className).toContain("cdp-hero-title-size-display-1");
      expect(getByTestId("s1").className).toContain("cdp-hero-title-size-display-2");
      expect(getByTestId("s2").className).toContain("cdp-hero-title-size-h1");
      expect(getByTestId("s3").className).toContain("cdp-hero-title-size-h2");
    });

    it("HeroTitle latin+cn 双语双行渲染 + children 兼容不变（十七轮 F1）", () => {
      const { getByTestId } = render(
        <div>
          <HeroTitle latin="CREATIVE" cn="创意模式" data-testid="bi" />
          <HeroTitle data-testid="legacy">旧用法</HeroTitle>
        </div>,
      );
      const bi = getByTestId("bi");
      expect(bi.querySelector(".cdp-hero-title-latin")).not.toBeNull();
      expect(bi.querySelector(".cdp-hero-title-cn")).not.toBeNull();
      expect(bi.querySelector(".cdp-hero-title-latin")!.textContent).toBe("CREATIVE");
      expect(bi.querySelector(".cdp-hero-title-cn")!.textContent).toBe("创意模式");
      expect(getByTestId("legacy").textContent).toBe("旧用法");
    });
  });

  describe("NumberPill", () => {
    it("NumberPill 三变体类名 + 数字渲染", () => {
      const { getByTestId } = render(
        <div>
          <NumberPill number="01" data-testid="p1" />
          <NumberPill number="02" variant="accent" data-testid="p2" />
          <NumberPill number="03" variant="invert" data-testid="p3" />
        </div>,
      );
      expect(getByTestId("p1").className).toContain("cdp-number-pill");
      expect(getByTestId("p1").textContent).toBe("01");
      expect(getByTestId("p2").className).toContain("cdp-number-pill-accent");
      expect(getByTestId("p3").className).toContain("cdp-number-pill-invert");
    });
  });

  describe("DeltaText", () => {
    it("DeltaText：涨跌片段着色类名（涨橙跌绿）+ 无片段原样", () => {
      const { container, getByTestId } = render(
        <div>
          <BodyCopy data-testid="dt-up"><DeltaText text="营收 +9.52% 收官" /></BodyCopy>
          <BodyCopy data-testid="dt-down"><DeltaText text="净利 -3.20%" /></BodyCopy>
          <BodyCopy data-testid="dt-none"><DeltaText text="无涨跌片段" /></BodyCopy>
        </div>,
      );
      expect(getByTestId("dt-up").querySelector(".cdp-delta-text-up")).toHaveTextContent("+9.52%");
      expect(getByTestId("dt-down").querySelector(".cdp-delta-text-down")).toHaveTextContent("-3.20%");
      // 无匹配原样输出：零包装 span
      expect(container.querySelectorAll(".cdp-delta-text")).toHaveLength(2);
      expect(getByTestId("dt-none")).toHaveTextContent("无涨跌片段");
    });
  });
});
