import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { estimateNarrationMs, resolveHoldMs } from "./engine/hold";
import { driveCaption } from "./engine/captionDriver";
import { stageConfig } from "./engine/runtime-config";
import { EXPORT_COMMAND, EXPORT_ROUTES, Stage, type ExportUiState } from "./engine/Stage";
import { useAudioPlayer } from "./engine/useAudioPlayer";
import { useStepper } from "./engine/useStepper";

const params = new URLSearchParams(window.location.search);
const renderMode = params.has("render"); // ?render=1 创建即冻结
// M5b Task 3 字幕开关：?no-subs=1 出**无字幕版**（值不重要，与 ?render/?auto 同款 `params.has` 口径）。
// 归类在模块级：与 renderMode 同一份"页面启动即定"的参数面（渲染链的归一发生在 CLI 侧
// `withNoSubs`，这里只读结果——页面不认识 CLI flag）。
const noSubs = params.has("no-subs");
setRenderMode(renderMode); // Ruling 9：模块加载即设置（先于渲染与 effect），杜绝初始 commit 动画自主播放的时序洞

// ── 导出客户端（M5b Task 5，§9「页面按钮 → 本地渲染服务」） ──
//
// 全部走相对路径（`EXPORT_ROUTES`）：服务是随 dev server 启动的 Vite 中间件，端口就是页面自己的
// ⇒ 无跨源、无预检、无端口发现。页面**不猜**状态与进度——每一次读数都来自 `/status`。

/** 轮询间隔（ms）：够密（一步数十秒）又不至于把 dev server 敲出噪音 */
const EXPORT_POLL_MS = 1000;

interface ExportStatusBody {
  state: "idle" | "running" | "done" | "failed";
  progress: { done: number; total: number };
  message?: string;
}

/**
 * 形状守卫：**不能**只看 HTTP 200——静态托管（生产构建 / `vite preview`）下 `/__export/status`
 * 会回 index.html（SPA fallback，200 text/html），把那种 200 当"服务可达"会让按钮永远转圈。
 */
function isExportStatusBody(value: unknown): value is ExportStatusBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as { state?: unknown; progress?: unknown; message?: unknown };
  const progress = body.progress as { done?: unknown; total?: unknown } | null | undefined;
  if (body.state !== "idle" && body.state !== "running" && body.state !== "done" && body.state !== "failed") {
    return false;
  }
  if (typeof progress !== "object" || progress === null) return false;
  if (typeof progress.done !== "number" || typeof progress.total !== "number") return false;
  return body.message === undefined || typeof body.message === "string";
}

/** 读一次状态：任何失败（网络不通 / 非 JSON / 形状不对）都归"不可达"——要么读到，要么 null。 */
async function readExportStatus(): Promise<ExportStatusBody | null> {
  try {
    const res = await fetch(EXPORT_ROUTES.status, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    return isExportStatusBody(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * 导出控制器：挂载探活（接上已在跑的导出）→ 触发 → 轮询到终态。所有界面态的**唯一来源**是
 * 服务端读数（页面不自己算进度、不自己判成败）。
 */
function useExportController(enabled: boolean): {
  state: ExportUiState;
  progress: { done: number; total: number };
  message?: string;
  start(): void;
  copyCommand(): void;
} {
  const [state, setState] = useState<ExportUiState>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true); // 卸载后到达的读数一律丢弃（不 setState）

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 读一次并落到界面；返回读到的体（null = 不可达）。 */
  const applyOnce = useCallback(async (): Promise<ExportStatusBody | null> => {
    const body = await readExportStatus();
    if (!aliveRef.current) return null;
    if (body === null) {
      stopPolling();
      setState("unreachable"); // §9 的启动指引面
      return null;
    }
    setProgress(body.progress);
    setMessage(body.message);
    setState(body.state);
    return body;
  }, [stopPolling]);

  /** 跟到终态：每 EXPORT_POLL_MS 读一次，读到 done / failed / 不可达即收工。 */
  const pollUntilSettled = useCallback(async (): Promise<void> => {
    for (;;) {
      await new Promise<void>((resolve) => {
        // 卸载时 clearTimeout 会让这一拍永远不醒——循环就此停住，不再 setState
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          resolve();
        }, EXPORT_POLL_MS);
      });
      if (!aliveRef.current) return;
      const body = await applyOnce();
      if (body === null || body.state === "done" || body.state === "failed") return;
    }
  }, [applyOnce]);

  // 挂载探活：服务可达 ⇒ 按钮可用（页面重载后还能接上正在跑的导出）；不可达 ⇒ 给启动指引
  useEffect(() => {
    if (!enabled) return;
    aliveRef.current = true;
    void (async () => {
      const body = await applyOnce();
      // 服务在跑（多半是上一次导出还没结束就刷了页）→ 继续跟；idle/done/failed 就停在这一态
      if (body === null || body.state !== "running") return;
      await pollUntilSettled();
    })();
    return () => {
      aliveRef.current = false;
      stopPolling();
    };
  }, [enabled, applyOnce, pollUntilSettled, stopPolling]);

  const start = useCallback(() => {
    void (async () => {
      setState("running"); // 立刻给反馈（真状态仍以服务端为准：下面的第一次读会纠正它）
      setMessage(undefined);
      try {
        const res = await fetch(EXPORT_ROUTES.run, { method: "POST" });
        if (!aliveRef.current) return;
        // 409 = 已有一次在跑（**不是错误**：双击 / 另一个标签页）——按 running 跟下去
        if (!res.ok && res.status !== 409) {
          setState("failed");
          setMessage(`导出服务返回 ${res.status}`);
          return;
        }
      } catch {
        if (!aliveRef.current) return;
        setState("unreachable"); // dev server 关掉了 ⇒ §9 的启动指引
        return;
      }
      const body = await applyOnce();
      if (body !== null && body.state === "running") await pollUntilSettled();
    })();
  }, [applyOnce, pollUntilSettled]);

  const copyCommand = useCallback(() => {
    // 剪贴板是可选能力（非安全上下文 / 老浏览器没有）：没有就只是没复制，命令文本仍在页面上
    try {
      void navigator.clipboard?.writeText(EXPORT_COMMAND).catch(() => undefined);
    } catch {
      // 忽略：复制失败不影响"指引已在页面上"这个事实
    }
  }, []);

  return { state, progress, message, start, copyCommand };
}

export default function App() {
  const autoFromStart = params.has("auto"); // ?auto=1 从 step 0 起播
  const stoppedRef = useRef(false); // 停止后停在起点静止，不回零重播（spec §9）

  const stepsPerChapter = useMemo(() => chapters.map((c) => c.steps), []);
  const stepper = useStepper(stageConfig.slug, stepsPerChapter, autoFromStart);
  const player = useAudioPlayer();
  // 控制条可见才探活/接服务（渲染/录屏态没有按钮，也就不该往 dev server 上打请求——
  // 那两个态是确定性与墙钟录制的现场，页面侧的额外流量只会是噪音）
  const showUi = !renderMode && !autoFromStart;
  const exportUi = useExportController(showUi);

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

  // M6 字幕切块：步长 = 估算口径 estimateNarrationMs（与渲染静置帧分块 / SRT 同一份）。
  // 换块是**命令式**的（captionDriver）：渲染/无头由桥 seek 同一拍直写 DOM（确定性），
  // 预览由音频时钟 tick 直写——都不进 React state（setState 刷新与截图窗口竞态，满载破坏确定性）。
  const captionStepMs = estimateNarrationMs(narration);
  useEffect(() => {
    if (shouldInstallBridge(params, import.meta.env.DEV)) return; // 渲染/无头：桥 seek 驱动
    // 预览态：音频时钟（只有真音频在播才有读数；估时兜底步无 tick → 恒第 0 块）
    return player.subscribeTick((ms) => driveCaption(ms));
  }, [player, params]);

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
      noUi={!showUi}
      noSubs={noSubs}
      caption={narration}
      captionStepMs={captionStepMs}
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
      onExport={exportUi.start}
      exportState={exportUi.state}
      exportProgress={exportUi.progress}
      exportMessage={exportUi.message}
      onCopyExportCommand={exportUi.copyCommand}
    >
      <Scene step={stepper.step} />
    </Stage>
  );
}
