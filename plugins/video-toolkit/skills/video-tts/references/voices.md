# 音色目录（video-tts）

三组内置音色。`--voice` 区分大小写；音色决定在线模型，两组在线音色不能混用。

## 本地 9 音色（Apple Silicon，mlx-audio Qwen3-TTS CustomVoice）

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

推荐交互：先按方向（普通话 / 方言 / 英语 / 日语·韩语）缩小范围，再选具体音色。

## 在线旗舰 4 音色（百炼 `qwen-audio-3.1-tts-plus`，支持 `--instruct`）

| 显示名 | `--voice` | 性别 | 描述 |
| --- | --- | --- | --- |
| 龙安灵心_v3.1 | `longanlingxin_v3.1` | 女 | 知心、温柔 |
| 许南川_v3.1 | `xunanchuan_v3.1` | 男 | 磁性、讲故事 |
| 龙安欢_v3.1 | `longanhuan_v3.1` | 女 | 活泼、爱笑 |
| 龙安风悦_v3.1 | `longanfengyue_v3.1` | 女 | 自然亲切、播报感 |

## 在线 Qwen-TTS 12 音色（`qwen3-tts-flash`，不支持 `--instruct`）

| 性别 | 显示名 | `--voice` | 描述 |
| --- | --- | --- | --- |
| 女 | 芊悦 | `Cherry` | 阳光积极、亲切自然小姐姐 |
| 女 | 苏瑶 | `Serena` | 温柔小姐姐 |
| 女 | 四月 | `Maia` | 知性与温柔的碰撞 |
| 女 | 十三 | `Vivian` | 拽拽的、可爱的小暴躁 |
| 女 | 茉兔 | `Momo` | 撒娇搞怪，逗你开心 |
| 女 | 粤语-阿清 | `Kiki` | 甜美的港妹闺蜜，粤语女声 |
| 男 | 晨煦 | `Ethan` | 标准普通话（带部分北方口音）；阳光、温暖 |
| 男 | 甜茶 | `Ryan` | 节奏拉满，戏感炸裂 |
| 男 | 月白 | `Moon` | 率性帅气 |
| 男 | 安德雷 | `Andre` | 声音磁性，自然舒服、沉稳 |
| 男 | 阿闻 | `Neil` | 字正腔圆，专业新闻主持人 |
| 男 | 粤语-阿强 | `Rocky` | 幽默风趣的粤语男声 |

推荐交互：先问音色组（旗舰 / Qwen-TTS），Qwen-TTS 再按性别分页展示。
粤语音色由 voice 本身决定语种，不发送语言字段；选到 Qwen-TTS 组不要再问语气。

## 语气指令映射（仅本地 CustomVoice 与在线旗舰支持）

| 选择 | `--instruct` |
| --- | --- |
| 默认 | 不传 |
| 平稳解说 | `用平稳的解说语气，语速稍慢` |
| 活泼 | `用活泼、轻快的语气` |
| 自定义 | 用户输入原样透传 |

## 交互菜单脚本（Claude / AskUserQuestion 适配）

所有用户选择必须使用 AskUserQuestion；其他宿主映射到等价的结构化用户输入控件，
按实际工具限制分页，不用普通文本菜单或回复编号替代。没有可用控件时说明能力缺失，
等待用户明确指令。下面是 Claude 的菜单示例，其他宿主使用自身工具 schema；
实际顺序先检测能力、选择 provider，再选择音色来源／音色／语气，已明确的选择跳过：

```text
AskUserQuestion({ questions: [{
  question: "用原声克隆还是系统音色？", header: "音色来源", multiSelect: false,
  options: [
    {"label": "原声克隆（推荐）", "description": "从视频/音频截 3–10s 参考，克隆原说话人音色；只能本地 Base 模型"},
    {"label": "系统音色", "description": "本地 9 个预设或在线 16 个音色，可选语气/风格"}
  ]
}]})
```

```text
AskUserQuestion({ questions: [{
  question: "用哪种配音方案？", header: "配音方案", multiSelect: false,
  options: [
    {"label": "本地（推荐）", "description": "免费、离线、隐私优先；仅 Apple Silicon Mac；首次需下载约 3.4 GB 模型"},
    {"label": "在线（百炼）", "description": "音色更多、表现力更强；按 token 付费，需要 bl 登录"}
  ]
}]})
```

（Windows / Intel Mac 宿主上不要展示「本地」选项——先做能力检测，再展示可行路线。）

其余菜单（本地方向 → 音色、在线音色组 → 音色、语气、覆盖策略）按同样模式构造，
选项内容直接取上面三张表。
