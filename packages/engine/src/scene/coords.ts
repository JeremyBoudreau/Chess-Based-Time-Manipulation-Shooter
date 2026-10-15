import type { Square } from "@buckshot/core";
import type { Vector3 } from "three";

/** Half the board width: board space runs 0..8, world space is centred on the board. */
export const HALF_BOARD = 4;

/**
 * Board → world mapping (worldX = x - 4, worldZ = 4 - y, worldY = up). Writes into `target` so the
 * per-frame sync code never allocates vectors.
 */
export const boardToWorld = (
  target: Vector3,
  x: number,
  y: number,
  height = 0
): Vector3 => target.set(x - HALF_BOARD, height, HALF_BOARD - y);

/** World position of a square's centre. */
export const squareToWorld = (
  target: Vector3,
  square: Square,
  height = 0
): Vector3 =>
  boardToWorld(target, square.file + 0.5, square.rank + 0.5, height);

/** Smooth Hermite step, the workhorse for every eased visual transition. */
export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Frame-rate independent exponential approach (`rate` in 1/s). */
export const damp = (
  current: number,
  target: number,
  rate: number,
  dt: number
) => target + (current - target) * Math.exp(-rate * dt);
