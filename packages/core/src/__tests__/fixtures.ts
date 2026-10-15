import { decidePieceAction } from "../brain";
import {
  DEFAULT_PIECE_CATALOG,
  DEFAULT_PLAYER,
  DEFAULT_SHOTGUN,
  DEFAULT_TIME_POLICY,
} from "../config";
import { squareCenter } from "../geometry";
import { mulberry32 } from "../random";
import { parseSquare } from "../setups";
import { createWorld, type SimulationDeps, stepWorld } from "../simulation";
import { targetTimeScale } from "../time";
import {
  type FrameInput,
  type GameConfig,
  type GameEvent,
  IDLE_INPUT,
  type PieceCatalogData,
  type PieceKind,
  type PieceState,
  type ShotgunStats,
  type WorldState,
} from "../types";

export const sq = parseSquare;

/** A standalone piece for rules/brain tests (name like "e4"). */
export const piece = (
  kind: PieceKind,
  square: string,
  overrides: Partial<PieceState> = {}
): PieceState => ({
  actionTimer: 10,
  fromSquare: sq(square),
  hitFlash: 0,
  hp: DEFAULT_PIECE_CATALOG[kind].maxHp,
  id: `${kind}-${square}`,
  isAttacking: false,
  kind,
  maxHp: DEFAULT_PIECE_CATALOG[kind].maxHp,
  moveProgress: 1,
  phase: "idle",
  square: sq(square),
  telegraphProgress: 0,
  ...overrides,
});

export interface ConfigOptions {
  readonly pieces?: Partial<PieceCatalogData>;
  readonly playerStart?: string;
  readonly shotgun?: Partial<ShotgunStats>;
  readonly white?: readonly (readonly [PieceKind, string])[];
}

/** Default stats with a custom army, so each test controls exactly what is on the board. */
export const makeConfig = (options: ConfigOptions = {}): GameConfig => ({
  pieces: { ...DEFAULT_PIECE_CATALOG, ...options.pieces },
  player: DEFAULT_PLAYER,
  setup: {
    description: "test",
    id: "test",
    name: "Test",
    playerStart: sq(options.playerStart ?? "e8"),
    white: (options.white ?? [["king", "a1"]]).map(([kind, square]) => ({
      kind,
      square: sq(square),
    })),
  },
  shotgun: { ...DEFAULT_SHOTGUN, ...options.shotgun },
  time: DEFAULT_TIME_POLICY,
});

export const waitBrain: SimulationDeps["decide"] = () => ({ type: "wait" });

export const makeDeps = (
  overrides: Partial<SimulationDeps> = {},
  seed = 1
): SimulationDeps => ({
  decide: decidePieceAction,
  rng: mulberry32(seed),
  targetScale: (signals) => targetTimeScale(DEFAULT_TIME_POLICY, signals),
  ...overrides,
});

/** Time always wants to run at full speed — for tests that need game time without walking. */
export const fullSpeed: SimulationDeps["targetScale"] = () => 1;

export const makeWorld = (options: ConfigOptions = {}, seed = 1): WorldState =>
  createWorld(makeConfig(options), mulberry32(seed));

/** A world with hand-placed pieces and the player standing on `playerSquare` (for brain tests). */
export const worldWith = (
  pieces: PieceState[],
  playerSquare: string
): WorldState => {
  const world = makeWorld();
  world.pieces = pieces;
  world.player.pos = squareCenter(sq(playerSquare));
  return world;
};

export const frame = (partial: Partial<FrameInput> = {}): FrameInput => ({
  ...IDLE_INPUT,
  ...partial,
});

export const FRAME = 1 / 60;

export interface RunOptions {
  readonly dt?: number;
  readonly input?: FrameInput | ((index: number) => FrameInput);
  readonly until?: (world: WorldState) => boolean;
}

/** Steps for `seconds` of real time and returns every event emitted along the way. */
export const run = (
  world: WorldState,
  deps: SimulationDeps,
  seconds: number,
  options: RunOptions = {}
): GameEvent[] => {
  const dt = options.dt ?? FRAME;
  const events: GameEvent[] = [];
  const frames = Math.round(seconds / dt);
  for (let index = 0; index < frames; index += 1) {
    const input =
      typeof options.input === "function"
        ? options.input(index)
        : (options.input ?? IDLE_INPUT);
    stepWorld(world, input, dt, deps);
    events.push(...world.events);
    if (options.until?.(world)) {
      break;
    }
  }
  return events;
};

export const eventsOfType = <T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T
): Extract<GameEvent, { type: T }>[] =>
  events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type
  );
