# ElevenLabs Scribe V2

只在用户明确选择在线后调用 `POST https://api.elevenlabs.io/v1/speech-to-text`。
模型固定 `scribe_v2`，不使用 realtime。只用标准库和 ffmpeg，无本地模型依赖。

## 凭证与请求

仅从 `ELEVENLABS_API_KEY` 读取密钥；不记录或输出密钥，也不回显 API 原始错误正文。
缺少凭证时前置失败，不上传。费率以 [账号/API 定价](https://elevenlabs.io/pricing/api) 为准，
不写过期价格常量。选择本地路线不授权在线回退。

视频先提取指定音轨为单声道 16kHz AAC／M4A，再使用带 Content-Length 的 multipart 流式上传，
单次内存块不超过 256KiB，不把整段视频／音频读入内存。
文件和工作材料保存在应用缓存，成功后清理临时音频。

请求固定 `timestamps_granularity=word`、`tag_audio_events=false`；指定语言时传 ISO language_code，
auto 不传；`diarize` 仅用户明确要求时开启。保留真实 speaker_id，不猜姓名。
词级时间用于 SRT 和带时间 MD，spacing／audio_event 不作为对白词单位。

## 有界重试

- 401／403：凭证错误立即停止。
- 其他明确 4xx（429 除外）：参数／资源错误立即停止。
- 429：最多 3 次，退避 2 秒、4 秒。
- 5xx、连接中断、超时、响应解析失败或不合契约：`submission_unknown`，不自动重新上传。
  这些情况可能已经处理／计费；用控件让用户决定后续操作，不能盲目重试。

完整成功响应缓存在应用缓存，可用于修改格式后重新导出；改变音轨或内容会创建新任务。
本轮仅做请求构造、流式发送、本地 HTTP 接收和故障逻辑测试，未发起真实计费调用。
远端限制以 [官方 API 文档](https://elevenlabs.io/docs/api-reference/speech-to-text/convert) 为准。
