// M1 示例章节：仅用于引擎装配验证（M2a 起用 token 化组件替换，非最终视觉）
export const exampleNarrations = ["这是第一句口播。", "这是第二句口播。", ""];

export function ExampleChapter({ step }: { step: number }) {
  if (step === 0) return <div data-testid="scene-0">冷开场</div>;
  if (step === 1) return <div data-testid="scene-1">第二幕</div>;
  return <div data-testid="scene-2">无声过场</div>;
}
