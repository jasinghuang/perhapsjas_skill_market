---
name: srt-html
description: >
  SRT 字幕转 HTML 动画工具。将标准 SRT 字幕文件转换为带 Karaoke 逐字高亮动画的 HTML 页面。
  支持两种模式：视频+字幕叠加播放（player）、纯字幕动画播放（lyric）。
  当用户要生成字幕动画、字幕HTML、歌词动画、字幕可视化、karaoke字幕、
  srt转html、字幕转网页、字幕播放器时触发此 skill。
  配色参考 Resend 设计系统，字体使用方正兰亭黑。
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
```

## 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `srt_file` | 输入 SRT 文件路径 | 必需 |
| `--video` | 视频文件路径（生成 player 版） | 无 |
| `--lyric` | 生成纯字幕动画版 | false |
| `--style` | 动画样式（当前仅 karaoke） | karaoke |
| `--output, -o` | 输出目录 | SRT 同目录 |

不加 `--video` 也不加 `--lyric` 时，默认生成 lyric 版。

## 输出

- `--video`：生成 `{srt名}_player.html`，内含视频播放器 + 字幕叠加
- `--lyric`：生成 `{srt名}_lyric.html`，纯字幕动画播放

## 视觉参数

- 高亮色：`#ff801f`（Resend 暖橙）
- 未读色：`#f0f0f0`（近白）
- 底栏：`rgba(0,0,0,0.50)` + 模糊
- 描边：`-webkit-text-stroke: 2.5px`
- 字体：方正兰亭黑（需预装）
- 字间距：0.12em

## 与其他 skill 配合

```
video-downloader → audio-transcribe → text-refine → srt-html
    下载视频          转录字幕          校准字幕      生成字幕HTML
```

## 示例

```
用户: 把这个字幕转成动画字幕 subtitle.srt --video clip.mp4
用户: 生成歌词字幕动画 audio.srt
用户: srt-html video.srt --video video.mp4 --lyric
```
