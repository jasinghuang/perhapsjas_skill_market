// 音频驱动推进（§3.1）：audio.ended 且 动画窗口结束 → 停留垫 → onDone（next）。
// 引擎层计时（轮询/垫）合法——确定性黑名单只约束章节层；渲染走时间轴表不经此路径。

import { useCallback, useEffect, useRef, useState } from "react";
import { allFinished, pauseAll, resumeAll } from "./animationRuntime";
import { estimateNarrationMs } from "./hold";

const POLL_MS = 50;

export interface AudioPlayer {
  playing: boolean;
  playStep(narration: string, src: string | null, holdMs: number, onDone: () => void): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** M6 字幕切块：步内音频时钟订阅（100ms 拍；仅播放态触发）。返回退订函数。 */
  subscribeTick(cb: (ms: number) => void): () => void;
}

interface LastStep {
  narration: string;
  src: string | null;
  holdMs: number;
}

export function useAudioPlayer(): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const tickSubsRef = useRef(new Set<(ms: number) => void>());
  const tickTimerRef = useRef<number | null>(null);
  const holdRef = useRef(0);
  const onDoneRef = useRef<() => void>(() => {});
  const lastRef = useRef<LastStep | null>(null);
  const [playing, setPlaying] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    return audioRef.current;
  }, []);

  // 估时公式在引擎侧唯一一份（hold.ts 的 estimateNarrationMs）：本 hook 不再自带文本，
  // 与渲染时间轴 timeline.ts 共用同一个函数（评审 I4 / Ruling R5）。

  /** 等动画窗口结束再执行（轮询；渲染路径不经此函数） */
  const afterAnimations = useCallback(
    (fn: () => void) => {
      if (allFinished()) {
        fn();
        return;
      }
      timerRef.current = window.setTimeout(() => afterAnimations(fn), POLL_MS);
    },
    [],
  );

  const scheduleHold = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => onDoneRef.current(), holdRef.current);
  }, [clearTimer]);

  /**
   * 估时兜底（无音频 / 加载失败 / **play() 被拒** 三条同款）：`estimateMs → 等动画 → 垫 → 推进`。
   *
   * **幂等**：只在没有悬挂计时器时武装。必要性来自"同一次失败两路都报"——404 时浏览器既发
   * `error` 事件、又让 `play()` 的 promise 以 NotSupportedError 拒绝，两次武装会拉起两条
   * 并行的 `afterAnimations` 轮询链（`clearTimer` 只认 timerRef 里那一只，另一只在浏览器里
   * 悬挂到点、无人能取消）。
   */
  const armEstimate = useCallback(
    (narration: string) => {
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(
        () => afterAnimations(scheduleHold),
        estimateNarrationMs(narration),
      );
    },
    [afterAnimations, scheduleHold],
  );

  const playStep = useCallback(
    (narration: string, src: string | null, holdMs: number, onDone: () => void) => {
      clearTimer();
      holdRef.current = holdMs;
      onDoneRef.current = onDone;
      lastRef.current = { narration, src, holdMs };
      setPlaying(true);

      if (!src) {
        // 音频缺失兜底：估时（或空步默认）→ 等动画 → 垫
        armEstimate(narration);
        return;
      }

      const audio = getAudio();
      audio.src = src;
      audio.onended = () => afterAnimations(scheduleHold);
      audio.onerror = () => {
        // 音频加载失败（如 404）：视同无音频，走估时兜底推进
        armEstimate(narration);
      };
      audio.play().catch(() => {
        // play() 被自动播放策略拒（NotAllowedError）：**必须武装估时兜底**，否则整条推进链
        // 静默 stall——没有任何事件会再来（onended 不响、onerror 是加载错误而非播放拒绝），
        // 游标永久停在当前步（实测：裸 ?auto=1 预览与实时捕获录制都是"一帧死画面"且无提示）。
        // 真人用 ?auto=1 打开预览（无 transport 无按钮，没有"点一下就好"的出路）踩的正是这一条。
        armEstimate(narration);
      });
    },
    [afterAnimations, armEstimate, clearTimer, getAudio, scheduleHold],
  );

  const pause = useCallback(() => {
    clearTimer();
    audioRef.current?.pause();
    pauseAll();
    setPlaying(false);
  }, [clearTimer]);

  const resume = useCallback(() => {
    clearTimer(); // 幂等化 resume：清除悬挂计时器，防双击播放双推进
    const last = lastRef.current;
    if (!last) return;
    const audio = audioRef.current;
    if (audio?.src && !audio.error) {
      if (audio.ended) {
        // 音频已念完、曾在等待动画中被暂停：重新武装等待链
        afterAnimations(scheduleHold);
      } else {
        audio.play().catch(() => {
          // 同 playStep：被策略拒时武装估时兜底（否则暂停后播放会静默 stall——本分支无其他事件源）
          armEstimate(last.narration);
        });
      }
    } else {
      // 兜底估时路径：重新计时（M1 简化，不恢复已流逝部分）
      // 含 audio.error 情形（M1 终审 parked ①）：失败资源上再 play() 不触发新 error 事件，
      // 无计时器重武装 → 暂停后播放即死锁；判 error 走估时兜底
      armEstimate(last.narration);
    }
    resumeAll();
    setPlaying(true);
  }, [afterAnimations, armEstimate, clearTimer, scheduleHold]);

  const stop = useCallback(() => {
    clearTimer();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    }
    pauseAll();
    setPlaying(false);
  }, [clearTimer]);

  useEffect(
    () => () => {
      clearTimer();
      audioRef.current?.pause();
    },
    [clearTimer],
  );

  /** M6 字幕切块：步内音频时钟订阅（100ms 拍；仅播放态触发）。返回退订函数。 */
  const subscribeTick = useCallback((cb: (ms: number) => void): (() => void) => {
    tickSubsRef.current.add(cb);
    if (tickTimerRef.current === null) {
      tickTimerRef.current = window.setInterval(() => {
        const a = audioRef.current;
        if (!a || a.paused || a.currentTime === 0) return;
        for (const sub of tickSubsRef.current) sub(a.currentTime * 1000);
      }, 100);
    }
    return () => {
      tickSubsRef.current.delete(cb);
      if (tickSubsRef.current.size === 0 && tickTimerRef.current !== null) {
        window.clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
    };
  }, []);

  return { playing, playStep, pause, resume, stop, subscribeTick };
}
