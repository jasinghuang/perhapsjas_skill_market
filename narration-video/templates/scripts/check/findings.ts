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

/**
 * note 的**两类**（修复轮 1 / M1——此前混装，正样本出现"info 2 条"而真 info finding = 0）：
 *   · `"info"`：**info 级 finding**（不可判定 / 环境噪音）——报告里 `info N 条` **只数它**
 *     （#16 ① 的浏览器 Log 类消息；Task 8 的 #18 渐变背景 / #14 无字体文本同落此档）；
 *   · `"readout"`：**运行读数**（基址 / 已跑步数 / examined 计数 / 中止说明）——单列成段，
 *     **不计入 info 条数**（它是"这一轮跑了什么"的事实陈述，不是待判级的条目）。
 * 参数**必填**：混装正是本轮的修复对象，默认值会让下一个调用方（Task 8）再次混装。
 */
export type NoteKind = "info" | "readout";

export class FindingBag {
  private readonly findings: Finding[] = [];
  private readonly infoNotes: string[] = [];
  private readonly readoutNotes: string[] = [];

  private bucketOf(kind: NoteKind): string[] {
    return kind === "info" ? this.infoNotes : this.readoutNotes;
  }

  add(finding: Finding): void {
    this.findings.push(finding);
  }

  /** 顺序追加（报告按插入序输出——同 severity 内不得被重排）；空数组是恒等操作。 */
  addAll(findings: readonly Finding[]): void {
    for (const f of findings) this.findings.push(f);
  }

  /**
   * 并入另一袋的全部 findings **与两类 notes**（M3b Task 7：fast 层 + 无头层两条管线的报告合并）。
   * 单次遍历私有数组（同类内互访）；合并空袋是恒等操作。
   */
  merge(other: FindingBag): void {
    for (const f of other.findings) this.findings.push(f);
    for (const n of other.infoNotes) this.infoNotes.push(n);
    for (const n of other.readoutNotes) this.readoutNotes.push(n);
  }

  /**
   * 追加一条 note（两类见 `NoteKind`）：**都不进退出码**。
   * info 之所以不用 `Severity` 表达：那会污染分级模型与 `exitCode()` 语义（info 必须"计数但
   * 不判级"），故单开笔记通道，报告末尾成段列出。
   */
  addNote(text: string, kind: NoteKind): void {
    this.bucketOf(kind).push(text);
  }

  /** 读取 notes（**返回副本**——M3 修复：类型是 readonly，运行时也不得把内部数组交出去）。 */
  notes(kind?: NoteKind): readonly string[] {
    if (kind !== undefined) return [...this.bucketOf(kind)];
    return [...this.infoNotes, ...this.readoutNotes];
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
    // 两段各自独立：无该类 note 时不产出任何行——既有报告逐字不变（既有测试/消费方不受影响）
    if (this.infoNotes.length > 0) {
      lines.push(`info ${this.infoNotes.length} 条（不进退出码）：`);
      for (const n of this.infoNotes) lines.push(`  · ${n}`);
    }
    if (this.readoutNotes.length > 0) {
      lines.push(`诊断读数（不计入 info 条数）：`);
      for (const n of this.readoutNotes) lines.push(`  · ${n}`);
    }
    return lines.join("\n");
  }
}
