// 框架字幕层（§9"字幕层归框架"的正式形态——从 Stage.tsx 内联实现抽出，渲染逻辑与类名完全一致）。
// 样式见 styles/base.css（.caption-layer 绝对定位底部居中 / .caption-text 墨底奶油字）。
// 字幕保留区规格：bottom 48px + 高约 60px → 占位带 y[972, 1032]（安全框验收时豁免本层自身）。
export function CaptionLayer({ text }: { text: string }) {
  return (
    <div className="caption-layer" data-testid="caption-layer">
      <span className="caption-text">{text}</span>
    </div>
  );
}
