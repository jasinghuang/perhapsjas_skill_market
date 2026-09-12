import type { PropsWithChildren } from "react";
import { CaptionLayer } from "./CaptionLayer";
import { StageDims, useStageScale } from "./useStageScale";

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
}

export function Stage({ dims, noUi, noSubs, caption, onPlay, onPause, onStop, children }: StageProps) {
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
        </div>
      )}
    </div>
  );
}
