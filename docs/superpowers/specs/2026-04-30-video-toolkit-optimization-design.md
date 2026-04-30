# Video Toolkit Skill 优化设计

## 背景

Video Toolkit 包含三个 skill，存在以下问题：
- SKILL 触发不准（description 写法不当）
- 输出质量不满意（whisper 模型弱，LLM 校准依赖外部 API）
- 首次使用体验差（缺少依赖检查和引导）
- Skill 命名不够直观

## 改动概览

| 旧名 | 新名 | 核心变更 |
|------|------|---------|
| `bili-download` | `video-downloader` | 改名 + 扩展 YouTube 支持 + 优化质量控制 |
| `whisper-transcribe` | `mlx-whisper` | 换 mlx-whisper + large-v3-turbo + 首次模型选择交互 |
| `llm-refine` | `text-refine` | 删除 Python 脚本，改成 Claude agent 直接校准 |

## 文件变更清单

| 操作 | 路径 |
|------|------|
| 重命名目录 | `skills/bili-download/` → `skills/video-downloader/` |
| 重写 | `skills/video-downloader/SKILL.md` |
| 修改 | `skills/video-downloader/skill_main.py` |
| 修改 | `skills/video-downloader/config.json` |
| 重命名目录 | `skills/whisper-transcribe/` → `skills/mlx-whisper/` |
| 重写 | `skills/mlx-whisper/SKILL.md` |
| 重写 | `skills/mlx-whisper/skill_main.py` |
| 修改 | `skills/mlx-whisper/config.json` |
| 删除目录 | `skills/llm-refine/`（整体删除） |
| 新建 | `skills/text-refine/SKILL.md`（纯指令，无 Python 脚本） |
| 更新 | `.claude-plugin/marketplace.json` |
| 更新 | `README.md` |

---

## 1. video-downloader

### 1.1 SKILL.md

```yaml
name: video-downloader
description: >
  视频下载工具，支持 Bilibili 和 YouTube。使用 yt-dlp 下载视频到本地。
  当用户要下载视频、保存视频、离线观看、批量下载、bilibili下载、youtube下载时触发此 skill。
  支持 B站/Bilibili/YouTube/油管链接，支持批量下载、aria2加速、Cookie登录下载。
```

**SKILL.md 主体内容**：

1. **首次依赖检查**
   - 检查 `yt-dlp` 是否安装，未安装则提示 `pip install yt-dlp` 或 `brew install yt-dlp`
   - 可选：检查 `aria2` 是否安装（加速下载用）

2. **用法**
   - 下载单个视频
   - 批量下载（多个 URL 或从文件读取）
   - 只下载音频
   - 使用 Cookie 下载会员视频

3. **质量控制**
   - 预设等级（默认 best）
   - 高级参数：`--resolution`、`--codec`、`--format`

4. **参数参考**（简洁版，不是完整 manpage）

### 1.2 质量控制设计

**预设等级**：

| 预设 | 含义 | yt-dlp format string |
|------|------|---------------------|
| `best`（默认） | 最高画质 | `bestvideo+bestaudio` |
| `high` | 1080p | `bestvideo[height<=1080]+bestaudio/best[height<=1080]` |
| `medium` | 720p | `bestvideo[height<=720]+bestaudio/best[height<=720]` |
| `low` | 480p | `worstvideo[height<=480]+worstaudio/worst` |
| `audio-only` | 只要音频 | `bestaudio`，输出 m4a |

**高级参数**：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--resolution, -r` | 指定分辨率（720/1080/2160） | 无（用预设） |
| `--codec` | 视频编码（h264/h265/vp9/av1） | h264 |
| `--audio-only` | 只下载音频 | false |
| `--format, -f` | 直接传 yt-dlp format string | 无 |

优先级：`--format` > `--resolution` + `--codec` > 预设

### 1.3 skill_main.py 改动

- "Bilibili 视频下载器" → "Video Downloader"
- Cookie 文件路径：`~/bilibili-cookies.txt` → `~/video-cookies.txt`
- `--quicktime` 参数去掉（默认 h264+aac 已兼容）
- 新增 `--audio-only` 参数
- 新增 `--resolution`、`--codec` 参数
- 质量默认值改为 `best`
- URL 自动识别 Bilibili / YouTube，无需用户指定平台

### 1.4 config.json

```json
{
  "download": {
    "output_dir": "~/Downloads",
    "quality": "best",
    "codec": "h264",
    "use_aria2": false
  }
}
```

---

## 2. mlx-whisper

### 2.1 SKILL.md

```yaml
name: mlx-whisper
description: >
  音频/视频转录工具，使用 MLX-Whisper 将视频或音频转录为字幕。
  Apple Silicon 原生加速。当用户要转录、转文字、提取字幕、语音识别、whisper 时触发此 skill。
  输出 SRT 或 Markdown 格式。首次使用会引导选择模型。
```

**SKILL.md 主体内容**：

1. **首次依赖检查**
   - `mlx-whisper`：`pip install mlx-whisper`
   - `ffmpeg`：`brew install ffmpeg`
   - 首次运行时模型会自动从 HuggingFace 下载

2. **首次模型选择交互**（SKILL.md + Python 脚本双重实现）
   - 检测 `config.json` 是否存在
   - 不存在 → 展示模型选项表，询问用户选择，保存到 config.json
   - 存在 → 直接使用配置的模型
   - Python 脚本里同样实现此交互：启动时检测 config.json，缺失则用 `input()` 展示选项表让用户选择

3. **模型选项表**

   | 模型 | 大小 | 速度 | 准确率 | 适合场景 |
   |------|------|------|--------|---------|
   | `base` | ~140MB | 很快 | 一般 | 快速试用，先看效果 |
   | `small` | ~460MB | 快 | 良好 | 快速预览，准确率要求不高 |
   | `large-v3-turbo` | ~800MB | 较快 | 优秀 | 推荐，速度和质量平衡 |
   | `large-v3` | ~3GB | 慢 | 最佳 | 最终版，最高准确率 |
   | `large-v2` | ~3GB | 慢 | 很好 | 备用，某些场景更稳 |

4. **用法**
   - 基本转录
   - 指定输出格式（SRT/MD/JSON）
   - 指定语言
   - 时间码开关
   - 切换模型（`--model` 参数覆盖配置）

### 2.2 skill_main.py 重写

**首次交互逻辑**：

```python
def ensure_config():
    """首次运行时引导用户选择模型，保存到 config.json"""
    if CONFIG_FILE.exists():
        return load_config()

    print("首次使用，请选择 Whisper 模型：")
    models = [
        ("base", "~140MB", "很快", "一般", "快速试用"),
        ("small", "~460MB", "快", "良好", "快速预览"),
        ("large-v3-turbo", "~800MB", "较快", "优秀", "【推荐】速度与质量平衡"),
        ("large-v3", "~3GB", "慢", "最佳", "最高准确率"),
        ("large-v2", "~3GB", "慢", "很好", "备用"),
    ]
    for i, (name, size, speed, quality, note) in enumerate(models, 1):
        print(f"  {i}. {name} ({size}) - {speed}/{quality} - {note}")

    choice = input("请输入编号 [3]: ").strip()
    idx = int(choice) - 1 if choice else 2  # 默认 large-v3-turbo
    selected = models[idx][0]

    config = {
        "model": selected,
        "language": "auto",
        "output_format": "md",
        "keep_timestamps": False
    }
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"✅ 已保存模型设置: {selected}")
    return config
```

**替换 openai-whisper 为 mlx-whisper**：

```python
# 旧
import whisper
model = whisper.load_model("medium")
result = model.transcribe(path, language=lang)

# 新
import mlx_whisper
result = mlx_whisper.transcribe(
    path,
    path_or_hf_repo=get_model_repo(model_name),
    language=lang if lang != "auto" else None
)
```

**模型到 HuggingFace repo 的映射**：

```python
MODEL_REPOS = {
    "base": "mlx-community/whisper-base",
    "small": "mlx-community/whisper-small",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
    "large-v3": "mlx-community/whisper-large-v3",
    "large-v2": "mlx-community/whisper-large-v2",
}
```

**保留**：多格式输出（SRT/MD/JSON）、自动语言检测、繁简转换（zhconv）、时间码开关

**去掉**：config.json 中的 model_size（改为 model）、去掉 tiny/medium 选项

### 2.3 config.json

首次不存在时由交互生成：

```json
{
  "model": "large-v3-turbo",
  "language": "auto",
  "output_format": "md",
  "keep_timestamps": false
}
```

---

## 3. text-refine

### 3.1 核心变化

**删除全部 Python 代码**，SKILL.md 变成纯 Claude 指令。
Claude 自身作为校准引擎，无需外部 API。

### 3.2 SKILL.md

```yaml
name: text-refine
description: >
  字幕/文本校准与翻译工具。Claude 直接校对 ASR 转录文本，
  修正错别字、同音字、专业术语，支持翻译非中文为中文。
  当用户要校准、校对、修正字幕、翻译字幕、精炼文本、refine 时触发此 skill。
  输入 SRT/MD/TXT，输出校准后的 Markdown。
```

**SKILL.md 主体内容**：

1. **首次检查**：无额外依赖

2. **工作流程**：
   - 读取用户指定的字幕文件（SRT/MD/TXT）
   - 自动检测语言（中文/非中文）
   - 非中文 → 翻译成中文
   - 中文 → 直接校准
   - 输出校准后的 Markdown 到同目录 `{原文件名}_refined.md`

3. **校准规则**（从现有 llm-refine 提炼）：
   - 删除 Whisper 冗余词（"叫做"、"所谓的"）—— 删除后句子仍通顺就不要加回
   - 同音字语义判断（基于上下文，不孤立纠错）
   - 专有名词和产品名称必须准确
   - 不改变原意，不添加内容

4. **视频类型自动检测**：
   - 读取文本样本，根据关键词判断类型
   - 医疗（膈肌、骨盆、康复…）→ 医学术语优先
   - 科技（代码、API、Cursor…）→ 产品名称优先
   - 财经（股票、基金、K线…）→ 财经术语优先
   - 通用 → 常见 ASR 错误纠正

5. **分段处理**：
   - 短文件（<200 段）一次处理
   - 长文件分段处理，每段保留前段最后 5 句作为上下文衔接

6. **输出格式**：Markdown

   ```markdown
   # {标题}

   **Refined by**: Claude
   **Refined at**: {时间}
   **Segments**: {段落数}
   **Context**: {主题概要}

   **校准状态**: ✅ 已通过 Claude 校准

   {校准后内容}
   ```

### 3.3 删除的文件

- `skills/llm-refine/skill_main.py`
- `skills/llm-refine/config.json`
- `skills/llm-refine/config.example.json`
- 整个 `skills/llm-refine/` 目录

### 3.4 不再需要的依赖

- `pip install openai`（已删除）

---

## 4. marketplace.json 更新

```json
{
  "name": "Video_Toolkit",
  "owner": {
    "name": "jasing",
    "email": ""
  },
  "metadata": {
    "description": "视频下载、MLX-Whisper转录、Claude文本校准——一站式视频字幕工作流",
    "version": "2.0.0"
  },
  "plugins": [
    {
      "name": "video-toolkit",
      "description": "视频字幕一站式工具：video-downloader + mlx-whisper + text-refine",
      "source": "./",
      "strict": false,
      "skills": [
        "./skills/video-downloader",
        "./skills/mlx-whisper",
        "./skills/text-refine"
      ]
    }
  ]
}
```

## 5. README.md 更新

- 更新 skill 名称表格
- 更新依赖安装说明（mlx-whisper 替代 openai-whisper，去掉 openai）
- 更新工作流示例
- 更新安装命令中的版本号
