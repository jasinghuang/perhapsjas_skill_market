# srt-html — SRT 字幕转 HTML 动画

将标准 SRT 字幕文件转换为带 Karaoke 逐字高亮动画的 HTML 页面。支持两种输出模式：视频+字幕叠加播放、纯字幕动画播放。

## 背景

video-toolkit 插件现有 pipeline：`video-downloader → audio-transcribe → text-refine`。srt-html 是 pipeline 的下游 skill，将校准后的 SRT 文件转换为可在浏览器中播放的字幕动画 HTML。

## 目录结构

```
plugins/video-toolkit/skills/srt-html/
├── SKILL.md                 # skill 描述文档
├── skill_main.py            # 入口脚本（CLI + SRT 解析 + 渲染）
├── requirements.txt         # jinja2
└── templates/
    ├── _base.html.j2        # 公共骨架：CSS、字体、动画 JS
    ├── _karaoke.css.j2      # karaoke 样式 CSS 片段
    ├── player.html.j2       # 用例 B：视频+字幕叠加
    └── lyric.html.j2        # 用例 C：纯字幕动画
```

以后加新动画样式（fade、typewriter 等）只需在 `templates/` 加对应 CSS 片段，通过 `--style` 参数切换。

## CLI 接口

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/srt-html/skill_main.py <srt_file> [选项]
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `srt_file` | 输入 SRT 文件路径 | 必需 |
| `--video` | 视频文件路径（生成 player 版） | 无 |
| `--lyric` | 生成纯字幕动画版 | false |
| `--style` | 动画样式名称 | `karaoke` |
| `--output, -o` | 输出目录 | SRT 同目录 |

**输出文件命名**：`{srt名}_player.html` / `{srt名}_lyric.html`。不加 `--video` 也不加 `--lyric` 时默认生成 lyric 版。

视频路径支持两种方式：CLI 参数传入，或与 SRT 同目录自动检测。生成时写为相对路径。

## SRT 解析

标准 SRT 格式解析，输出结构化数据：

```python
@dataclass
class Subtitle:
    index: int
    start: float    # 秒
    end: float      # 秒
    text: str       # 原始文本
    chars: list     # 逐字拆分后的字符列表
```

逐字动画的时长分配：每条字幕内，每个字符的高亮持续时间 = `(end - start) / 字符数`。

多行文本（一个序号下含 `\n`）合并为一行显示。

边缘处理：时间戳重叠取后一条，空条目跳过，字幕间隙清空显示区。

## 模板架构

使用 Jinja2 模板继承，避免公共代码重复。

`_base.html.j2` 包含：字体声明、字幕定位 CSS、逐字动画 JS 逻辑、`{% block content %}` 占位。

动画样式通过 `{% include style_name + ".css.j2" %}` 动态加载，当前仅有 `_karaoke.css.j2`。

子模板 `player.html.j2` 和 `lyric.html.j2` 继承 base，各自添加专属内容（video 标签 / 播放控制）。

### 模板变量

```python
{
  "subtitles": [{"index":1, "start":1.0, "end":3.0, "text":"...", "chars":["电","影",...]}],
  "video_path": "video.mp4",   # 用例 B，用例 C 为 None
  "font_family": "FZLanTingHei",
  "font_hint": "请在系统中安装方正兰亭黑字体以获得最佳效果",
  "style_name": "karaoke"
}
```

### Karaoke 动画样式（_karaoke.css.j2）

配色参考 Resend 设计系统：
- 高亮色：`#ff801f`（暖橙）
- 未读色：`#f0f0f0`（近白）
- 底栏：`rgba(0,0,0,0.50)` + `backdrop-filter: blur(6px)`

描边方案：双层叠加 + `-webkit-text-stroke: 2.5px rgba(0,0,0,0.85)`。

字体：方正兰亭黑（FZLanTingHei），fallback 到 PingFang SC / Microsoft YaHei。页面顶部显示安装提示。

字间距：`0.12em`（约 1.2 倍）。

## 动画同步

两种用例共用一套动画 JS 逻辑：拿到当前时间 → 匹配 SRT 时间戳 → 计算当前字符索引 → 切换 `.hl` / `.unhl` class。

区别仅在"当前时间"来源：
- 用例 B：`video.currentTime`（随视频播放进度）
- 用例 C：`performance.now()` - 起始时间（纯时间流逝）

用例 B 用 `requestAnimationFrame` 逐帧读取 `video.currentTime` 并插值，不受 `timeupdate` 事件 250ms 粒度限制，实现平滑的逐字扫过。

用例 C 提供播放/暂停/重播控制按钮。

## 首次依赖检查

脚本自动检测并安装 jinja2（`pip install jinja2`）。

## 与其他 skill 的配合

```
video-downloader → audio-transcribe → text-refine → srt-html
    下载视频          转录字幕          校准字幕      生成字幕HTML
```

输入接受 `text-refine` 输出的 SRT 文件，也接受任何标准 SRT 文件。

## 示例

```
用户: 把这个字幕转成动画字幕 video.srt --video video.mp4
用户: 生成歌词字幕动画 audio.srt --lyric
用户: srt-html subtitle.srt --video clip.mp4 --style karaoke
```
