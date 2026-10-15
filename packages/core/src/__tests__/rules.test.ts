import { describe, expect, test } from "bun:test";
import {
  attackSquares,
  buildOccupancy,
  canAttack,
  moveTravel,
  pathSquares,
  quietMoves,
  squaresPassed,
  threatenedSquares,
} from "../rules";
import { squareName } from "../setups";
import type { PieceKind, PieceState, Square } from "../types";
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

describe("pathSquares", () => {
  const path = (kind: PieceKind, from: string, to: string): string[] =>
    pathSquares(kind, sq(from), sq(to)).map(squareName);

  test("sliders cover every square between, ending on the destination", () => {
    expect(path("rook", "a1", "a4")).toEqual(["a2", "a3", "a4"]);
    expect(path("rook", "h1", "c1")).toEqual(["g1", "f1", "e1", "d1", "c1"]);
    expect(path("bishop", "c1", "f4")).toEqual(["d2", "e3", "f4"]);
    expect(path("queen", "d8", "a5")).toEqual(["c7", "b6", "a5"]);
  });

  test("kings and pawns step, a pawn's double push covers both squares", () => {
    expect(path("king", "e1", "f2")).toEqual(["f2"]);
    expect(path("pawn", "e2", "e3")).toEqual(["e3"]);
    expect(path("pawn", "e2", "e4")).toEqual(["e3", "e4"]);
    expect(path("pawn", "d4", "e5")).toEqual(["e5"]);
  });

  test("a knight jumps, touching only where it lands", () => {
    expect(path("knight", "b1", "c3")).toEqual(["c3"]);
    expect(path("knight", "g8", "e7")).toEqual(["e7"]);
  });
});

describe("squaresPassed", () => {
  const passed = (
    kind: PieceKind,
    from: string,
    to: string,
    moveProgress: number
  ): string[] =>
    squaresPassed(
      piece(kind, to, {
        fromSquare: sq(from),
        moveProgress,
        phase: "moving",
      })
    ).map(squareName);

  test("the glide eases in and out and always ends on the destination", () => {
    expect(moveTravel(0)).toBe(0);
    expect(moveTravel(0.5)).toBeCloseTo(0.5, 10);
    expect(moveTravel(1)).toBe(1);
    expect(moveTravel(0.25)).toBeLessThan(0.25);
    expect(moveTravel(0.75)).toBeGreaterThan(0.75);
    expect(moveTravel(-1)).toBe(0);
    expect(moveTravel(2)).toBe(1);
  });

  test("a slider has passed a square once its centre crosses into it", () => {
    expect(passed("rook", "a1", "a5", 0)).toEqual([]);
    // Four squares: a2 counts from 1/8 of the way, a3 from 3/8, a4 from 5/8, a5 from 7/8.
    expect(passed("rook", "a1", "a5", 0.35)).toEqual(["a2"]);
    expect(passed("rook", "a1", "a5", 0.5)).toEqual(["a2", "a3"]);
    expect(passed("rook", "a1", "a5", 0.6)).toEqual(["a2", "a3", "a4"]);
    expect(passed("rook", "a1", "a5", 1)).toEqual(["a2", "a3", "a4", "a5"]);
  });

  test("a one-square step reaches its destination halfway", () => {
    expect(passed("pawn", "e2", "e3", 0.49)).toEqual([]);
    expect(passed("pawn", "e2", "e3", 0.5)).toEqual(["e3"]);
    expect(passed("king", "e1", "f2", 0.6)).toEqual(["f2"]);
  });

  test("a knight is airborne until it lands", () => {
    expect(passed("knight", "b1", "c3", 0.99)).toEqual([]);
    expect(passed("knight", "b1", "c3", 1)).toEqual(["c3"]);
  });
});
