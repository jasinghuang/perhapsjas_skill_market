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
