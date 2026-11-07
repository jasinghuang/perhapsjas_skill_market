# text-refine 回归用例集

纯 prompt skill 没有可跑的单测，质量靠改完 SKILL.md / references 后回归验证：把"输入"套进 SRT 条目（序号 + 时间轴）交给 refine，按"必须满足"逐条核对。

**共同断言（所有用例）**：时间轴与序号原样保留；输出仍是 UTF-8 无 BOM 的 SRT；无 Markdown 标记、无标题摘要。

| # | 验证点 | 输入（条目正文 / 时长） | 必须满足 | 对应规则 |
| --- | --- | --- | --- | --- |
| E1 | 意群断句 | "We found traces of explosive materials inside the warehouse." / 2.6s | 双行各自成意群（地点状语 + 动宾）；"的"不悬在行尾；总字数 ≤ 硬上限（时长×7≈18） | 案例 1 |
| E2 | 连词归属 | "I didn't tell you the truth because I thought you couldn't handle it." / 2.2s | 因果引导词（"是因为/是怕"类）不在第一行行尾领空；总字数 ≤ 硬上限 15 | 案例 2 |
| E3 | 减词 | "Well, to be completely honest with you, I actually really don't remember seeing him there at that specific moment." / 2.0s | 删 well/actually/really 等填充词；无"呃/老实跟你讲"；≤14 字；信息点（表态+遗忘+时间+见人）一个不缺 | 案例 3 |
| E4 | 动作化拆解 | "The failure of the cooling system caused the core temperature to rise to a critical level." / 2.3s | 无"的故障导致了"式名词化直译；拆成两个动作短句；保住危机语气 | 案例 4 |
| E5 | 中文断句 | "我说了多少次了让你别擅自做主你到底有没有把我的话放在心上" / 3.4s | 补标点；行尾落在意群边界；单字（"你/的"类）不孤立行尾；删冗余"了/到底" | 案例 5 |
| E6 | 中英夹杂 | "So basically you just open up Cursor and then paste your API key right there." / 2.4s | Cursor、API 保留原文不硬译；删 basically/just；≤ 硬上限 17 | 动态对等 |
| E7 | Whisper 冗余 | "这个功能叫做所谓的自动补全 自动补全 自动补全" / 3.0s | 删"叫做/所谓的"；重复只留一次，输出近"自动补全功能" | 校准规则 |
| E8 | CPS 预算 | "And that was the exact moment when the entire situation started to change for our whole family." / 2.0s | ≤ 硬上限 14 字，超预算减词而非全译（参考："那一刻，全家的处境都变了"） | CPS 速查 |
| E9 | 水印清理 | "优优独播剧场 YoYo Television Series Exclusive 今天聊聊怎么拍视频" / 4.0s | 水印整段删除；正文（今天聊聊怎么拍视频）保留 | 校准规则 |

跑法：改了哪个章节，至少跑该章节对应用例 + E1（断句基线）；动"翻译标准"或 references/line-break-cases.md 则全跑。任一断言失败 = 回归，先修 SKILL.md 再继续。
