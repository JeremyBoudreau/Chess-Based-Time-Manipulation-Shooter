import type { ShotgunStats, Square, Vec2 } from "./types";

/**
 * Horizontal angle offsets (radians, relative to aim) for one shot: the spread is split into
 * `pellets` equal bins and each pellet lands at a random point in its bin, plus `spreadJitter`
 * of extra wander — wide coverage but never the same pattern twice.
 */
export const pelletAngles = (
  _stats: ShotgunStats,
  _rng: () => number
): number[] => {
  throw new Error("not implemented");
};

/**
 * Grid traversal (Amanatides–Woo DDA): every square the segment from → to passes through, in order,
 * including the starting square. Used so fast pellets can never tunnel through or slip "between"
 * occupied squares.
 */
export const traverseSquares = (_from: Vec2, _to: Vec2): Square[] => {
  throw new Error("not implemented");
};
