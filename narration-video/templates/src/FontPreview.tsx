// 字体配对对比页（M2b 用户拍板用；dev-only，不入章节层）
export function FontPreview() {
  const sample = "口播视频 从稿子到成片";
  return (
    <div style={{ padding: 48, fontFamily: "sans-serif" }}>
      <h1>中文标题字体配对对比（creative-mode 主题）</h1>
      <div style={{ display: "flex", gap: 64 }}>
        <div>
          <div style={{ fontFamily: '"Noto Sans SC"', fontWeight: 900, fontSize: 72 }}>{sample}</div>
          <p>A. Noto Sans SC 900（黑体）——现代、中性、与 Archivo Black 同气质</p>
        </div>
        <div>
          <div style={{ fontFamily: '"Noto Serif SC"', fontWeight: 900, fontSize: 72 }}>{sample}</div>
          <p>B. Noto Serif SC 900（宋体）——模板官方 CJK 指引推荐，重体宋最接近海报黑体密度</p>
        </div>
      </div>
      <p style={{ marginTop: 48 }}>判定标准：与 Archivo Black 大标题并置时的密度协调度（见下方混合排版）。</p>
      <div style={{ fontFamily: '"Archivo Black"', fontSize: 96 }}>CREATIVE MODE</div>
      <div style={{ fontFamily: '"Noto Sans SC"', fontWeight: 900, fontSize: 96 }}>创意模式</div>
      <div style={{ fontFamily: '"Noto Serif SC"', fontWeight: 900, fontSize: 96 }}>创意模式</div>
    </div>
  );
}
