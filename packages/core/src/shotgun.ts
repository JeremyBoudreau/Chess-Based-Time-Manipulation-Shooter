import { clamp, squareAt } from "./geometry";
import type { ShotgunStats, Square, Vec2 } from "./types";

const DEGREES_TO_RADIANS = Math.PI / 180;
/** Jitter may push edge pellets slightly past the nominal spread, but never far past it. */
const MAX_SPREAD_OVERSHOOT = 1.15;

/**
 * Horizontal angle offsets (radians, relative to aim) for one shot: the spread is split into
 * `pellets` equal bins and each pellet lands at a random point in its bin, plus `spreadJitter`
 * of extra wander — wide coverage but never the same pattern twice.
 */
export const pelletAngles = (
  stats: ShotgunStats,
  rng: () => number
): number[] => {
  const count = Math.max(0, Math.floor(stats.pellets));
  if (count === 0) {
    return [];
  }
  const spread = stats.spreadDegrees * DEGREES_TO_RADIANS;
  const bin = (2 * spread) / count;
  const limit = spread * MAX_SPREAD_OVERSHOOT;
  const angles: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const centre = -spread + bin * (index + 0.5);
    const jitter = (rng() - 0.5) * bin * (1 + stats.spreadJitter);
    angles.push(clamp(centre + jitter, -limit, limit));
  }
  return angles;
};

/** Parametric distance (0..1 along the segment) to the first grid line crossed on one axis. */
const firstCrossing = (start: number, cell: number, delta: number): number => {
  if (delta > 0) {
    return (cell + 1 - start) / delta;
  }
  if (delta < 0) {
    return (start - cell) / -delta;
  }
  return Number.POSITIVE_INFINITY;
};

/**
 * Grid traversal (Amanatides–Woo DDA): every square the segment from → to passes through, in order,
 * including the starting square. Used so fast pellets can never tunnel through or slip "between"
 * occupied squares.
 *
 * The walk changes exactly one coordinate per step (4-connected): when the segment passes exactly
 * through a grid corner it visits a side square first, so a pellet can never squeeze diagonally
 * between two pieces. The step count is fixed up front and each axis stops once it reaches the end
 * square, so float error can never make the walk overshoot or miss `squareAt(to)`.
 */
export const traverseSquares = (from: Vec2, to: Vec2): Square[] => {
  const start = squareAt(from);
  const end = squareAt(to);
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const stepX = Math.sign(end.file - start.file);
  const stepY = Math.sign(end.rank - start.rank);
  const tDeltaX = stepX === 0 ? 0 : Math.abs(1 / deltaX);
  const tDeltaY = stepY === 0 ? 0 : Math.abs(1 / deltaY);
  let tMaxX = firstCrossing(from.x, start.file, deltaX);
  let tMaxY = firstCrossing(from.y, start.rank, deltaY);
  let { file, rank } = start;
  const squares: Square[] = [start];
  const steps =
    Math.abs(end.file - start.file) + Math.abs(end.rank - start.rank);
  for (let index = 0; index < steps; index += 1) {
    const stepFile = rank === end.rank || (file !== end.file && tMaxX <= tMaxY);
    if (stepFile) {
      file += stepX;
      tMaxX += tDeltaX;
    } else {
      rank += stepY;
      tMaxY += tDeltaY;
    }
    squares.push({ file, rank });
  }
  return squares;
};
