// 安全框**单一数字源**（M3b Task 4）：showcase 参考线 / 运行时配置 / scaffold 全部派生自本文件——
// 杜绝 64/96/112/934/958 在多处硬编码后各自漂移（§8.1 细节一致性）。
//
// 基准值来源**逐条**（勿笼统说"取自 V1"）：
//   chrome 64 / content 96 / contentBottom 934 / captionTop 958 → 设计文档 §12b V1
//   top 112 → **实现锚点**（V1 文本未给该数）：showcase 注释"topbar 底 88 + 24 = 顶 112"
//
// 档案折算：水平值（chrome / content）按 W / 1920、垂直值（top / contentBottom / captionTop）
// 按 H / 1080 折算后取整（Math.round）。
//
// **待定项（不擅自定数字）**：3:4（1080×1440）的绝对值只是**基准比例折算**的结果，
// **小红书档案绝对值待 M7 档案定稿时由用户确认**——本文件不发明 3:4 的绝对值。
// 已登记 research-notes/KNOWN-ISSUES.md（M3b Task 4 条目）。

/** 安全框规格（单位：画布 px，相对画布边缘/顶边）。字段形状由 brief 冻结，不得增删。 */
export interface SafeArea {
  /** chrome 元素水平距边缘的下限（左右同值） */
  chrome: number;
  /** 内容带左右边界距边缘的距离（左右同值） */
  content: number;
  /** 内容带顶边 y */
  top: number;
  /** 内容带底边 y（= 字幕区上缘 − 24） */
  contentBottom: number;
  /** 字幕保留区上缘 y */
  captionTop: number;
}

/** 基准档案（16:9 / 1920×1080）的绝对值——见文件头来源逐条。 */
export const SAFE_AREA_BASE: SafeArea = {
  chrome: 64, // §12b V1
  content: 96, // §12b V1
  top: 112, // 实现锚点（V1 未给）
  contentBottom: 934, // §12b V1（字幕区上缘 958 − 24）
  captionTop: 958, // §12b V1
};

/** 基准档案画布尺寸（折算分母，与 SAFE_AREA_BASE 同源） */
export const SAFE_AREA_BASE_DIMS: { width: number; height: number } = {
  width: 1920,
  height: 1080,
};

/** 按档案画布尺寸折算安全框（基准比例折算 + 取整）；非法尺寸抛错（非空护栏）。 */
export function deriveSafeArea(dims: { width: number; height: number }): SafeArea {
  const { width, height } = dims;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`deriveSafeArea: 画布尺寸必须为正有限数，收到 ${width}×${height}`);
  }
  const sx = width / SAFE_AREA_BASE_DIMS.width;
  const sy = height / SAFE_AREA_BASE_DIMS.height;
  return {
    chrome: Math.round(SAFE_AREA_BASE.chrome * sx),
    content: Math.round(SAFE_AREA_BASE.content * sx),
    top: Math.round(SAFE_AREA_BASE.top * sy),
    contentBottom: Math.round(SAFE_AREA_BASE.contentBottom * sy),
    captionTop: Math.round(SAFE_AREA_BASE.captionTop * sy),
  };
}
