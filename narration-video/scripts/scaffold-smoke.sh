#!/usr/bin/env bash
# 冒烟：scaffold 到临时目录，校验关键产物；任一断言失败即退出非零
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. 16:9 场景
bash "$SKILL_DIR/scripts/scaffold.sh" "$TMP/demo" --slug demo --stage 16:9 >/dev/null
test -f "$TMP/demo/.engine-version"
test -f "$TMP/demo/src/engine/runtime-config.ts"
grep -q 'slug: "demo"' "$TMP/demo/src/engine/runtime-config.ts"
grep -q 'width: 1920' "$TMP/demo/src/engine/runtime-config.ts"
# 安全框单一源（M3b Task 4）：engine/safe-area.ts 随模板全量拷贝，生成的运行时配置消费它
# （16:9 基准值本身由 src/engine/safe-area.test.ts 钉死，此处只断言接线）
test -f "$TMP/demo/src/engine/safe-area.ts"
grep -q 'safeArea: deriveSafeArea(' "$TMP/demo/src/engine/runtime-config.ts"
grep -q '"dev": "vite"' "$TMP/demo/package.json"
grep -q '"test": "vitest run"' "$TMP/demo/package.json"

# 1b. 门禁接线（M3a 静态层 + M3b 全量入口）：check 脚本随模板全量拷贝（含 __fixtures__——
#     fixtures.test.ts 依赖夹具），scaffold 产物上 npm run check:fast exit 0
#     （零 blocker——模板自身是合规标杆；warning 允许：未合成音频是脚手架合法态）。
#     冒烟只跑 check:fast：**全量 check 需 Chromium + 自起 Vite（十秒级），冒烟不跑**
#     （前置 `npx playwright install chromium`）——全量入口的接线由下面的 package.json 断言钉住。
test -f "$TMP/demo/scripts/check/check-fast.ts"
test -f "$TMP/demo/scripts/check/check.ts"
test -d "$TMP/demo/scripts/check/__fixtures__"
(cd "$TMP/demo" && npm run check:fast >/dev/null)
grep -q '"check": "tsx scripts/check/check.ts"' "$TMP/demo/package.json"

# 1c. 时间机器接线（M4 收口）：截图模块 + storyboard 生成器随模板全量拷贝，
#     package.json 有 storyboard 入口（只断言产物存在与接线——真跑要 dev server + Chromium）
test -f "$TMP/demo/scripts/shot/capture.ts"
test -f "$TMP/demo/scripts/shot/verify-sequential.ts"
test -f "$TMP/demo/scripts/storyboard.ts"
test -f "$TMP/demo/scripts/storyboard/data.ts"
test -f "$TMP/demo/scripts/storyboard/html.ts"
test -f "$TMP/demo/src/engine/cursorBridge.ts"
test -f "$TMP/demo/src/chapters/01-example/timing.json"
grep -q '"storyboard": "tsx scripts/storyboard.ts"' "$TMP/demo/package.json"
grep -q 'npx playwright install chromium' "$TMP/demo/scripts/shot/session.ts"
# 模板工作区的分镜产出不得随拷贝进新项目（与 dist/ 同类的生成物；新项目分镜页应为空）
test ! -e "$TMP/demo/storyboard"
# 设计钩子的本地状态（narrow ignore + hook 缓存）是工具态，不得随拷贝进新项目
test ! -e "$TMP/demo/.impeccable"

# 2. 3:4 场景
bash "$SKILL_DIR/scripts/scaffold.sh" "$TMP/tall" --slug tall --stage 3:4 >/dev/null
grep -q 'width: 1080' "$TMP/tall/src/engine/runtime-config.ts"
grep -q 'height: 1440' "$TMP/tall/src/engine/runtime-config.ts"
# 3:4 档案：safeArea **随 dims 折算**（不是 16:9 照抄）——真跑生成配置读实测折算值
SAFE_34="$(cd "$TMP/tall" && npx tsx -e 'import { stageConfig } from "./src/engine/runtime-config.ts"; console.log(JSON.stringify(stageConfig.safeArea))')"
test "$SAFE_34" = '{"chrome":36,"content":54,"top":149,"contentBottom":1245,"captionTop":1277}'

# 3. 目标已存在 → 拒绝覆盖
if bash "$SKILL_DIR/scripts/scaffold.sh" "$TMP/demo" --slug again --stage 16:9 >/dev/null 2>&1; then
  echo "FAIL: 已存在目录未被拒绝" >&2
  exit 1
fi

# 4. 非法 stage → 报错
if bash "$SKILL_DIR/scripts/scaffold.sh" "$TMP/bad" --slug bad --stage 9:16 >/dev/null 2>&1; then
  echo "FAIL: 非法 stage 未被拒绝" >&2
  exit 1
fi

echo "scaffold smoke: OK"
