import { useEffect, useMemo, useRef } from "react";
import { chapters } from "./chapters/manifest";
import { setRenderMode } from "./engine/animationRuntime";
import { DEFAULT_HOLD_MS } from "./engine/constants";
import {
  animations,
  installBridge,
  ready,
  shouldInstallBridge,
  uninstallBridge,
} from "./engine/cursorBridge";
import { stageConfig } from "./engine/runtime-config";
import { Stage } from "./engine/Stage";
import { useAudioPlayer } from "./engine/useAudioPlayer";
import { useStepper } from "./engine/useStepper";

const params = new URLSearchParams(window.location.search);
const renderMode = params.has("render"); // ?render=1 创建即冻结
setRenderMode(renderMode); // Ruling 9：模块加载即设置（先于渲染与 effect），杜绝初始 commit 动画自主播放的时序洞

export default function App() {
  const autoFromStart = params.has("auto"); // ?auto=1 从 step 0 起播
  const stoppedRef = useRef(false); // 停止后停在起点静止，不回零重播（spec §9）

  const stepsPerChapter = useMemo(() => chapters.map((c) => c.steps), []);
  const stepper = useStepper(stageConfig.slug, stepsPerChapter, autoFromStart);
  const player = useAudioPlayer();

  const chapter = chapters[stepper.chapter];
  const narration = chapter.narrations[stepper.step] ?? "";
  const audioSrc = narration ? `/audio/${chapter.folder}/${stepper.step}.mp3` : null;

  // 游标桥（M4 §7 决策 1）：?headless=1 或 dev 模式安装 window.__presentation，
  // 供分镜截图/无头门禁/渲染管线确定性驱动游标；生产构建不暴露（见 shouldInstallBridge）。
  // 桥只装一次（依赖为空）→ jumpTo/getState 经 ref 读**最新** stepper，杜绝陈旧闭包。
  const stepperRef = useRef(stepper);
  useEffect(() => {
    stepperRef.current = stepper;
  });

  useEffect(() => {
    if (!shouldInstallBridge(params, import.meta.env.DEV)) return;
    installBridge({
      jumpTo: (chapter, step) => stepperRef.current.jumpTo(chapter, step),
      // getState 读的是**已 commit** 的游标：跳转后先 await ready() 再读（契约语义）
      getState: () => ({
        chapter: stepperRef.current.chapter,
        step: stepperRef.current.step,
      }),
      ready,
      animations,
    });
    return uninstallBridge;
  }, []);

  // 每步推进：音频驱动（audio.ended 且 动画窗口结束 → 停留垫 → next）
  useEffect(() => {
    if (stoppedRef.current) {
      // 停止后的回零触发了本 effect：停在起点静止，消费标记后放行
      stoppedRef.current = false;
      return;
    }
    player.playStep(narration, audioSrc, DEFAULT_HOLD_MS, stepper.next);
    // stepper.chapter/step 变化即进入新的一步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepper.chapter, stepper.step]);

  // 开发调试键盘（←/→/Home/End）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") stepper.next();
      else if (e.key === "ArrowLeft") stepper.prev();
      else if (e.key === "Home") stepper.jumpTo(0, 0);
      else if (e.key === "End")
        stepper.jumpTo(chapters.length - 1, stepsPerChapter[chapters.length - 1] - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepper, stepsPerChapter]);

  const Scene = chapter.Component;

  return (
    <Stage
      dims={stageConfig.dims}
      noUi={renderMode || autoFromStart}
      caption={narration}
      onPlay={() => {
        stoppedRef.current = false;
        player.resume();
      }}
      onPause={player.pause}
      onStop={() => {
        stoppedRef.current = true;
        player.stop();
        stepper.jumpTo(0, 0);
      }}
    >
      <Scene step={stepper.step} />
    </Stage>
  );
}
