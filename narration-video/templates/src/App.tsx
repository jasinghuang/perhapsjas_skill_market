import { useEffect, useMemo, useRef } from "react";
import { chapters } from "./chapters/manifest";
import { setRenderMode } from "./engine/animationRuntime";
import {
  animations,
  audit,
  installBridge,
  ready,
  seek,
  shouldInstallBridge,
  uninstallBridge,
} from "./engine/cursorBridge";
import { resolveHoldMs } from "./engine/hold";
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
  // 停留垫逐帧解析（§3.1 三层：timing.json > 档案 > 引擎默认）——与渲染时间轴表同一份
  // 解析器（engine/hold.ts），预览与成片节奏不会各算各的。随游标派生，无陈旧闭包问题。
  const holdMs = resolveHoldMs(chapter.timing, stepper.step, stageConfig.holdMs);

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
      // M3b Task 5 追加成员：动画审计面（四方法契约不动）
      audit,
      // M5a Task 3 追加成员：定位面（渲染器唯一入口；截图前 seek(0) 补画"未 draw 初始态"）
      seek,
    });
    return uninstallBridge;
  }, []);

  // 每步推进：音频驱动（audio.ended 且 动画窗口结束 → 停留垫 → next）
  useEffect(() => {
    // 无头/渲染模式不武装自驱推进链（M3b Task 6）：模板无 public/ → 每步 mp3 拿不到真音频
    //（dev server 命中 SPA fallback 回 index.html：200 text/html → 解码失败；静态服多为 404）
    // → onerror 走估时兜底 → 约 2.5s 就把游标带走，逐 step 检查根本来不及。
    // 依赖方：scripts/shot/capture.ts（截图）、scripts/storyboard.ts（分镜）、
    // verify-sequential（顺序校验）、M3b 无头门禁（Task 7）——它们都靠键盘/jumpTo
    // 显式驱动游标，推进必须只由它们说了算。
    // 注：非 render 的 headless 下 transport 仍可见，但播放键点了不会有反应
    //（playStep 从未被调用 → lastRef 为 null → resume() 直接返回）。
    if (renderMode || params.has("headless")) return;
    if (stoppedRef.current) {
      // 停止后的回零触发了本 effect：停在起点静止，消费标记后放行
      stoppedRef.current = false;
      return;
    }
    player.playStep(narration, audioSrc, holdMs, stepper.next);
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
