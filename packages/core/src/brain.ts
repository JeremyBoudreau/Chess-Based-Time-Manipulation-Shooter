import { squareAt, squareDistance } from "./geometry";
import { buildOccupancy, canAttack, quietMoves } from "./rules";
import type { PieceAction, PieceState, Square, WorldState } from "./types";

/** A move must beat the current distance by more than float noise to count as "closer". */
const CLOSER_EPSILON = 1e-9;
/** Moves this close to the best distance are treated as equally good. */
const TIE_EPSILON = 1e-6;
/** How much more likely a move pointing straight at the king is than a sideways/backwards one. */
const TOWARDS_KING_BIAS = 3;

interface Candidate {
  readonly square: Square;
  readonly weight: number;
}

/** Roulette-wheel pick; `undefined` only when there are no candidates. */
const pickWeighted = (
  candidates: readonly Candidate[],
  rng: () => number
): Square | undefined => {
  const total = candidates.reduce(
    (sum, candidate) => sum + candidate.weight,
    0
  );
  let roll = rng() * total;
  let chosen: Square | undefined;
  for (const candidate of candidates) {
    chosen = candidate.square;
    roll -= candidate.weight;
    if (roll < 0) {
      break;
    }
  }
  return chosen;
};

/** 1 for moves pointing away from the king, up to 1 + bias for moves pointing straight at it. */
const towardsKingWeight = (from: Square, to: Square, king: Square): number => {
  const moveFile = to.file - from.file;
  const moveRank = to.rank - from.rank;
  const kingFile = king.file - from.file;
  const kingRank = king.rank - from.rank;
  const lengths =
    Math.hypot(moveFile, moveRank) * Math.hypot(kingFile, kingRank);
  const cosine =
    lengths > 0 ? (moveFile * kingFile + moveRank * kingRank) / lengths : 0;
  return 1 + TOWARDS_KING_BIAS * Math.max(0, cosine);
};

/** Closest-to-the-king moves when they make progress, otherwise a king-leaning random wander. */
const chooseMove = (
  piece: PieceState,
  moves: readonly Square[],
  king: Square,
  rng: () => number
): Square | undefined => {
  const scored = moves.map((square) => ({
    distance: squareDistance(square, king),
    square,
  }));
  const best = Math.min(...scored.map((move) => move.distance));
  if (best < squareDistance(piece.square, king) - CLOSER_EPSILON) {
    const closest = scored
      .filter((move) => move.distance - best <= TIE_EPSILON)
      .map((move) => ({ square: move.square, weight: 1 }));
    return pickWeighted(closest, rng);
  }
  const wander = moves.map((square) => ({
    square,
    weight: towardsKingWeight(piece.square, square, king),
  }));
  return pickWeighted(wander, rng);
};

/**
 * Default enemy brain:
 * 1. If the king's square is attackable → attack it.
 * 2. Else move to the quiet move whose centre is closest to the king, if it gets closer than now.
 * 3. Else move randomly, weighting moves that point towards the king more heavily.
 * 4. No legal moves → wait.
 */
export const decidePieceAction = (
  world: WorldState,
  piece: PieceState,
  rng: () => number
): PieceAction => {
  const king = squareAt(world.player.pos);
  const occupancy = buildOccupancy(world.pieces);
  if (canAttack(piece, king, occupancy)) {
    return { to: king, type: "attack" };
  }
  const to = chooseMove(piece, quietMoves(piece, occupancy, king), king, rng);
  return to ? { to, type: "move" } : { type: "wait" };
};
