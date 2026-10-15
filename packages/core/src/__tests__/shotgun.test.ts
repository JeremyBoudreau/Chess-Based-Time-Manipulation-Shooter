import { describe, expect, test } from "bun:test";
import { DEFAULT_SHOTGUN } from "../config";
import { squareAt } from "../geometry";
import { mulberry32 } from "../random";
import { pelletAngles, traverseSquares } from "../shotgun";
import type { Square, Vec2 } from "../types";

const spread = (DEFAULT_SHOTGUN.spreadDegrees * Math.PI) / 180;
const bin = (2 * spread) / DEFAULT_SHOTGUN.pellets;

const pairs = (squares: readonly Square[]): [number, number][] =>
  squares.map(({ file, rank }) => [file, rank]);

const isFourConnected = (squares: readonly Square[]): boolean =>
  squares.every((square, index) => {
    const previous = squares[index - 1];
    if (!previous) {
      return true;
    }
    return (
      Math.abs(square.file - previous.file) +
        Math.abs(square.rank - previous.rank) ===
      1
    );
  });

describe("pelletAngles", () => {
  test("fires one angle per pellet within the clamped spread", () => {
    const rng = mulberry32(3);
    for (let shot = 0; shot < 200; shot += 1) {
      const angles = pelletAngles(DEFAULT_SHOTGUN, rng);
      expect(angles).toHaveLength(DEFAULT_SHOTGUN.pellets);
      for (const angle of angles) {
        expect(Math.abs(angle)).toBeLessThanOrEqual(spread * 1.15 + 1e-12);
      }
    }
  });

  test("each pellet stays near its own stratified bin", () => {
    const rng = mulberry32(5);
    const wander = (bin * (1 + DEFAULT_SHOTGUN.spreadJitter)) / 2;
    for (let shot = 0; shot < 200; shot += 1) {
      for (const [index, angle] of pelletAngles(
        DEFAULT_SHOTGUN,
        rng
      ).entries()) {
        const centre = -spread + bin * (index + 0.5);
        expect(Math.abs(angle - centre)).toBeLessThanOrEqual(wander + 1e-12);
      }
    }
  });

  test("a centred roll lands exactly on the bin centres", () => {
    const degrees = pelletAngles(DEFAULT_SHOTGUN, () => 0.5).map(
      (angle) => (angle * 180) / Math.PI
    );
    expect(degrees.map((angle) => Math.round(angle * 1e6) / 1e6)).toEqual([
      -19.2, -9.6, 0, 9.6, 19.2,
    ]);
  });

  test("never repeats the same pattern", () => {
    const rng = mulberry32(9);
    expect(pelletAngles(DEFAULT_SHOTGUN, rng)).not.toEqual(
      pelletAngles(DEFAULT_SHOTGUN, rng)
    );
  });

  test("handles a gun with no pellets", () => {
    expect(
      pelletAngles({ ...DEFAULT_SHOTGUN, pellets: 0 }, Math.random)
    ).toEqual([]);
  });
});

describe("traverseSquares", () => {
  test("a zero-length segment is just the start square", () => {
    expect(
      pairs(traverseSquares({ x: 2.3, y: 4.7 }, { x: 2.3, y: 4.7 }))
    ).toEqual([[2, 4]]);
  });

  test("walks axis-aligned segments in both directions", () => {
    expect(
      pairs(traverseSquares({ x: 0.5, y: 0.5 }, { x: 3.5, y: 0.5 }))
    ).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(
      pairs(traverseSquares({ x: 4.5, y: 7.2 }, { x: 4.5, y: 5.1 }))
    ).toEqual([
      [4, 7],
      [4, 6],
      [4, 5],
    ]);
  });

  test("may leave the board (the caller decides what that means)", () => {
    expect(
      pairs(traverseSquares({ x: 0.5, y: 0.5 }, { x: -1.5, y: 0.5 }))
    ).toEqual([
      [0, 0],
      [-1, 0],
      [-2, 0],
    ]);
  });

  test("an exact corner visits a side square before the diagonal one", () => {
    const squares = traverseSquares({ x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 });
    expect(squares).toHaveLength(5);
    expect(isFourConnected(squares)).toBe(true);
    expect(pairs(squares)).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ]);
  });

  test("a segment starting on a grid line moves straight into the next square", () => {
    expect(
      pairs(traverseSquares({ x: 3, y: 0.5 }, { x: 2.5, y: 0.5 }))
    ).toEqual([
      [3, 0],
      [2, 0],
    ]);
  });

  test("random segments are 4-connected and cover every square they cross", () => {
    const rng = mulberry32(11);
    const point = (): Vec2 => ({ x: rng() * 10 - 1, y: rng() * 10 - 1 });
    for (let trial = 0; trial < 500; trial += 1) {
      const from = point();
      const to = point();
      const squares = traverseSquares(from, to);
      expect(squares[0]).toEqual(squareAt(from));
      expect(squares.at(-1)).toEqual(squareAt(to));
      expect(isFourConnected(squares)).toBe(true);
      const visited = new Set(
        squares.map(({ file, rank }) => `${file},${rank}`)
      );
      for (let sample = 0; sample <= 200; sample += 1) {
        const t = sample / 200;
        const { file, rank } = squareAt({
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        });
        expect(visited.has(`${file},${rank}`)).toBe(true);
      }
    }
  });
});
