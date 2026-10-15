import type { SetupDefinition, Square } from "./types";

const sq = (name: string): Square => {
  const file = name.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(name.slice(1)) - 1;
  return { file, rank };
};

/** The launch setup: a stripped-down white army (5 pawns, rook, bishop, king). */
export const SKIRMISH_SETUP: SetupDefinition = {
  description: "Five pawns, a rook, a bishop and their king. Kill the king.",
  id: "skirmish",
  name: "Skirmish",
  playerStart: sq("e8"),
  white: [
    { kind: "pawn", square: sq("c2") },
    { kind: "pawn", square: sq("d2") },
    { kind: "pawn", square: sq("e2") },
    { kind: "pawn", square: sq("f2") },
    { kind: "pawn", square: sq("g2") },
    { kind: "rook", square: sq("h1") },
    { kind: "bishop", square: sq("c1") },
    { kind: "king", square: sq("e1") },
  ],
};

export const SETUPS: readonly SetupDefinition[] = [SKIRMISH_SETUP];

export const squareName = (square: Square): string =>
  `${String.fromCharCode("a".charCodeAt(0) + square.file)}${square.rank + 1}`;

export const parseSquare = sq;
