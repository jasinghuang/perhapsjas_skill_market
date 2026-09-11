// M1 示例章节：仅用于引擎装配验证（M2a 起用 token 化组件替换，非最终视觉）。
// scene-0 带 KenBurns（I-1 集成测试锚点）：帧函数组件的 canvasAnim 不需要 canvas 2d
// ctx，注册即驱动，是 App 级"含帧函数组件的步骤能自动推进"测试的最小可行载体。
import { KenBurns } from "../../components";
import { stageConfig } from "../../engine/runtime-config";

// Ruling P4-4：示例章节即门禁标杆——narrations 结尾不带标点（V3 字幕结尾禁句号等）
export const exampleNarrations = ["这是第一句口播", "这是第二句口播", ""];

// 安全框（§12b V1 / 门禁 #20）：示例章节的文字也得落在内容带内——标杆一旦自带自家门禁认定的
// 违规就自相矛盾，且 scaffold 全量拷贝模板（每个新项目开局带 4 条越界）。
//   · 数字取自单一源 stageConfig.safeArea（不写字面量 112/96——"数字单一源"是 Global Constraints）；
//   · 用 **margin** 而不是 padding：#20 查的是元素 **border box**，`width:auto` 的块级 div 加
//     padding 只把内容推进去、border box 仍贴画布原点（实测无效，修复轮 1 / I2 的取证结论）。
const SAFE_MARGIN = {
  marginTop: stageConfig.safeArea.top,
  marginLeft: stageConfig.safeArea.content,
  marginRight: stageConfig.safeArea.content,
} as const;

export function ExampleChapter({ step }: { step: number }) {
  if (step === 0)
    return (
      <div data-testid="scene-0" style={SAFE_MARGIN}>
        冷开场
        <KenBurns duration="fast" />
      </div>
    );
  if (step === 1)
    return (
      <div data-testid="scene-1" style={SAFE_MARGIN}>
        第二幕
      </div>
    );
  return (
    <div data-testid="scene-2" style={SAFE_MARGIN}>
      无声过场
    </div>
  );
}
