import type { PropsWithChildren } from "react";
import { StageDims, useStageScale } from "./useStageScale";

export interface StageProps extends PropsWithChildren {
  dims: StageDims;
  /** 录屏/渲染模式隐藏 chrome */
  noUi?: boolean;
  caption: string;
  onPlay(): void;
  onPause(): void;
  onStop(): void;
}

export function Stage({ dims, noUi, caption, onPlay, onPause, onStop, children }: StageProps) {
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
          {caption ? (
            <div className="caption-layer" data-testid="caption-layer">
              <span className="caption-text">{caption}</span>
            </div>
          ) : null}
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
