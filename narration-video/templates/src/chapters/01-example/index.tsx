// M1 示例章节：仅用于引擎装配验证（M2a 起用 token 化组件替换，非最终视觉）。
// scene-0 带 KenBurns（I-1 集成测试锚点）：帧函数组件的 canvasAnim 不需要 canvas 2d
// ctx，注册即驱动，是 App 级"含帧函数组件的步骤能自动推进"测试的最小可行载体。
import { KenBurns } from "../../components";

// Ruling P4-4：示例章节即门禁标杆——narrations 结尾不带标点（V3 字幕结尾禁句号等）
export const exampleNarrations = ["这是第一句口播", "这是第二句口播", ""];

export function ExampleChapter({ step }: { step: number }) {
  if (step === 0)
    return (
      <div data-testid="scene-0">
        冷开场
        <KenBurns duration="fast" />
      </div>
    );
  if (step === 1) return <div data-testid="scene-1">第二幕</div>;
  return <div data-testid="scene-2">无声过场</div>;
}
