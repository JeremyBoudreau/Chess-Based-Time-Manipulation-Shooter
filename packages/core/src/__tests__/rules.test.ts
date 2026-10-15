import { describe, expect, test } from "bun:test";
import {
  attackSquares,
  buildOccupancy,
  canAttack,
  quietMoves,
  threatenedSquares,
} from "../rules";
import { squareName } from "../setups";
import type { PieceState, Square } from "../types";
import { makeWorld, piece, sq } from "./fixtures";

const names = (squares: readonly Square[]): string[] =>
  squares.map(squareName).sort();

const attacks = (subject: PieceState, others: PieceState[] = []) =>
  names(attackSquares(subject, buildOccupancy([subject, ...others])));

const moves = (
  subject: PieceState,
  others: PieceState[] = [],
  avoid: string | null = null
) =>
  names(
    quietMoves(
      subject,
      buildOccupancy([subject, ...others]),
      avoid ? sq(avoid) : null
    )
  );

const blocker = (square: string) => piece("pawn", square);

describe("buildOccupancy", () => {
  test("indexes living pieces only", () => {
    const occupancy = buildOccupancy([
      piece("pawn", "a2"),
      piece("rook", "h1", { phase: "dead" }),
    ]);
    expect(occupancy.size).toBe(1);
  });
});

describe("pawn", () => {
  test("attacks diagonally towards rank 8, staying on the board", () => {
    expect(attacks(piece("pawn", "e4"))).toEqual(["d5", "f5"]);
    expect(attacks(piece("pawn", "a4"))).toEqual(["b5"]);
  });

  test("pushes one square, or two from its starting rank", () => {
    expect(moves(piece("pawn", "e2"))).toEqual(["e3", "e4"]);
    expect(moves(piece("pawn", "e3"))).toEqual(["e4"]);
  });

  test("is blocked by pieces and by the king", () => {
    expect(moves(piece("pawn", "e2"), [blocker("e4")])).toEqual(["e3"]);
    expect(moves(piece("pawn", "e2"), [blocker("e3")])).toEqual([]);
    expect(moves(piece("pawn", "e2"), [], "e4")).toEqual(["e3"]);
    expect(moves(piece("pawn", "e2"), [], "e3")).toEqual([]);
    expect(moves(piece("pawn", "e7"), [], "e8")).toEqual([]);
  });
});

describe("knight", () => {
  test("jumps in L shapes over anything", () => {
    expect(attacks(piece("knight", "a1"))).toEqual(["b3", "c2"]);
    expect(
      attacks(piece("knight", "d4"), [blocker("d5"), blocker("e5")])
    ).toEqual(["b3", "b5", "c2", "c6", "e2", "e6", "f3", "f5"]);
  });

  test("cannot land on friends, nor quietly on the king", () => {
    expect(attacks(piece("knight", "a1"), [blocker("b3")])).toEqual(["c2"]);
    expect(moves(piece("knight", "a1"), [], "c2")).toEqual(["b3"]);
  });
});

describe("bishop", () => {
  test("slides diagonally until a friendly piece, which it excludes", () => {
    expect(attacks(piece("bishop", "c1"), [blocker("d2")])).toEqual([
      "a3",
      "b2",
    ]);
    expect(attacks(piece("bishop", "a1"))).toHaveLength(7);
  });

  test("quiet moves stop before the king", () => {
    expect(moves(piece("bishop", "a1"), [], "d4")).toEqual(["b2", "c3"]);
  });
});

describe("rook", () => {
  test("slides orthogonally", () => {
    expect(attacks(piece("rook", "a1"))).toHaveLength(14);
    expect(
      attacks(piece("rook", "a1"), [blocker("a4"), blocker("c1")])
    ).toEqual(["a2", "a3", "b1"]);
  });

  test("the king never blocks its attacks, but blocks its movement", () => {
    const rook = piece("rook", "a1");
    expect(canAttack(rook, sq("a8"), buildOccupancy([rook]))).toBe(true);
    expect(moves(rook, [blocker("b1")], "a4")).toEqual(["a2", "a3"]);
  });

  test("cannot attack through a friendly piece", () => {
    const rook = piece("rook", "a1");
    const occupancy = buildOccupancy([rook, blocker("a4")]);
    expect(canAttack(rook, sq("a8"), occupancy)).toBe(false);
  });
});

describe("queen", () => {
  test("combines rook and bishop lines", () => {
    expect(attacks(piece("queen", "d4"))).toHaveLength(27);
    expect(
      attacks(piece("queen", "a1"), [blocker("a2"), blocker("b1")])
    ).toEqual(["b2", "c3", "d4", "e5", "f6", "g7", "h8"]);
  });
});

describe("king", () => {
  test("steps to neighbouring free squares", () => {
    expect(attacks(piece("king", "e1"))).toEqual([
      "d1",
      "d2",
      "e2",
      "f1",
      "f2",
    ]);
    expect(attacks(piece("king", "e1"), [blocker("f2")])).toEqual([
      "d1",
      "d2",
      "e2",
      "f1",
    ]);
    expect(moves(piece("king", "e1"), [], "e2")).toEqual([
      "d1",
      "d2",
      "f1",
      "f2",
    ]);
  });
});

describe("threatenedSquares", () => {
  test("unions the attacks of telegraphing pieces without duplicates", () => {
    const world = makeWorld();
    world.pieces = [
      piece("pawn", "d2", { phase: "telegraph" }),
      piece("pawn", "f2", { phase: "telegraph" }),
      piece("rook", "h1"),
      piece("bishop", "a8", { phase: "dead" }),
    ];
    expect(names(threatenedSquares(world))).toEqual(["c3", "e3", "g3"]);
  });
});
