# 全文文件接口

普通任务只有主任务的 `prepare`、`finish`，以及独立审校 agent 使用的 `review-input`。旧 init/chunk/submit/validate/publish 状态机已移除，无需逐块协议。Python 3.9 及以上，纯标准库。

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
  "criteria":["信","达","雅"],
  "coverage":[[1,163]],
  "verdict":"pass",
  "findings":[]
}
```

coverage 指原文位置，从 1 到 source_count 全文覆盖；可用连续多个区间，不能重叠或漏查。verdict 为 pass 或 revise。每条 finding 包含 `source_ids`、`dimension`、`message`、`suggestion`，以及 `severity: required/optional`、`status: open/resolved`。未解决的事实错误、不通顺或明显文体错误属于 required；不是仅将事实错误视为必修。

修订 draft 后须独立复核并绑定新的 draft_sha256；不能手动换哈希冒充复核。脚本检查记录完整性与版本，不证明 agent 真的独立，也不能识别全部语义错误。宿主负责实际调度与核对 agent 标识。原语言校对和精简可按需独立审校，翻译必需。

## 一次输出

```text
python3 <skill目录>/skill_main.py finish <working_dir> --draft <draft_path> --review <review_path>
```

成功返回 `ok:true`、真实 output、reviewer_id 与 warnings；成功后清理系统临时任务。默认输出 `_refined`，已存在时生成 `_refined_2` 等。只有用户经 AskUserQuestion 明确选择覆盖后使用 `--overwrite`，源文件始终不能覆盖。正文通过数据文件传递，不经过 shell 插值。

失败返回非零并保留临时任务供重试；不能把 draft 当成完成的译文。退出码 0 表示命令成功；2 为参数用法错误；3 为输入、结构、审校或文件操作失败。prepare/review-input 成功均不代表翻译质量已通过。Windows 文件系统需支持原子硬链接发布；不支持时明确失败，不用可能覆盖已有结果的方式降级。

## 明确选择重新分段时

prepare 加 `--timing resegment --timing-reason word-timestamps|audio-align|srt-estimate`。前两项仅在真实提供了对应证据时使用，脚本不自动对齐；只有 SRT 时先用 AskUserQuestion 取得估算授权，再用 srt-estimate。

draft 改为以下结构，允许合并或拆分，不固定条目数：

```json
{"items":[{"source_ids":["entry-000001","entry-000002"],"start":"00:00:00,000","end":"00:00:06,000","text":"按中文意群组织的字幕。"}]}
```

每条必须引用连续、按顺序的源条目，时间落在对应源范围内，覆盖全文，保留首尾范围，无反向、零时长或新重叠。仅覆盖 source_ids 不能证明字词同步，审校还须检查内容出现时机。估算时间在完成摘要中说明，不声称精确。
