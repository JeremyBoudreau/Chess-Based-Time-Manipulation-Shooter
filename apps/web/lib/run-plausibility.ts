import {
  DEFAULT_SHOTGUN,
  PIECE_KINDS,
  type RunResult,
  SETUPS,
} from "@buckshot/core";

/** Rounding slack when comparing millisecond timers that were rounded independently. */
const TIMER_ROUNDING_MS = 5;

/**
 * Cheap sanity checks on a client-submitted run, so a hand-crafted request cannot top the
 * leaderboard with impossible numbers. Returns the first problem found, or null when plausible.
 * It is not anti-cheat: the client still owns the simulation.
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
  const totalKills = PIECE_KINDS.reduce(
    (sum, kind) => sum + result.kills[kind],
    0
  );
  if (totalKills > setup.white.length) {
    return "more kills than pieces on the board";
  }
  if (result.outcome === "won" && result.kills.king < 1) {
    return "won without killing the king";
  }
  return null;
};
