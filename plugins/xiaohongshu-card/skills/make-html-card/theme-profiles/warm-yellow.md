---
name: warm-yellow
description: 暖黄风主题——小红书金融投教默认风格，暖黄底+白卡+红强调+兰亭黑
---

# 主题：warm-yellow（暖黄风）

小红书金融投教的**默认主题**。暖黄底 + 白色圆角卡片 + 红色强调 + 方正兰亭黑。

## 风格说明（给 AI 读）

- **气质**：亲和、温暖、专业但不严肃，适合投教科普。
- **配色逻辑**：暖黄底（#fff1cc / #faf3e1）做温暖基调，白色卡片承载内容，红色（#d22727）
  只用于强调（主题词、段落标题、关键词、CTA）——**红色是稀缺资源，不要滥用**，一份卡片里
  红色占比过高会显得廉价、刺眼。
- **配图建议**：封面配图区用暖色调照片或插画；正文卡默认不用图，靠关键词高亮做视觉节奏。
- **raw 逃生舱**（若用，见 `references/component-policy.md`）：图表 / 图解用红色描边 + 黑色
  文字 + 白/黄底，**不要渐变、不要阴影**，保持扁平，和暖黄底协调。

## :root 变量值（切换到此主题时，把这组值写进每张卡片 `<style>` 的 `:root`）

```css
:root {
  --xhs-bg-cover: #fff1cc;
  --xhs-bg-content: #faf3e1;
  --xhs-card-bg: #ffffff;
  --xhs-card-border: #000000;
  --xhs-accent: #d22727;
  --xhs-text-primary: #000000;
  --xhs-text-secondary: #2d2727;
  --xhs-on-accent: #ffffff;
  --xhs-hero-size: 220px;
  --xhs-subtitle-zh-size: 80px;
  --xhs-subtitle-en-size: 45px;
  --xhs-title-size: 64px;
  --xhs-body-size: 40px;
  --xhs-cta-size: 32px;
  --xhs-disclaimer-size: 28px;
  --xhs-hero-ls: 17.6px;
  --xhs-subtitle-zh-ls: 8px;
  --xhs-subtitle-en-ls: 4.5px;
  --xhs-title-ls: 7.68px;
  --xhs-body-ls: 4px;
  --xhs-cta-ls: 3px;
  --xhs-disclaimer-ls: 1.4px;
}
```

## 不主题化的部分（所有主题共享 · 小红书规格）

- 画布 1242×1660，白卡 1151×1580，圆角 39px，底边框 5px
- 字体族：方正兰亭黑系列（FZLanTingHeiS-*）
- 字重：Heavy 900 / ExtraBold 800 / Bold 700 / DemiBold 600 / Medium 500 / Regular 400
- 风险提示：固定文案 + absolute 定位（合规红线，见 `references/repair-policy.md`）

## 新增主题时的约束

新主题只改 `:root` 的颜色 / 字号 / letter-spacing，**不得动**卡片尺寸、字体族、字重、
风险提示。新主题要在此目录加一份 `<id>.md`（本文件结构）并在 `index.json` 注册。
