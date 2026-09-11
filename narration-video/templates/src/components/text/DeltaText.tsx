/** 涨跌文本（S24 数据条目收编；二十四轮 A股规则全局落地）：
    文本内 [+-]数字[.数字]% 片段 → 涨橙（accent-3 / +）跌绿（accent-1 / −），
    可命中多段；无片段文本原样输出（零包装）。
    （现状 showcase 只处理 + 号，本轮按 A股规则扩展 − 号——报告记录在案） */

/** 片段整段匹配（着色判定） */
const DELTA_SEGMENT = /^[+-][0-9]+(?:\.[0-9]+)?%$/;
/** 切分正则（捕获组保留片段本身；全局——多段全着色） */
const DELTA_SPLIT = /([+-][0-9]+(?:\.[0-9]+)?%)/g;

export interface DeltaTextProps {
  text: string;
  className?: string;
}

export function DeltaText({ text, className = "" }: DeltaTextProps) {
  const parts = text.split(DELTA_SPLIT);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        DELTA_SEGMENT.test(part) ? (
          <span
            key={i}
            className={`cdp-delta-text ${part.startsWith("+") ? "cdp-delta-text-up" : "cdp-delta-text-down"} ${className}`.trim()}
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
