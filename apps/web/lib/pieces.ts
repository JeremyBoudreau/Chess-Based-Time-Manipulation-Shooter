import type { PieceKind, SetupDefinition } from "@buckshot/core";

/** White chess glyphs — the enemy is always White. */
export const PIECE_GLYPHS: Readonly<Record<PieceKind, string>> = {
  bishop: "♗",
  king: "♔",
  knight: "♘",
  pawn: "♙",
  queen: "♕",
  rook: "♖",
};

export const PIECE_BLURBS: Readonly<Record<PieceKind, string>> = {
  bishop: "Owns the diagonals. Never stand on one for long.",
  king: "Your target. Shuffles one square at a time, hits like a rook.",
  knight: "Hops over everything. Cover does not exist.",
  pawn: "Fodder — until one reaches your back rank and promotes.",
  queen: "Everything a rook and a bishop can do, at once.",
  rook: "Slow to die, fast down an open file.",
};

/** Kings first, pawns last: the order a chess diagram lists material in. */
const ARMY_ORDER: readonly PieceKind[] = [
  "king",
  "queen",
  "rook",
  "bishop",
  "knight",
  "pawn",
];

export interface ArmyEntry {
  readonly count: number;
  readonly kind: PieceKind;
}

/**
 * How many of each kind a setup fields, in ARMY_ORDER, leaving out kinds it lacks. Counted from
 * the setup itself so the site can never drift from the army the game actually spawns.
 */
export const armyOf = (setup: SetupDefinition): readonly ArmyEntry[] =>
  ARMY_ORDER.map((kind) => ({
    count: setup.white.filter((piece) => piece.kind === kind).length,
    kind,
  })).filter((entry) => entry.count > 0);

/** "1 rook", "5 pawns". */
export const countPieces = (count: number, kind: PieceKind): string =>
  `${count} ${kind}${count === 1 ? "" : "s"}`;
