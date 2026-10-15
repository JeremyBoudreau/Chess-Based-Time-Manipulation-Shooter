import type { PieceState, Square, WorldState } from "./types";

/** Living white pieces indexed by `squareKey`. The black king never blocks lines (it is the target). */
export type Occupancy = ReadonlyMap<number, PieceState>;

export const buildOccupancy = (_pieces: readonly PieceState[]): Occupancy => {
  throw new Error("not implemented");
};

/**
 * Squares a white piece attacks from its current square, following chess movement:
 * pawns attack diagonally forward (towards rank 8), sliders stop at the first occupied square
 * (which is a friendly piece, so it is excluded), knights jump, kings step.
 */
export const attackSquares = (
  _piece: PieceState,
  _occupancy: Occupancy
): Square[] => {
  throw new Error("not implemented");
};

/**
 * Non-capturing destinations: pawns push one square forward (two from rank 2 if both empty),
 * every other piece moves like it attacks. Excludes occupied squares and `avoid` (the king's square,
 * which can only be entered by an attack).
 */
export const quietMoves = (
  _piece: PieceState,
  _occupancy: Occupancy,
  _avoid: Square | null
): Square[] => {
  throw new Error("not implemented");
};

export const canAttack = (
  _piece: PieceState,
  _target: Square,
  _occupancy: Occupancy
): boolean => {
  throw new Error("not implemented");
};

/** Union of squares attacked by pieces currently telegraphing (rendered as red floor tiles). */
export const threatenedSquares = (_world: WorldState): Square[] => {
  throw new Error("not implemented");
};
