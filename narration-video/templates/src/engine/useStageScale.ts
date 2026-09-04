import { useEffect, useRef, useState } from "react";

export interface StageDims {
  width: number;
  height: number;
}

/** 缩放纯函数：取宽高比的最小值，舞台任意视口 bulletproof */
export function computeScale(availW: number, availH: number, dims: StageDims): number {
  return Math.min(availW / dims.width, availH / dims.height);
}

export interface StageScale {
  shellRef: React.RefObject<HTMLDivElement>;
  scale: number;
}

/** 三层壳结构（原版继承）：app-shell（视口居中）→ stage-fitter（真实可见 px）→ stage-frame（原尺寸 transform scale） */
export function useStageScale(dims: StageDims): StageScale {
  const shellRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setScale(computeScale(rect.width, rect.height, dims));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims.width, dims.height]);

  return { shellRef, scale };
}
