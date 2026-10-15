import type { PieceKind } from "@buckshot/core";

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
