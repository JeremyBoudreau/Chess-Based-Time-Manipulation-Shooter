import {
  CoreLive,
  type CreateGameOptions,
  GameFactory,
  type Simulation,
} from "@buckshot/core";
import { Effect, ManagedRuntime } from "effect";

/**
 * The client's single Effect runtime. Building it memoises every core seam layer, so the whole
 * browser session shares one instance of each seam (the "singleton seam" rule).
 */
export const GameRuntime = ManagedRuntime.make(CoreLive);

/** Create a fresh simulation through the GameFactory seam. All core layers are synchronous. */
export const createGame = (options?: CreateGameOptions): Simulation =>
  GameRuntime.runSync(
    Effect.gen(function* () {
      const factory = yield* GameFactory;
      return yield* factory.create(options);
    })
  );
