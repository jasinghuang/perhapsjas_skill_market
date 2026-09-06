/**
 * findings：静态门禁的发现项模型与报告渲染。
 *
 * 纯 TS、无 DOM 依赖——同时被 tsx（node 环境，check-fast 入口）与 vitest 消费。
 */

export type Severity = "blocker" | "warning";

export interface Finding {
  rule: string;
  severity: Severity;
  location: string;
  message: string;
}

export class FindingBag {
  private readonly findings: Finding[] = [];

  add(finding: Finding): void {
    this.findings.push(finding);
  }

  hasBlockers(): boolean {
    return this.findings.some((f) => f.severity === "blocker");
  }

  exitCode(): number {
    return this.hasBlockers() ? 1 : 0;
  }

  render(): string {
    if (this.findings.length === 0) {
      return "静态门禁报告：0 项（blocker 0，warning 0）";
    }
    const blockers = this.findings.filter((f) => f.severity === "blocker");
    const warnings = this.findings.filter((f) => f.severity === "warning");
    const lines: string[] = [
      `静态门禁报告：共 ${this.findings.length} 项（blocker ${blockers.length}，warning ${warnings.length}）`,
    ];
    for (const group of [blockers, warnings] as const) {
      for (const f of group) {
        lines.push(`[${f.severity}] ${f.rule} ${f.location} ${f.message}`);
      }
    }
    return lines.join("\n");
  }
}
