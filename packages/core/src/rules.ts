import { isOnBoard, sameSquare, squareKey } from "./geometry";
import type { PieceKind, PieceState, Square, WorldState } from "./types";

/** Living white pieces indexed by `squareKey`. The black king never blocks lines (it is the target). */
export type Occupancy = ReadonlyMap<number, PieceState>;

type Offset = readonly [file: number, rank: number];

const ORTHOGONAL: readonly Offset[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const DIAGONAL: readonly Offset[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const ALL_DIRECTIONS: readonly Offset[] = [...ORTHOGONAL, ...DIAGONAL];

const KNIGHT_JUMPS: readonly Offset[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

/** Sliders repeat their offsets until blocked; everything else takes a single step/jump. */
const SLIDES: Partial<Record<PieceKind, readonly Offset[]>> = {
  bishop: DIAGONAL,
  queen: ALL_DIRECTIONS,
  rook: ORTHOGONAL,
};

const STEPS: Partial<Record<PieceKind, readonly Offset[]>> = {
  king: ALL_DIRECTIONS,
  knight: KNIGHT_JUMPS,
};

/** Pawns start on rank 2 (index 1), where they may push two squares. */
const PAWN_START_RANK = 1;

const isFree = (
  square: Square,
  occupancy: Occupancy,
  avoid: Square | null
): boolean =>
  !(
    occupancy.has(squareKey(square)) ||
    (avoid !== null && sameSquare(square, avoid))
  );

const offsetSquare = (from: Square, [file, rank]: Offset): Square => ({
  file: from.file + file,
  rank: from.rank + rank,
});

const slideSquares = (
  from: Square,
  directions: readonly Offset[],
  occupancy: Occupancy,
  avoid: Square | null
): Square[] => {
  const squares: Square[] = [];
  for (const direction of directions) {
    let square = offsetSquare(from, direction);
    while (isOnBoard(square) && isFree(square, occupancy, avoid)) {
      squares.push(square);
      square = offsetSquare(square, direction);
    }
  }
  return squares;
};

const stepSquares = (
  from: Square,
  offsets: readonly Offset[],
  occupancy: Occupancy,
  avoid: Square | null
): Square[] =>
  offsets
    .map((offset) => offsetSquare(from, offset))
    .filter((square) => isOnBoard(square) && isFree(square, occupancy, avoid));

/** Shared by attacks (`avoid` = null) and quiet moves: the two only differ in whether the king's square blocks. */
const reachableSquares = (
  piece: PieceState,
  occupancy: Occupancy,
  avoid: Square | null
): Square[] => {
  const slides = SLIDES[piece.kind];
  if (slides) {
    return slideSquares(piece.square, slides, occupancy, avoid);
  }
  const steps = STEPS[piece.kind];
  return steps ? stepSquares(piece.square, steps, occupancy, avoid) : [];
};

const pawnAttacks = ({ file, rank }: Square): Square[] =>
  [
    { file: file - 1, rank: rank + 1 },
    { file: file + 1, rank: rank + 1 },
  ].filter(isOnBoard);

const pawnPushes = (
  { file, rank }: Square,
  occupancy: Occupancy,
  avoid: Square | null
): Square[] => {
  const single = { file, rank: rank + 1 };
  if (!(isOnBoard(single) && isFree(single, occupancy, avoid))) {
    return [];
  }
  const double = { file, rank: rank + 2 };
  return rank === PAWN_START_RANK && isFree(double, occupancy, avoid)
    ? [single, double]
    : [single];
};

/** Dead pieces stay in the array for effects, so rules must look pieces up through this map only. */
export const buildOccupancy = (pieces: readonly PieceState[]): Occupancy => {
  const occupancy = new Map<number, PieceState>();
  for (const piece of pieces) {
    if (piece.phase !== "dead") {
      occupancy.set(squareKey(piece.square), piece);
    }
  }
  return occupancy;
};

/**
 * Squares a white piece attacks from its current square, following chess movement:
 * pawns attack diagonally forward (towards rank 8), sliders stop at the first occupied square
 * (which is a friendly piece, so it is excluded), knights jump, kings step.
 */
export const attackSquares = (
  piece: PieceState,
  occupancy: Occupancy
): Square[] =>
  piece.kind === "pawn"
    ? pawnAttacks(piece.square)
    : reachableSquares(piece, occupancy, null);

/**
 * Non-capturing destinations: pawns push one square forward (two from rank 2 if both empty),
 * every other piece moves like it attacks. Excludes occupied squares and `avoid` (the king's square,
 * which can only be entered by an attack).
 */
export const quietMoves = (
  piece: PieceState,
  occupancy: Occupancy,
  avoid: Square | null
): Square[] =>
  piece.kind === "pawn"
    ? pawnPushes(piece.square, occupancy, avoid)
    : reachableSquares(piece, occupancy, avoid);

/** Whether `piece` could capture on `target` right now — the brain's "kill the king" check. */
export const canAttack = (
  piece: PieceState,
  target: Square,
  occupancy: Occupancy
): boolean =>
  attackSquares(piece, occupancy).some((square) => sameSquare(square, target));

/** Union of squares attacked by pieces currently telegraphing (rendered as red floor tiles). */
export const threatenedSquares = (world: WorldState): Square[] => {
  const occupancy = buildOccupancy(world.pieces);
  const seen = new Set<number>();
  const squares: Square[] = [];
  for (const piece of world.pieces) {
    if (piece.phase !== "telegraph") {
      continue;
    }
    for (const square of attackSquares(piece, occupancy)) {
      const key = squareKey(square);
      if (!seen.has(key)) {
        seen.add(key);
        squares.push(square);
      }
    }
  }
  return squares;
};
