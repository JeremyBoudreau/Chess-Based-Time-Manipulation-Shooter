import { describe, expect, test } from "bun:test";
import { decidePieceAction } from "../brain";
import { mulberry32 } from "../random";
import { squareName } from "../setups";
import type { PieceAction } from "../types";
import { piece, sq, worldWith } from "./fixtures";

const target = (action: PieceAction): string | null =>
  action.type === "wait" ? null : squareName(action.to);

describe("decidePieceAction", () => {
  test("attacks the king when it can", () => {
    const rook = piece("rook", "a1");
    const world = worldWith([rook], "a8");
    const action = decidePieceAction(world, rook, mulberry32(1));
    expect(action).toEqual({ to: sq("a8"), type: "attack" });
  });

  test("approaches with the closest move when it makes progress", () => {
    const rook = piece("rook", "a1");
    const world = worldWith([rook], "h7");
    expect(target(decidePieceAction(world, rook, mulberry32(1)))).toBe("h1");

    const pawn = piece("pawn", "e2");
    const pawnWorld = worldWith([pawn], "e8");
    expect(target(decidePieceAction(pawnWorld, pawn, mulberry32(1)))).toBe(
      "e4"
    );
  });

  test("breaks ties between equally close moves randomly", () => {
    const rook = piece("rook", "a1");
    const world = worldWith([rook], "h8");
    const picks = new Set<string | null>();
    for (let seed = 1; seed <= 40; seed += 1) {
      picks.add(target(decidePieceAction(world, rook, mulberry32(seed))));
    }
    expect([...picks].sort()).toEqual(["a8", "h1"]);
  });

  test("waits when it has no legal move", () => {
    const pawn = piece("pawn", "e7");
    expect(
      decidePieceAction(worldWith([pawn], "e8"), pawn, Math.random)
    ).toEqual({
      type: "wait",
    });
    const blocked = piece("pawn", "e2");
    const world = worldWith([blocked, piece("pawn", "e3")], "a8");
    expect(decidePieceAction(world, blocked, Math.random)).toEqual({
      type: "wait",
    });
  });

  test("wanders towards the king when no move gets closer", () => {
    const knight = piece("knight", "e4");
    const world = worldWith([knight], "e5");
    const rng = mulberry32(7);
    const counts = new Map<string | null, number>();
    for (let index = 0; index < 2000; index += 1) {
      const pick = target(decidePieceAction(world, knight, rng));
      counts.set(pick, (counts.get(pick) ?? 0) + 1);
    }
    expect(counts.has(null)).toBe(false);
    expect(counts.has("e5")).toBe(false);
    expect(counts.size).toBe(8);
    const towards = counts.get("f6") ?? 0;
    const away = counts.get("f2") ?? 0;
    expect(towards).toBeGreaterThan(away * 2);
  });
});
