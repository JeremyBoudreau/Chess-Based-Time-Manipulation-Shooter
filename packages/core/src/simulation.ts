import type { TimeSignals } from "./time";
import type {
  FrameInput,
  GameConfig,
  PieceAction,
  PieceState,
  WorldState,
} from "./types";

export interface SimulationDeps {
  readonly decide: (
    world: WorldState,
    piece: PieceState,
    rng: () => number
  ) => PieceAction;
  readonly rng: () => number;
  readonly targetScale: (signals: TimeSignals) => number;
}

/** A running game. `step` mutates and returns `world` (no per-frame allocation of the whole state). */
export interface Simulation {
  step(input: FrameInput, realDt: number): WorldState;
  readonly world: WorldState;
}

export const createWorld = (
  _config: GameConfig,
  _rng: () => number
): WorldState => {
  throw new Error("not implemented");
};

export const stepWorld = (
  _world: WorldState,
  _input: FrameInput,
  _realDt: number,
  _deps: SimulationDeps
): WorldState => {
  throw new Error("not implemented");
};

export const createSimulation = (
  config: GameConfig,
  deps: SimulationDeps
): Simulation => {
  const world = createWorld(config, deps.rng);
  return {
    step: (input, realDt) => stepWorld(world, input, realDt, deps),
    world,
  };
};
