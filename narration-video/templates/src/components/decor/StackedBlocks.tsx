export interface StackedBlocksProps {
  className?: string;
  "data-testid"?: string;
}

/** 堆叠方块（十轮 F3 新组件，参考 s4 stacked-block）：4 个 160×160 方块
    绝对定位错位叠放（偏移步进 40px），配色序列 accent-2/accent-4/accent-3/surface-2，
    每块 4px 墨框 + 18px 18px 0 墨色硬阴影。容器尺寸自适应 = 4×160 + 3×40 = 280。 */
const BLOCK_COLORS = ["var(--accent-2)", "var(--accent-4)", "var(--accent-3)", "var(--surface-2)"];

export function StackedBlocks({ className = "", ...rest }: StackedBlocksProps) {
  return (
    <div className={`cdp-stacked-blocks ${className}`.trim()} data-testid={rest["data-testid"]}>
      {BLOCK_COLORS.map((bg, i) => (
        <div key={i} className="cdp-stacked-block" style={{ background: bg }} />
      ))}
    </div>
  );
}
