import {
  DEFAULT_PIECE_CATALOG,
  DEFAULT_SHOTGUN,
  PIECE_KINDS,
  type PieceKind,
  type RunResult,
  SETUPS,
} from "@buckshot/core";

/** Rounding slack when comparing millisecond timers that were rounded independently. */
const TIMER_ROUNDING_MS = 5;
const MS_PER_SECOND = 1000;

/** Kinds that can only die as often as they were fielded (pawns may also die as queens). */
const UNPROMOTED_KINDS = ["rook", "bishop", "knight", "king"] as const;

/**
 * Cheap sanity checks on a client-submitted run, so a hand-crafted request cannot top the
 * leaderboard with impossible numbers. Upper bounds stop inflated totals; lower bounds derived from
 * the game rules (hits needed per kill, reloads needed per shell) stop instant zero-shot wins.
 * Returns the first problem found, or null when plausible. It is not anti-cheat: the client still
 * owns the simulation, so this only raises the floor to the theoretical best run.
 */
export const findImplausibility = (result: RunResult): string | null => {
  const setup = SETUPS.find((candidate) => candidate.id === result.setupId);
  if (!setup) {
    return "unknown setup";
  }
  if (result.pelletsHit > result.pelletsFired) {
    return "more pellets hit than fired";
  }
  if (result.pelletsFired > result.shotsFired * DEFAULT_SHOTGUN.pellets) {
    return "more pellets than shells allow";
  }
  // Time scale never exceeds 1, so game-time can only lag behind real time.
  if (result.gameTimeMs > result.realTimeMs + TIMER_ROUNDING_MS) {
    return "game-time ran faster than real time";
  }

  // The simulation sets killedBy only when a piece captures the king, which is the only way to lose.
  const won = result.outcome === "won";
  if (won !== (result.killedBy === null)) {
    return "outcome disagrees with killedBy";
  }
  // There is one white king and killing it ends the game.
  if (result.kills.king !== (won ? 1 : 0)) {
    return "king kills disagree with outcome";
  }

  const fielded = (kind: PieceKind): number =>
    setup.white.filter((piece) => piece.kind === kind).length;
  // Promotion turns a pawn into a queen, so the two share one budget.
  if (
    result.kills.pawn + result.kills.queen >
    fielded("pawn") + fielded("queen")
  ) {
    return "more pawns and queens killed than fielded";
  }
  for (const kind of UNPROMOTED_KINDS) {
    if (result.kills[kind] > fielded(kind)) {
      return `more ${kind}s killed than fielded`;
    }
  }

  // Every hit deals a fixed amount, and a promoted pawn heals to full queen health.
  const hpNeeded = PIECE_KINDS.reduce(
    (sum, kind) => sum + result.kills[kind] * DEFAULT_PIECE_CATALOG[kind].maxHp,
    0
  );
  if (result.pelletsHit * DEFAULT_SHOTGUN.damagePerPellet < hpNeeded) {
    return "kills need more hits than landed";
  }

  // A reload cannot be interrupted, runs at time scale 1 and loads at most `capacity` shells.
  const { capacity, reloadDuration, reserveRegenInterval, reserveStart } =
    DEFAULT_SHOTGUN;
  const gameTimeCeilingMs = result.gameTimeMs + TIMER_ROUNDING_MS;
  const reloads = Math.ceil(
    Math.max(0, result.shotsFired - capacity) / capacity
  );
  if (gameTimeCeilingMs < reloads * reloadDuration * MS_PER_SECOND) {
    return "too little game-time for the reloads";
  }
  // The reserve starts full and regenerates at most one shell per interval of game-time.
  const maxShells =
    capacity +
    reserveStart +
    Math.floor(gameTimeCeilingMs / (reserveRegenInterval * MS_PER_SECOND));
  if (result.shotsFired > maxShells) {
    return "more shells than the gun could supply";
  }
  return null;
};
