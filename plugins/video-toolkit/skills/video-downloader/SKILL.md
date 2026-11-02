---
name: video-downloader
description: >
  Video downloader for Bilibili and YouTube using yt-dlp.
  视频下载工具，支持 Bilibili 和 YouTube，使用 yt-dlp 下载视频到本地。
  Trigger this skill when the user wants to: download video, save video offline,
  batch download videos, download playlist videos, download from Bilibili/B站/YouTube/油管,
  extract audio from video, use yt-dlp, save a video for later viewing, download with cookies,
  or download video in specific quality.
  当用户要下载视频、保存视频、离线观看、批量下载、下载播放列表、bilibili下载、youtube下载、
  B站下载、油管下载、提取音频、指定画质下载时触发此 skill。
  支持 B站/Bilibili/YouTube/油管链接，支持批量下载、播放列表、aria2加速、浏览器 Cookie 登录下载。
  下载前会先检测标题、时长、预计大小，并让用户确认后再下载。
  只负责视频下载，字幕转录和校准请使用 audio-transcribe 和 text-refine skill。
  yt-dlp 会自动安装，无需手动预装。
---

# Video Downloader

下载 Bilibili / YouTube 视频到本地。

## 下载前确认（必须）

收到视频 URL 后，**不要直接下载**，先检测再让用户确认：

1. 运行 `--inspect`（可带用户指定的画质、Cookie 等参数），只探测元数据、不下载：

   ```bash
   python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --inspect "URL"
   ```

   在输出中找到以 `INSPECT_JSON:` 开头的一行，解析其后的 JSON。关键字段：

   - `title` / `duration` / `size` / `resolution`：默认格式的标题、时长、预计大小、画质
   - `choices`：可选格式列表，每项含 `label`、`description`、`format`、`kind`（`muxed` / `separate`）、`needs_merge`、`size`、`default`
   - `formats.muxed` / `formats.video_only` / `formats.audio_only`：完整的合并流、纯视频流、纯音频流列表
   - `ffmpeg_available` / `merge_note`：当前机器能否合并，以及分离流的处理说明
   - 播放列表：`playlist_count`、`duration`、`entries_preview`；播放列表用 flat 探测，`choices` 为空

2. **所有需要用户做选择的交互一律使用 AskUserQuestion**（不要用纯文本让用户回复编号，也不要把元数据单独发一条文字再问）。把标题、时长、预计大小直接写进 question 里：

   - **单个视频**：一次 AskUserQuestion，选项为 default + 1~2 个分离流 + 取消（最多 4 个选项）
   - **多个视频**：在**同一个 AskUserQuestion 调用**里放多个 question（即多个 tab），每个视频一个 tab；header 用「视频 1」「视频 2」…（≤12 字符），question 里放该视频的标题/时长/大小，选项为该视频的 default + 分离流 +「跳过此视频」
   - 一次调用最多 4 个 question；超过 4 个视频时分批提问
   - 默认选项取 `choices` 中 `default: true`；分离流取 `kind: "separate"`；每项的 `description` 已包含大小和是否需合并
   - 如果某个视频的可选格式超过 4 个：先展示 default + 1~2 个重点分离流 + 取消/跳过；用户想看更多时，再用一次 AskUserQuestion 展示剩余格式（仍然不要用纯文本菜单）
   - 分离流默认配 `formats.audio_only` 中最佳音频（优先 m4a）；若用户要指定音频，用 `--format "<video_format>+<audio_format>"` 自行拼接
   - **播放列表**：用一个 tab 展示 `playlist_count`、总时长、预计大小，选项为「下载整个播放列表」/「取消」

3. 用户选择分离流时，先说明后续步骤：

   - 会分别下载**纯视频流**和**纯音频流**两个文件
   - 脚本会自动调用 **ffmpeg** 合并成一个 mp4，合并后删除原始分离文件；用户不需要手动操作
   - 需要已安装 ffmpeg；如果 `ffmpeg_available` 为 `false`，先提醒安装（Mac: `brew install ffmpeg`，Windows: `winget install Gyan.FFmpeg`），或改选合并流

4. 根据每个 tab 的选择执行下载：

   - 所有视频都选默认格式：一条命令 `--yes URL1 URL2 ...`
   - 某个视频选了特定格式：对该视频单独执行 `--yes --format "<choice.format>" "URL"`
   - 多个视频格式不同：按视频分别执行；格式相同的可以合并成一条命令
   - 用户选「跳过此视频」的不下载
   - 如果用户选的就是 default 项，也可以直接用 `--yes "URL"`

5. 用户取消则停止，不要下载。

6. 脚本在非交互环境（如 Claude 的 Bash）中缺少 `--yes` 会退出并提示，确保不会跳过确认；在终端直接运行时会显示元数据并提示 `y/N`。

## 独立运行环境

脚本首次运行会在用户数据目录创建独立 venv，并在其中安装 yt-dlp（含 yt-dlp-ejs YouTube 支持）：

- macOS / Linux：`~/.local/share/video-downloader/venv`
- Windows：`%LOCALAPPDATA%\video-downloader\venv`

之后每次运行都会在该 venv 内静默检查并更新 yt-dlp，不会修改系统 Python 或 Homebrew。环境损坏时删除该目录即可自动重建。

### 需要：JS runtime（YouTube 等站点）

YouTube 下载需要 JavaScript runtime，脚本自动检测：

- **Node.js** ≥20（推荐）：`winget install OpenJS.NodeJS` 或 https://nodejs.org
- **Deno**：`winget install DenoLand.Deno` 或 `brew install deno`

脚本会校验 Node.js 主版本，低于 20 会被跳过并提示。安装后无需额外配置。

### 需要：ffmpeg（合并音视频 / 提取音频）

合并流（单文件）下载不需要 ffmpeg；当站点不提供合并流（如 B 站）回退到分离流时需要 ffmpeg 合并。`--audio-only` 的音频提取也需要 ffmpeg。

`--inspect` 的 JSON 会返回 `ffmpeg_available`；选择分离流时脚本会自动调用 ffmpeg 合并视频和音频，用户不需要手动操作。

- Mac: `brew install ffmpeg`
- Windows: `winget install Gyan.FFmpeg`

### 可选：aria2（加速下载）

- Mac: `brew install aria2`
- Windows: `winget install aria2.aria2`

## 使用方法

> 以下示例展示参数组合；实际下载请按上面的确认流程，在用户确认后加 `--yes`（终端直接运行会提示 `y/N`）。

```bash
# 1) 先检测（不下载）：输出标题、时长、预计大小
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --inspect "URL"

# 2) 用户确认后下载（非交互环境必须加 --yes）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --yes "URL"

# 批量下载（确认后）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --yes "URL1" "URL2" "URL3"

# 从文件读取 URL 列表
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --file urls.txt

# 只下载音频（适合转录场景）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --audio-only "URL"

# 指定画质
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --quality high "URL"
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --resolution 720 "URL"

# 需要 1080p/4K 时显式走分离流（ffmpeg 合并）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --format "bv*[height<=2160]+ba" "URL"

# 选择 inspect 给出的具体分离流（choice.format 例如 "137+140"）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --yes --format "137+140" "URL"

# 使用 Cookie 下载会员视频
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --cookies ~/video-cookies.txt "URL"

# 直接从浏览器读取 Cookie（推荐，B站大会员 / YouTube 登录态）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --cookies-from-browser chrome "URL"

# 下载完整播放列表（默认忽略 URL 中的 list=，只下载单个视频）
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --playlist "https://youtube.com/playlist?list=xxx"

# aria2 加速
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --aria2 "URL"
```

## 参数

### 预设画质

| 参数值 | 含义 |
|--------|------|
| `best`（默认） | 最高画质的合并流；无合并流时回退分离流 |
| `high` | 1080p 以内的最高合并流（无则分离流） |
| `medium` | 720p 以内的最高合并流（无则分离流） |
| `low` | 480p 以内的最高合并流（无则分离流） |
| `audio-only` | 只要音频（m4a） |

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `urls` | 视频 URL（支持多个） | 必需 |
| `--file, -f` | 从文件读取 URL 列表（txt） | - |
| `--cookies, -c` | Cookie 文件路径（与 `--cookies-from-browser` 二选一） | 自动检测 `~/video-cookies.txt` |
| `--cookies-from-browser` | 直接读取浏览器 Cookie：chrome/firefox/safari/edge/brave 等 | 无 |
| `--output, -o` | 输出目录 | ~/Downloads |
| `--quality, -q` | 画质预设（best/high/medium/low/audio-only） | best |
| `--resolution, -r` | 指定分辨率上限（720/1080/2160） | 无（用预设） |
| `--codec` | 视频编码偏好（h264/h265/vp9/av1），仅在同分辨率下优先，需配合 `--resolution` | h264 |
| `--audio-only` | 只下载音频 | false |
| `--format` | 直接传 yt-dlp format string（可用 `choices[].format`，如 `"137+140"`） | 无 |
| `--inspect` | 仅检测元数据（标题/时长/预计大小），输出 JSON，不下载 | false |
| `--yes, -y` | 跳过确认直接下载（用户确认元数据后使用） | false |
| `--playlist` | 下载完整播放列表（默认忽略 URL 中的 `list=`） | false |
| `--aria2` | 使用 aria2 加速下载 | false |

优先级：`--format` > `--resolution` + `--codec` > `--quality` 预设

`--codec` 是**同分辨率下的排序偏好**，不会为了编码牺牲分辨率：先在 `--resolution` 上限内选最高的视频流，同分辨率下再优先指定编码。yt-dlp 原生支持 h264/h265/vp9/av1 别名。

## 推荐用法

- **YouTube 合并流（默认）**：直接运行。`best` 只选单文件合并流（`b`），按画质取最高；站点没有合并流时才回退到分离流 + 合并。
- **YouTube 合并流的实际画质**：目前多数视频只提供 360p 合并流（format 18），少数有 720p（format 22）。`b` 会取该视频可用的最高合并流。
- **需要 1080p/4K**：合并流通常不提供，`--inspect` 的 `choices` 会列出可用的分离流（不同分辨率和编码），选择后脚本自动合并；也可以手动用 `--format "bv*[height<=2160]+ba"`。
- **格式选择**：默认取 `choices` 中 `default: true` 的合并流；分离流会分别下载视频和音频，再由 ffmpeg 自动合并成 mp4。
- **限制分辨率**：`--resolution 1080`。在合并流中取上限内的最高画质；`--codec` 只在同分辨率下优先。
- **编码兼容性**：YouTube 的 H.264 通常最高 1080p；4K 只能走 VP9/AV1。若播放器不支持 AV1/VP9，接受 1080p H.264，或用 `--format` 自定义。
- **B 站高画质 / 大会员**：`--cookies-from-browser chrome`（先在浏览器登录）。
- **只要音频 / 送转录**：`--audio-only`，输出 m4a。
- **批量**：`--file urls.txt`。默认忽略 URL 中的 `list=`，避免误下整个播放列表；需要整列表时加 `--playlist`。
- **指定目录**：`--output ~/Movies`。

## Cookie

下载会员 / 登录态视频需要 Cookie，两种方式二选一：

### 方式一：直接从浏览器读取（推荐）

```bash
python ${CLAUDE_PLUGIN_ROOT}/skills/video-downloader/skill_main.py --cookies-from-browser chrome "URL"
```

先在浏览器登录 Bilibili / YouTube。macOS 首次读取 Chrome Cookie 会弹出 Keychain 授权，点“始终允许”。

### 方式二：Cookie 文件

1. 浏览器登录 Bilibili 或 YouTube
2. 使用浏览器扩展导出 Cookie 到 `~/video-cookies.txt`
3. 使用 `--cookies` 参数指定（或自动检测默认路径）

## 完整工作流

下载视频后，配合其他 skills 使用：

```
1. video-downloader → 检测元数据 → 用户确认 → 下载视频
2. audio-transcribe → 转录为字幕 (SRT/MD)
3. text-refine      → 校准/翻译字幕
```

## 示例

```
用户: 下载这个视频 https://www.bilibili.com/video/BV1xx411c7mD
用户: 下载 YouTube 视频 https://youtube.com/watch?v=xxx
用户: 批量下载这些视频: [URL1, URL2, URL3]
用户: 下载这个视频，只要音频
用户: 下载视频 720p 的就行
```
