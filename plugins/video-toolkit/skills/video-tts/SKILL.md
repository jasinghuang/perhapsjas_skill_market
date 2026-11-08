---
name: video-tts
description: >
  中文视频配音工具：把 SRT 字幕逐条合成中文配音，按时间轴对齐后替换视频原声，
  输出与视频等长的配音轨或配音成片。当用户要视频配音、中文配音、SRT 配音、
  把字幕读成声音、外语视频转中文配音、给视频配旁白、dubbing、voiceover、TTS 时触发。
  **不是通用 TTS**：输入必须是 SRT 字幕；纯文本转语音、长文朗读不在本 skill 范围内。
  支持本地 Apple Silicon（免费离线，mlx-audio）与百炼在线（付费，bl）两种 provider。
---

# video-tts

把一条中文 SRT 逐句合成配音，按字幕时间轴对齐（必要时 atempo 加速；仍放不下则截断并告警），输出「与视频等长的配音轨」或「替换原声的成片」。

> **不是通用 TTS。** 输入必须是一条 SRT 字幕。纯文本转语音、整段文章朗读、单句试音请直接用 TTS 工具，不要用本 skill。没有字幕先做 `audio-transcribe`；字幕不是中文、术语不准或有错别字，先做 `text-refine`。

## 上游链路

```text
video-downloader → audio-transcribe → text-refine → video-tts
```

| 步骤 | 产出 | 说明 |
| --- | --- | --- |
| video-downloader | 视频文件 | B 站 / YouTube 下载 |
| audio-transcribe | SRT / 文本 | 转录出带时间轴的字幕 |
| text-refine | 中文 SRT | 纠错、术语校准、翻译成中文；**保持原时间轴** |
| video-tts | `.dub.wav` / `.dub.mp4` | 按 SRT 时间轴配音并混流 |

本 skill 只消费**已经是中文**、时间轴与视频一致的 SRT。视频与 SRT 的时间原点必须一致（SRT 从视频 0 秒开始计时）。需要翻译、断句、纠错时，先在上游完成。

## 入口

始终通过 `run.py` 调用（它负责挑选已装好依赖的 Python 解释器；`skill_main.py` 是非交互 CLI）：

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py --srt <字幕> --provider <local|online> [其它参数]
```

- `run.py` 会打印 `[video-tts] Using /path/to/python`：说明命中了已有环境，没有重复安装。把它转述给用户。
- 只有所有候选解释器都缺依赖时才会自动 pip 安装；装不上会打印手动 pip 命令后退出。
- **CLI 完全非交互**：不会在终端里提问。所有选择都由本 SKILL 用 `AskUserQuestion` 收集后，以显式参数传入。
- Windows 把 `python3` 换成 `python`；本地 provider 仅支持 Apple Silicon macOS，Windows 只能走在线。

## 交互方式（硬性规则）

**所有需要用户做选择的地方，一律使用 `AskUserQuestion`。** 纯文本只用于展示音色表、SRT 摘要、进度和最终报告；不用来问「选哪个 / 要不要继续」，也**禁止**要求用户回复「1/2/3」或「a/b/c」。

`AskUserQuestion` 的真实 schema 约束：

- 每次调用最多 4 个问题；**每题最多 4 个选项**。
- 每个选项是 `{label, description}`（不是 `value`）。
- `header` ≤ 12 字符。
- `multiSelect` 必填；本 skill 全部单选，固定 `multiSelect: false`。
- 超过 4 个选项必须拆成多次调用（Qwen-TTS 的 6 个音色拆成 3 + 3 两页）。

例外：需要用户补充**路径**（视频 / SRT / 输出目录）时可以用纯文本提问——这是补充信息，不是多选决策。

如果用户在对话里已经明确指定（如「用本地」「用 Serena」「语气平静点」），等同于传了对应参数，跳过对应问题。

## 决策点清单

| 时机 | 问题（header） | 选项 | 何时跳过 |
| --- | --- | --- | --- |
| 启动（用户给了视频/音频） | 音色来源 | 原声克隆（推荐）/ 系统音色 | 已传 `--ref-audio` 或已选 `--voice`/`--design` |
| 启动 | 配音方案 | 本地（推荐）/ 在线 | 原声克隆（只能本地）/ 传了 `--provider` |
| 在线 | 音色组 | 3.1 Plus 旗舰（推荐）/ Qwen-TTS 12 音色 | |
| 在线·旗舰 | 具体音色 | 4 个旗舰音色 | 传了 `--voice` |
| 在线·Qwen-TTS | 性别 | 女声（6，含粤语）/ 男声（6，含粤语） | |
| 在线·Qwen-TTS | 具体音色 | 每组 6 个，拆 3 + 3 两页 | 传了 `--voice` |
| 本地 | 音色方向 | 普通话 / 方言 / 英语 / 日语·韩语 | 传了 `--voice` |
| 本地 | 具体音色 | 该方向 2–3 个 | 传了 `--voice` |
| 选完音色 | 语气 | 默认 / 平稳解说 / 活泼；自定义走 Other | 传了 `--instruct` |
| SRT 解析后 | 语义合并 | 语义合并（默认必做）/ 逐条合成 | 传了 `--merge-plan` 或用户明确拒绝合并 |
| SRT 解析后 | 是否开跑 | 开始合成 / 只预览（dry-run）/ 取消 | |
| 在线开跑前 | 费用确认 | 继续 / 切本地 / 取消 | `--yes` |
| 在线未登录（超时后） | 登录方式 | 重新获取链接 / 重新登录 / 切本地 | 已登录或链接等待中 |
| 合成失败 | 失败处理 | 切本地重跑 / 终止 | `--continue-on-error` |
| 输出已存在 | 覆盖策略 | 覆盖 / 另存 / 取消 | 输出不存在 |

表格里的「传了某参数」在对话场景中同样适用于「用户已经明确说了」；Qwen-TTS 组不支持语气指令，选到该组时跳过语气问题（详见下文）。「另存」通过传不同的 `--out` 路径实现——CLI 没有独立的 save-as 参数，默认覆盖。

推荐执行顺序：

1. 如果用户给了视频/音频，先问「音色来源：原声克隆（推荐）/ 系统音色」。原声克隆只能本地 Base，跳到第 2 步的克隆分支；系统音色继续选 provider。
2. 系统音色：选 provider → 做预检 → 选音色组 / 方向 → 选具体音色 → 选语气。原声克隆：提取 3–10s 参考音频 + 对应文本，用 `--ref-audio/--ref-text`，跳过音色/语气菜单。
3. 解析 SRT，用纯文本打印摘要（条数、总时长、前几条）；**读完整 SRT**按「语义合并」一节的规则生成 merge plan——这是默认必做步骤，只有用户明确拒绝合并才跳过。
4. 合并计划传 `--merge-plan`；先 `--dry-run` 看合并组数，检查 `<out>.dub.srt` 确认没有半句切断 → 问「是否开跑」。
5. 在线：打印总字数与计费提示 → 问「费用确认」。
6. 检查输出是否已存在 → 问「覆盖策略」。
7. 运行 CLI；在线未登录时按登录流程展示链接并等待。
8. 完成后展示报告摘要与产物路径；失败时问「失败处理」。

## 语义合并计划（默认必做）

逐条合成会让每个 SRT 条目独立起调、句尾收束，短条目多时听起来卡顿、起伏大；**必须**先做**语义合并**：由 Claude 读完整 SRT，按句子意思分组成完整语义单元，再写成一个显式计划交给 CLI。

**不要按时间间隙或字数机械合并**——机械规则不懂语义，断错位置比逐条合成更伤配音质量。分组规则：

- 组必须在语义完整处结束：合并后的文本以 `。` / `！` / `？` 等句末标点结尾；**绝不把半句留在一组末尾**。
- 以 `，`、`、`、`；`、`：` 结尾或没有标点的条目，通常并入下一组。
- 人物介绍（「第二位是 …」「最后是 …」）、步骤标题（「第一步」「第二步」…）、明显的新话题单独起组；介绍句和后面的外貌/场景描述可以合并。
- 长停顿（> 0.8s）且语义上另起一段时断开；同一句话内的短暂停顿不要断。
- 每组建议 3–8 条、总时长不超过约 18s；过长时在**最近的句末标点**处拆开，不要在逗号处硬切。
- 计划必须覆盖全部条目、顺序递增、组内连续；用 `python3` 或测试校验，不要手写漏条目。

计划格式（写到 `<srt 同名>.merge-plan.json`）：

```json
{"groups": [[1, 2, 3], [4, 5], [6], [7, 8, 9]]}
```

需要在不改 SRT 的前提下精简某组文本时，把该组写成对象：

```json
{"groups": [[1, 2], {"indices": [3, 4], "text": "精简后但不改变语义的整句。"}]}
```

`text` 只影响配音文本，时间窗仍按 `indices` 的首尾计算。

运行：

```bash
python3 <skill>/run.py --srt video.srt --provider local --voice Serena \
  --merge-plan video.merge-plan.json --track-only
```

先加 `--dry-run` 看合并后的组数；CLI 会把合并后的块写成 `<out>.dub.srt`（序号重排、UTF-8 无 BOM，`--dry-run` 也会写）并打印 `块级字幕: <path>`——检查有没有半句切断直接看这份文件。确认没有半句切断再正式跑。CLI 会打印 `合并: 434 条 → 79 组`。

语义合并的意义：逐条模式每条必须塞进自己的字幕窗口（放不下就 atempo 加速、再不行截断），节奏赶；合并成块后整段一次合成、共享时间弹性，块与块之间的原停顿正好当呼吸，atempo 触发率大幅下降。对口型、短句快节奏场景才考虑逐条。

## 音色菜单

### 选音色来源（header：音色来源）

**仅当用户给了视频/音频时问**；没有媒体可截参考时跳过，直接走系统音色。用户已给 `--ref-audio` 或已选 `--voice`/`--design` 时也跳过。

```text
AskUserQuestion({
  questions: [{
    question: "用原声克隆还是系统音色？",
    header: "音色来源",
    multiSelect: false,
    options: [
      {"label": "原声克隆（推荐）", "description": "从视频/音频截 3–10s 参考，克隆原说话人音色；只能本地 Base 模型"},
      {"label": "系统音色", "description": "本地 9 个预设或在线 16 个音色，可选语气/风格"}
    ]
  }]
})
```

选「原声克隆」→ 进入 Base 克隆分支，不再问 provider / 音色 / 语气；选「系统音色」→ 继续下面的 provider 菜单。

### 选 provider（header：配音方案）

```text
AskUserQuestion({
  questions: [{
    question: "用哪种配音方案？",
    header: "配音方案",
    multiSelect: false,
    options: [
      {"label": "本地（推荐）", "description": "免费、离线、隐私优先；仅 Apple Silicon Mac；首次需下载约 3.4 GB 模型"},
      {"label": "在线（百炼）", "description": "音色更多、表现力更强；按 token 付费，需要 bl 登录"}
    ]
  }]
})
```

选择建议：想免费 / 离线 / 隐私优先、音色够用 → 本地；想要更细分的普通话人格音色和更强表现力，且接受付费 → 在线。

### 本地 9 音色：先选方向，再选音色

先问方向（正好 4 个选项）：

```text
AskUserQuestion({
  questions: [{
    question: "想用哪一类本地音色？",
    header: "音色方向",
    multiSelect: false,
    options: [
      {"label": "普通话", "description": "Uncle_Fu / Serena / Vivian，中文解说与叙述"},
      {"label": "方言", "description": "Dylan（北京话）/ Eric（四川话）"},
      {"label": "英语", "description": "Ryan / Aiden，英语原生音色"},
      {"label": "日语·韩语", "description": "Ono_Anna（日语）/ Sohee（韩语）"}
    ]
  }]
})
```

完整目录（`--voice` 区分大小写）：

| 方向 | 显示名 | `--voice` | 描述 |
| --- | --- | --- | --- |
| 普通话 | Uncle_Fu | `Uncle_Fu` | 低沉醇厚的成熟男声（解说 / 口播首选） |
| 普通话 | Serena | `Serena` | 温暖、温柔的年轻女声（温柔叙述首选） |
| 普通话 | Vivian | `Vivian` | 明亮、略带锋利感的年轻女声 |
| 方言 | Dylan | `Dylan` | 年轻北京男声，自动切北京话 |
| 方言 | Eric | `Eric` | 活泼成都男声，自动切四川话 |
| 英语 | Ryan | `Ryan` | 节奏感强的男声（英语原生） |
| 英语 | Aiden | `Aiden` | 阳光美式男声，中频清晰（英语原生） |
| 日语·韩语 | Ono_Anna | `Ono_Anna` | 活泼轻盈的日语女声 |
| 日语·韩语 | Sohee | `Sohee` | 温暖、情感丰富的韩语女声 |

按方向发第二问（每个方向 2–3 个选项）：

```text
# 普通话
AskUserQuestion({ questions: [{
  question: "选一个普通话音色：", header: "具体音色", multiSelect: false,
  options: [
    {"label": "Uncle_Fu（成熟男声）", "description": "低沉醇厚，解说 / 口播首选；--voice Uncle_Fu"},
    {"label": "Serena（温柔女声）", "description": "温暖、温柔，温柔叙述首选；--voice Serena"},
    {"label": "Vivian（明亮女声）", "description": "明亮、略带锋利感的年轻女声；--voice Vivian"}
  ]
}]})
```

```text
# 方言
AskUserQuestion({ questions: [{
  question: "选一个方言音色：", header: "具体音色", multiSelect: false,
  options: [
    {"label": "Dylan（北京话）", "description": "年轻北京男声，清晰自然；--voice Dylan"},
    {"label": "Eric（四川话）", "description": "活泼成都男声，略带沙哑亮度；--voice Eric"}
  ]
}]})
```

```text
# 英语
AskUserQuestion({ questions: [{
  question: "选一个英语音色：", header: "具体音色", multiSelect: false,
  options: [
    {"label": "Ryan（节奏男声）", "description": "节奏感强的男声；--voice Ryan"},
    {"label": "Aiden（阳光男声）", "description": "阳光美式男声，中频清晰；--voice Aiden"}
  ]
}]})
```

```text
# 日语·韩语
AskUserQuestion({ questions: [{
  question: "选一个日语 / 韩语音色：", header: "具体音色", multiSelect: false,
  options: [
    {"label": "Ono_Anna（日语女声）", "description": "活泼轻盈的日语女声；--voice Ono_Anna"},
    {"label": "Sohee（韩语女声）", "description": "温暖、情感丰富的韩语女声；--voice Sohee"}
  ]
}]})
```

### 在线：先选音色组（header：音色组）

```text
AskUserQuestion({
  questions: [{
    question: "用哪组在线音色？",
    header: "音色组",
    multiSelect: false,
    options: [
      {"label": "3.1 Plus 旗舰（推荐）", "description": "qwen-audio-3.1-tts-plus，4 个 v3.1 音色，支持语气指令"},
      {"label": "Qwen-TTS 12 音色", "description": "qwen3-tts-flash，6 女 / 6 男（含粤语阿强/阿清），不支持语气指令"}
    ]
  }]
})
```

两组音色**不能混用**，`--voice` 决定模型：`*_v3.1` → `qwen-audio-3.1-tts-plus`，其余 12 个 → `qwen3-tts-flash`。

### 在线·旗舰 4 音色（header：具体音色）

| 显示名 | `--voice` | 性别 | 描述 |
| --- | --- | --- | --- |
| 龙安灵心_v3.1 | `longanlingxin_v3.1` | 女 | 知心、温柔 |
| 许南川_v3.1 | `xunanchuan_v3.1` | 男 | 磁性、讲故事 |
| 龙安欢_v3.1 | `longanhuan_v3.1` | 女 | 活泼、爱笑 |
| 龙安风悦_v3.1 | `longanfengyue_v3.1` | 女 | 自然亲切、播报感 |

```text
AskUserQuestion({
  questions: [{
    question: "选一个 3.1 Plus 旗舰音色：",
    header: "具体音色",
    multiSelect: false,
    options: [
      {"label": "龙安灵心（温柔女声）", "description": "知心、温柔；--voice longanlingxin_v3.1"},
      {"label": "许南川（磁性男声）", "description": "磁性、讲故事；--voice xunanchuan_v3.1"},
      {"label": "龙安欢（活泼女声）", "description": "活泼、爱笑；--voice longanhuan_v3.1"},
      {"label": "龙安风悦（播报女声）", "description": "自然亲切、播报感；--voice longanfengyue_v3.1"}
    ]
  }]
})
```

这 4 个音色支持 `--instruct` 自然语言语气控制；本 skill 只透传 instruction，不生成 SSML。

### 在线·Qwen-TTS 12 音色（6 女 / 6 男，含粤语）

| 性别 | 显示名 | `--voice` | 描述 |
| --- | --- | --- | --- |
| 女 | 芊悦 | `Cherry` | 阳光积极、亲切自然小姐姐 |
| 女 | 苏瑶 | `Serena` | 温柔小姐姐 |
| 女 | 四月 | `Maia` | 知性与温柔的碰撞 |
| 女 | 十三 | `Vivian` | 拽拽的、可爱的小暴躁 |
| 女 | 茉兔 | `Momo` | 撒娇搞怪，逗你开心 |
| 女 | 粤语-阿清 | `Kiki` | 甜美的港妹闺蜜，粤语女声 |
| 男 | 晨煦 | `Ethan` | 标准普通话（带部分北方口音）；阳光、温暖、活力 |
| 男 | 甜茶 | `Ryan` | 节奏拉满，戏感炸裂 |
| 男 | 月白 | `Moon` | 率性帅气 |
| 男 | 安德雷 | `Andre` | 声音磁性，自然舒服、沉稳 |
| 男 | 阿闻 | `Neil` | 字正腔圆，专业新闻主持人 |
| 男 | 粤语-阿强 | `Rocky` | 幽默风趣的粤语男声，在线陪聊 |

先问性别（header：性别）：

```text
AskUserQuestion({
  questions: [{
    question: "选女声还是男声音色？",
    header: "性别",
    multiSelect: false,
    options: [
      {"label": "女声（6 个）", "description": "Cherry / Serena / Maia / Vivian / Momo / Kiki（粤语）"},
      {"label": "男声（6 个）", "description": "Ethan / Ryan / Moon / Andre / Neil / Rocky（粤语）"}
    ]
  }]
})
```

6 个选项超过 4 个上限，拆成 3 + 3 两页；第一页留一个「下一页」选项，第二页留「返回上一页」：

```text
# 女声 · 第 1 页（3 个音色 + 下一页）
AskUserQuestion({ questions: [{
  question: "选一个女声音色（第 1 / 2 页）：", header: "具体音色", multiSelect: false,
  options: [
    {"label": "芊悦 Cherry", "description": "阳光积极、亲切自然；--voice Cherry"},
    {"label": "苏瑶 Serena", "description": "温柔小姐姐；--voice Serena"},
    {"label": "四月 Maia", "description": "知性与温柔的碰撞；--voice Maia"},
    {"label": "下一页（3 个）", "description": "查看十三 Vivian、茉兔 Momo、粤语-阿清 Kiki"}
  ]
}]})
```

```text
# 女声 · 第 2 页（2 个音色 + 返回）
AskUserQuestion({ questions: [{
  question: "选一个女声音色（第 2 / 2 页）：", header: "具体音色", multiSelect: false,
  options: [
    {"label": "十三 Vivian", "description": "拽拽的、可爱的小暴躁；--voice Vivian"},
    {"label": "茉兔 Momo", "description": "撒娇搞怪，逗你开心；--voice Momo"},
    {"label": "粤语-阿清 Kiki", "description": "甜美的港妹闺蜜，粤语女声；--voice Kiki"},
    {"label": "返回上一页", "description": "回到 Cherry / Serena / Maia"}
  ]
}]})
```

```text
# 男声 · 第 1 页（3 个音色 + 下一页）
AskUserQuestion({ questions: [{
  question: "选一个男声音色（第 1 / 2 页）：", header: "具体音色", multiSelect: false,
  options: [
    {"label": "晨煦 Ethan", "description": "标准普通话、阳光温暖；--voice Ethan"},
    {"label": "甜茶 Ryan", "description": "节奏拉满，戏感炸裂；--voice Ryan"},
    {"label": "月白 Moon", "description": "率性帅气；--voice Moon"},
    {"label": "下一页（3 个）", "description": "查看安德雷 Andre、阿闻 Neil、粤语-阿强 Rocky"}
  ]
}]})
```

```text
# 男声 · 第 2 页（2 个音色 + 返回）
AskUserQuestion({ questions: [{
  question: "选一个男声音色（第 2 / 2 页）：", header: "具体音色", multiSelect: false,
  options: [
    {"label": "安德雷 Andre", "description": "声音磁性、沉稳；--voice Andre"},
    {"label": "阿闻 Neil", "description": "字正腔圆、专业新闻主持人；--voice Neil"},
    {"label": "粤语-阿强 Rocky", "description": "幽默风趣的粤语男声；--voice Rocky"},
    {"label": "返回上一页", "description": "回到 Ethan / Ryan / Moon"}
  ]
}]})
```

Qwen-TTS 组属于 `qwen3-tts-flash`，**不接受 `instruction`**：选了这组就不要再问语气（CLI 传了 `--instruct` 也只会警告并忽略）。需要语气控制时提示用户改选旗舰组或本地。

### 语气（header：语气）

只对本地 / 在线旗舰询问；默认 / 平稳解说 / 活泼，自定义用 Other 输入：

```text
AskUserQuestion({
  questions: [{
    question: "配音用什么语气？",
    header: "语气",
    multiSelect: false,
    options: [
      {"label": "默认", "description": "不加指令，使用音色默认语气"},
      {"label": "平稳解说", "description": "平稳、稍慢的解说感；--instruct \"用平稳的解说语气，语速稍慢\""},
      {"label": "活泼", "description": "更轻快、有活力；--instruct \"用活泼、轻快的语气\""}
    ]
  }]
})
```

映射：默认 → 不传 `--instruct`；平稳解说 / 活泼 → 传上面引号里的文本；Other → 用户输入的文本原样作为 `--instruct`。

## 预检

### 本地（macOS Apple Silicon）

```bash
uname -sm                                      # 需要 Darwin arm64
command -v ffmpeg && command -v ffprobe        # 缺一不可
python3 -c "import mlx_audio" 2>/dev/null && echo ok || echo missing
ls ~/.cache/huggingface/hub 2>/dev/null | grep -i qwen3-tts || echo "no cache"
```

处理：

- 非 Darwin arm64 → 本地不可用，回到 provider 选择改走在线。
- 缺 `ffmpeg` / `ffprobe` → 报错并给安装命令：`brew install ffmpeg`（Windows 用 `winget install ffmpeg`）。
- 缺 `mlx_audio` → 告诉用户 `run.py` 首次真实运行会自动选择解释器安装；也可手动 `python3 -m pip install --break-system-packages mlx-audio`。装不上时把 `run.py` 打印的 pip 命令转给用户。
- 模型未缓存 → 首次会下载约 3.4 GB（`mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16`），缓存在 `~/.cache/huggingface/hub`。把这个信息写进「是否开跑」问题的 description，让用户决定现在跑还是先预览；下载失败时提示检查网络或手动 `huggingface-cli download mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16`。

### 在线（百炼）

```bash
command -v bl
bl auth status --output json    # 期望 {"authenticated": true, ...}
```

缺 `bl` 时用 `AskUserQuestion`（header：登录方式）让用户选：

- 安装 bl → `npm install -g bailian-cli`（需 Node.js ≥ 18.17），或 `curl -fsSL https://bailian.aliyun.com/cli/install.sh | bash`；详见[百炼 CLI 安装说明](https://bailian.aliyun.com/cli/install.md)，装好后重试；
- HTTP 兜底 → 仅当环境已有 `DASHSCOPE_API_KEY` 时提供；运行时加 `--tts-endpoint <DashScope endpoint>`；
- 切本地 → 回到 provider 选择。

未登录（`authenticated` 不是 `true`）时不要先弹问题，直接进入登录流程。

#### 登录链接流程

1. 用**后台方式**运行 CLI（否则登录 URL 要等进程结束才看得到），或先手动后台运行 `bl auth login --console --no-browser`。
2. CLI / provider 会打印 `请点击登录：https://...`。**一看到 URL 就立刻**作为可点击的 Markdown 链接贴给用户，例如 `[点击这里登录百炼](https://...)`，并说明「登录完成后回来告诉我，我会继续等待」。
3. provider 每 2 秒轮询 `bl auth status`，最长等待 300 秒；等待期间不要重复启动登录。
4. 超时或登录子进程提前退出后，用 `AskUserQuestion`（header：登录方式）：
   - 重新获取链接 → 重新后台运行 `bl auth login --console --no-browser`，展示新链接；
   - 重新登录 → 结束可能卡住的登录进程，重走完整登录流程（后台运行、展示新链接、继续轮询 `bl auth status`，最长再等 300 秒）；
   - 切本地 → 改 provider。
5. **HTTP 兜底（API Key）不在这个决策点**：只要 PATH 上能找到 `bl`，provider 就一定走 `bl` 登录路径，API key 兜底只在 `bl` 缺失时生效——那是预检里「缺 `bl`」的选项，不要在这里提供。
6. **skill 不接收、不保存、不打印任何明文 key。** 不要要求用户把 key 发到对话里。

## 命令示例

```bash
# 本地：视频 + SRT → 成片（默认输出 video.dub.wav + video.dub.mp4）
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py \
  --srt video.srt --video video.mp4 \
  --provider local --voice Serena \
  --instruct "用平稳的解说语气，语速稍慢"

# 本地：只出配音轨，不混流
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py \
  --srt video.srt --provider local --voice Uncle_Fu --track-only

# 在线旗舰（费用已确认后才加 --yes）
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py \
  --srt video.srt --video video.mp4 \
  --provider online --voice longanlingxin_v3.1 --yes

# 在线 Qwen-TTS
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py \
  --srt video.srt --video video.mp4 \
  --provider online --voice Cherry --yes

# 预览：只解析 SRT 并打印计划（不加载模型、不联网；online 预览不需要 --yes）
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py \
  --srt video.srt --provider local --voice Serena --dry-run

# 保留逐条片段 + 机器可读报告
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py \
  --srt video.srt --video video.mp4 --provider local --voice Serena \
  --keep-segments --json-report report.json

# 指定输出前缀（输出 s2.dub.wav / s2.dub.mp4）
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py \
  --srt video.srt --video video.mp4 --provider local --voice Serena --out s2

# 本地 VoiceDesign 试音（与 --voice / --instruct 互斥；自动加载 VoiceDesign 模型；跨段音色会漂，仅建议短视频）
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py \
  --srt video.srt --provider local --design "温暖、温柔的年轻女声"

# 在线 HTTP 兜底（bl 不可用，且环境已有 DASHSCOPE_API_KEY；不要在命令里回显 key）
python3 ${CLAUDE_PLUGIN_ROOT}/skills/video-tts/run.py \
  --srt video.srt --video video.mp4 --provider online --voice Cherry \
  --tts-endpoint <DashScope SpeechSynthesizer endpoint> --yes
```

- `--provider` 是必需参数；本地必须且只能给 `--voice` / `--design` 之一；在线必须给 `--voice`。
- 在线**真实运行**必须带 `--yes`（费用确认的机器可读形式）：只有用户在「费用确认」里选了「继续」才加。
- `--dry-run` 只解析并打印计划，不加载模型、不联网、不写文件；退出码 0。
- 遇到登录链接时按上面的登录流程处理，不要等命令超时后才回头看输出。

## 输出与退出码

| 产物 | 何时生成 |
| --- | --- |
| `<out>.dub.wav` | 总是生成：24 kHz 单声道整轨，长度 = 视频时长（无视频时 = 最后一句结束时间） |
| `<out>.dub.mp4` | 提供 `--video` 且未 `--track-only`：视频流复制（必要时重编码 H.264），音频替换为 AAC 192k（源轨 24 kHz 单声道） |
| `<out>.dub.srt` | 语义合并（`--merge-plan`）生效时生成（`--dry-run` 也会写）：块级字幕，检查半句切断用 |

输出命名：

- 默认 `<out>` = 视频 stem（无视频时 = SRT stem）。
- `--out foo` → `foo.dub.wav` + `foo.dub.mp4`。
- `--out foo.mp4` → `foo.dub.wav` + `foo.mp4`（只有 `.mp4` 后缀视为成品路径）。
- `--out foo.mkv` / 其它非 `.mp4` 后缀 → `foo.mkv.dub.wav` + `foo.mkv.dub.mp4`（按前缀处理）。
- `--track-only` 只写 `.dub.wav`。
- `--keep-segments` 把逐条片段写到 `<out_dir>/segments/`。
- `--json-report <path>` 写机器可读 JSON（逐条时长、动作、告警、失败数等）；混流失败时报告仍保留音轨与逐条结果，`output` 为 `null`。

stdout 报告逐条打印 `序号 / 开始 / 窗口 / 合成时长 / 最终时长 / 倍率 / 状态`，末尾汇总总字数、警告数与失败数。退出码：全部成功或只有截断 / 超速警告 → 0；有合成失败或混流失败 → 1；参数错误 → 2。

## 参数

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `--srt` | 中文 SRT 路径（UTF-8） | 必需 |
| `--video` | 视频路径；提供则混流输出 mp4 | 无 |
| `--audio` | 音频路径（只取时长，不混流；与 `--video` 互斥） | 无 |
| `--provider` | `local` / `online` | 必需（由 AskUserQuestion 决定） |
| `--out` | 输出前缀或 `.mp4` 路径（非 `.mp4` 后缀按前缀处理） | 视频 / SRT stem |
| `--voice` | 音色 ID（本地 9 / 在线 16，区分大小写） | 交互选择；local 与 `--design` 二选一，online 必需 |
| `--instruct` | 语气 / 风格指令（仅 3.1 Plus） | 空 |
| `--rate` | 在线语速 0.5-2.0 | 模型默认 |
| `--pitch` | 在线音调 0.5-2.0 | 模型默认 |
| `--volume` | 在线音量 0-100 | 模型默认 |
| `--seed` | 随机种子 0-65535（本地/在线；提升跨段一致性） | 模型默认 |
| `--temperature` | 本地采样温度（默认 0.9；越低越稳定） | 模型默认 |
| `--top-p` | 本地 top-p 采样（0-1） | 模型默认 |
| `--top-k` | 本地 top-k 采样 | 模型默认 |
| `--enable-ssml` | 在线 SSML 模式（仅 3.1 Plus 旗舰音色） | false |
| `--hotfix-file` | hot_fix JSON（仅在线 3.1 Plus；强制 HTTP 兜底，需 `DASHSCOPE_API_KEY` + `--tts-endpoint`） | 无 |
| `--design` | 本地 VoiceDesign 音色描述；与 `--voice` / `--instruct` 互斥，自动加载 VoiceDesign 模型 | 无 |
| `--ref-audio` | 本地 Base 克隆参考音频（3–10s，需 `--ref-text`；与 `--voice`/`--design`/`--instruct` 互斥） | 无 |
| `--ref-text` | 参考音频对应的准确文本 | 无 |
| `--lang` | 语言代码（在线映射 `chinese` 等 → `zh` / `en` / …） | `chinese` |
| `--model` | 覆盖 provider 模型 id；在线必须与音色同组，本地 VoiceDesign 只能配 `--design` | 各 provider 默认 |
| `--tts-endpoint` | DashScope HTTP 兜底 endpoint（仅 `bl` 不可用时） | 无 |
| `--bl-bin` | `bl` 可执行文件 | `bl` |
| `--track-only` | 只出配音轨，不混流 | false |
| `--keep-segments` | 保留逐条 wav 到 `segments/` | false |
| `--no-cache` | 禁用片段缓存 | false |
| `--json-report` | 写机器可读报告到该路径 | 无 |
| `--continue-on-error` | 单条失败继续（会缺句，退出码仍为 1） | false |
| `--skip-bracketed` | 跳过纯音效标记条目（如 `[音乐]`、`（掌声）`） | false |
| `--merge-plan` | 语义合并计划 JSON；按组合成，减少逐句起调与硬静音 | 无（默认必做） |
| `--max-speed` | 最大 atempo 倍率（只加速，不减速） | `1.30` |
| `--yes` | 确认在线合成费用（online 真实运行必需；`--dry-run` 免确认） | false |
| `--dry-run` | 只解析并打印计划，不合成 | false |

## 配音优化（百炼文档要点）

- **语速 / 音调 / 音量**：`--rate` / `--pitch` / `--volume`，只对在线生效；本地用 atempo 做时间对齐，不做音色级调速。
- **随机种子**：`--seed` 固定在线采样，帮助跨段音色更稳定；同一 seed + 文本 + 音色更容易复现。
- **指令控制**：`--instruct` 仅 3.1 Plus 生效，可同时说语种、语速、情绪、角色。例：`"请用粤语说，语速稍慢，语气温柔"`。
- **情感 / 拟声标签**：3.1 Plus 支持把 `[excited]`、`[sad]`、`[laughing]` 等直接写进 SRT 文本；Qwen-TTS 备选组不支持。
- **SSML**：`--enable-ssml` 后可在 SRT 文本里用 `<break time="300ms"/>` 等控制停顿/读音，仅 3.1 Plus；provider 会自动给每条文本套 `<speak>...</speak>`（已套则不重复），普通文本不要默认开启。
- **语言提示**：`--lang` 在 3.1 Plus 走 `language_hints`，在 Qwen-TTS 走 `language_type`；粤语音色由 voice 本身决定语种，不发送语言字段。
- **hot_fix（专名发音/替换）**：`--hotfix-file <json>`，仅在线 3.1 Plus；`bl` 不支持该参数，provider 会强制走 DashScope HTTP 兜底，因此必须设置 `DASHSCOPE_API_KEY` 并提供 `--tts-endpoint`。

  JSON 结构：

  ```json
  {"pronunciation": [{"重庆": "chong2 qing4"}], "replace": [{"今天": "金天"}]}
  ```

  `pronunciation` 用拼音纠正发音，`replace` 在合成前替换文本；两者都可省略。
- 在线风格参数会进入缓存键：改 `--rate/--pitch/--volume/--seed/--enable-ssml` 会触发重新合成。

## 音色 / 情绪一致性（本地）

本地 Qwen3-TTS 的 `generation_config` 默认 `temperature=0.9, top_p=1.0, top_k=50`，每条独立采样；长片逐组生成时，情绪、节奏、音色会有可见波动。优先用这几个参数压稳定：

```bash
--temperature 0.6 --top-p 0.9 --top-k 40 --seed 42
```

- `--temperature` 从 0.9 降到 0.6–0.7 最有效；过低会变平、失去自然起伏。
- `--seed` 固定采样起点，便于复现；配合较低 temperature 效果更好。
- `--instruct` 保持全片同一句，不要逐条换风格；语气指令越强，跨文本波动通常越明显。
- 9 组真实截断和部分组的 atempo 加速也会造成“节奏/音色突变”；优先精简这些组的文本，其次才提高 `--max-speed`。
- 如果仍不满意，再考虑用 `Qwen3-TTS-12Hz-1.7B-Base` 做单说话人微调：官方 [finetuning](https://github.com/QwenLM/Qwen3-TTS/tree/main/finetuning) 目前只支持 Base 模型、单说话人、CUDA + `qwen-tts`，需要 `audio/text/ref_audio` JSONL；同一 `ref_audio` 贯穿数据集能提升说话人一致性。这不是 Mac/MLX 上的快速修复，只有想要专属固定音色时才值得做。

## Base 克隆（本地，音色最稳）

如果预设音色仍不够统一，用 Base 模型做一次参考克隆，之后每组都从同一参考条件生成：

```bash
python3 <skill>/run.py --srt video.srt --provider local \
  --ref-audio ref.wav --ref-text "参考音频的准确文本" \
  --temperature 0.6 --top-p 0.9 --top-k 40 --seed 42 --track-only
```

从用户给的视频/音频提取参考（3–10 秒、单说话人、无背景音乐）：

```bash
ffmpeg -ss <start> -t <duration> -i <media> -vn -ac 1 -ar 24000 ref.wav
```

- `--ref-text` 必须是**这段参考音频的原语言文本**，不能用翻译后的中文 SRT；没有原文字幕时先对参考片段做 ASR。
- 只有音频、没有视频时，用 `--audio <media>` 让 CLI 取音频时长（不混流），输出 `<out>.dub.wav`。
- 不传 `--model` 时自动用 `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16`；显式 `--model` 必须是 Base 族。
- 与 `--voice` / `--design` / `--instruct` 互斥；参考音频必须是单说话人、干净、3–10 秒，`--ref-text` 要和音频逐字一致。
- Base **推理**在 Apple Silicon/MLX 上可用，不需要 CUDA；官方 finetuning 才需要 CUDA。
- 克隆只锁音色，不消除韵律采样波动；仍建议配合固定 `--seed` 和较低 `--temperature`。

## 错误处理

| 现象 | 处理 |
| --- | --- |
| 缺 ffmpeg / ffprobe | 报错并提示 `brew install ffmpeg`（Windows 用 `winget install ffmpeg`） |
| 缺 mlx-audio | `run.py` 自动选解释器安装；装不上给出 `python3 -m pip install --break-system-packages mlx-audio` |
| 本地模型首次下载失败 | 报错，提示检查网络或手动 `huggingface-cli download mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16`（错误信息里已带命令） |
| 本地音色名非法 | 参数校验阶段报错并列出 9 个合法音色后退出（码 2） |
| 在线缺 `bl` | 提示安装（`npm install -g bailian-cli`，需 Node.js ≥ 18.17；详见预检一节）；询问是否切本地；已有 `DASHSCOPE_API_KEY` 时可加 `--tts-endpoint` 走 HTTP 兜底 |
| `bl` 未登录 | 自动展示 `bl auth login --console --no-browser` 的登录链接并轮询；超时后用 AskUserQuestion 选重新获取链接 / 重新登录 / 切本地；不代存 key |
| `bl` 401 / 403 | provider 立即报错并提示运行 `bl auth login` 重新登录；可切本地 |
| 在线 429 / 5xx | provider 自动指数退避重试 2 次（1s / 2s）；仍失败则询问切本地或终止 |
| 在线额度不足 / Throttling | provider 立即报错并给出[百炼控制台](https://bailian.console.aliyun.com/)链接；可切本地 |
| `--hotfix-file` 缺 key / endpoint | 参数校验直接报错：需 `DASHSCOPE_API_KEY` + `--tts-endpoint`（hot_fix 只走 HTTP 兜底） |
| 在线音色与模型不匹配 | `--voice` 自动决定模型；显式 `--model` 必须与音色同组，跨组在本地参数校验阶段退出 2，不发请求 |
| 在线音色名非法 | 参数校验阶段报错并列出 16 个合法音色后退出（码 2） |
| `bl --list-voices` 返回空 | 正常现象（这两个模型返回 `null`）；以本文音色表为准，不报错 |
| SRT 为空 / 时间非法 / 零时长 | 列出条目号并退出 |
| merge plan 非法（漏条 / 重复 / 乱序 / 组内不连续） | 参数校验退出 2，并指出第一处问题；按「语义合并」规则重写计划 |
| 单条合成失败 / 空音频 / 全静音 | 重试一次；仍失败终止（除非 `--continue-on-error`），不写缓存 |
| 单条放不下 | 先 atempo 加速（上限 `--max-speed`）；仍放不下则截断并记 warning |
| 视频无视频流 | 混流前报错，不出残缺文件 |
| 视频编码不兼容 mp4 | 自动重编码 H.264（VP9 / AV1 等也会重编码） |
| 输出已存在 | 默认覆盖（ffmpeg `-y`）；开跑前按决策表询问覆盖 / 另存（换 `--out`）/ 取消 |

## 示例触发

```text
用户: 把这个视频配上中文旁白，字幕是 video.srt
用户: 用本地音色给这条 SRT 配个音
用户: 帮我把英文字幕翻译成中文后配音（先走 text-refine，再走本 skill）
用户: 用百炼的龙安灵心给这个视频配音
用户: 只要配音轨，不用合成视频
```
