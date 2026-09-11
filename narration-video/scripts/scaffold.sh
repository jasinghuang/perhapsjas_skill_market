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
# 清掉模板工作区里的生成物（不入库、也不该进新项目）：node_modules / dist /
# storyboard（M4 分镜产出——模板上跑过 npm run storyboard 后是脏的，新项目应为空）
cp -R "$TEMPLATE_DIR" "$TARGET"
rm -rf "$TARGET/node_modules" "$TARGET/dist" "$TARGET/storyboard"

# 2. 写运行时配置（slug + 舞台尺寸 = 档案最小参数；安全框由尺寸折算，不手写绝对值）
cat > "$TARGET/src/engine/runtime-config.ts" <<EOF
// 运行时配置：由 scaffold 按档案参数生成（--slug / --stage），勿手改
// 安全框（safeArea）走单一数字源 deriveSafeArea 派生——档案绝对值由基准比例折算得出，
// 不在此处手写（竖版/小红书档案的绝对值待 M7 档案定稿时由用户确认）。
import type { SafeArea } from "./safe-area";
import { deriveSafeArea } from "./safe-area";
import type { StageDims } from "./useStageScale";

export interface RuntimeConfig {
  slug: string;
  dims: StageDims;
  /** 安全框（档案绝对值由基准比例折算得出，见 engine/safe-area.ts） */
  safeArea: SafeArea;
}

const dims: StageDims = $DIMS;

export const stageConfig: RuntimeConfig = {
  slug: "$SLUG",
  dims,
  safeArea: deriveSafeArea(dims),
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
   环境要求: Node ≥ 22.15（package.json engines 已声明——check 的 registerHooks 依赖）

下一步:
   cd $TARGET && npm run dev     # 预览（浏览器即播放器，?auto=1 全自动）
   npm run test                  # 引擎单测 + 门禁自检
   npm run check                 # 静态门禁：章节/文本/资源/主题/组件扫描 + 防失同步/清单断言（零 blocker 才算过）
   npm run storyboard            # Phase 3 静态分镜：逐帧截图 + storyboard/index.html + storyboard.json
                                 #   + 零动画门禁（帧数=总 step 数；氛围微动按步 timing.json 声明 ambient 豁免）
                                 #   加 --verify-sequential：顺序推进 vs 独立 mount 逐字节一致性校验
   npm run render                # 渲染导出（M5 实现中，当前占位）

截图/渲染类命令前置（仅这些命令需要，浏览器不进 npm install）:
   npx playwright install chromium   # 首次执行一次；之后走缓存（跨项目复用）
   dev server 需先运行（npm run dev）——storyboard 连不上会给指引，不自动起服

章节开发前必读: 渐进式文件读取表（SKILL.md）+ CHAPTER-CRAFT.md
EOF
