# 市场维护交接

## 当前发布配置

- 市场版本 v3.2.1，包含 oscar-performance v1.6。远程 main 是分发源；客户端安装状态与文件内容需单独验证，不能只读版本标签。
- 用户已授权提交、推送本次修订、更新本地插件缓存，并在用户项目中优化原 11 秒提示词；用户项目文稿不提交到市场仓库。
- 本机更新顺序：Codex `plugin marketplace upgrade perhapsjas_skill_market` 后 `plugin add video-toolkit@perhapsjas_skill_market`；Claude Code 先 `plugin marketplace update perhapsjas_skill_market` 后 `plugin update video-toolkit@perhapsjas_skill_market`。命令参数以本机帮助为准。

## 2026-11-20：添加市场后看不到 oscar-performance

- `oscar-performance` 已在 GitHub `main` 的 `772ecec` 提交中发布，并收录在 `video-toolkit` 插件下；市场列表显示的安装单位是 `video-toolkit`。
- 排查时，Codex 配置已保存市场地址，但本机缺少 `~/.codex/.tmp/marketplaces/perhapsjas_skill_market` 副本；`codex plugin marketplace list` 未列出该市场，插件查询为空。地址存在不代表市场已成功加载。
- 使用原地址重新添加后，市场副本已就绪，`codex plugin list --marketplace perhapsjas_skill_market --available --json` 能列出 `video-toolkit`，副本也包含最新 `oscar-performance/SKILL.md`。
- Codex 当前状态：插件可安装，尚未安装或启用。添加市场和安装插件是两个步骤；本次未执行插件安装。
- 本机 Claude Code 的 `video-toolkit` 仍为旧提交 `0de07aecee94`，其市场副本也仍列出 `video-performance`；Codex 和 Claude Code 的缓存、安装状态分别维护。

### 排查命令与注意事项

```sh
codex plugin marketplace list
codex plugin marketplace add https://github.com/jasinghuang/perhapsjas_skill_market.git --json
codex plugin list --marketplace perhapsjas_skill_market --available --json
```

- 复用已添加的市场时保持原来源参数；给原先未指定 ref 的来源追加 `--ref main` 会被视为不同来源并报冲突。
- 当前 `.claude-plugin/marketplace.json` 可被本机 Codex 正确识别，无需仅因目录名称而迁移市场格式。

## 2026-11-20：表演提示词的验收漏洞

- 用户提供色觉辅助宣传片的 `前11秒-表演与视频提示词.md`，指出表演控制偏少。本轮只诊断文本，不改源提示词或 skill 规则，不推断实际成片效果。
- 成稿已具备人物目标、视线对象、眼睑动作及观察后起步的因果；问题是辨认受阻、改换判断依据、获得确认的状态过渡偏薄，不能误报成“完全没有表演”或“分析中的细节全未进入复制块”。
- 八维记录按全段汇总并多项判定“已落实”，不足以证明逐拍表演充分。尤其旁白的声音/气口与画内角色的呼吸是不同对象，前者不能代替后者通过验收。
- 后续改进重点：在最终复制块中核对关键节拍的感知、处理、可见变化及状态承接；区分动作连续性与表演充分性。“克制”“每拍1–2个细节”限制幅度和密度，不应删掉反应过程。
- 该场景的目标、信息障碍及观察邻人的策略已有依据，无需为加强表演新增惊险、羞耻、求助、强行反转或 AU 编码。完整修订应由用户后续请求确定范围。

## 2026-11-20：oscar-performance v1.6 通用修订

- 用户已授权修改 skill 的表演设计与最终提示词验收规则，明确不针对单个场景打补丁。
- 已更新仓库中 skill 的入口、02 表演设计、04 编译、05 验收，并同步导航、方法论、来源映射、用例与验证记录。新增 T23–T28 六组跨场景候选对照；这是同助手文字自检，未进行独立模型运行或成片验证。
- 关键规则：逐拍任务/感知/处理/证据/承接；最终复制块独立验收；偏弱/缺失不能冒充通过；画外声音与画内人物分别核对；不强制持续状态发生转折，局部修订只检查本段及接口。
- 当前为工作区 v1.6，尚未提交或推送；远程市场及已有缓存不会自动包含本次修改。具体记录见 skill 内 `HANDOFF.md` 与 `验证记录.md`。
