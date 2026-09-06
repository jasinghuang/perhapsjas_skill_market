// 素材承载（§6.2）：墨框 + 硬阴影 + 遮罩揭示；无素材渲染 placeholder 卡（诚实原则）。
import { createPrimitive } from "../factory";

export interface FigureProps {
  src?: string;
  caption?: string;
  variant?: "frame" | "bare" | "plain";
  /** 宽高比（组件级 aspect 处理，如 "3 / 4"）：高度由 width 与 ratio 决定，placeholder 撑满 */
  ratio?: string;
  reveal?: "fade" | "rise" | "wipe";
  duration?: "fast" | "mid" | "slow";
  className?: string;
  "data-testid"?: string;
}

const Base = createPrimitive("figure", {
  tag: "figure",
  variants: ["frame", "bare", "plain"],
  defaultVariant: "frame",
});

export function Figure({ src, caption, variant = "frame", ratio, reveal, duration, className = "", ...rest }: FigureProps) {
  return (
    <Base
      variant={variant}
      reveal={reveal}
      duration={duration}
      className={[className, ratio ? "cdp-figure-ratio" : ""].filter(Boolean).join(" ")}
      style={ratio ? { aspectRatio: ratio } : undefined}
      data-testid={rest["data-testid"]}
    >
      {src ? (
        <img className="cdp-figure-img" src={src} alt={caption ?? ""} />
      ) : (
        <div className="cdp-figure-placeholder">
          <span className="cdp-figure-placeholder-text">素材待补</span>
        </div>
      )}
      {caption ? <figcaption className="cdp-figure-caption">{caption}</figcaption> : null}
    </Base>
  );
}
