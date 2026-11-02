// 框架字幕层（§9"字幕层归框架"的正式形态——从 Stage.tsx 内联实现抽出，渲染逻辑与类名完全一致）。
// 样式见 styles/base.css（.caption-layer 绝对定位底部居中 / .caption-text 墨底奶油字）。
// 字幕保留区规格：bottom 48px + 高约 60px → 占位带 y[972, 1032]（安全框验收时豁免本层自身）。
//
// M6 Checkpoint C 用户硬性要求："每一次出现的字幕不要太长了"——字幕按句切块（≤16 字/块），
// 步内随时间逐块推进。确定性：块 = f(text, stepMs, tMs) 纯函数（captionChunks.ts），
// 渲染态由桥 seek 驱动 tMs（同一 t 恒同一块，跨会话逐字节一致）；
// 预览态由音频时钟驱动。未提供 tMs（历史调用方）→ 整段显示（无切块）。
import { useEffect, useRef } from "react";
import { bindCaptionElement } from "./captionDriver";
import { splitCaptionChunks } from "./captionChunks";

export function CaptionLayer({
  text,
  stepMs,
}: {
  text: string;
  /** 该步时长（估算口径——与渲染静置帧分块 / SRT 同一份 estimateNarrationMs） */
  stepMs?: number;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  // 每步（text 变化）绑定一次；绑定时即驱动 t=0（第 0 块）。后续换块由
  // cursorBridge.seek / 音频时钟经 captionDriver 同步直写——不进 React。
  useEffect(() => {
    bindCaptionElement(spanRef.current, text, stepMs ?? 0);
    return () => bindCaptionElement(null, "", 0);
  }, [text, stepMs]);
  return (
    <div className="caption-layer" data-testid="caption-layer">
      <span className="caption-text" ref={spanRef}>
        {splitCaptionChunks(text)[0] ?? text}
      </span>
    </div>
  );
}
