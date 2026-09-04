import { createPrimitive } from "../factory";

export interface StatCardProps {
  number: string;
  label: string;
  variant?: "plain" | "invert" | "accent";
  "data-testid"?: string;
}

const Base = createPrimitive("stat-card", {
  tag: "div",
  variants: ["plain", "invert", "accent"],
  defaultVariant: "plain",
});

export function StatCard({ number, label, variant = "plain", ...rest }: StatCardProps) {
  return (
    <Base variant={variant} data-testid={rest["data-testid"]}>
      <div className="cdp-stat-card-number">{number}</div>
      <div className="cdp-stat-card-label">{label}</div>
    </Base>
  );
}
