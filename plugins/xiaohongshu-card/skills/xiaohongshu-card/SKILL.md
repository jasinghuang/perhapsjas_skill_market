---
name: xiaohongshu-card
description: 将小红书文案转换为精美的 HTML 图文卡片（1242×1660），支持封面/正文/结尾多卡片自动拆分。当用户想将文案转为小红书图文、生成 XHS 卡片、制作图文笔记，或提到"小红书卡片"、"图文卡片"、"XHS card"时使用。
---

# 小红书 HTML 图文卡片

## 这个 Skill 做什么

将用户写好的小红书文案自动转换为精美的 HTML 图文卡片，每张 1242×1660px。

**视觉风格：** 暖黄底 + 白色圆角卡片 + 红色强调 + 方正兰亭黑字体。
**能力：** 智能排版 — 自动拆分段落、分配多卡片布局、标记重点关键词。

## 何时使用

**合适的场景：**
- 小红书图文笔记的文案转图片
- 金融投教内容的卡片化呈现
- 需要多张图片轮播的内容呈现

**不合适的场景：**
- 视频内容（用视频相关 skill）
- 纯文字发布（无需卡片化）
- 横版图片/海报（比例不同）

## 资源文件路径

所有资源文件位于 `${CLAUDE_PLUGIN_ROOT}/skills/xiaohongshu-card/` 下：

```
xiaohongshu-card/
├── SKILL.md                    ← 你正在读
├── assets/
│   └── layouts/                # 按类型分目录的布局模板
│       ├── cover/
│       │   └── default.html    # 封面布局
│       ├── content/
│       │   └── default.html    # 正文布局
│       └── ending/
│           └── default.html    # 结尾布局
└── references/
    ├── design-tokens.md        # 设计变量参考（颜色、字号、间距）
    └── checklist.md            # 质量检查清单
```

## 工作流

### Step 1 · 读取文案，解析结构

**分析输入文案，识别关键元素：**

1. **识别段落锚点**：emoji 前缀（👉、📌、💡 等）或 markdown `##` 标题
2. **识别列表**：`•` / `-` / `1.` / `2.` 等列表格式
3. **识别核心术语**：专业名词、关键数据、需要强调的词组
4. **识别封面元素**：
   - 主题词（最能概括文案主题的 2-4 个字）
   - 是否有固定的栏目名（如"每天一个金融小知识"）
   - 是否有英文副标题需求

### Step 2 · 规划卡片拆分

#### Step 2a · 按锚点预拆分

1. **第一张 = 封面卡片**
   - 提取主题词作为 hero-title
   - 配图区域留占位符（983×770px）

2. **正文按段落标题预拆分**
   - 以 👉 / ## / 【】 等为拆分锚点
   - 每个段落标题 + 其下正文 = 一个"内容块"

3. **结尾 = 合并或独立**
   - 如果文案有明确的总结/CTA 段落，使用结尾布局
   - 如果文案自然收束，合并到最后一张正文卡片

4. **风险提示：每张卡片都有**

#### Step 2b · 填充度校验与流式分配

预拆分后，按"流式填充"重新分配内容到卡片：

**高度估算规则：**
- 段落标题：94px（64px 字号 + 30px 下间距）
- 正文每行：57px（40px × 1.42 行高）
- 每行约 24 个中文字（1061px 内宽 ÷ 44px 字宽+字距）
- 段落间距：15px，段落块间距：50px
- 可用空间：1335px（1405px 风险提示位 - 70px 上内边距）

**填充目标：**
- 每张卡片目标填充 65%~85%（约 870~1135px）
- 低于 65% 的卡片内容偏少，高于 85% 可能与风险提示重叠

**流式填充逻辑：**
1. 依次将内容块往当前卡片里放
2. 段落标题必须跟至少第一段正文在同一张卡
3. 当加入下一段内容会超过 85% 时，剩余内容流到下一张卡
4. 一个段落块的内容可以跨卡，不需要整块塞一张里

### Step 3 · 选择布局并填充

1. 根据卡片类型读取对应布局 HTML 文件：
   - 封面：`${CLAUDE_PLUGIN_ROOT}/skills/xiaohongshu-card/assets/layouts/cover/default.html`
   - 正文：`${CLAUDE_PLUGIN_ROOT}/skills/xiaohongshu-card/assets/layouts/content/default.html`
   - 结尾：`${CLAUDE_PLUGIN_ROOT}/skills/xiaohongshu-card/assets/layouts/ending/default.html`
2. 将解析好的内容填入占位符位置
3. **关键词标记**：将识别出的核心术语用 `<span class="highlight">` 包裹

**占位符替换对照：**

| 占位符 | 内容来源 |
|--------|----------|
| `{{TOPIC}}` | 主题词 |
| `{{COVER_IMAGE}}` | 配图路径（默认用占位色块） |
| `{{SECTION_TITLE_N}}` | 第 N 个段落标题（不含 emoji 前缀，emoji 由布局自带） |
| `{{BODY_PARAGRAPH_N}}` | 正文段落（含 highlight 标记） |
| `{{ENDING_ICON}}` | 结尾页图标 |
| `{{ENDING_TITLE}}` | 结尾标题 |
| `{{SUMMARY_POINT_N}}` | 总结要点 |
| `{{CTA_TEXT}}` | CTA 按钮文案 |

### Step 4 · 自检

读取 `${CLAUDE_PLUGIN_ROOT}/skills/xiaohongshu-card/references/checklist.md`，逐项检查：

**P0（必须通过）：**
- 卡片尺寸 1242×1660
- 字体为兰亭黑系列，字重正确
- letter-spacing 符合 design-tokens.md 规范
- 颜色值正确（封面 #fff1cc / 正文 #faf3e1 / 强调 #d22727）
- 每张卡片有风险提示

**P1（排版质量）：**
- 段落间距统一
- 关键词标记合理（不过度）
- 内容无溢出

创建新布局时参考 `${CLAUDE_PLUGIN_ROOT}/skills/xiaohongshu-card/references/design-tokens.md`。

### Step 5 · 输出

1. 按卡片数量生成对应的 HTML 文件
2. 文件保存在当前工作目录下
3. 文件名格式：`{主题}-card-01.html`, `{主题}-card-02.html`, ...
4. 向用户报告生成的文件列表

### Step 6 · 预览

在浏览器中打开生成的文件，确认视觉效果：

```bash
open "{主题}-card-01.html"
```
