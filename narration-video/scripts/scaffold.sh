#!/usr/bin/env bash
set -euo pipefail

# 用法: scaffold.sh <目标目录> [--slug 项目名] [--stage 16:9|3:4]
# 机制说明（偏离原版 npm create vite）：直接拷贝模板 + npm install——
# 依赖版本由模板 package.json 锁定，确定性优于 create-vite 的时变脚手架。

TARGET=""
SLUG="presentation"
STAGE="16:9"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2 ;;
    --stage) STAGE="$2"; shift 2 ;;
    *) TARGET="$1"; shift ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "用法: scaffold.sh <目标目录> [--slug 项目名] [--stage 16:9|3:4]" >&2
  exit 1
fi

if [[ -e "$TARGET" ]]; then
  echo "错误: 目标目录已存在，拒绝覆盖: $TARGET" >&2
  exit 1
fi

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_DIR="$SKILL_DIR/templates"

case "$STAGE" in
  16:9) DIMS='{ width: 1920, height: 1080 }' ;;
  3:4)  DIMS='{ width: 1080, height: 1440 }' ;;
  *)
    echo "错误: --stage 只支持 16:9 或 3:4" >&2
    exit 1
    ;;
esac

# 1. 拷贝模板
cp -R "$TEMPLATE_DIR" "$TARGET"

# 2. 写运行时配置（slug + 舞台尺寸 = 档案最小参数）
cat > "$TARGET/src/engine/runtime-config.ts" <<EOF
// 运行时配置：由 scaffold 按档案参数生成（--slug / --stage），勿手改
import type { StageDims } from "./useStageScale";

export interface RuntimeConfig {
  slug: string;
  dims: StageDims;
}

export const stageConfig: RuntimeConfig = {
  slug: "$SLUG",
  dims: $DIMS,
};
EOF

# 3. 引擎版本标记（check 对比升级提示）
ENGINE_VERSION="$(grep -o 'ENGINE_VERSION = "[^"]*"' "$TEMPLATE_DIR/src/engine/constants.ts" | cut -d'"' -f2)"
echo "$ENGINE_VERSION" > "$TARGET/.engine-version"

# 4. 依赖安装 + 类型冒烟
(cd "$TARGET" && npm install --no-audit --no-fund && npx tsc --noEmit)

# 5. 下一步指引（给下一个时刻的 agent 看）
cat <<EOF

✅ 项目已创建: $TARGET
   舞台: ${STAGE}（${DIMS}）
   引擎版本: $ENGINE_VERSION

下一步:
   cd $TARGET && npm run dev     # 预览（浏览器即播放器，?auto=1 全自动）
   npm run test                  # 引擎单测
   npm run check                 # 静态门禁（M3a 实现中，当前占位）
   npm run render                # 渲染导出（M5 实现中，当前占位）

章节开发前必读: 渐进式文件读取表（SKILL.md）+ CHAPTER-CRAFT.md
EOF
