---
name: srt-html
description: >
  SRT 字幕转 HTML 动画工具。将标准 SRT 字幕文件转换为带动画的 HTML 页面。
  支持四种动画样式（karaoke、fade、typewriter、word-karaoke）、
  五种配色预设（resend、neon、sakura、ocean、fire）、
  双语字幕、字幕拖拽定位、进度条和字幕列表导航。
  支持两种模式：视频+字幕叠加播放（player）、纯字幕动画播放（lyric）。
  当用户要生成字幕动画、字幕HTML、歌词动画、字幕可视化、karaoke字幕、
  srt转html、字幕转网页、字幕播放器时触发此 skill。
  依赖 jinja2，脚本自动安装。
---

# srt-html

将 SRT 字幕文件转换为带动画效果的 HTML 页面。

## 首次依赖检查

脚本自动检测并安装 jinja2：

```bash
pip install jinja2
```

## 使用方法

```bash
# 纯字幕动画播放（默认）
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py subtitle.srt

# 视频 + 字幕叠加
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py subtitle.srt --video video.mp4

# 指定输出目录
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py subtitle.srt -o ~/Desktop

# 同时生成两种模式
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py subtitle.srt --video video.mp4 --lyric

# 使用 neon 配色预设
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py subtitle.srt --palette neon

# 自定义颜色
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py subtitle.srt --highlight-color #ff0000

# 使用 fade 动画样式
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py subtitle.srt --style fade

# 双语字幕（中英）
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py zh.srt --srt2 en.srt

# 英文按词高亮
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py en.srt --style word-karaoke

# 自定义字体
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py subtitle.srt --font-family "Noto Sans SC"
```

## 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `srt_file` | 输入 SRT 文件路径 | 必需 |
| `--video` | 视频文件路径（生成 player 版） | 无 |
| `--lyric` | 生成纯字幕动画版 | false |
| `--style` | 动画样式：karaoke / fade / typewriter / word-karaoke | karaoke |
| `--output, -o` | 输出目录 | SRT 同目录 |
| `--palette` | 配色预设：resend / neon / sakura / ocean / fire | resend |
| `--highlight-color` | 覆盖高亮色（如 `#ff0000`） | 跟随 palette |
| `--unhighlight-color` | 覆盖未高亮色 | 跟随 palette |
| `--bar-bg` | 覆盖字幕栏背景色 | 跟随 palette |
| `--font-family` | 字体名称 | FZLanTingHei |
| `--srt2` | 第二语言 SRT 文件路径（双语字幕） | 无 |

不加 `--video` 也不加 `--lyric` 时，默认生成 lyric 版。

## 输出

- `--video`：生成 `{srt名}_player.html`，内含视频播放器 + 字幕叠加
- `--lyric`：生成 `{srt名}_lyric.html`，纯字幕动画播放（含进度条和字幕列表导航）

## 动画样式

| 样式 | 说明 |
|------|------|
| `karaoke` | 逐字符高亮扫过（默认） |
| `fade` | 整句淡入淡出 |
| `typewriter` | 逐字打字机效果，带闪烁光标 |
| `word-karaoke` | 按单词高亮（适合英文） |

## 配色预设

| 预设 | 高亮色 | 未读色 | 风格 |
|------|--------|--------|------|
| `resend` | `#ff801f` 暖橙 | `#f0f0f0` 近白 | Resend 风格（默认） |
| `neon` | `#00ffaa` 荧光绿 | `#2a2a3a` 暗灰 | 赛博朋克 |
| `sakura` | `#ff6b9d` 樱粉 | `#f0e6ea` 淡粉 | 日系 |
| `ocean` | `#00b4d8` 天蓝 | `#caf0f8` 浅蓝 | 海洋 |
| `fire` | `#ff4500` 烈橙红 | `#ffe8cc` 暖黄 | 火焰 |

## 交互功能

- **字幕拖拽**：鼠标拖拽字幕区域可上下调整位置
- **进度条**：lyric 模式下方进度条，点击可跳转
- **字幕列表**：lyric 模式右侧字幕列表，点击可跳转到对应时间点
- **双语字幕**：传入 `--srt2` 后，副语言字幕显示在主字幕下方

## 与其他 skill 配合

```
video-downloader → audio-transcribe → text-refine → srt-html
    下载视频          转录字幕          校准字幕      生成字幕HTML
```

## 示例

```
用户: 把这个字幕转成动画字幕 subtitle.srt --video clip.mp4
用户: 生成歌词字幕动画 audio.srt
用户: srt-html video.srt --video video.mp4 --lyric --palette neon
用户: 把英文字幕按词高亮 en.srt --style word-karaoke
用户: 生成中英双语字幕 zh.srt --srt2 en.srt --video clip.mp4
```
