// SeededRandom（§8.1）：确定性伪随机（mulberry32）——同 seed 同序列，跨渲染可复现。
// 确定性黑名单（§11.1 #7）禁 Math.random 的创作替代品。

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
