import {
  BOARD_SIZE,
  clamp,
  forward,
  isOnBoard,
  right,
  sameSquare,
  squareAt,
  squareCenter,
  squareKey,
} from "./geometry";
import { buildOccupancy, type Occupancy } from "./rules";
import { pelletAngles, traverseSquares } from "./shotgun";
import type { TimeSignals } from "./time";
import type {
  FrameInput,
  GameConfig,
  PelletState,
  PieceAction,
  PieceDefinition,
  PieceState,
  SetupPiece,
  Square,
  Vec2,
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
  readonly step: (input: FrameInput, realDt: number) => WorldState;
  readonly world: WorldState;
}

/** Longest real step simulated at once, so a stalled tab cannot skip a telegraph or teleport pellets. */
const MAX_STEP = 0.1;
/** Piece colliders cover the piece's footprint rather than the whole tile. */
const PIECE_INSET = 0.12;
/** Pellets spawn at the barrel, not inside the player's head. */
const MUZZLE_OFFSET = 0.25;
const HIT_FLASH_DURATION = 0.18;
/** Every piece gets at least this many game-seconds (plus a random share of its interval) before its first telegraph. */
const FIRST_ACTION_GRACE = 1;
const FIRST_ACTION_SPREAD = 1.5;
const PROMOTION_RANK = BOARD_SIZE - 1;
/** Pushing out of one collider can push into a neighbour; a second pass settles it. */
const COLLISION_PASSES = 2;
/**
 * Longest player move resolved at once, as a fraction of the player's radius. The gap between two
 * side-by-side pieces' colliders (2 × PIECE_INSET) is narrower than the player, but one long hitch
 * frame could push the circle past it and the push-out passes would then bounce it between the two
 * boxes instead of back out. Sub-stepping keeps every collision step short enough to settle.
 */
const MAX_SUBSTEP_RADIUS_FRACTION = 0.5;
const RANGE_EPSILON = 1e-9;

interface Box {
  readonly maxX: number;
  readonly maxY: number;
  readonly minX: number;
  readonly minY: number;
}

interface PelletContext {
  readonly occupancy: Occupancy;
  readonly playerSquare: Square;
}

const createPiece = (
  entry: SetupPiece,
  index: number,
  config: GameConfig,
  rng: () => number
): PieceState => {
  const definition = config.pieces[entry.kind];
  return {
    actionTimer:
      definition.telegraphDuration +
      FIRST_ACTION_GRACE +
      rng() * definition.actionInterval * FIRST_ACTION_SPREAD,
    fromSquare: entry.square,
    hitFlash: 0,
    hp: definition.maxHp,
    id: `${entry.kind}-${index}`,
    isAttacking: false,
    kind: entry.kind,
    maxHp: definition.maxHp,
    moveProgress: 1,
    phase: "idle",
    square: entry.square,
    telegraphProgress: 0,
  };
};

/**
 * A fresh game: the player stands on the setup's start square facing White, and each piece's first
 * action is staggered randomly so the army does not move in lockstep.
 */
export const createWorld = (
  config: GameConfig,
  rng: () => number
): WorldState => ({
  config,
  events: [],
  gameTime: 0,
  killedBy: null,
  nextPelletId: 1,
  pellets: [],
  pieces: config.setup.white.map((entry, index) =>
    createPiece(entry, index, config, rng)
  ),
  player: {
    alive: true,
    fireCooldown: 0,
    loaded: config.shotgun.capacity,
    pitch: 0,
    pos: squareCenter(config.setup.playerStart),
    regenTimer: config.shotgun.reserveRegenInterval,
    reloadTimer: 0,
    reserve: config.shotgun.reserveStart,
    velocity: { x: 0, y: 0 },
    yaw: Math.PI,
  },
  realTime: 0,
  shotBurstRemaining: 0,
  stats: {
    distanceMoved: 0,
    kills: { bishop: 0, king: 0, knight: 0, pawn: 0, queen: 0, rook: 0 },
    pelletsFired: 0,
    pelletsHit: 0,
    shotsFired: 0,
  },
  status: "playing",
  timeScale: config.time.idleScale,
});

/** Game over: time stops, but the killing lunge and hit flashes still play out in real time. */
const animateAftermath = (world: WorldState, dt: number): void => {
  for (const piece of world.pieces) {
    piece.hitFlash = Math.max(0, piece.hitFlash - dt);
    if (piece.isAttacking) {
      const { moveDuration } = world.config.pieces[piece.kind];
      piece.moveProgress =
        moveDuration > 0
          ? Math.min(1, piece.moveProgress + dt / moveDuration)
          : 1;
    }
  }
};

/** Applies mouse look and returns the camera's angular speed (rad/real s) for the time policy. */
const applyLook = (
  world: WorldState,
  input: FrameInput,
  dt: number
): number => {
  const { player } = world;
  const { maxPitch } = world.config.player;
  player.yaw += input.lookYaw;
  player.pitch = clamp(player.pitch + input.lookPitch, -maxPitch, maxPitch);
  return dt > 0 ? Math.hypot(input.lookYaw, input.lookPitch) / dt : 0;
};

const pieceBox = (square: Square): Box => ({
  maxX: square.file + 1 - PIECE_INSET,
  maxY: square.rank + 1 - PIECE_INSET,
  minX: square.file + PIECE_INSET,
  minY: square.rank + PIECE_INSET,
});

/** Centre inside the box: leave through the nearest face. */
const exitBox = (point: Vec2, radius: number, box: Box): Vec2 => {
  const toLeft = point.x - box.minX;
  const toRight = box.maxX - point.x;
  const toBottom = point.y - box.minY;
  const toTop = box.maxY - point.y;
  const nearest = Math.min(toLeft, toRight, toBottom, toTop);
  if (nearest === toLeft) {
    return { x: box.minX - radius, y: point.y };
  }
  if (nearest === toRight) {
    return { x: box.maxX + radius, y: point.y };
  }
  if (nearest === toBottom) {
    return { x: point.x, y: box.minY - radius };
  }
  return { x: point.x, y: box.maxY + radius };
};

/** Circle vs AABB: the circle pushed out along the minimum-penetration direction, or null if apart. */
const pushOutOfBox = (point: Vec2, radius: number, box: Box): Vec2 | null => {
  const offsetX = point.x - clamp(point.x, box.minX, box.maxX);
  const offsetY = point.y - clamp(point.y, box.minY, box.maxY);
  const distanceSquared = offsetX * offsetX + offsetY * offsetY;
  if (distanceSquared >= radius * radius) {
    return null;
  }
  if (distanceSquared === 0) {
    return exitBox(point, radius, box);
  }
  const distance = Math.sqrt(distanceSquared);
  const push = (radius - distance) / distance;
  return { x: point.x + offsetX * push, y: point.y + offsetY * push };
};

const clampToBoard = (point: Vec2, radius: number): Vec2 => ({
  x: clamp(point.x, radius, BOARD_SIZE - radius),
  y: clamp(point.y, radius, BOARD_SIZE - radius),
});

/** Keeps the player on the board and out of every living piece. The board edge always wins. */
const resolvePosition = (world: WorldState, wanted: Vec2): Vec2 => {
  const { radius } = world.config.player;
  let point = clampToBoard(wanted, radius);
  for (let pass = 0; pass < COLLISION_PASSES; pass += 1) {
    let pushed = false;
    for (const piece of world.pieces) {
      if (piece.phase === "dead") {
        continue;
      }
      const resolved = pushOutOfBox(point, radius, pieceBox(piece.square));
      if (resolved) {
        point = resolved;
        pushed = true;
      }
    }
    if (!pushed) {
      break;
    }
  }
  return clampToBoard(point, radius);
};

/**
 * Walks the player in REAL time (the player is never slowed, only the world is), resolving x then y
 * so walls and pieces slide instead of stopping dead. Long frames are split into short sub-steps so
 * the player can never be forced into a gap between two pieces. Returns |velocity| / moveSpeed.
 */
const applyMovement = (
  world: WorldState,
  input: FrameInput,
  dt: number
): number => {
  const { player } = world;
  const { moveSpeed } = world.config.player;
  const facing = forward(player.yaw);
  const side = right(player.yaw);
  let wishX = side.x * input.moveX + facing.x * input.moveY;
  let wishY = side.y * input.moveX + facing.y * input.moveY;
  const wishLength = Math.hypot(wishX, wishY);
  if (wishLength > 1) {
    wishX /= wishLength;
    wishY /= wishLength;
  }
  const start = player.pos;
  const maxSubstep = world.config.player.radius * MAX_SUBSTEP_RADIUS_FRACTION;
  const travel = Math.min(1, wishLength) * moveSpeed * dt;
  const substeps =
    maxSubstep > 0 ? Math.max(1, Math.ceil(travel / maxSubstep)) : 1;
  const subDt = dt / substeps;
  let end = start;
  for (let index = 0; index < substeps; index += 1) {
    const afterX = resolvePosition(world, {
      x: end.x + wishX * moveSpeed * subDt,
      y: end.y,
    });
    end = resolvePosition(world, {
      x: afterX.x,
      y: afterX.y + wishY * moveSpeed * subDt,
    });
  }
  const movedX = end.x - start.x;
  const movedY = end.y - start.y;
  const moved = Math.hypot(movedX, movedY);
  player.pos = end;
  player.velocity =
    dt > 0 ? { x: movedX / dt, y: movedY / dt } : { x: 0, y: 0 };
  world.stats.distanceMoved += moved;
  return dt > 0 && moveSpeed > 0 ? moved / dt / moveSpeed : 0;
};

const fireShell = (world: WorldState, rng: () => number): void => {
  const { player, stats } = world;
  const aim = forward(player.yaw);
  const origin = {
    x: player.pos.x + aim.x * MUZZLE_OFFSET,
    y: player.pos.y + aim.y * MUZZLE_OFFSET,
  };
  const angles = pelletAngles(world.config.shotgun, rng);
  for (const angle of angles) {
    world.pellets.push({
      alive: true,
      dir: forward(player.yaw + angle),
      id: world.nextPelletId,
      origin,
      pos: origin,
      // The first step is collision-checked from here, so the barrel offset cannot skip a square.
      prevPos: player.pos,
      traveled: 0,
    });
    world.nextPelletId += 1;
  }
  player.loaded -= 1;
  stats.shotsFired += 1;
  stats.pelletsFired += angles.length;
  world.shotBurstRemaining = world.config.time.shotBurst;
  world.events.push({ pellets: angles.length, type: "shot" });
};

/** Reload and trigger, both in real time. A reload in progress blocks firing. */
const handleWeapon = (
  world: WorldState,
  input: FrameInput,
  dt: number,
  rng: () => number
): void => {
  const { player } = world;
  const { shotgun } = world.config;
  if (
    input.reload &&
    player.reloadTimer === 0 &&
    player.loaded < shotgun.capacity &&
    player.reserve > 0
  ) {
    player.reloadTimer = shotgun.reloadDuration;
    world.events.push({ type: "reloadStart" });
  }
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  if (input.fire && player.reloadTimer === 0 && player.fireCooldown === 0) {
    if (player.loaded === 0) {
      world.events.push({ type: "dryFire" });
    } else {
      fireShell(world, rng);
    }
    player.fireCooldown = shotgun.fireCooldown;
  }
  world.shotBurstRemaining = Math.max(0, world.shotBurstRemaining - dt);
};

/** Smooths the time scale towards the policy's target and returns this frame's game-seconds. */
const advanceTime = (
  world: WorldState,
  deps: SimulationDeps,
  dt: number,
  signals: Pick<TimeSignals, "lookSpeed" | "moveFraction">
): number => {
  const reloading = world.player.reloadTimer > 0;
  if (reloading) {
    world.timeScale = 1;
  } else {
    const target = deps.targetScale({
      ...signals,
      reloading,
      shotBurst: world.shotBurstRemaining > 0,
    });
    const blend = 1 - Math.exp(-world.config.time.responsiveness * dt);
    world.timeScale += (target - world.timeScale) * blend;
  }
  const gameDt = dt * world.timeScale;
  world.gameTime += gameDt;
  return gameDt;
};

const progressReload = (world: WorldState, gameDt: number): void => {
  const { player } = world;
  if (player.reloadTimer <= 0) {
    return;
  }
  player.reloadTimer -= gameDt;
  if (player.reloadTimer > 0) {
    return;
  }
  player.reloadTimer = 0;
  const shells = Math.min(
    world.config.shotgun.capacity - player.loaded,
    player.reserve
  );
  player.loaded += shells;
  player.reserve -= shells;
  world.events.push({ loaded: player.loaded, type: "reloadEnd" });
};

const regenerateShells = (world: WorldState, gameDt: number): void => {
  const { player } = world;
  const { reserveMax, reserveRegenInterval } = world.config.shotgun;
  if (player.reserve >= reserveMax) {
    player.regenTimer = reserveRegenInterval;
    return;
  }
  player.regenTimer -= gameDt;
  while (player.regenTimer <= 0 && player.reserve < reserveMax) {
    player.reserve += 1;
    player.regenTimer += reserveRegenInterval;
    world.events.push({ reserve: player.reserve, type: "shellRegenerated" });
  }
};

const expirePellet = (world: WorldState, pellet: PelletState): void => {
  pellet.alive = false;
  world.events.push({ pelletId: pellet.id, type: "pelletExpired" });
};

const damagePiece = (world: WorldState, piece: PieceState): void => {
  piece.hp -= world.config.shotgun.damagePerPellet;
  piece.hitFlash = HIT_FLASH_DURATION;
  world.stats.pelletsHit += 1;
  world.events.push({
    hp: piece.hp,
    kind: piece.kind,
    pieceId: piece.id,
    square: piece.square,
    type: "pieceHit",
  });
  if (piece.hp > 0) {
    return;
  }
  piece.phase = "dead";
  piece.telegraphProgress = 0;
  world.stats.kills[piece.kind] += 1;
  world.events.push({
    kind: piece.kind,
    pieceId: piece.id,
    square: piece.square,
    type: "pieceKilled",
  });
  if (piece.kind === "king") {
    world.status = "won";
    world.events.push({ type: "victory" });
  }
};

/**
 * Moves one pellet along this frame's segment, checking every square it crosses so it can never
 * tunnel through a piece. The player's own square is ignored (pellets start inside it).
 *
 * The first step is checked from the player's centre (`prevPos`), not the muzzle: from a corner of
 * the player's square the muzzle can already sit in the diagonal square, and starting the walk there
 * would let a shot slip between the two side squares' pieces.
 */
const advancePellet = (
  world: WorldState,
  pellet: PelletState,
  gameDt: number,
  context: PelletContext
): void => {
  const { pelletRange, pelletSpeed } = world.config.shotgun;
  const step = Math.max(
    0,
    Math.min(pelletSpeed * gameDt, pelletRange - pellet.traveled)
  );
  const next = {
    x: pellet.pos.x + pellet.dir.x * step,
    y: pellet.pos.y + pellet.dir.y * step,
  };
  const from = pellet.traveled > 0 ? pellet.pos : pellet.prevPos;
  for (const square of traverseSquares(from, next)) {
    if (sameSquare(square, context.playerSquare)) {
      continue;
    }
    if (!isOnBoard(square)) {
      expirePellet(world, pellet);
      return;
    }
    const target = context.occupancy.get(squareKey(square));
    // Pieces killed earlier this frame are still in the map; they no longer stop pellets.
    if (target && target.phase !== "dead") {
      pellet.alive = false;
      damagePiece(world, target);
      return;
    }
  }
  // A zero-length step (frozen time) keeps `prevPos` on the player, so the barrel check stays pending.
  if (step > 0) {
    pellet.prevPos = pellet.pos;
    pellet.pos = next;
    pellet.traveled += step;
  }
  if (pellet.traveled >= pelletRange - RANGE_EPSILON) {
    expirePellet(world, pellet);
  }
};

const removeDeadPellets = (pellets: PelletState[]): void => {
  let kept = 0;
  for (const pellet of pellets) {
    if (pellet.alive) {
      pellets[kept] = pellet;
      kept += 1;
    }
  }
  pellets.length = kept;
};

const updatePellets = (world: WorldState, gameDt: number): void => {
  if (world.pellets.length === 0) {
    return;
  }
  const context: PelletContext = {
    occupancy: buildOccupancy(world.pieces),
    playerSquare: squareAt(world.player.pos),
  };
  for (const pellet of world.pellets) {
    if (pellet.alive) {
      advancePellet(world, pellet, gameDt, context);
    }
  }
  removeDeadPellets(world.pellets);
};

const startMove = (piece: PieceState, to: Square): void => {
  piece.fromSquare = piece.square;
  piece.square = to;
  piece.moveProgress = 0;
  piece.phase = "moving";
};

const promoteIfPossible = (world: WorldState, piece: PieceState): void => {
  if (piece.kind !== "pawn" || piece.square.rank !== PROMOTION_RANK) {
    return;
  }
  const { queen } = world.config.pieces;
  piece.kind = "queen";
  piece.maxHp = queen.maxHp;
  piece.hp = queen.maxHp;
  world.events.push({ pieceId: piece.id, to: "queen", type: "piecePromoted" });
};

/** Executes the brain's decision once a telegraph completes, then schedules the next action. */
const actPiece = (
  world: WorldState,
  piece: PieceState,
  deps: SimulationDeps
): void => {
  const action = deps.decide(world, piece, deps.rng);
  if (action.type === "attack") {
    startMove(piece, action.to);
    piece.isAttacking = true;
    world.status = "lost";
    world.killedBy = piece.kind;
    world.player.alive = false;
    world.events.push({
      kind: piece.kind,
      pieceId: piece.id,
      type: "kingCaptured",
    });
  } else if (action.type === "move") {
    const from = piece.square;
    startMove(piece, action.to);
    world.events.push({
      from,
      pieceId: piece.id,
      to: action.to,
      type: "pieceMoved",
    });
    promoteIfPossible(world, piece);
  } else {
    piece.phase = "idle";
  }
  const { actionInterval, intervalJitter } = world.config.pieces[piece.kind];
  piece.telegraphProgress = 0;
  piece.actionTimer =
    actionInterval * (1 + intervalJitter * (2 * deps.rng() - 1));
};

/** Advances the move animation; a piece only telegraphs again once it has arrived. */
const advanceMove = (
  piece: PieceState,
  definition: PieceDefinition,
  gameDt: number
): void => {
  piece.moveProgress =
    definition.moveDuration > 0
      ? Math.min(1, piece.moveProgress + gameDt / definition.moveDuration)
      : 1;
  if (piece.moveProgress >= 1) {
    piece.phase = "idle";
  }
};

/**
 * Runs one piece's idle → telegraph → act cycle. A telegraph always lasts the full
 * `telegraphDuration`, even when a long move delayed it, so no action ever comes unannounced.
 */
const updatePiece = (
  world: WorldState,
  piece: PieceState,
  gameDt: number,
  deps: SimulationDeps
): void => {
  const definition = world.config.pieces[piece.kind];
  if (piece.phase === "moving") {
    advanceMove(piece, definition, gameDt);
  }
  piece.actionTimer -= gameDt;
  if (
    piece.phase === "idle" &&
    piece.actionTimer <= definition.telegraphDuration
  ) {
    piece.phase = "telegraph";
    piece.actionTimer = definition.telegraphDuration;
    world.events.push({ pieceId: piece.id, type: "pieceTelegraph" });
  }
  if (piece.phase !== "telegraph") {
    return;
  }
  piece.telegraphProgress =
    definition.telegraphDuration > 0
      ? clamp(1 - piece.actionTimer / definition.telegraphDuration, 0, 1)
      : 1;
  if (piece.actionTimer <= 0) {
    actPiece(world, piece, deps);
  }
};

const updatePieces = (
  world: WorldState,
  dt: number,
  gameDt: number,
  deps: SimulationDeps
): void => {
  for (const piece of world.pieces) {
    piece.hitFlash = Math.max(0, piece.hitFlash - dt);
    if (piece.phase !== "dead") {
      updatePiece(world, piece, gameDt, deps);
    }
    if (world.status !== "playing") {
      return;
    }
  }
};

/**
 * One frame. The player (look, walk, trigger) runs in real time; everything else runs in game time,
 * which the time policy derives from how actively the player is moving this frame.
 */
export const stepWorld = (
  world: WorldState,
  input: FrameInput,
  realDt: number,
  deps: SimulationDeps
): WorldState => {
  world.events.length = 0;
  const dt = Number.isFinite(realDt) ? clamp(realDt, 0, MAX_STEP) : 0;
  world.realTime += dt;
  if (world.status !== "playing") {
    animateAftermath(world, dt);
    return world;
  }
  const lookSpeed = applyLook(world, input, dt);
  const moveFraction = applyMovement(world, input, dt);
  handleWeapon(world, input, dt, deps.rng);
  const gameDt = advanceTime(world, deps, dt, { lookSpeed, moveFraction });
  progressReload(world, gameDt);
  regenerateShells(world, gameDt);
  updatePellets(world, gameDt);
  if (world.status === "playing") {
    updatePieces(world, dt, gameDt, deps);
  }
  return world;
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
