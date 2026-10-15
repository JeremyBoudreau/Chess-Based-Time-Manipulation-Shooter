import {
  type KillCounts,
  PIECE_KINDS,
  type PieceKind,
  type RunResult,
} from "@buckshot/core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  min,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { Context, Data, Effect, Layer } from "effect";
import { Database, type DrizzleDb } from "./client";
import { nowMs, type Run, run, user } from "./schema";

export class DbError extends Data.TaggedError("DbError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

/**
 * The user saved another run too recently for this one to have been played in between: either the
 * claimed real time does not fit since their previous save, or saves are arriving faster than any
 * game can end. Stops a signed-in client from replaying one plausible payload to farm the boards.
 */
export class RunTooSoon extends Data.TaggedError("RunTooSoon")<{
  readonly windowMs: number;
}> {}

export interface SavedRun {
  readonly id: string;
  /** True when this run is a win faster (in game-time) than every earlier win by the same user. */
  readonly personalBest: boolean;
}

export interface UserStats {
  /** pelletsHit / pelletsFired over every run, 0 when nothing was fired. */
  readonly accuracy: number;
  readonly bestWinGameTimeMs: number | null;
  /** The piece kind this user has killed most often. */
  readonly favouriteVictim: PieceKind | null;
  readonly games: number;
  readonly kills: KillCounts;
  readonly kingsKilled: number;
  readonly losses: number;
  /** The piece kind that has captured this user most often. */
  readonly nemesis: PieceKind | null;
  readonly totalKills: number;
  readonly wins: number;
}

export interface FastestWinEntry {
  readonly bestGameTimeMs: number;
  readonly name: string;
  readonly userId: string;
  readonly wins: number;
}

export interface MostKillsEntry {
  readonly games: number;
  readonly name: string;
  readonly totalKills: number;
  readonly userId: string;
}

export interface Leaderboard {
  readonly fastestWins: readonly FastestWinEntry[];
  readonly mostKills: readonly MostKillsEntry[];
}

export interface RunRepositoryShape {
  readonly leaderboard: (limit?: number) => Effect.Effect<Leaderboard, DbError>;
  readonly listForUser: (
    userId: string,
    limit?: number
  ) => Effect.Effect<readonly Run[], DbError>;
  /** Fails with RunTooSoon, writing nothing, when the run cannot fit since the user's last save. */
  readonly save: (
    userId: string,
    result: RunResult
  ) => Effect.Effect<SavedRun, DbError | RunTooSoon>;
  readonly statsForUser: (userId: string) => Effect.Effect<UserStats, DbError>;
}

const DEFAULT_LEADERBOARD_SIZE = 20;
const DEFAULT_RECENT_RUNS = 20;

/**
 * Real time only accrues while the game steps, so a run's `realTimeMs` never exceeds the wall-clock
 * time since the previous run ended. The previous save can land after the next run started,
 * though, when the player restarts instantly while that request is slow (a cold start); this much
 * of that overlap is forgiven.
 */
export const SAVE_LATENCY_SLACK_MS = 5000;

/**
 * Floor on the gap between two saves. Without it a payload claiming under the latency slack of
 * real time could be replayed back to back. No legitimate game ends this fast: White's first
 * action takes over two game-seconds and a win needs at least one reload.
 */
export const MIN_SAVE_INTERVAL_MS = 2000;

/** How far back a previous save blocks this one: the run's own duration, less the latency slack. */
export const saveWindowMs = (result: RunResult): number =>
  Math.max(result.realTimeMs - SAVE_LATENCY_SLACK_MS, MIN_SAVE_INTERVAL_MS);

/** Lifts a drizzle promise into Effect so every query fails the same, typed way. */
const query = <A>(operation: string, execute: () => PromiseLike<A>) =>
  Effect.tryPromise({
    catch: (cause) => new DbError({ cause, operation }),
    try: () => Promise.resolve(execute()),
  });

/** Sum of every piece kind's kill count; denormalised into `run.totalKills` for cheap ranking. */
export const totalKillsOf = (kills: KillCounts): number =>
  PIECE_KINDS.reduce((sum, kind) => sum + kills[kind], 0);

/** First win always counts; later wins only when strictly faster than the stored best. */
export const isPersonalBest = (
  result: RunResult,
  previousBestMs: number | null
): boolean =>
  result.outcome === "won" &&
  (previousBestMs === null || result.gameTimeMs < previousBestMs);

/** The key with the highest positive count, or null when everything is zero. */
const argMax = (counts: KillCounts): PieceKind | null => {
  let best: PieceKind | null = null;
  for (const kind of PIECE_KINDS) {
    if (counts[kind] > (best === null ? 0 : counts[best])) {
      best = kind;
    }
  }
  return best;
};

/** `sum(json_extract(kills, '$.<kind>'))` for one kind — kills are stored as a JSON object. */
const sumKillsOf = (kind: PieceKind) =>
  sql<number>`coalesce(sum(json_extract(${run.kills}, ${`$.${kind}`})), 0)`.mapWith(
    Number
  );

const killSumColumns = Object.fromEntries(
  PIECE_KINDS.map((kind) => [kind, sumKillsOf(kind)])
);

const toKillCounts = (row: Record<string, unknown>): KillCounts => {
  const counts = {} as Record<PieceKind, number>;
  for (const kind of PIECE_KINDS) {
    counts[kind] = Number(row[kind] ?? 0);
  }
  return counts;
};

/** A column paired with its value, encoded the way drizzle's insert builder would (JSON, etc.). */
const cell = (column: AnySQLiteColumn, value: unknown) =>
  [column, sql.param(value, column)] as const;

/** Builds the repository against a concrete drizzle client. */
export const makeRunRepository = (db: DrizzleDb): RunRepositoryShape => {
  const bestWinMs = (userId: string) =>
    query("bestWin", () =>
      db
        .select({ best: min(run.gameTimeMs) })
        .from(run)
        .where(and(eq(run.userId, userId), eq(run.outcome, "won")))
    ).pipe(Effect.map((rows) => rows[0]?.best ?? null));

  const save = Effect.fn("RunRepository.save")(function* (
    userId: string,
    result: RunResult
  ) {
    const previousBest =
      result.outcome === "won" ? yield* bestWinMs(userId) : null;
    const id = crypto.randomUUID();
    const windowMs = saveWindowMs(result);
    const cells: readonly (readonly [AnySQLiteColumn, SQLWrapper])[] = [
      [run.createdAt, nowMs],
      cell(run.distanceMoved, result.distanceMoved),
      cell(run.gameTimeMs, result.gameTimeMs),
      cell(run.id, id),
      cell(run.killedBy, result.killedBy),
      cell(run.kills, result.kills),
      cell(run.outcome, result.outcome),
      cell(run.pelletsFired, result.pelletsFired),
      cell(run.pelletsHit, result.pelletsHit),
      cell(run.realTimeMs, result.realTimeMs),
      cell(run.setupId, result.setupId),
      cell(run.shotsFired, result.shotsFired),
      cell(run.totalKills, totalKillsOf(result.kills)),
      cell(run.userId, userId),
    ];
    /*
     * One statement, so the "no recent save" check and the insert are atomic: SQLite takes the write
     * lock before evaluating the subquery, and parallel requests cannot all see the same last run.
     * drizzle's insert builder has no conditional form, hence the raw SQL.
     */
    const inserted = yield* query("insertRun", () =>
      db.run(sql`
        insert into ${run} (${sql.join(
          cells.map(([column]) => sql.identifier(column.name)),
          sql`, `
        )})
        select ${sql.join(
          cells.map(([, value]) => value),
          sql`, `
        )}
        where not exists (
          select 1 from ${run}
          where ${run.userId} = ${userId}
            and ${run.createdAt} > ${nowMs} - ${windowMs}
        )
      `)
    );
    if (inserted.rowsAffected === 0) {
      return yield* new RunTooSoon({ windowMs });
    }
    return { id, personalBest: isPersonalBest(result, previousBest) };
  });

  const listForUser = (userId: string, limit = DEFAULT_RECENT_RUNS) =>
    query("listForUser", () =>
      db
        .select()
        .from(run)
        .where(eq(run.userId, userId))
        .orderBy(desc(run.createdAt))
        .limit(limit)
    );

  const statsForUser = Effect.fn("RunRepository.statsForUser")(function* (
    userId: string
  ) {
    const [totals] = yield* query("statsTotals", () =>
      db
        .select({
          ...killSumColumns,
          bestWin: sql<
            number | null
          >`min(case when ${run.outcome} = 'won' then ${run.gameTimeMs} end)`,
          games: count(),
          pelletsFired:
            sql<number>`coalesce(sum(${run.pelletsFired}), 0)`.mapWith(Number),
          pelletsHit: sql<number>`coalesce(sum(${run.pelletsHit}), 0)`.mapWith(
            Number
          ),
          totalKills: sql<number>`coalesce(sum(${run.totalKills}), 0)`.mapWith(
            Number
          ),
          wins: sql<number>`coalesce(sum(case when ${run.outcome} = 'won' then 1 else 0 end), 0)`.mapWith(
            Number
          ),
        })
        .from(run)
        .where(eq(run.userId, userId))
    );
    const [nemesisRow] = yield* query("statsNemesis", () =>
      db
        .select({ kind: run.killedBy, times: count() })
        .from(run)
        .where(and(eq(run.userId, userId), isNotNull(run.killedBy)))
        .groupBy(run.killedBy)
        .orderBy(desc(count()))
        .limit(1)
    );

    const games = totals?.games ?? 0;
    const wins = totals?.wins ?? 0;
    const pelletsFired = totals?.pelletsFired ?? 0;
    const kills = toKillCounts(totals ?? {});
    const stats: UserStats = {
      accuracy: pelletsFired > 0 ? (totals?.pelletsHit ?? 0) / pelletsFired : 0,
      bestWinGameTimeMs:
        totals?.bestWin === null || totals?.bestWin === undefined
          ? null
          : Number(totals.bestWin),
      favouriteVictim: argMax(kills),
      games,
      kills,
      kingsKilled: kills.king,
      losses: games - wins,
      nemesis: nemesisRow?.kind ?? null,
      totalKills: totals?.totalKills ?? 0,
      wins,
    };
    return stats;
  });

  const leaderboard = Effect.fn("RunRepository.leaderboard")(function* (
    limit: number = DEFAULT_LEADERBOARD_SIZE
  ) {
    const bestTime = min(run.gameTimeMs);
    const fastestWins = yield* query("fastestWins", () =>
      db
        .select({
          bestGameTimeMs: sql<number>`${bestTime}`.mapWith(Number),
          name: user.name,
          userId: run.userId,
          wins: count(),
        })
        .from(run)
        .innerJoin(user, eq(user.id, run.userId))
        .where(eq(run.outcome, "won"))
        .groupBy(run.userId, user.name)
        .orderBy(asc(bestTime))
        .limit(limit)
    );

    const killSum = sql<number>`sum(${run.totalKills})`.mapWith(Number);
    const mostKills = yield* query("mostKills", () =>
      db
        .select({
          games: count(),
          name: user.name,
          totalKills: killSum,
          userId: run.userId,
        })
        .from(run)
        .innerJoin(user, eq(user.id, run.userId))
        .groupBy(run.userId, user.name)
        .having(sql`sum(${run.totalKills}) > 0`)
        .orderBy(desc(killSum))
        .limit(limit)
    );

    const board: Leaderboard = { fastestWins, mostKills };
    return board;
  });

  return { leaderboard, listForUser, save, statsForUser };
};

/** Seam: persistence for finished runs, stats and leaderboards. */
export class RunRepository extends Context.Service<
  RunRepository,
  RunRepositoryShape
>()("@buckshot/db/RunRepository") {
  /** Needs a `Database` from the surrounding layer graph. */
  static readonly layer = Layer.effect(
    RunRepository,
    Effect.gen(function* () {
      const { db } = yield* Database;
      return makeRunRepository(db);
    })
  );

  /** Self-contained: wired to the process-wide singleton database. */
  static readonly Default = Layer.provide(
    RunRepository.layer,
    Database.Default
  );
}

/** Every db seam (Database + RunRepository) with default implementations. */
export const DbLive = Layer.provideMerge(RunRepository.layer, Database.Default);
