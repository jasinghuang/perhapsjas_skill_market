# 全文文件接口

普通任务只有主任务的 `prepare`、`finish`，以及独立审校 agent 使用的 `review-input`。review-input 内部确定性生成最终排时；finish 复算并验证同一候选，无额外逐段协议。Python 3.9 及以上，纯标准库。

## 准备

```text
python3 <skill目录>/skill_main.py prepare <输入> --task translate --target-lang zh
```

`--task` 支持 proofread／translate／simplify；校对和精简不设 target-lang。可选 `--terms <UTF-8术语文件>`、`--translator-id <当前翻译者标识>`、`--output <同格式输出路径>`。明确“翻译并精简”时加 `--allow-simplify`，正常翻译的自然表达无需此选项。

命令返回全文材料、每条时长、实际术语内容、任务配置、内部 working_dir、draft_path 和 review_path。工作目录使用系统临时位置，每次唯一。源文件旁不建任何工作文件夹。失败后直接在临时任务继续，不维护额外状态。

默认保留时间窗的 draft：

```json
{"items":[{"id":"entry-000001","text":"译文"},{"id":"entry-000002","text":"下一条"}]}
```

正文 ID 只用于回填位置，不要求每条孤立翻译。MD／TXT 使用 block-000001。MD 中 editable=false 的块只读，不放入 draft，程序原样回填。所有可编辑 ID 必须恰好覆盖一次。

## 独立审校

独立 agent 执行以下命令，得到原文、候选成品、任务配置、术语和机器计算的 source_sha256／draft_sha256：

```text
python3 <skill目录>/skill_main.py review-input <working_dir> --draft <draft_path>
```

独立 agent 对照全部内容后生成 review；哈希复制命令实际值，不靠模型手算。以下为格式示例，不是可直接复用的审校结论：

```json
{
  "reviewer_id":"实际独立agent标识",
  "source_sha256":"命令返回值",
  "draft_sha256":"命令返回值",
  "candidate_sha256":"命令返回的最终SRT摘要",
  "request_sha256":"命令返回的任务与排时实现摘要",
  "criteria":["信","达","雅"],
  "coverage":[[1,163]],
  "verdict":"pass",
  "findings":[]
}
```

coverage 指原文位置，从 1 到 source_count 全文覆盖；可用连续多个区间，不能重叠或漏查。verdict 为 pass 或 revise。每条 finding 包含 `source_ids`、`dimension`、`message`、`suggestion`，以及 `severity: required/optional`、`status: open/resolved`。未解决的事实错误、不通顺或明显文体错误属于 required；不是仅将事实错误视为必修。

修订 draft、语义范围、排时参数或实现后须独立复核，更新命令实际返回的四项摘要；不能手动换哈希冒充复核。脚本检查记录完整性与版本，不证明 agent 真的独立，也不能识别全部语义错误。宿主负责实际调度与核对 agent 标识。原语言校对和精简可按需独立审校，翻译必需。

## 一次输出

```text
python3 <skill目录>/skill_main.py finish <working_dir> --draft <draft_path> --review <review_path>
```

成功返回 `ok:true`、真实 output、reviewer_id 与 warnings；成功后清理系统临时任务。默认输出 `_refined`，已存在时生成 `_refined_2` 等。只有用户经 AskUserQuestion 明确选择覆盖后使用 `--overwrite`，源文件始终不能覆盖。正文通过数据文件传递，不经过 shell 插值。

失败返回非零并保留临时任务供重试；不能把 draft 当成完成的译文。退出码 0 表示命令成功；2 为参数用法错误；3 为输入、结构、审校或文件操作失败。prepare/review-input 成功均不代表翻译质量已通过。Windows 文件系统需支持原子硬链接发布；不支持时明确失败，不用可能覆盖已有结果的方式降级。

## 自然重新分段 semantic

用户已明确选择自然分段时，prepare 加 `--timing semantic --timing-reason srt-estimate`。全文位于 semantic_source.document，正文移除样式标签、合并空白、原条目间以单空格连接；segments 含 Unicode code point 的字符范围与句级时间。输入的 source 片段按相同规则规范化，程序从头逐个匹配，自动生成字符范围，不要求模型手算偏移。

```json
{"blocks":[{"id":"b001","units":[
  {"source":"Even big AI companies", "text":"连大型 AI 公司也开始"},
  {"source":"now pay creators.", "text":"付费邀请创作者合作。"}
]}]}
```

每段 id 唯一，units 的 source 按顺序连接须恰好覆盖全部规范化正文，包括译文自然省略的填充词；不可重叠、跳句或把源单词劈开。时间由源范围插值得到，模型不填 start/end。每段与每个意群记录局部时间及内部锚点，review-input 返回 timing_plan：段落、候选条目、源范围、时间依据与阅读诊断。

长段只是提醒，不能强制凑时长。已知大于等于 800ms 的源时间留白默认作为段界；词级记录有已知长停顿时亦然。跨这种边界的单位或段落会报错，改语义范围后重试，不删原文。没有实际语音时称“源时间留白”，不称听音确认。程序可按阅读需要借用段内下条入点前最多 300ms 的短空隙延长出点，不移动下条入点、不跨已知停顿或段界；原源文出点与延长量记入 plan。参数集中于 semantic_timing.DEFAULTS，可通过 `--timing-parameters <JSON>` 覆盖；阅读提醒不自动删事实。

源 SRT 的 1～2ms 舍入重叠可归一化为共同边界并列诊断；超过该容差的重叠阻塞自然重排，保留模式仍可使用。复杂局部样式暂不自动重排，会明确报告；整条统一闭合样式可随拆分重新包装，跨不同样式的意群应在样式边界拆开，不能丢标签。

### 已有词级时间

使用 `--timing semantic --timing-reason word-timestamps --timing-data <JSON>`。元数据快照写入临时任务，不在后续调用时悄悄重读外部文件。schema：

```text
source_sha256: 源文件实际字节摘要
document_sha256: semantic_source.document 的 UTF-8 摘要
words: [{text, start_char, end_char, start_ms, end_ms}, ...]
pauses: [{kind, start_ms, end_ms}, ...]   # 可选的已提供停顿/切换区间
```

字符范围以规范化全文计数，左闭右开，覆盖全部非空白文字；每条 text 与切片完全一致，时间为毫秒，按顺序且落在匹配的句级范围内。程序拒绝源摘要错误、字符不匹配、偏移、非法时间或与词语重叠的停顿。意群必须在词边界结束。只有真实数据才能选择 word-timestamps；audio-align 结果需先转换到该 schema，不能仅设一个标志冒充对齐。

只验证元数据身份与内部一致性，不能认证它的真实音频来源；宿主仍需核实提供者及文件对应关系。已验证词时间提供更细依据，不等于已逐帧复核中文声画同步。

## 旧手填时间的 resegment 兼容模式

仅兼容已有显式稿件，不作为翻译推荐路线。prepare 加 `--timing resegment --timing-reason ...`，时间来源必须如实。新任务优先使用上面的 semantic 程序排时。

draft 改为以下结构，允许合并或拆分，不固定条目数：

```json
{"items":[{"source_ids":["entry-000001","entry-000002"],"start":"00:00:00,000","end":"00:00:06,000","text":"按中文意群组织的字幕。"}]}
```

每条必须引用连续、按顺序的源条目，时间落在对应源范围内，覆盖全文，保留首尾范围，无反向、零时长或新重叠。仅覆盖 source_ids 不能证明字词同步，审校还须检查内容出现时机。估算时间在完成摘要中说明，不声称精确。
