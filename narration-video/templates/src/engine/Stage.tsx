import type { PropsWithChildren } from "react";
import { CaptionLayer } from "./CaptionLayer";
import { StageDims, useStageScale } from "./useStageScale";

/**
 * 导出服务的页面侧路由（M5b Task 5，§9 的"导出"控制）。
 *
 * **相对路径是同源的载体**：导出服务是随 dev server 启动的 Vite 中间件
 * （`vite-plugins/export-service.ts`），端口就是页面自己的 ⇒ 无跨源、无预检、无端口发现。
 * 中间件侧的路由由 `vite-plugins/export-service.test.ts`（真 fetch 打真 Vite）钉死，本侧由
 * `App.test.tsx` 的 `toHaveBeenCalledWith` 逐字钉死——任一侧改名即另一侧红。
 */
export const EXPORT_ROUTES = {
  status: "/__export/status",
  run: "/__export/run",
  file: "/__export/file",
} as const;

/** 不可达时的启动指引（§9）。**只写 CLI 入口**——指引里出现别的入口等于教用户走不存在的路。 */
export const EXPORT_COMMAND = "npm run render";

/**
 * 导出按钮的界面态：idle / running / done 是 §9 的三态（进度反馈 → 取 mp4）；
 * unreachable = 导出服务不可达（页面给启动指引）；failed = 服务报的失败（可重试）。
 * 后两者是**非 happy 面**，不是第三态之外的新能力——按钮的位置与语义不变。
 */
export type ExportUiState = "idle" | "running" | "done" | "failed" | "unreachable";

export interface StageProps extends PropsWithChildren {
  dims: StageDims;
  /** 录屏/渲染模式隐藏 chrome */
  noUi?: boolean;
  /**
   * 字幕开关（M5b Task 3，§9 字幕层归框架）：缺省 undefined = 字幕照常进片（现状）；
   * `noSubs` 时**不渲染字幕层**（`--no-subs` 出无字幕版）。判据是"层不在 DOM"——
   * 成片是整视口截图，只有不挂载才等于"字幕不进片"（CSS 隐藏会留下占位与样式面）。
   * 否定式开关：没传 / 传 false 都不改变行为（章节无权干预）。
   */
  noSubs?: boolean;
  caption: string;
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  /**
   * 导出（M5b Task 5，§9 的第四个控制）：点一下触发本地渲染服务。
   * 缺省 = 按钮在但禁用（老调用方零改动，位置也稳定——不做"能力时有时无"的闪动）。
   */
  onExport?: () => void;
  /** 导出界面态（缺省 idle；状态与进度都由服务端给，页面不自己猜） */
  exportState?: ExportUiState;
  /** 进度读数：total === 0 = 还不知道总步数（显示占位，不给假分数） */
  exportProgress?: { done: number; total: number };
  /** failed = 失败原因；done = 产物名（服务端 message 原样显示） */
  exportMessage?: string;
  /** 「复制命令」按钮（unreachable 态的启动指引）；缺省 = 只显示命令文本 */
  onCopyExportCommand?: () => void;
}

export function Stage({
  dims,
  noUi,
  noSubs,
  caption,
  onPlay,
  onPause,
  onStop,
  onExport,
  exportState = "idle",
  exportProgress,
  exportMessage,
  onCopyExportCommand,
  children,
}: StageProps) {
  const { shellRef, scale } = useStageScale(dims);
  return (
    <div className="app-shell" ref={shellRef}>
      <div
        className="stage-fitter"
        style={{ width: dims.width * scale, height: dims.height * scale }}
      >
        <div
          className="stage-frame"
          data-testid="stage-frame"
          style={{
            width: dims.width,
            height: dims.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
          {caption && !noSubs ? <CaptionLayer text={caption} /> : null}
        </div>
      </div>
      {!noUi && (
        <div className="transport" data-testid="transport">
          <button type="button" data-testid="btn-play" onClick={onPlay}>
            播放
          </button>
          <button type="button" data-testid="btn-pause" onClick={onPause}>
            暂停
          </button>
          <button type="button" data-testid="btn-stop" onClick={onStop}>
            停止
          </button>
          {/* 导出（M5b Task 5，§9）：用户不碰命令行取片——点按钮 → 进度 → 下载。
              running 中禁用（服务端对重复触发也是 409 的两道防线之一）。 */}
          <button
            type="button"
            data-testid="btn-export"
            onClick={onExport}
            disabled={exportState === "running" || onExport === undefined}
          >
            {exportState === "running" ? "导出中" : exportState === "done" ? "重新导出" : "导出"}
          </button>
          {exportState === "running" && (
            <span data-testid="export-progress">
              {exportProgress !== undefined && exportProgress.total > 0
                ? `${exportProgress.done}/${exportProgress.total}`
                : "…"}
            </span>
          )}
          {exportState === "done" && (
            // 同源取件口：中间件带 `Content-Disposition: attachment`，点一下直接下载（不导航走页面）。
            // 行内样式只取 token（字号与按钮同档、颜色继承）——`.transport` 的样式表不在本任务 Files 内。
            <a
              data-testid="link-export-file"
              href={EXPORT_ROUTES.file}
              download
              style={{ alignSelf: "center", color: "inherit", fontSize: "var(--t-label)" }}
            >
              下载 mp4
            </a>
          )}
          {(exportState === "done" || exportState === "failed") && exportMessage !== undefined && (
            <span data-testid="export-message">{exportMessage}</span>
          )}
          {exportState === "unreachable" && (
            // §9「不可达时页面给出启动指引」：服务没起来（或这页是生产构建）时，页面把命令行入口
            // 摆在原地——用户不用去翻 README 才知道怎么出片。
            <span data-testid="export-hint">
              导出服务不可达（随 dev server 启动）——命令行出片：<code>{EXPORT_COMMAND}</code>
              {onCopyExportCommand !== undefined && (
                <button type="button" data-testid="btn-export-copy" onClick={onCopyExportCommand}>
                  复制命令
                </button>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
