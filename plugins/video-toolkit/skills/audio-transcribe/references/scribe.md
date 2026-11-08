# Scribe V2 在线路线（ElevenLabs）

`POST https://api.elevenlabs.io/v1/speech-to-text`，模型固定 `scribe_v2`
（不用 realtime 变体）。标准库实现，无本地模型、无 GPU、无第三方依赖——
选此路线时 `run.py` 直接用当前解释器，不安装任何包。

## 凭证

- 仅从环境变量 `ELEVENLABS_API_KEY` 读取。
- **绝不**把 key 写进 SKILL.md、输出产物、日志、错误信息或提交记录
  （401 报错只说凭证被拒，不回显 key）。
- 缺失时转写前置检查即失败并给出配置指引，不发起网络请求。

## 请求参数（本项目固定约定）

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `model_id` | `scribe_v2` | 固定 |
| `timestamps_granularity` | `word` | 词级时间戳，供 SRT 分句 |
| `tag_audio_events` | `false` | 音频事件标签默认关闭，避免混入字幕时间轴 |
| `language_code` | 指定时传 ISO-639-1（zh/en/…） | auto/混合时不传，由 API 自动识别 |
| `diarize` | `--diarize` 时 true | 说话人分离，可能计费上浮 |

不默认启用 keyterms、transcript_edit、多声道独立计费等附加选项。

## 计费

- 价格随时间变化，**不写入代码常量**。估算与结算以账号实际费率为准：
  [ElevenLabs API 定价](https://elevenlabs.io/pricing/api)
- 多声道独立识别按声道计费，本项目不默认开启。
- 已上传后超时（状态不明）不会自动重传——重传会再次计费。此时报
  `submission_unknown` 并保留请求标识，请先在 ElevenLabs 控制台核对用量。

## 重试策略

| 情况 | 行为 |
| --- | --- |
| 401 / 403（凭证） | 立即停止，不重试，不打印 key |
| 400 / 422（参数） | 立即停止并展示 API 返回的原因 |
| 429 / 5xx / 连接失败 | 最多 3 次，退避 2s、4s |
| 上传后超时 | `submission_unknown`，不自动重传 |

## 文件限制

支持所有主流音视频格式直接上传（本项目沿用原文件，不预处理）；单文件 < 5GB；
最短 100ms。[API 文档](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)

## 验收状态

| 场景 | 状态 |
| --- | --- |
| P07 无本地 GPU 模型依赖，scribe_v2 完成导出 | 请求/重试/过滤逻辑单测全覆盖；真实计费调用待有凭证环境验收 |
| 凭证缺失 | 已验证：前置失败、无网络请求、不泄露 key |
