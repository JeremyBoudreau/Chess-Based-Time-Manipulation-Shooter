import type { Square, Vec2 } from "./types";

export const BOARD_SIZE = 8;

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export const length = (a: Vec2): number => Math.hypot(a.x, a.y);

export const distance = (a: Vec2, b: Vec2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Unit vector the player faces for a given yaw (see types.ts header). */
export const forward = (yaw: number): Vec2 => ({
  x: -Math.sin(yaw),
  y: Math.cos(yaw),
});

/** Unit vector to the player's right for a given yaw. */
export const right = (yaw: number): Vec2 => ({
  x: Math.cos(yaw),
  y: Math.sin(yaw),
});

export const squareCenter = (square: Square): Vec2 => ({
  x: square.file + 0.5,
  y: square.rank + 0.5,
});

/** Square containing a board-space point (may be off-board; check with `isOnBoard`). */
export const squareAt = (pos: Vec2): Square => ({
  file: Math.floor(pos.x),
  rank: Math.floor(pos.y),
});

export const isOnBoard = (square: Square): boolean =>
  square.file >= 0 &&
  square.file < BOARD_SIZE &&
  square.rank >= 0 &&
  square.rank < BOARD_SIZE;

export const sameSquare = (a: Square, b: Square): boolean =>
  a.file === b.file && a.rank === b.rank;

export const squareKey = (square: Square): number =>
  square.rank * BOARD_SIZE + square.file;

/** Euclidean distance between square centres. */
export const squareDistance = (a: Square, b: Square): number =>
  Math.hypot(a.file - b.file, a.rank - b.rank);

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
