import { useCallback, useEffect, useState } from "react";
import { CURSOR_KEY_PREFIX } from "./constants";

export interface Stepper {
  chapter: number;
  step: number;
  next(): void;
  prev(): void;
  jumpTo(chapter: number, step: number): void;
  gotoChapter(chapter: number): void;
  atStart: boolean;
  atEnd: boolean;
}

interface Pos {
  chapter: number;
  step: number;
}

/** 简单字符串 hash：步数内容变化 → key 变化 → 游标自动失效（不手动 bump，§3.2 A） */
function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function cursorKey(slug: string, stepsPerChapter: number[]): string {
  return `${CURSOR_KEY_PREFIX}:${slug}:${simpleHash(JSON.stringify(stepsPerChapter))}`;
}

function restore(key: string, stepsPerChapter: number[]): Pos {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (
        p.chapter >= 0 &&
        p.chapter < stepsPerChapter.length &&
        p.step >= 0 &&
        p.step < stepsPerChapter[p.chapter]
      ) {
        return p;
      }
    }
  } catch {
    // 损坏值按无游标处理
  }
  return { chapter: 0, step: 0 };
}

function clamp(chapter: number, step: number, stepsPerChapter: number[]): Pos {
  const ch = Math.min(stepsPerChapter.length - 1, Math.max(0, chapter));
  const st = Math.min(stepsPerChapter[ch] - 1, Math.max(0, step));
  return { chapter: ch, step: st };
}

export function useStepper(
  slug: string,
  stepsPerChapter: number[],
  autoFromStart: boolean,
): Stepper {
  const key = cursorKey(slug, stepsPerChapter);
  const [pos, setPos] = useState<Pos>(() =>
    autoFromStart ? { chapter: 0, step: 0 } : restore(key, stepsPerChapter),
  );

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(pos));
    } catch {
      // 私密模式等存储不可用，忽略
    }
  }, [key, pos]);

  const total = stepsPerChapter.length;
  const atStart = pos.chapter === 0 && pos.step === 0;
  const atEnd =
    pos.chapter === total - 1 && pos.step === stepsPerChapter[pos.chapter] - 1;

  const next = useCallback(() => {
    setPos((p) => {
      if (p.step + 1 < stepsPerChapter[p.chapter]) return { ...p, step: p.step + 1 };
      if (p.chapter + 1 < total) return { chapter: p.chapter + 1, step: 0 };
      return p;
    });
  }, [stepsPerChapter, total]);

  const prev = useCallback(() => {
    setPos((p) => {
      if (p.step - 1 >= 0) return { ...p, step: p.step - 1 };
      if (p.chapter - 1 >= 0)
        return { chapter: p.chapter - 1, step: stepsPerChapter[p.chapter - 1] - 1 };
      return p;
    });
  }, [stepsPerChapter]);

  const jumpTo = useCallback(
    (chapter: number, step: number) => setPos(clamp(chapter, step, stepsPerChapter)),
    [stepsPerChapter],
  );

  const gotoChapter = useCallback(
    (chapter: number) => setPos(clamp(chapter, 0, stepsPerChapter)),
    [stepsPerChapter],
  );

  return { chapter: pos.chapter, step: pos.step, next, prev, jumpTo, gotoChapter, atStart, atEnd };
}
