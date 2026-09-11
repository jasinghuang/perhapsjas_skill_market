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

/** 报告默认标题（M3b Task 7 起可被调用方覆盖：全量入口用"门禁报告（fast + 无头）"）。 */
export const DEFAULT_REPORT_TITLE = "静态门禁报告";

export class FindingBag {
  private readonly findings: Finding[] = [];
  private readonly noteLines: string[] = [];

  add(finding: Finding): void {
    this.findings.push(finding);
  }

  /** 顺序追加（报告按插入序输出——同 severity 内不得被重排）；空数组是恒等操作。 */
  addAll(findings: readonly Finding[]): void {
    for (const f of findings) this.findings.push(f);
  }

  /**
   * 并入另一袋的全部 findings **与 notes**（M3b Task 7：fast 层 + 无头层两条管线的报告合并）。
   * 单次遍历 this.findings（同类内私有数组互访）；合并空袋是恒等操作。
   */
  merge(other: FindingBag): void {
    for (const f of other.findings) this.findings.push(f);
    for (const n of other.noteLines) this.noteLines.push(n);
  }

  /**
   * 追加一条 **info**：计数、展示、**不进退出码**（§11.1 的第三档——"不可判定 / 环境噪音"）。
   * 由来（M3b Task 7）：#16 的 console 断言要求"非本页脚本的浏览器 Log 类消息（弃用告警 /
   * CSP / 非 passive 监听器）→ info 并计数，不报 warning"；Task 8 的 #18（渐变/图片背景不可判定）
   * 与 #14（无主题字体文本）同样要落在这一档。故 info 不进 `Severity`（用 severity 表达会污染
   * 分级与退出码语义），而是单开一条笔记通道：报告末尾成段列出，`exitCode()` 完全不受影响。
   */
  addNote(text: string): void {
    this.noteLines.push(text);
  }

  notes(): readonly string[] {
    return this.noteLines;
  }

  hasBlockers(): boolean {
    return this.findings.some((f) => f.severity === "blocker");
  }

  exitCode(): number {
    return this.hasBlockers() ? 1 : 0;
  }

  render(title: string = DEFAULT_REPORT_TITLE): string {
    const lines: string[] = [];
    if (this.findings.length === 0) {
      lines.push(`${title}：0 项（blocker 0，warning 0）`);
    } else {
      const blockers = this.findings.filter((f) => f.severity === "blocker");
      const warnings = this.findings.filter((f) => f.severity === "warning");
      lines.push(
        `${title}：共 ${this.findings.length} 项（blocker ${blockers.length}，warning ${warnings.length}）`,
      );
      for (const group of [blockers, warnings] as const) {
        for (const f of group) {
          lines.push(`[${f.severity}] ${f.rule} ${f.location} ${f.message}`);
        }
      }
    }
    // info 段：无 note 时不产出任何行——既有报告逐字不变（既有测试/消费方不受影响）
    if (this.noteLines.length > 0) {
      lines.push(`info ${this.noteLines.length} 条（不进退出码）：`);
      for (const n of this.noteLines) lines.push(`  · ${n}`);
    }
    return lines.join("\n");
  }
}
