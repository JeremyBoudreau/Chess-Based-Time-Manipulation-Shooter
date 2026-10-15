// biome-ignore-all lint/suspicious/noBitwiseOperators: 32-bit integer math is the point of a PRNG
/** Small, fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};
