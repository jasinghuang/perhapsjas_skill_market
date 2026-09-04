import { createPrimitive } from "../factory";

export interface TableProps {
  header?: string[];
  rows: string[][];
  variant?: "bordered" | "zebra";
  className?: string;
  "data-testid"?: string;
}

const Base = createPrimitive("table", {
  tag: "table",
  variants: ["bordered", "zebra"],
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
