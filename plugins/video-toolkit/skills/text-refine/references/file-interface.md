# 文件接口与恢复说明

按需读取：执行管线命令、排查退出码或恢复中断任务时读本文。

## 命令与数据流

```text
inspect 输入 → init 输入(--task …) → [ chunk 工作目录 块ID → 宿主模型改写 → submit 工作目录 块ID 结果.json ]×N
→ validate 工作目录 → publish 工作目录 [--overwrite]
```

- 工作目录：`{输出目录}/{源文件名}_refine_work/`，内含 `state.json` 与 `chunks/<块ID>.result.json`；state 中的路径均为绝对路径（跨目录恢复不漂移）。
- 默认输出：`{源文件名}_refined.{原扩展名}`；已有文件默认不覆盖（自动取 `_2`、`_3`… 序号名），`--overwrite` 需用户显式选择。
- 「翻译并精简」组合意图：`init --task translate --allow-simplify`，删改授权记入 `task_config.extra.allow_simplify`（中断恢复与逐块审校都能拿到授权依据；仅 translate 可用）。
- 重做已提交的块（审校返工、结果文件被篡改后的修复）：`submit … --force`，覆盖该块结果文件并重算 sha 与校验。
- 结果一律走**文件**传递：宿主模型把改写结果写成 JSON 文件再 submit。正文是数据——含引号、反引号、`$()`、heredoc 结束标记也不会被 shell 解释或截断。

## 提交格式

preserve（校对/翻译/精简，SRT 与 TXT/MD 通用）——模型只填新正文，**没有时间字段可填**：

```json
{
  "chunk_id": "chunk-0002",
  "items": [
    {"source_id": "entry-000051", "text": "校对后的正文"},
    {"source_id": "entry-000052", "text": "下一条正文"}
  ]
}
```

- SRT 的 `source_id` 是 `entry-%06d`（按源位置，重复序号也能区分）；TXT/MD 是 `block-%06d`，且 items 里只会出现可编辑文本块（围栏/表格/frontmatter 自动原样回填，不在 items 中）。
- 校验：ID 未知/重复/遗漏/越界（含只读上下文条目）逐一拒绝；SRT 样式标签多重集合不变；MD 链接地址多重集合不变、行内代码默认不变（用户明确要求翻译代码注释时 `submit --allow-inline-code-edit`，仅校验数量一致）。

resegment（独立格式，见 timing-policies.md）：`items[].source_ids / start / end / text`，校验映射覆盖、时间边界与不重叠。

## 状态文件字段（state.json）

| 字段 | 用途 |
| --- | --- |
| `schema_version` | 状态格式版本（不匹配即拒绝复用） |
| `input_path`、`input_sha256` | 源文件及其实际内容（路径相同 ≠ 内容相同） |
| `task_config`、`config_hash` | 任务、语言、时间轴、术语与保护选项（改动即失效） |
| `skill_revision` | 规则版本，防止规则变动后混用旧结果 |
| `output_path`、`working_dir` | 正式输出与中间文件位置 |
| `chunks` | 每块源位置、结果文件、结果 sha256 与状态（pending/validated/failed） |
| `status` | pending / running / needs_review / validated / completed / failed |
| `diagnostics` | 输入诊断（既有重叠、断续序号等，恢复时如实继承） |

恢复时同时校验输入内容、任务配置与规则版本；`status` 子命令列出 pending 块，已验证块直接复用，只补未完成的。

## 退出码（单点定义，与 skill_main.py 一致）

| 码 | 含义 | 调用方动作 |
| --- | --- | --- |
| 0 | 成功 | 继续 |
| 1 | 成功，带非阻塞警告/疑点 | 继续并把疑点并入报告 |
| 2 | 用法错误（参数缺失/非法、不支持格式） | 修正参数 |
| 3 | 阻塞失败（解析失败、块校验不过、有块未提交、未授权覆盖） | 读 stdout JSON 的 issues/blockers 定位修复 |
| 4 | 状态陈旧或损坏（源内容变化、配置/规则版本不符、state.json 损坏） | 不静默复用；新建任务或重新生成受影响块 |

stdout 始终有本命令结果的 JSON（失败时含 `ok:false` 与原因），stderr 一行人类摘要；**不得仅凭输出文件存在判断成功**。

## 批量与并行注意

- 多文件批量：每文件独立工作目录，各自 init/submit/validate，主任务统一 publish 并汇总成功/失败/待审校。
- 并行时不要让多个 agent 写同一个文件或同一个工作目录；资源不足就串行降级，核心功能不依赖并行。
- 审校（含独立 agent 复检）计入总资源预算。
