import {
  type GameStatus,
  PIECE_KINDS,
  type PieceKind,
  type RunResult,
  squareAt,
  squareKey,
  threatenedSquares,
  type WorldState,
} from "@buckshot/core";

/**
 * Everything the React HUD shows, already rounded/quantised. Plain data so React can compare it
 * by reference: the store only hands out a new object when one of these values changes.
 */
export interface HudSnapshot {
  /** Shells the gun holds. */
  readonly capacity: number;
  /** True when a shot fired now would leave the barrel (crosshair "+" vs "x"). */
  readonly fireReady: boolean;
  /** Game-seconds, rounded to 0.1 s. */
  readonly gameTime: number;
  readonly killedBy: PieceKind | null;
  /** Total white pieces killed this run. */
  readonly kills: number;
  /** Set once per game over; the same object passed to `onGameOver`. */
  readonly lastResult: RunResult | null;
  readonly loaded: number;
  /** Pointer not locked while the game is still being played. */
  readonly paused: boolean;
  /** Shell boxes lying on the board (the only way to refill the reserve). */
  readonly pickupsOnBoard: number;
  /** Living white pieces. */
  readonly piecesLeft: number;
  /** The king stands on a square a telegraphing piece will hit when it acts: move! */
  readonly playerThreatened: boolean;
  /** Reload progress 0..1, or null when not reloading. */
  readonly reloadProgress: number | null;
  readonly reserve: number;
  readonly reserveMax: number;
  /** Shift held while actually moving: time is running faster than real time. */
  readonly sprinting: boolean;
  readonly status: GameStatus;
  /** World time scale rounded to 0.01 (above 1 while sprinting). */
  readonly timeScale: number;
  readonly whiteKingHp: number | null;
  readonly whiteKingMaxHp: number | null;
}

export const INITIAL_HUD_SNAPSHOT: HudSnapshot = {
  capacity: 2,
  fireReady: false,
  gameTime: 0,
  killedBy: null,
  kills: 0,
  lastResult: null,
  loaded: 2,
  paused: true,
  pickupsOnBoard: 0,
  piecesLeft: 0,
  playerThreatened: false,
  reloadProgress: null,
  reserve: 0,
  reserveMax: 0,
  sprinting: false,
  status: "playing",
  timeScale: 0,
  whiteKingHp: null,
  whiteKingMaxHp: null,
};

/** Client-side state that is not part of the world. */
export interface HudExtras {
  readonly paused: boolean;
}

/**
 * Progress bars are quantised so a 60 fps loop produces at most ~20 React renders per bar fill
 * instead of one per frame.
 */
const PROGRESS_STEPS = 20;

const quantise = (value: number, steps: number): number =>
  Math.round(Math.min(1, Math.max(0, value)) * steps) / steps;

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

type Listener = () => void;

/**
 * A minimal external store for `useSyncExternalStore`. The game loop calls `update` every frame;
 * subscribers are only notified (and the snapshot only replaced) when a visible value changed,
 * so React re-renders a handful of times per second instead of 60.
 */
export class HudStore {
  private snapshot: HudSnapshot = INITIAL_HUD_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private lastResult: RunResult | null = null;

  /** Bound so it can be passed straight to `useSyncExternalStore`. */
  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Bound so it can be passed straight to `useSyncExternalStore`. */
  readonly getSnapshot = (): HudSnapshot => this.snapshot;

  /** Record the finished run so the results screen can read it from the same snapshot. */
  setLastResult(result: RunResult | null): void {
    this.lastResult = result;
  }

  update(world: WorldState, extras: HudExtras): void {
    this.commit(computeSnapshot(world, extras, this.lastResult));
  }

  /** Back to defaults (after a restart, before the first frame of the new game). */
  reset(): void {
    this.lastResult = null;
  }

  private commit(next: HudSnapshot): void {
    if (shallowEqual(this.snapshot, next)) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const computeSnapshot = (
  world: WorldState,
  extras: HudExtras,
  lastResult: RunResult | null
): HudSnapshot => {
  const { player, config } = world;
  const { shotgun } = config;
  const playing = world.status === "playing";
  const reloading = player.reloadTimer > 0;
  const king = world.pieces.find((piece) => piece.kind === "king");
  const kingAlive = king !== undefined && king.phase !== "dead";
  return {
    capacity: shotgun.capacity,
    fireReady:
      playing &&
      player.alive &&
      player.loaded > 0 &&
      !reloading &&
      player.fireCooldown <= 0,
    gameTime: roundTo(world.gameTime, 1),
    killedBy: world.killedBy,
    kills: totalKills(world),
    lastResult,
    loaded: player.loaded,
    paused: extras.paused,
    pickupsOnBoard: world.pickups.length,
    piecesLeft: world.pieces.filter((piece) => piece.phase !== "dead").length,
    playerThreatened: playing && isPlayerThreatened(world),
    reloadProgress: reloading
      ? quantise(
          1 - player.reloadTimer / shotgun.reloadDuration,
          PROGRESS_STEPS
        )
      : null,
    reserve: player.reserve,
    reserveMax: shotgun.reserveMax,
    sprinting: playing && player.sprinting,
    status: world.status,
    timeScale: roundTo(world.timeScale, 2),
    whiteKingHp: king ? Math.max(0, kingAlive ? king.hp : 0) : null,
    whiteKingMaxHp: king ? king.maxHp : null,
  };
};

const totalKills = (world: WorldState): number => {
  let total = 0;
  for (const kind of PIECE_KINDS) {
    total += world.stats.kills[kind];
  }
  return total;
};

const isPlayerThreatened = (world: WorldState): boolean => {
  const here = squareKey(squareAt(world.player.pos));
  return threatenedSquares(world).some((square) => squareKey(square) === here);
};

const shallowEqual = (a: HudSnapshot, b: HudSnapshot): boolean => {
  for (const key of Object.keys(a) as (keyof HudSnapshot)[]) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};
