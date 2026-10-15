/**
 * Seams — the points where behaviour can be swapped without editing the code that uses it.
 *
 * Every seam is an Effect 4 `Context.Service` with a `Default` layer. Layers are memoised when a
 * runtime is built, so each seam is a singleton per runtime: the client builds exactly one
 * `ManagedRuntime` (see @buckshot/engine `GameRuntime`) and every consumer shares the same instances.
 *
 * Future features plug in here rather than in the simulation:
 *   - upgrades / classes      → a different `Loadout` layer
 *   - variable white armies   → more entries in `SetupRegistry`
 *   - difficulty / run modifiers → `PieceCatalog` + `TimePolicy` layers per run floor
 *   - smarter enemies         → a different `PieceBrain`
 */
import { Context, Data, Effect, Layer } from "effect";
import { decidePieceAction } from "./brain";
import {
  DEFAULT_PIECE_CATALOG,
  DEFAULT_PLAYER,
  DEFAULT_SHOTGUN,
  DEFAULT_TIME_POLICY,
} from "./config";
import { mulberry32 } from "./random";
import { SETUPS, SKIRMISH_SETUP } from "./setups";
import { createSimulation, type Simulation } from "./simulation";
import { type TimeSignals, targetTimeScale } from "./time";
import type {
  GameConfig,
  PieceAction,
  PieceCatalogData,
  PieceDefinition,
  PieceKind,
  PieceState,
  PlayerStats,
  SetupDefinition,
  ShotgunStats,
  TimePolicyData,
  WorldState,
} from "./types";

export class UnknownSetupError extends Data.TaggedError("UnknownSetupError")<{
  readonly setupId: string;
}> {}

/** Seam: randomness. Production uses Math.random; tests and replays use a seeded generator. */
export class Rng extends Context.Service<
  Rng,
  { readonly next: () => number }
>()("@buckshot/core/Rng") {
  static readonly Default = Layer.sync(Rng, () => ({ next: Math.random }));
  static readonly seeded = (seed: number) =>
    Layer.sync(Rng, () => ({ next: mulberry32(seed) }));
}

/** Seam: per-piece stats (HP, cadence, telegraph length). */
export class PieceCatalog extends Context.Service<
  PieceCatalog,
  {
    readonly all: PieceCatalogData;
    readonly get: (kind: PieceKind) => PieceDefinition;
  }
>()("@buckshot/core/PieceCatalog") {
  static readonly Default = Layer.succeed(PieceCatalog, {
    all: DEFAULT_PIECE_CATALOG,
    get: (kind: PieceKind) => DEFAULT_PIECE_CATALOG[kind],
  });
}

/** Seam: the player's weapon + body stats (future upgrades/classes swap this). */
export class Loadout extends Context.Service<
  Loadout,
  { readonly shotgun: ShotgunStats; readonly player: PlayerStats }
>()("@buckshot/core/Loadout") {
  static readonly Default = Layer.succeed(Loadout, {
    player: DEFAULT_PLAYER,
    shotgun: DEFAULT_SHOTGUN,
  });
}

/** Seam: available white armies. */
export class SetupRegistry extends Context.Service<
  SetupRegistry,
  {
    readonly list: readonly SetupDefinition[];
    readonly get: (
      id: string
    ) => Effect.Effect<SetupDefinition, UnknownSetupError>;
  }
>()("@buckshot/core/SetupRegistry") {
  static readonly Default = Layer.succeed(SetupRegistry, {
    get: (id: string) => {
      const setup = SETUPS.find((candidate) => candidate.id === id);
      return setup
        ? Effect.succeed(setup)
        : Effect.fail(new UnknownSetupError({ setupId: id }));
    },
    list: SETUPS,
  });
}

/** Seam: how player activity maps to the flow of time (the SUPERHOT rule). */
export class TimePolicy extends Context.Service<
  TimePolicy,
  {
    readonly data: TimePolicyData;
    readonly target: (signals: TimeSignals) => number;
  }
>()("@buckshot/core/TimePolicy") {
  static readonly Default = Layer.succeed(TimePolicy, {
    data: DEFAULT_TIME_POLICY,
    target: (signals: TimeSignals) =>
      targetTimeScale(DEFAULT_TIME_POLICY, signals),
  });
}

/** Seam: enemy decision making. */
export class PieceBrain extends Context.Service<
  PieceBrain,
  {
    readonly decide: (
      world: WorldState,
      piece: PieceState,
      rng: () => number
    ) => PieceAction;
  }
>()("@buckshot/core/PieceBrain") {
  static readonly Default = Layer.succeed(PieceBrain, {
    decide: decidePieceAction,
  });
}

export interface CreateGameOptions {
  readonly setupId?: string;
}

/** Seam: assembles a playable simulation from all the other seams. */
export class GameFactory extends Context.Service<
  GameFactory,
  {
    readonly create: (
      options?: CreateGameOptions
    ) => Effect.Effect<Simulation, UnknownSetupError>;
  }
>()("@buckshot/core/GameFactory") {
  static readonly Default = Layer.effect(
    GameFactory,
    Effect.gen(function* () {
      const rng = yield* Rng;
      const catalog = yield* PieceCatalog;
      const loadout = yield* Loadout;
      const setups = yield* SetupRegistry;
      const timePolicy = yield* TimePolicy;
      const brain = yield* PieceBrain;

      const create = (options: CreateGameOptions = {}) =>
        Effect.gen(function* () {
          const setup = options.setupId
            ? yield* setups.get(options.setupId)
            : SKIRMISH_SETUP;
          const config: GameConfig = {
            pieces: catalog.all,
            player: loadout.player,
            setup,
            shotgun: loadout.shotgun,
            time: timePolicy.data,
          };
          return createSimulation(config, {
            decide: brain.decide,
            rng: rng.next,
            targetScale: timePolicy.target,
          });
        });

      return { create };
    })
  );
}

/** All core seams with their default (singleton) implementations. */
export const CoreLive = Layer.provideMerge(
  GameFactory.Default,
  Layer.mergeAll(
    Rng.Default,
    PieceCatalog.Default,
    Loadout.Default,
    SetupRegistry.Default,
    TimePolicy.Default,
    PieceBrain.Default
  )
);
