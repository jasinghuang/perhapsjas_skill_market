---
name: design-tokens
description: 小红书 HTML 图文卡片设计变量参考，从 Figma 设计稿中提取
---

# 设计变量参考

> 所有数值从 Figma 设计稿 (fileKey: BdRa400gYkfc11noqbtpR4) 精确提取。
> 本文件是**默认主题 warm-yellow** 的完整 tokens，也是创建新布局时的变量命名参考。

**主题化边界**：颜色 / 字号 / letter-spacing 是主题变量（见 `theme-profiles/warm-yellow.md`
的 `:root`，其他主题可覆盖）；画布尺寸 / 字体族 / 字重 / 间距 / 封面定位是**所有主题共享的
规格**，不随主题变。布局模板已用 `--xhs-*` CSS 变量，切换主题 = 替换 `:root` 值。

## 画布与卡片

| 参数 | 值 |
|------|-----|
| 画布尺寸 | 1242 × 1660 px |
| 白色卡片 | 1151 × 1580 px，水平垂直居中 |
| 卡片圆角 | 39px |
| 底部边框 | 5px solid #000 |
| 卡片内边距 | padding: 70px 45px |

## 颜色

| 变量名 | 值 | 用途 |
|--------|-----|------|
| bg-cover | #fff1cc | 封面背景暖黄 |
| bg-content | #faf3e1 | 正文背景暖黄 |
| card-bg | #ffffff | 白色卡片 |
| accent | #d22727 | 红色强调 |
| text-primary | #000000 | 主文字黑 |
| text-secondary | #2d2727 | 次要文字 |
| card-border | #000000 | 底部边框 |

## 字体

方正兰亭黑系列（FZLanTingHeiS）：

| 字重名 | font-weight | 后缀 | 用途 |
|--------|-------------|------|------|
| Regular | 400 | -R-GB | 风险提示 |
| Medium | 500 | -M-GB | 正文 |
| DemiBold | 600 | -DB-GB | 英文副标题 |
| Bold | 700 | -B-GB | 中文副标题 |
| ExtraBold | 800 | -EB-GB | 段落标题、关键词 |
| Heavy | 900 | -H-GB | 封面主题词 |

## 排版规范

| 用途 | 类名 | font-size | font-weight | letter-spacing | line-height | color |
|------|------|-----------|-------------|----------------|-------------|-------|
| 封面主题词 | hero-title | 220px | 900 | 17.6px | normal | #d22727 |
| 封面中文副标题 | cover-subtitle-zh | 80px | 700 | 8px | normal | #000000 |
| 封面英文副标题 | cover-subtitle-en | 45px | 600 | 4.5px | normal | #d22727 |
| 段落标题 | section-title | 64px | 800 | 7.68px | normal | #d22727 |
| 正文 | body-text | 40px | 500 | 4px | 1.42 | #000000 |
| 关键词高亮 | highlight | 40px | 800 | 4px | 1.42 | #d22727 |
| 风险提示 | disclaimer | 28px | 400 | 1.4px | 1.18 | #2d2727 |

## 间距

| 参数 | 值 |
|------|-----|
| 卡片内边距 | 70px 45px |
| 段落标题 → 正文 | margin-bottom: 30px |
| 正文段落间 | margin-bottom: 15px |
| 两个段落块之间 | margin-top: 50px |
| 风险提示 | margin-top: auto |

## 封面特殊参数

| 元素 | 定位 |
|------|------|
| 中文副标题 | top ~102px, 居中 |
| 英文副标题 | 中文副标题下方, 居中 |
| 主题词 | top ~378px, 居中 |
| 配图区 | top ~611px, left ~129px, 983×770px |
| 风险提示 | bottom ~80px, 宽度 ~1123px |
