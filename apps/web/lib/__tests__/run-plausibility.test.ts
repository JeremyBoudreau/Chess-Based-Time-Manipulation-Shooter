// The web app does not install @types/bun (core and db do), so the runner's own module has no
// declarations here; drop this directive once it does — tsc will flag it as unused.
// @ts-expect-error bun:test is provided by `bun test` at runtime
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PICKUPS,
  DEFAULT_PIECE_CATALOG,
  DEFAULT_SHOTGUN,
  DEFAULT_TIME_POLICY,
  type KillCounts,
  maxTimeScale,
  PIECE_KINDS,
  type RunResult,
} from "@buckshot/core";
import { findImplausibility } from "../run-plausibility";

const MS_PER_SECOND = 1000;
const { sprintScale } = DEFAULT_TIME_POLICY;
/** A sprint during a reload: the fastest game-time can run. */
const fastestScale = maxTimeScale(DEFAULT_TIME_POLICY);
const REAL_TIME_MS = 60_000;

/** Every Easy piece dead: five pawns, the rook, the bishop and the king. */
const FULL_CLEAR: KillCounts = {
  bishop: 1,
  king: 1,
  knight: 0,
  pawn: 5,
  queen: 0,
  rook: 1,
};

/** Shortest gap between two pickup spawn attempts at the normal rate, in game-ms. */
const NORMAL_SPAWN_GAP_MS =
  DEFAULT_PICKUPS.spawnInterval *
  (1 - DEFAULT_PICKUPS.spawnJitter) *
  MS_PER_SECOND;

/** Shortest possible gap: the spawn clock runs faster while the king holds 0–1 shells. */
const MIN_SPAWN_GAP_MS =
  NORMAL_SPAWN_GAP_MS / Math.max(1, DEFAULT_PICKUPS.lowAmmoSpawnRate);

/**
 * The documented shell budget, restated independently of the implementation: both barrels, the
 * starting reserve, the initial pickups, one early spawn and one spawn per minimum gap.
 */
const shellBudget = (gameTimeMs: number): number =>
  DEFAULT_SHOTGUN.capacity +
  DEFAULT_SHOTGUN.reserveStart +
  DEFAULT_PICKUPS.shellsPerPickup *
    (DEFAULT_PICKUPS.initialPickups +
      1 +
      Math.floor(gameTimeMs / MIN_SPAWN_GAP_MS));

/**
 * A believable winning run that spent most of its minute sprinting, so game-time is well past
 * real time (which the old "time scale ≤ 1" rule would have rejected).
 */
const sprintWin = (overrides: Partial<RunResult> = {}): RunResult => ({
  distanceMoved: 140,
  gameTimeMs: Math.round(REAL_TIME_MS * sprintScale * 0.9),
  killedBy: null,
  kills: FULL_CLEAR,
  outcome: "won",
  pelletsFired: 24 * DEFAULT_SHOTGUN.pellets,
  pelletsHit: 66,
  realTimeMs: REAL_TIME_MS,
  setupId: "easy",
  shotsFired: 24,
  ...overrides,
});

const withKills = (kills: Partial<KillCounts>): RunResult =>
  sprintWin({ kills: { ...FULL_CLEAR, ...kills } });

/** Hits needed to clear the whole Easy army (the least a full-clear win can have landed). */
const FULL_CLEAR_HITS = Math.ceil(
  (5 * DEFAULT_PIECE_CATALOG.pawn.maxHp +
    DEFAULT_PIECE_CATALOG.rook.maxHp +
    DEFAULT_PIECE_CATALOG.bishop.maxHp +
    DEFAULT_PIECE_CATALOG.king.maxHp) /
    DEFAULT_SHOTGUN.damagePerPellet
);

/** A run firing exactly `shotsFired` shells, with every pellet fired and just enough of them landing. */
const firing = (shotsFired: number, gameTimeMs: number): RunResult =>
  sprintWin({
    gameTimeMs,
    pelletsFired: shotsFired * DEFAULT_SHOTGUN.pellets,
    pelletsHit: FULL_CLEAR_HITS,
    realTimeMs: gameTimeMs,
    shotsFired,
  });

describe("findImplausibility: honest runs", () => {
  test("a sprint-heavy win passes", () => {
    const run = sprintWin();
    expect(run.gameTimeMs).toBeGreaterThan(run.realTimeMs);
    expect(findImplausibility(run)).toBeNull();
  });

  test("a loss passes", () => {
    const run = sprintWin({
      killedBy: "pawn",
      kills: { ...FULL_CLEAR, king: 0 },
      outcome: "lost",
    });
    expect(findImplausibility(run)).toBeNull();
  });

  test("a pawn that promoted can die as a queen", () => {
    expect(findImplausibility(withKills({ pawn: 3, queen: 2 }))).toBeNull();
  });
});

describe("findImplausibility: time-scale bound", () => {
  test("game-time beyond a plain sprint passes (reloads while sprinting run faster)", () => {
    const run = sprintWin({
      gameTimeMs: Math.ceil(REAL_TIME_MS * sprintScale) + 50,
    });
    expect(findImplausibility(run)).toBeNull();
  });

  test("game-time at exactly realTime × maxTimeScale passes", () => {
    const run = sprintWin({
      gameTimeMs: Math.floor(REAL_TIME_MS * fastestScale),
    });
    expect(findImplausibility(run)).toBeNull();
  });

  test("game-time beyond realTime × maxTimeScale is rejected", () => {
    const run = sprintWin({
      gameTimeMs: Math.ceil(REAL_TIME_MS * fastestScale) + 50,
    });
    expect(findImplausibility(run)).toBe(
      "game-time ran faster than the clock allows"
    );
  });

  test("a long run claimed in a second of real time is rejected", () => {
    expect(findImplausibility(sprintWin({ realTimeMs: 1000 }))).toBe(
      "game-time ran faster than the clock allows"
    );
  });
});

describe("findImplausibility: pickup shell bound", () => {
  // Mid-way between two spawn gaps, so the server's rounding slack cannot change the floor.
  const gameTimeMs = Math.round(MIN_SPAWN_GAP_MS * 17.5);
  const budget = shellBudget(gameTimeMs);

  test("firing exactly the board's supply passes", () => {
    expect(findImplausibility(firing(budget, gameTimeMs))).toBeNull();
  });

  test("one shell over the board's supply is rejected", () => {
    expect(findImplausibility(firing(budget + 1, gameTimeMs))).toBe(
      "more shells than the board could supply"
    );
  });

  test("a run spent nearly dry may collect at the boosted rate", () => {
    // What the board could supply at the normal rate only; the low-ammo boost allows more.
    const normalRateBudget =
      DEFAULT_SHOTGUN.capacity +
      DEFAULT_SHOTGUN.reserveStart +
      DEFAULT_PICKUPS.shellsPerPickup *
        (DEFAULT_PICKUPS.initialPickups +
          1 +
          Math.floor(gameTimeMs / NORMAL_SPAWN_GAP_MS));
    expect(budget).toBeGreaterThan(normalRateBudget);
    expect(
      findImplausibility(firing(normalRateBudget + 1, gameTimeMs))
    ).toBeNull();
  });

  test("idling in real time spawns no extra pickups", () => {
    // Pickups drop on a game-time cadence, so ten real minutes of standing still buy nothing.
    const run = { ...firing(budget + 1, gameTimeMs), realTimeMs: 600_000 };
    expect(findImplausibility(run)).toBe(
      "more shells than the board could supply"
    );
  });
});

describe("findImplausibility: forged wins", () => {
  test("an unknown setup is rejected", () => {
    expect(findImplausibility(sprintWin({ setupId: "nope" }))).toBe(
      "unknown setup"
    );
  });

  test("an instant zero-shot win is rejected", () => {
    const run = sprintWin({
      distanceMoved: 0,
      gameTimeMs: 0,
      kills: { ...FULL_CLEAR, bishop: 0, pawn: 0, rook: 0 },
      pelletsFired: 0,
      pelletsHit: 0,
      realTimeMs: 0,
      shotsFired: 0,
    });
    expect(findImplausibility(run)).toBe("kills need more hits than landed");
  });

  test("more pellets hit than fired is rejected", () => {
    const run = sprintWin({ pelletsFired: 50, pelletsHit: 51 });
    expect(findImplausibility(run)).toBe("more pellets hit than fired");
  });

  test("more pellets than the shells hold is rejected", () => {
    const run = sprintWin({
      pelletsFired: 24 * DEFAULT_SHOTGUN.pellets + 1,
    });
    expect(findImplausibility(run)).toBe("more pellets than shells allow");
  });

  test("a win with a killer is rejected", () => {
    expect(findImplausibility(sprintWin({ killedBy: "rook" }))).toBe(
      "outcome disagrees with killedBy"
    );
  });

  test("a win that never killed the king is rejected", () => {
    expect(findImplausibility(withKills({ king: 0 }))).toBe(
      "king kills disagree with outcome"
    );
  });

  test("killing more of a kind than was fielded is rejected", () => {
    expect(findImplausibility(withKills({ rook: 2 }))).toBe(
      "more rooks killed than fielded"
    );
    expect(findImplausibility(withKills({ knight: 1 }))).toBe(
      "more knights killed than fielded"
    );
  });

  test("more pawns and queens than the pawn budget is rejected", () => {
    expect(findImplausibility(withKills({ pawn: 4, queen: 2 }))).toBe(
      "more pawns and queens killed than fielded"
    );
  });

  test("kills that need more damage than landed are rejected", () => {
    const hpNeeded =
      5 * DEFAULT_PIECE_CATALOG.pawn.maxHp +
      DEFAULT_PIECE_CATALOG.rook.maxHp +
      DEFAULT_PIECE_CATALOG.bishop.maxHp +
      DEFAULT_PIECE_CATALOG.king.maxHp;
    const run = sprintWin({
      pelletsHit: Math.ceil(hpNeeded / DEFAULT_SHOTGUN.damagePerPellet) - 1,
    });
    expect(findImplausibility(run)).toBe("kills need more hits than landed");
  });

  test("too little game-time for the reloads is rejected", () => {
    const run = sprintWin({ gameTimeMs: 2000, realTimeMs: 2000 });
    expect(findImplausibility(run)).toBe(
      "too little game-time for the reloads"
    );
  });

  test("every reload costs its full duration in game-time", () => {
    // The opening supply needs no pickups, so only the reload floor can object.
    const shots = shellBudget(0);
    const reloads = Math.ceil(
      (shots - DEFAULT_SHOTGUN.capacity) / DEFAULT_SHOTGUN.capacity
    );
    const reloadMs = Math.ceil(
      reloads * DEFAULT_SHOTGUN.reloadDuration * MS_PER_SECOND
    );
    expect(findImplausibility(firing(shots, reloadMs))).toBeNull();
    // Real time does not help: the reload timer only counts down in game-time.
    const rushed = { ...firing(shots, reloadMs - 100), realTimeMs: 600_000 };
    expect(findImplausibility(rushed)).toBe(
      "too little game-time for the reloads"
    );
  });
});

/**
 * Hard's whole army, restated from the difficulty rules rather than read from the setup: Medium adds
 * a rook, a bishop and three pawns to Easy, and Hard adds both knights and the queen on top.
 */
const HARD_CLEAR: KillCounts = {
  bishop: 2,
  king: 1,
  knight: 2,
  pawn: 8,
  queen: 1,
  rook: 2,
};

/** Least number of pellets that can have landed for these kills. */
const hitsToKill = (kills: KillCounts): number =>
  Math.ceil(
    PIECE_KINDS.reduce(
      (sum, kind) => sum + kills[kind] * DEFAULT_PIECE_CATALOG[kind].maxHp,
      0
    ) / DEFAULT_SHOTGUN.damagePerPellet
  );

/** A full-clear win on `setupId`, firing a few shells more than the hits strictly need. */
const clearWin = (setupId: string, kills: KillCounts): RunResult => {
  const hits = hitsToKill(kills);
  const shotsFired = Math.ceil(hits / DEFAULT_SHOTGUN.pellets) + 4;
  return sprintWin({
    kills,
    pelletsFired: shotsFired * DEFAULT_SHOTGUN.pellets,
    pelletsHit: hits,
    setupId,
    shotsFired,
  });
};

describe("findImplausibility: difficulties", () => {
  test("a legal Hard full-clear passes, knights and queen included", () => {
    expect(findImplausibility(clearWin("hard", HARD_CLEAR))).toBeNull();
  });

  test("Hard still caps each kind at what it fields", () => {
    expect(
      findImplausibility(clearWin("hard", { ...HARD_CLEAR, knight: 3 }))
    ).toBe("more knights killed than fielded");
    expect(
      findImplausibility(clearWin("hard", { ...HARD_CLEAR, queen: 2 }))
    ).toBe("more pawns and queens killed than fielded");
  });

  test("a Hard-sized clear claimed on Easy is rejected", () => {
    expect(findImplausibility(clearWin("easy", HARD_CLEAR))).not.toBeNull();
  });

  test("knight kills on Easy are rejected", () => {
    expect(
      findImplausibility(sprintWin({ kills: { ...FULL_CLEAR, knight: 1 } }))
    ).toBe("more knights killed than fielded");
  });

  test("a queen kill on Easy needs a promoted pawn", () => {
    // Easy fields no queen, so a dead queen must be one of its five pawns.
    expect(findImplausibility(withKills({ pawn: 4, queen: 1 }))).toBeNull();
    expect(findImplausibility(withKills({ queen: 1 }))).toBe(
      "more pawns and queens killed than fielded"
    );
  });

  test("Medium's second rook and bishop count there but not on Easy", () => {
    const doubled = { ...FULL_CLEAR, bishop: 2, rook: 2 };
    expect(findImplausibility(clearWin("medium", doubled))).toBeNull();
    expect(findImplausibility(clearWin("easy", doubled))).toBe(
      "more rooks killed than fielded"
    );
  });

  test("the legacy skirmish id still validates, against Easy's army", () => {
    expect(findImplausibility(sprintWin({ setupId: "skirmish" }))).toBeNull();
    expect(findImplausibility(clearWin("skirmish", HARD_CLEAR))).toBe(
      "more pawns and queens killed than fielded"
    );
  });
});
