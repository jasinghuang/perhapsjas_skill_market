import { createPrimitive } from "../_internal/factory";

export interface TableProps {
  header?: string[];
  rows: string[][];
  variant?: "bordered" | "zebra" | "columns";
  className?: string;
  "data-testid"?: string;
}

const Base = createPrimitive("table", {
  tag: "table",
  variants: ["bordered", "zebra", "columns"],
  defaultVariant: "bordered",
});

export function Table({ header, rows, variant = "bordered", ...rest }: TableProps) {
  return (
    <Base variant={variant} data-testid={rest["data-testid"]} className={rest.className}>
      {header ? (
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </Base>
  );
}
