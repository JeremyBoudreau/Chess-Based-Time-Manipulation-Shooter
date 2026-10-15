import { beforeEach, describe, expect, test } from "bun:test";
import type { RunResult } from "@buckshot/core";
import { createClient } from "@libsql/client";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import type { DrizzleDb } from "../client";
import {
  distinctSetupIdsQuery,
  MIN_SAVE_INTERVAL_MS,
  makeRunRepository,
  type RunRepositoryShape,
  SAVE_LATENCY_SLACK_MS,
  setupIdsMeaning,
  totalKillsOf,
} from "../run-repository";
import { run, schema, user } from "../schema";

const USER_ID = "user-1";
const CLOCK_TOLERANCE_MS = 5000;

const aRun = (overrides: Partial<RunResult> = {}): RunResult => ({
  distanceMoved: 12.5,
  gameTimeMs: 9000,
  killedBy: null,
  kills: { bishop: 1, king: 1, knight: 0, pawn: 2, queen: 0, rook: 0 },
  outcome: "won",
  pelletsFired: 40,
  pelletsHit: 30,
  realTimeMs: 20_000,
  setupId: "easy",
  shotsFired: 8,
  ...overrides,
});

let db: DrizzleDb;
let runs: RunRepositoryShape;

/** Pretends every stored save happened `msAgo` milliseconds ago, by the database clock. */
const backdateRuns = (msAgo: number) =>
  db.run(
    sql`update ${run} set created_at = cast(unixepoch('subsecond') * 1000 as integer) - ${msAgo}`
  );

/** "saved", or the tag of the typed failure. */
const save = (result: RunResult) =>
  Effect.runPromise(
    runs.save(USER_ID, result).pipe(
      Effect.match({
        onFailure: (error) => error._tag,
        onSuccess: () => "saved" as const,
      })
    )
  );

beforeEach(async () => {
  db = drizzle(createClient({ url: ":memory:" }), { schema });
  const { apply } = await pushSQLiteSchema(schema, db);
  await apply();
  await db
    .insert(user)
    .values({ email: "p@example.com", id: USER_ID, name: "Player" });
  runs = makeRunRepository(db);
});

describe("RunRepository.save", () => {
  test("stores every field, with kills as JSON and a database timestamp", async () => {
    expect(await save(aRun())).toBe("saved");
    const [stored] = await db.select().from(run);
    expect(stored?.kills).toEqual(aRun().kills);
    expect(stored?.totalKills).toBe(4);
    expect(stored?.killedBy).toBeNull();
    expect(stored?.userId).toBe(USER_ID);
    const age = Date.now() - (stored?.createdAt.getTime() ?? 0);
    expect(Math.abs(age)).toBeLessThan(CLOCK_TOLERANCE_MS);
  });

  test("rejects a replay that arrives faster than any game could end", async () => {
    expect(await save(aRun({ realTimeMs: 0 }))).toBe("saved");
    expect(await save(aRun({ realTimeMs: 0 }))).toBe("RunTooSoon");
    expect(await db.$count(run)).toBe(1);
  });

  test("rejects a run whose real time does not fit since the previous save", async () => {
    await save(aRun());
    await backdateRuns(10_000);
    expect(await save(aRun({ realTimeMs: 60_000 }))).toBe("RunTooSoon");
  });

  test("forgives save latency when the player restarts instantly", async () => {
    await save(aRun());
    await backdateRuns(10_000);
    const realTimeMs = 10_000 + SAVE_LATENCY_SLACK_MS - 500;
    expect(await save(aRun({ realTimeMs }))).toBe("saved");
    expect(await db.$count(run)).toBe(2);
  });

  test("accepts the next run once the minimum interval has passed", async () => {
    await save(aRun({ realTimeMs: 0 }));
    await backdateRuns(MIN_SAVE_INTERVAL_MS + 100);
    expect(await save(aRun({ realTimeMs: 0 }))).toBe("saved");
  });

  test("lets only one of several parallel replays through", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => save(aRun({ realTimeMs: 0 })))
    );
    expect(outcomes.filter((outcome) => outcome === "saved")).toHaveLength(1);
    expect(await db.$count(run)).toBe(1);
  });

  test("only the user's own runs count", async () => {
    await db
      .insert(user)
      .values({ email: "q@example.com", id: "user-2", name: "Other" });
    await Effect.runPromise(runs.save("user-2", aRun({ realTimeMs: 0 })));
    expect(await save(aRun({ realTimeMs: 0 }))).toBe("saved");
  });
});

const OTHER_ID = "user-2";

const addOtherUser = () =>
  db
    .insert(user)
    .values({ email: "q@example.com", id: OTHER_ID, name: "Other" });

let seededRuns = 0;

/** Stores a run directly, skipping save's rate limit, so a test can lay down a whole history. */
const seedRun = (userId: string, overrides: Partial<RunResult> = {}) => {
  const result = aRun(overrides);
  seededRuns += 1;
  return db.insert(run).values({
    ...result,
    id: `seeded-${seededRuns}`,
    totalKills: totalKillsOf(result.kills),
    userId,
  });
};

/** A loss with `pawns` pawn kills and nothing else. */
const aLoss = (setupId: string, pawns: number): Partial<RunResult> => ({
  killedBy: "pawn",
  kills: { bishop: 0, king: 0, knight: 0, pawn: pawns, queen: 0, rook: 0 },
  outcome: "lost",
  setupId,
});

const boardFor = (setupId: string) =>
  Effect.runPromise(runs.leaderboard({ setupId }));

describe("setupIdsMeaning", () => {
  test("folds legacy ids into the setup they now mean", () => {
    const stored = ["skirmish", "easy", "medium", "hard"];
    expect(setupIdsMeaning("easy", stored).toSorted()).toEqual([
      "easy",
      "skirmish",
    ]);
    expect(setupIdsMeaning("skirmish", stored).toSorted()).toEqual([
      "easy",
      "skirmish",
    ]);
    expect(setupIdsMeaning("hard", stored)).toEqual(["hard"]);
  });

  test("always includes the setup's own id, even with no runs stored", () => {
    expect(setupIdsMeaning("medium", [])).toEqual(["medium"]);
  });
});

describe("distinctSetupIdsQuery", () => {
  test("lists each stored setup id once", async () => {
    const stored = ["hard", "skirmish", "easy", "hard", "nightmare"];
    await Promise.all(stored.map((setupId) => seedRun(USER_ID, { setupId })));
    const rows = await db.all<{ setupId: string }>(distinctSetupIdsQuery);
    expect(rows.map((row) => row.setupId)).toEqual([
      "easy",
      "hard",
      "nightmare",
      "skirmish",
    ]);
  });

  test("is empty when no run is stored", async () => {
    expect(await db.all(distinctSetupIdsQuery)).toEqual([]);
  });

  test("seeks the setup index instead of scanning every run", async () => {
    const plan = await db.all<{ detail: string }>(
      sql`explain query plan ${distinctSetupIdsQuery}`
    );
    const details = plan.map((step) => step.detail);
    expect(details.some((detail) => detail.startsWith("SEARCH run"))).toBe(
      true
    );
    expect(details.some((detail) => detail.startsWith("SCAN run"))).toBe(false);
  });
});

describe("RunRepository.leaderboard", () => {
  test("ranks wins and kills on the requested difficulty only", async () => {
    await addOtherUser();
    await seedRun(USER_ID, { gameTimeMs: 9000, setupId: "easy" });
    await seedRun(USER_ID, { gameTimeMs: 40_000, setupId: "hard" });
    await seedRun(OTHER_ID, { gameTimeMs: 30_000, setupId: "hard" });
    await seedRun(OTHER_ID, aLoss("medium", 6));

    const hard = await boardFor("hard");
    expect(
      hard.fastestWins.map((entry) => [entry.userId, entry.bestGameTimeMs])
    ).toEqual([
      [OTHER_ID, 30_000],
      [USER_ID, 40_000],
    ]);

    const easy = await boardFor("easy");
    expect(easy.fastestWins.map((entry) => entry.userId)).toEqual([USER_ID]);
    expect(easy.mostKills.map((entry) => entry.userId)).toEqual([USER_ID]);

    const medium = await boardFor("medium");
    expect(medium.fastestWins).toEqual([]);
    expect(medium.mostKills).toEqual([
      { games: 1, name: "Other", totalKills: 6, userId: OTHER_ID },
    ]);
  });

  test("counts legacy skirmish runs as Easy", async () => {
    await seedRun(USER_ID, { gameTimeMs: 8000, setupId: "skirmish" });
    await seedRun(USER_ID, { gameTimeMs: 9000, setupId: "easy" });
    await seedRun(USER_ID, aLoss("skirmish", 3));
    await seedRun(USER_ID, { gameTimeMs: 5000, setupId: "hard" });

    const easy = await boardFor("easy");
    expect(easy.fastestWins).toEqual([
      { bestGameTimeMs: 8000, name: "Player", userId: USER_ID, wins: 2 },
    ]);
    // Two wins of 4 kills each (aRun's default) plus the legacy loss's 3; the Hard win stays out.
    expect(easy.mostKills).toEqual([
      { games: 3, name: "Player", totalKills: 11, userId: USER_ID },
    ]);
    // Asking by the legacy id ranks the same board.
    expect(await boardFor("skirmish")).toEqual(easy);
    expect((await boardFor("hard")).fastestWins[0]?.bestGameTimeMs).toBe(5000);
  });

  test("an unknown difficulty has empty boards", async () => {
    await seedRun(USER_ID);
    expect(await boardFor("nightmare")).toEqual({
      fastestWins: [],
      mostKills: [],
    });
  });

  test("honours the limit on both boards", async () => {
    await addOtherUser();
    await seedRun(USER_ID, { gameTimeMs: 9000 });
    await seedRun(OTHER_ID, { gameTimeMs: 8000 });
    const board = await Effect.runPromise(
      runs.leaderboard({ limit: 1, setupId: "easy" })
    );
    expect(board.fastestWins.map((entry) => entry.userId)).toEqual([OTHER_ID]);
    expect(board.mostKills).toHaveLength(1);
  });
});

describe("RunRepository.statsForUser", () => {
  const statsOf = (userId: string) =>
    Effect.runPromise(runs.statsForUser(userId));

  test("reports the best win per difficulty, easiest first, legacy runs as Easy", async () => {
    await seedRun(USER_ID, { gameTimeMs: 8000, setupId: "skirmish" });
    await seedRun(USER_ID, { gameTimeMs: 9500, setupId: "easy" });
    await seedRun(USER_ID, aLoss("easy", 2));
    await seedRun(USER_ID, { gameTimeMs: 40_000, setupId: "hard" });
    await seedRun(USER_ID, aLoss("hard", 1));

    const stats = await statsOf(USER_ID);
    expect(stats.difficulties).toEqual([
      { bestWinGameTimeMs: 8000, games: 3, setupId: "easy", wins: 2 },
      { bestWinGameTimeMs: null, games: 0, setupId: "medium", wins: 0 },
      { bestWinGameTimeMs: 40_000, games: 2, setupId: "hard", wins: 1 },
    ]);
    expect(stats.bestWinGameTimeMs).toBe(8000);
    expect(stats.games).toBe(5);
    expect(stats.wins).toBe(3);
  });

  test("lists every difficulty before the first run", async () => {
    const stats = await statsOf(USER_ID);
    expect(stats.difficulties.map((entry) => entry.setupId)).toEqual([
      "easy",
      "medium",
      "hard",
    ]);
    expect(
      stats.difficulties.every(
        (entry) => entry.bestWinGameTimeMs === null && entry.games === 0
      )
    ).toBe(true);
  });

  test("ignores other players' runs", async () => {
    await addOtherUser();
    await seedRun(OTHER_ID, { gameTimeMs: 1000, setupId: "medium" });
    const stats = await statsOf(USER_ID);
    expect(stats.difficulties[1]).toEqual({
      bestWinGameTimeMs: null,
      games: 0,
      setupId: "medium",
      wins: 0,
    });
  });
});

describe("RunRepository.save: personal bests", () => {
  /** Saves a quick win and reports whether it was a personal best, clearing the rate limit after. */
  const personalBest = async (overrides: Partial<RunResult>) => {
    const saved = await Effect.runPromise(
      runs.save(USER_ID, aRun({ realTimeMs: 0, ...overrides }))
    );
    await backdateRuns(MIN_SAVE_INTERVAL_MS + 100);
    return saved.personalBest;
  };

  test("are kept per difficulty", async () => {
    expect(await personalBest({ gameTimeMs: 9000, setupId: "easy" })).toBe(
      true
    );
    // Slower than the Easy best, but the first Hard win.
    expect(await personalBest({ gameTimeMs: 30_000, setupId: "hard" })).toBe(
      true
    );
    expect(await personalBest({ gameTimeMs: 35_000, setupId: "hard" })).toBe(
      false
    );
    expect(await personalBest({ gameTimeMs: 8000, setupId: "easy" })).toBe(
      true
    );
  });

  test("count legacy skirmish wins as Easy", async () => {
    await seedRun(USER_ID, { gameTimeMs: 7000, setupId: "skirmish" });
    await backdateRuns(MIN_SAVE_INTERVAL_MS + 100);
    expect(await personalBest({ gameTimeMs: 7500, setupId: "easy" })).toBe(
      false
    );
    expect(await personalBest({ gameTimeMs: 6500, setupId: "easy" })).toBe(
      true
    );
  });
});
