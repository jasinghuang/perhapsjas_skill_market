import type { CSSProperties } from "react";
import { Card } from "../structure/Card";
import { Kicker } from "../text/Kicker";

/** 便签卡（S13 便签墙收编）：4px 墨框卡体 + tone 背景 + mono 标签 + 短句。
    tone 背景走组件 CSS（token：粉=accent-2 / 黄=accent-4 / 绿=accent-1 / 橙=accent-3 / cream=surface）；
    亮底（yellow/cream）墨字、深底三色 cream 字（Card plain/accent 变体决定）。
    定位 / 尺寸 / 旋转（rotate）为构图职责——消费端 style 提供；图钉为组件内 CSS 几何（左上角 8px 墨点）。 */

export interface PostItProps {
  label: string;
  text: string;
  tone: "pink" | "yellow" | "green" | "orange" | "cream";
  /** 构图级微旋转（deg；默认 0）——旋转 bbox 落安全框内为消费端构图职责 */
  rotate?: number;
  /** 主角卡文本加大档（S13 hero 卡 44px；默认 28px） */
  emphasis?: boolean;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/** tone → CSS 类（组件 CSS 以 token 语义命名：accent-N 映射进 CSS——零色名词进样式表） */
const TONE_CLASS: Record<PostItProps["tone"], string> = {
  pink: "cdp-post-it-tone-accent-2",
  yellow: "cdp-post-it-tone-accent-4",
  green: "cdp-post-it-tone-accent-1",
  orange: "cdp-post-it-tone-accent-3",
  cream: "cdp-post-it-tone-surface",
};

export function PostIt({ label, text, tone, rotate = 0, emphasis = false, className = "", style, ...rest }: PostItProps) {
  const darkInk = tone === "yellow" || tone === "cream";
  return (
    <Card
      variant={darkInk ? "plain" : "accent"}
      className={`cdp-post-it ${TONE_CLASS[tone]} ${emphasis ? "cdp-post-it-emphasis" : ""} ${className}`.trim()}
      style={{ transform: `rotate(${rotate}deg)`, ...style }}
      data-testid={rest["data-testid"]}
    >
      <div
        className="cdp-post-it-pin"
        aria-hidden="true"
        data-testid={rest["data-testid"] ? `${rest["data-testid"]}-pin` : undefined}
      />
      <Kicker variant="plain" className="cdp-post-it-label">{label}</Kicker>
      <span className="cdp-post-it-text">{text}</span>
    </Card>
  );
}
