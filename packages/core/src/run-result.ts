import { Schema } from "effect";
import { PIECE_KINDS, type WorldState } from "./types";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PieceKindSchema = Schema.Literals(PIECE_KINDS);

/** The summary of one game that the client submits and the server persists. */
export const RunResult = Schema.Struct({
  distanceMoved: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  gameTimeMs: Count,
  killedBy: Schema.NullOr(PieceKindSchema),
  kills: Schema.Struct({
    bishop: Count,
    king: Count,
    knight: Count,
    pawn: Count,
    queen: Count,
    rook: Count,
  }),
  outcome: Schema.Literals(["won", "lost"]),
  pelletsFired: Count,
  pelletsHit: Count,
  realTimeMs: Count,
  setupId: Schema.String.check(Schema.isBetweenLength(1, 64)),
  shotsFired: Count,
});

export type RunResult = typeof RunResult.Type;

export const decodeRunResult = Schema.decodeUnknownEffect(RunResult);

/** Snapshot a finished world into a persistable result. */
export const toRunResult = (world: WorldState): RunResult => ({
  distanceMoved: Math.round(world.stats.distanceMoved * 100) / 100,
  gameTimeMs: Math.round(world.gameTime * 1000),
  killedBy: world.killedBy,
  kills: { ...world.stats.kills },
  outcome: world.status === "won" ? "won" : "lost",
  pelletsFired: world.stats.pelletsFired,
  pelletsHit: world.stats.pelletsHit,
  realTimeMs: Math.round(world.realTime * 1000),
  setupId: world.config.setup.id,
  shotsFired: world.stats.shotsFired,
});
