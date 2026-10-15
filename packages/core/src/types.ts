/**
 * Domain types for Buckshot Gambit.
 *
 * Board space: `x` runs along files (a→h = 0→8), `y` runs along ranks (1→8 = 0→8).
 * Square (file f, rank r) covers [f, f+1) × [r, r+1); its centre is (f + 0.5, r + 0.5).
 * White starts on ranks 1–2 (low y), the black king (the player) starts on e8 (high y).
 *
 * Yaw convention (matches a three.js camera with rotation order "YXZ"):
 *   forward(yaw) = { x: -sin(yaw), y: cos(yaw) }, right(yaw) = { x: cos(yaw), y: sin(yaw) }.
 *   yaw = π faces rank 1 (towards White). Positive yaw delta turns left.
 */

export type PieceKind =
  | "pawn"
  | "knight"
  | "bishop"
  | "rook"
  | "queen"
  | "king";

export const PIECE_KINDS: readonly PieceKind[] = [
  "pawn",
  "knight",
  "bishop",
  "rook",
  "queen",
  "king",
];

/** Integer board coordinate: file 0..7 (a..h), rank 0..7 (1..8). */
export interface Square {
  readonly file: number;
  readonly rank: number;
}

/** Continuous board-space point or direction. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Lifecycle of a white piece:
 * idle → telegraph (shaking + blinking red) → moving (animating to `square`) → idle …
 * dead pieces stay in the array (for shatter effects) but are ignored by rules.
 */
export type PiecePhase = "idle" | "telegraph" | "moving" | "dead";

export interface PieceState {
  /** Game-seconds until this piece acts. Telegraph starts when it drops below the telegraph duration. */
  actionTimer: number;
  /** Square the current/last move started from (renderer interpolates fromSquare → square). */
  fromSquare: Square;
  /** Game-seconds of white "hit flash" remaining. */
  hitFlash: number;
  hp: number;
  readonly id: string;
  /** True while performing the lethal capture move onto the king's square. */
  isAttacking: boolean;
  /** Mutable so a pawn can promote. */
  kind: PieceKind;
  maxHp: number;
  /** 0..1 progress of the current move animation (1 = arrived). */
  moveProgress: number;
  phase: PiecePhase;
  /** Logical square. Updated the instant a move starts, so rules never see a piece "between" squares. */
  square: Square;
  /** 0..1 progress through the telegraph window (drives shake + red blink intensity). */
  telegraphProgress: number;
}

export interface PelletState {
  alive: boolean;
  /** Unit direction in board space. */
  readonly dir: Vec2;
  readonly id: number;
  readonly origin: Vec2;
  /** Current board-space position. */
  pos: Vec2;
  /**
   * Position at the previous step (renderer uses origin→pos for trails). Until the first non-zero
   * step it holds the player's centre, so the simulation collision-checks player → muzzle too.
   */
  prevPos: Vec2;
  /** Board units travelled so far. */
  traveled: number;
}

export interface PlayerState {
  alive: boolean;
  /** Real seconds until the gun can fire again. */
  fireCooldown: number;
  /** Shells in the gun (0..capacity). */
  loaded: number;
  /** Radians, clamped by the config. Purely cosmetic for the simulation (shots are horizontal). */
  pitch: number;
  pos: Vec2;
  /** Game-seconds of reload remaining; 0 when not reloading. */
  reloadTimer: number;
  /** Shells in reserve (0..reserveMax). */
  reserve: number;
  /** True while sprint is held AND the king is actually moving (drives time scale, FOV kick, HUD). */
  sprinting: boolean;
  /** Board units per real second (actual velocity after collisions). */
  velocity: Vec2;
  /** Radians, see file header for convention. */
  yaw: number;
}

/**
 * A shell box lying on an empty square. Walking onto its square collects it (if the reserve has
 * room); any white piece moving onto or sliding across its square crushes it.
 */
export interface PickupState {
  /** Game-seconds since it appeared (renderer uses it for the drop-in animation). */
  age: number;
  readonly id: number;
  /** Shells added to the reserve when collected. */
  readonly shells: number;
  readonly square: Square;
}

export type GameStatus = "playing" | "won" | "lost";

export type GameEvent =
  | { readonly type: "shot"; readonly pellets: number }
  | { readonly type: "dryFire" }
  | { readonly type: "reloadStart" }
  | { readonly type: "reloadEnd"; readonly loaded: number }
  | {
      readonly type: "pickupSpawned";
      readonly pickupId: number;
      readonly square: Square;
    }
  | {
      readonly type: "pickupCollected";
      readonly pickupId: number;
      readonly square: Square;
      /** Shells actually added (may be fewer than the box held if the reserve was nearly full). */
      readonly shells: number;
      readonly reserve: number;
    }
  | {
      readonly type: "pickupCrushed";
      readonly pickupId: number;
      readonly square: Square;
      readonly pieceId: string;
    }
  | {
      readonly type: "pieceHit";
      readonly pieceId: string;
      readonly kind: PieceKind;
      readonly square: Square;
      readonly hp: number;
    }
  | {
      readonly type: "pieceKilled";
      readonly pieceId: string;
      readonly kind: PieceKind;
      readonly square: Square;
    }
  | { readonly type: "pieceTelegraph"; readonly pieceId: string }
  | {
      readonly type: "pieceMoved";
      readonly pieceId: string;
      readonly from: Square;
      readonly to: Square;
    }
  | {
      readonly type: "piecePromoted";
      readonly pieceId: string;
      readonly to: PieceKind;
    }
  | {
      readonly type: "kingCaptured";
      readonly pieceId: string;
      readonly kind: PieceKind;
    }
  | { readonly type: "victory" }
  | { readonly type: "pelletExpired"; readonly pelletId: number };

export type KillCounts = Record<PieceKind, number>;

export interface RunStats {
  /** Board units walked. */
  distanceMoved: number;
  kills: KillCounts;
  pelletsFired: number;
  pelletsHit: number;
  /** Shells picked up from the board (reserve gained). */
  shellsCollected: number;
  shotsFired: number;
}

/** Per-frame input sampled by the client. All fields are for this frame only. */
export interface FrameInput {
  /** Fire pressed this frame (edge-triggered). */
  readonly fire: boolean;
  /** Radians to add to pitch this frame (positive = look up). */
  readonly lookPitch: number;
  /** Radians to add to yaw this frame (positive = turn left). */
  readonly lookYaw: number;
  /** Strafe, -1 (left) .. 1 (right). */
  readonly moveX: number;
  /** Forward/back, -1 (back) .. 1 (forward). */
  readonly moveY: number;
  /** Reload pressed this frame (edge-triggered). */
  readonly reload: boolean;
  /** Sprint held (Shift): faster legs, and time runs faster than real time. */
  readonly sprint: boolean;
}

export const IDLE_INPUT: FrameInput = {
  fire: false,
  lookPitch: 0,
  lookYaw: 0,
  moveX: 0,
  moveY: 0,
  reload: false,
  sprint: false,
};

export interface PieceDefinition {
  /** Mean game-seconds between actions. */
  readonly actionInterval: number;
  /** ± fraction of `actionInterval` applied randomly after each action (0.25 = ±25%). */
  readonly intervalJitter: number;
  readonly kind: PieceKind;
  readonly maxHp: number;
  /** Game-seconds the move animation takes. */
  readonly moveDuration: number;
  /** Game-seconds of shaking/blinking before acting. */
  readonly telegraphDuration: number;
}

export type PieceCatalogData = Readonly<Record<PieceKind, PieceDefinition>>;

export interface ShotgunStats {
  /** Shells the gun holds. */
  readonly capacity: number;
  readonly damagePerPellet: number;
  /** Real seconds between shots. */
  readonly fireCooldown: number;
  /** Board units before a pellet disappears. */
  readonly pelletRange: number;
  /** Board units per game-second (constant). */
  readonly pelletSpeed: number;
  /** Pellets per shot. */
  readonly pellets: number;
  /** Game-seconds for a full reload (time runs at full speed while reloading). */
  readonly reloadDuration: number;
  /** Max reserve shells. Shells only come back by collecting pickups from the board. */
  readonly reserveMax: number;
  readonly reserveStart: number;
  /** Half-angle of the horizontal spread, in degrees. */
  readonly spreadDegrees: number;
  /** Extra per-pellet random jitter as a fraction of one stratified bin (1 = pellets may wander a full bin). */
  readonly spreadJitter: number;
}

export interface PlayerStats {
  readonly maxPitch: number;
  /** Board units per real second. */
  readonly moveSpeed: number;
  /** Collision radius in board units. */
  readonly radius: number;
}

/** How shell pickups appear on the board (replaces passive reserve regeneration). */
export interface PickupRules {
  /** Pickups already on the board when the game starts. */
  readonly initialPickups: number;
  /** How much faster the spawn clock runs while the king is that low (2 = twice the rate). */
  readonly lowAmmoSpawnRate: number;
  /** At or below this many shells (loaded + reserve) the spawn clock speeds up. */
  readonly lowAmmoThreshold: number;
  /** Never more than this many pickups on the board at once. */
  readonly maxOnBoard: number;
  /** Minimum Chebyshev distance (in squares) from the king's square for a new pickup. */
  readonly minSpawnDistance: number;
  /** Shells in each pickup. */
  readonly shellsPerPickup: number;
  /** Mean game-seconds between spawn attempts. */
  readonly spawnInterval: number;
  /** ± fraction of `spawnInterval` applied randomly after each attempt. */
  readonly spawnJitter: number;
}

export interface TimePolicyData {
  /** Time scale while completely still (SUPERHOT never fully freezes; 0 = hard freeze). */
  readonly idleScale: number;
  /** Camera angular speed (rad/real s) that counts as "full speed" time. */
  readonly lookFullSpeed: number;
  /** Max time scale contributed by camera movement alone. */
  readonly lookMaxScale: number;
  /** Added to the time scale while reloading (a still reload runs at exactly this speed). */
  readonly reloadBonus: number;
  /** How far reloading lifts the activity cap (walk + reload = 1 + this, sprint + reload = sprintScale + this). */
  readonly reloadCapBonus: number;
  /** Exponential smoothing rate (1/s) towards the target scale. */
  readonly responsiveness: number;
  /** Real seconds of full-speed time after each shot (recoil "kick"). */
  readonly shotBurst: number;
  /**
   * The sprint factor, shared by legs and clock: Shift moves the king `sprintScale`× faster than
   * walking, and because the clock's leg term IS speed ÷ walking speed, a full sprint runs the world
   * `sprintScale`× faster than real time too. One knob, so sprint speed and time can never drift.
   */
  readonly sprintScale: number;
}

export interface SetupPiece {
  readonly kind: PieceKind;
  readonly square: Square;
}

export interface SetupDefinition {
  readonly description: string;
  readonly id: string;
  readonly name: string;
  readonly playerStart: Square;
  readonly white: readonly SetupPiece[];
}

/** Everything needed to start a game. Seams resolve each part (catalog, loadout, setup, time policy). */
export interface GameConfig {
  readonly pickups: PickupRules;
  readonly pieces: PieceCatalogData;
  readonly player: PlayerStats;
  readonly setup: SetupDefinition;
  readonly shotgun: ShotgunStats;
  readonly time: TimePolicyData;
}

export interface WorldState {
  readonly config: GameConfig;
  /** Events produced by the most recent step only (cleared at the start of each step). */
  events: GameEvent[];
  /** Accumulated game-seconds (only advances when the player acts). */
  gameTime: number;
  /** Set when the king is captured. */
  killedBy: PieceKind | null;
  nextPelletId: number;
  nextPickupId: number;
  pellets: PelletState[];
  /** Shell boxes currently on the board. */
  pickups: PickupState[];
  /** Game-seconds until the next pickup spawn attempt. */
  pickupTimer: number;
  pieces: PieceState[];
  player: PlayerState;
  /** Accumulated real seconds. */
  realTime: number;
  /** Real seconds of shot burst remaining. */
  shotBurstRemaining: number;
  stats: RunStats;
  status: GameStatus;
  /** Current time scale, 0..time.sprintScale (smoothed). */
  timeScale: number;
}

/** What a piece decides to do when its action timer fires. */
export type PieceAction =
  | { readonly type: "attack"; readonly to: Square }
  | { readonly type: "move"; readonly to: Square }
  | { readonly type: "wait" };
