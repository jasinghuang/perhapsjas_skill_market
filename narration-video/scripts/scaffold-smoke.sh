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
grep -q '"dev": "vite"' "$TMP/demo/package.json"
grep -q '"test": "vitest run"' "$TMP/demo/package.json"

# 1b. 静态门禁接线（M3a 收口）：check 脚本随模板全量拷贝（含 __fixtures__——
#     fixtures.test.ts 依赖夹具），scaffold 产物上 npm run check exit 0
#     （零 blocker——模板自身是合规标杆；warning 允许：未合成音频是脚手架合法态）
test -f "$TMP/demo/scripts/check/check-fast.ts"
test -d "$TMP/demo/scripts/check/__fixtures__"
(cd "$TMP/demo" && npm run check >/dev/null)

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

# 2. 3:4 场景
bash "$SKILL_DIR/scripts/scaffold.sh" "$TMP/tall" --slug tall --stage 3:4 >/dev/null
grep -q 'width: 1080' "$TMP/tall/src/engine/runtime-config.ts"
grep -q 'height: 1440' "$TMP/tall/src/engine/runtime-config.ts"

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
