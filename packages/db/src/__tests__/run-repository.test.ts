import { beforeEach, describe, expect, test } from "bun:test";
import type { RunResult } from "@buckshot/core";
import { createClient } from "@libsql/client";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import type { DrizzleDb } from "../client";
import {
  MIN_SAVE_INTERVAL_MS,
  makeRunRepository,
  type RunRepositoryShape,
  SAVE_LATENCY_SLACK_MS,
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
  setupId: "skirmish",
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
