import type {
  PickupRules,
  PieceCatalogData,
  PlayerStats,
  ShotgunStats,
  TimePolicyData,
} from "./types";

/**
 * Health is tuned against a point-blank shot landing all 5 pellets (5 damage):
 * pawn 3 → ~0.6 shots, bishop/knight 8 & queen 9 → 1–2 shots, rook/king 12 → 2–3 shots.
 * Cadence: a pawn acts every ~2.7 game-seconds (±25%), heavier pieces a little less often.
 */
export const DEFAULT_PIECE_CATALOG: PieceCatalogData = {
  bishop: {
    actionInterval: 3.2,
    intervalJitter: 0.25,
    kind: "bishop",
    maxHp: 8,
    moveDuration: 0.4,
    telegraphDuration: 1.1,
  },
  king: {
    actionInterval: 4.4,
    intervalJitter: 0.25,
    kind: "king",
    maxHp: 12,
    moveDuration: 0.4,
    telegraphDuration: 1.3,
  },
  knight: {
    actionInterval: 3.1,
    intervalJitter: 0.25,
    kind: "knight",
    maxHp: 8,
    moveDuration: 0.4,
    telegraphDuration: 1.1,
  },
  pawn: {
    actionInterval: 2.7,
    intervalJitter: 0.25,
    kind: "pawn",
    maxHp: 3,
    moveDuration: 0.3,
    telegraphDuration: 1.1,
  },
  queen: {
    actionInterval: 3.1,
    intervalJitter: 0.25,
    kind: "queen",
    maxHp: 9,
    moveDuration: 0.4,
    telegraphDuration: 1.1,
  },
  rook: {
    actionInterval: 3.6,
    intervalJitter: 0.25,
    kind: "rook",
    maxHp: 12,
    moveDuration: 0.45,
    telegraphDuration: 1.2,
  },
};

/**
 * Double-barrel buckshot. Pellets fly flat across the board at 10 squares/s and vanish after 5,
 * so the furthest pellet lands ~0.5 s after the trigger pull. A ±24° stratified-random fan
 * puts every pellet on an adjacent square but only ~1–2 on a square 4 away.
 */
export const DEFAULT_SHOTGUN: ShotgunStats = {
  capacity: 2,
  damagePerPellet: 1,
  fireCooldown: 0.22,
  pelletRange: 5,
  pelletSpeed: 10,
  pellets: 5,
  reloadDuration: 1.1,
  reserveMax: 6,
  reserveStart: 6,
  spreadDegrees: 24,
  spreadJitter: 0.9,
};

/** Walking is 2.4 squares per real second; Shift sprints at `DEFAULT_TIME_POLICY.sprintScale`× that. */
export const DEFAULT_PLAYER: PlayerStats = {
  maxPitch: 1.2,
  moveSpeed: 2.4,
  radius: 0.22,
};

/**
 * Shells no longer regenerate: single shells drop onto empty squares every ~5 game-seconds (max 3 on
 * the board, never within 2 squares of the king), so restocking means walking into the open — and
 * a piece that moves over a shell crushes it.
 */
export const DEFAULT_PICKUPS: PickupRules = {
  initialPickups: 2,
  maxOnBoard: 3,
  minSpawnDistance: 2,
  shellsPerPickup: 1,
  spawnInterval: 5,
  spawnJitter: 0.3,
};

/**
 * Time moves with the king: walking, looking and reloading run it at up to full speed. Standing
 * still is a SUPERHOT-style creep (1%) rather than a hard freeze — the world never looks paused,
 * pellets visibly inch forward, yet 10 seconds of thinking costs only 0.1 s of game time.
 * Sprinting speeds legs and clock by the same factor (1.75×): a sprint gets you there sooner in real
 * time, and every square still costs exactly as much game-time as walking it.
 * Effects stack: legs + camera are capped at 1 (1.75 sprinting); reloading adds 1 and lifts that
 * cap by 0.5 — a still reload is 1×, walking while reloading 1.5×, sprinting while reloading 2.25×.
 */
export const DEFAULT_TIME_POLICY: TimePolicyData = {
  idleScale: 0.01,
  lookFullSpeed: 5,
  lookMaxScale: 0.7,
  reloadBonus: 1,
  reloadCapBonus: 0.5,
  responsiveness: 14,
  shotBurst: 0.12,
  sprintScale: 1.75,
};
