// 种子粒子（§6.2 氛围微动 + §8.1 SeededRandom）：
// 粒子位置由 seed 确定性生成；运动 = 有限时长 draw(t)（Ruling P3-3：t ≥ durMs 渲染终态）。
import { useEffect, useRef } from "react";
import { canvasAnim } from "../../engine/animationRuntime";
import { MotionDuration } from "../motion";
import { seededRandom } from "../seededRandom";

const DUR_FALLBACK: Record<MotionDuration, number> = { fast: 3000, mid: 8000, slow: 16000 };

export interface SeededParticlesProps {
  seed: number;
  count?: number;
  duration?: MotionDuration;
  variant?: "drift" | "static";
  className?: string;
  "data-testid"?: string;
}

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
}

export function SeededParticles({ seed, count = 30, duration = "mid", variant = "drift", className = "", ...rest }: SeededParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rnd = seededRandom(seed);
    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: rnd() * 100,
      y: rnd() * 100,
      r: 1 + rnd() * 3,
      vx: (rnd() - 0.5) * 1.2,
      vy: (rnd() - 0.5) * 0.8,
    }));

    // Ruling P3-6：canvas fillStyle 不支持 var() 语法——effect 内读一次强调色 token，
    // 非空则用之，否则回退中性占位值（主题值在绘制期稳定，捕获进 draw 闭包）。
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue("--accent-1").trim() || "#c9501f";

    const durMs = DUR_FALLBACK[duration];
    const draw = (tMs: number) => {
      const progress = Math.min(1, tMs / durMs);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = accent;
      for (const p of particles) {
        const x = (p.x + p.vx * progress * 20) % 100;
        const y = (p.y + p.vy * progress * 20) % 100;
        ctx.beginPath();
        ctx.arc((x / 100) * canvas.width, (y / 100) * canvas.height, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const h = canvasAnim(draw, durMs);
    return () => h.dispose();
  }, [seed, count, duration, variant]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={300}
      className={`cdp-particles ${className}`}
      data-testid={rest["data-testid"]}
    />
  );
}
