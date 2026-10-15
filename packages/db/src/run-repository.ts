import {
  type KillCounts,
  PIECE_KINDS,
  type PieceKind,
  type RunResult,
} from "@buckshot/core";
import { and, asc, count, desc, eq, isNotNull, min, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";
import { Database, type DrizzleDb } from "./client";
import { type Run, run, user } from "./schema";

export class DbError extends Data.TaggedError("DbError")<{
  readonly operation: string;
  readonly cause: unknown;
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
  readonly save: (
    userId: string,
    result: RunResult
  ) => Effect.Effect<SavedRun, DbError>;
  readonly statsForUser: (userId: string) => Effect.Effect<UserStats, DbError>;
}

const DEFAULT_LEADERBOARD_SIZE = 20;
const DEFAULT_RECENT_RUNS = 20;

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
    yield* query("insertRun", () =>
      db.insert(run).values({
        distanceMoved: result.distanceMoved,
        gameTimeMs: result.gameTimeMs,
        id,
        killedBy: result.killedBy,
        kills: result.kills,
        outcome: result.outcome,
        pelletsFired: result.pelletsFired,
        pelletsHit: result.pelletsHit,
        realTimeMs: result.realTimeMs,
        setupId: result.setupId,
        shotsFired: result.shotsFired,
        totalKills: totalKillsOf(result.kills),
        userId,
      })
    );
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
