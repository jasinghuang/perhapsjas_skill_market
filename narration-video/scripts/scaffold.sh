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
# storyboard（M4 分镜产出——模板上跑过 npm run storyboard 后是脏的，新项目应为空）/
# .impeccable（设计钩子的本地状态：narrow ignore 与 hook 缓存，属工具态非模板内容）
cp -R "$TEMPLATE_DIR" "$TARGET"
rm -rf "$TARGET/node_modules" "$TARGET/dist" "$TARGET/storyboard" "$TARGET/.impeccable"
# M5a Task 7：渲染产出（render/<slug>.mp4 + 中间帧目录）同样是生成物，新项目应为空。
# 单独一行（不动上面那行 M3b/M4 落的清理面——Ruling Q3）。
rm -rf "$TARGET/render"

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
  /** 停留垫档案覆盖（ms；§3.1 三层停留垫的**中间层**：引擎默认 400ms → 本层 → timing.json
   *  逐帧覆盖）。生产者是 scaffold（按平台节奏写），缺省 = 不覆盖 → 引擎默认。
   *  解析唯一源头：engine/hold.ts 的 resolveHoldMs（运行时与渲染同一条）。
   *  M5a Task 7 补：接口形状必须与模板 src/engine/runtime-config.ts **同形**——本文件由
   *  scaffold 整份重写，字段少一个就是"生成物类型与引擎/渲染消费面不一致"（App.tsx 与
   *  scripts/render.ts 都读 stageConfig.holdMs，缺字段 = 新项目 tsc 直接报 TS2339）。 */
  holdMs?: number;
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
   npm run check:fast            # 静态门禁（秒级，迭代用）：章节/文本/资源/主题/组件扫描 + 防失同步/清单断言
   npm run storyboard            # Phase 3 静态分镜：逐帧截图 + storyboard/index.html + storyboard.json
                                 #   + 零动画门禁（帧数=总 step 数；氛围微动按步 timing.json 声明 ambient 豁免）
                                 #   加 --verify-sequential：顺序推进 vs 独立 mount 逐字节一致性校验
   npm run render                # 渲染导出：自起 Vite + 逐帧 seek → ffmpeg 出 render/<slug>.mp4 + 产物自校验
                                 #   未合成音频时按估时出片（无声，CLI 会明示）；首次可用 --mock-audio 出占位音轨
                                 #   （lavfi 正弦 + ffprobe 实测时长 → public/audio/ + audio-durations.json）
                                 #   加 --only 0,2 只渲指定步（specs 下标）／--concurrency N／--verify-determinism
                                 #   （独立会话重采逐字节比对 + 负样本；产物 render/ 不入库）

截图/渲染/全量门禁类命令前置（仅这些命令需要，浏览器不进 npm install）:
   npx playwright install chromium   # 首次执行一次；之后走缓存（跨项目复用）
   ffmpeg                            # 仅渲染导出需要（npm run render）：macOS 用 brew install ffmpeg，Linux 用 apt install ffmpeg
   npm run check                 # 全量门禁（= check:fast + 无头 pass）：自起 Vite + Chromium 逐 step 跑，十秒级；零 blocker 才算过
   dev server 需先运行（npm run dev）——storyboard 连不上会给指引，不自动起服

章节开发前必读: 渐进式文件读取表（SKILL.md）+ CHAPTER-CRAFT.md
EOF
