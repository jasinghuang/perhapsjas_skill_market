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
}

interface LastStep {
  narration: string;
  src: string | null;
  holdMs: number;
}

export function useAudioPlayer(): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
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

  const playStep = useCallback(
    (narration: string, src: string | null, holdMs: number, onDone: () => void) => {
      clearTimer();
      holdRef.current = holdMs;
      onDoneRef.current = onDone;
      lastRef.current = { narration, src, holdMs };
      setPlaying(true);

      if (!src) {
        // 音频缺失兜底：估时（或空步默认）→ 等动画 → 垫
        timerRef.current = window.setTimeout(
          () => afterAnimations(scheduleHold),
          estimateNarrationMs(narration),
        );
        return;
      }

      const audio = getAudio();
      audio.src = src;
      audio.onended = () => afterAnimations(scheduleHold);
      audio.onerror = () => {
        // 音频加载失败（如 404）：视同无音频，走估时兜底推进
        timerRef.current = window.setTimeout(
          () => afterAnimations(scheduleHold),
          estimateNarrationMs(narration),
        );
      };
      audio.play().catch(() => {
        // play() 拒绝（自动播放限制等）：错误统一由 onerror 处理，勿让 rejection 冒泡
      });
    },
    [afterAnimations, clearTimer, getAudio, scheduleHold],
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
          // play() 拒绝：错误统一由 onerror 处理
        });
      }
    } else {
      // 兜底估时路径：重新计时（M1 简化，不恢复已流逝部分）
      // 含 audio.error 情形（M1 终审 parked ①）：失败资源上再 play() 不触发新 error 事件，
      // 无计时器重武装 → 暂停后播放即死锁；判 error 走估时兜底
      timerRef.current = window.setTimeout(
        () => afterAnimations(scheduleHold),
        estimateNarrationMs(last.narration),
      );
    }
    resumeAll();
    setPlaying(true);
  }, [afterAnimations, clearTimer, scheduleHold]);

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

  return { playing, playStep, pause, resume, stop };
}
