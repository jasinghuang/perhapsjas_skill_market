import { createPrimitive } from "../factory";

export interface GridProps {
  variant?: "even" | "half";
  /** even 变体下的列数（half 固定 2 列） */
  columns?: number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  "data-testid"?: string;
}

const Base = createPrimitive("grid", {
  tag: "div",
  variants: ["even", "half"],
  defaultVariant: "even",
});

export function Grid({ variant = "even", columns = 3, style, ...rest }: GridProps) {
  const gridStyle: React.CSSProperties =
    variant === "even"
      ? { gridTemplateColumns: `repeat(${columns}, 1fr)`, ...style }
      : style ?? {};
  return (
    <Base variant={variant} style={gridStyle} data-testid={rest["data-testid"]} className={rest.className}>
      {rest.children}
    </Base>
  );
}
