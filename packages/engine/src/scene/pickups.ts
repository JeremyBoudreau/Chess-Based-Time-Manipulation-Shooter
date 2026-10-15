import {
  type PickupState,
  type PieceState,
  type Square,
  sameSquare,
  squareAt,
  type WorldState,
} from "@buckshot/core";
import {
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  TetrahedronGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { VOID_FLOOR_Y } from "./board";
import {
  clamp01,
  damp,
  easeOutCubic,
  HALF_BOARD,
  smoothstep,
  squareToWorld,
} from "./coords";
import { PALETTE } from "./palette";

// Shell model, world units. The shell is ~0.32 tall: readable from the 0.95 eye height across the
// board, yet well under a pawn's head (1.05) and the pellet flight line (0.6).
const SHELL_SEGMENTS = 8;
const RIM_RADIUS = 0.062;
const RIM_HEIGHT = 0.012;
const HEAD_RADIUS = 0.057;
const HEAD_HEIGHT = 0.075;
const HULL_RADIUS = 0.055;
const HULL_TOP = 0.3;
const CRIMP_RADIUS = 0.036;
const CRIMP_HEIGHT = 0.022;

// Drop-in, on GAME time (pickup.age): a fall from DROP_HEIGHT and one bounce.
export const DROP_HEIGHT = 1.2;
export const GRAVITY = 9.8;
const DROP_BOUNCE = 0.32;
const FALL_TIME = Math.sqrt((2 * DROP_HEIGHT) / GRAVITY);
const BOUNCE_SPEED = DROP_BOUNCE * GRAVITY * FALL_TIME;
const LAND_TIME = FALL_TIME + (2 * BOUNCE_SPEED) / GRAVITY;
const IMPACT_TIME = 0.12;
const IMPACT_SQUASH = 0.24;
/** Age by which the fall, the bounce and both impact squashes are over: a box at rest. */
const SETTLED_AGE = LAND_TIME + IMPACT_TIME;

// Idle life, on REAL time so a pickup stays alive while the world creeps at 1%.
const HOVER = 0.05;
const BOB_AMPLITUDE = 0.025;
const BOB_RATE = 2.6;
const SPIN_RATE = 0.9;

const RING_Y = 0.006;
const RING_INNER = 0.3;
const RING_OUTER = 0.355;
/** Real seconds between the expanding "ping" rings that make a pickup findable from afar. */
const PING_PERIOD = 1.8;

/** Real seconds of the collect pop. */
const POP_TIME = 0.2;
/**
 * The pop flies toward a point this far ahead of and below the eye: the bottom-centre of a level
 * view. A box is collected the moment the king steps onto its square, when it is already far below
 * the frame, so without the rise the player would never see it go.
 */
const POP_AHEAD = 0.65;
const POP_BELOW = 0.33;
/** Fraction of the way to that point the shells travel before they are gone. */
const POP_REACH = 0.85;
/** Size punch at the start of the pop (they shrink back as they are "absorbed"). */
const POP_GROW = 0.3;
/**
 * Effect seconds (game time with a real-time floor) of the crush: the press, then the fade. While
 * the crushing piece is still moving, the press follows its model instead of this clock.
 */
const CRUSH_TIME = 0.35;
/** Share of CRUSH_TIME spent pressing the shells flat; the rest fades them out. */
const PRESS_SHARE = 0.4;
const PRESS_TIME = CRUSH_TIME * PRESS_SHARE;
/**
 * Distance (board units) along a crushing piece's path at which its model meets the shell: a pawn
 * base is 0.33 in radius and the shell ~0.06 in radius.
 */
export const CONTACT_DISTANCE = 0.39;

const FRAGMENTS_PER_CRUSH = 16;
const MAX_FRAGMENTS = 96;
/** Effect seconds a crush fragment lives (shrinking out over the last part). */
const FRAGMENT_LIFE = 0.6;
const FRAGMENT_BOUNCE = 0.3;
const BOARD_EDGE = HALF_BOARD + 0.45;

type PickupPhase = "live" | "pendingCrush" | "pop" | "crush";

/** Per-frame inputs, built once per frame by the renderer. */
export interface PickupFrame {
  /** Monotonic real-time clock (seconds). */
  readonly clock: number;
  /** Game-time step with a real-time floor (crush squash and fragments). */
  readonly effectDt: number;
  /** Main camera position: collected shells pop up toward it. */
  readonly eye: Vector3;
  /** Player yaw (see core types): with `eye`, where the bottom-centre of the view is. */
  readonly eyeYaw: number;
  /** False once the game is over: pickups freeze on the final frame and their rings go out. */
  readonly live: boolean;
  readonly realDt: number;
}

/** Where a piece's model is drawn (the piece layer), so a crush waits for the piece to arrive. */
export interface PieceLocator {
  readonly positionOf: (id: string, target: Vector3) => Vector3 | null;
}

/** Shared geometry and material templates; each view clones the materials so it can fade alone. */
interface PickupKit {
  readonly brass: BufferGeometry;
  readonly brassMaterial: MeshStandardMaterial;
  readonly crimp: BufferGeometry;
  readonly crimpMaterial: MeshStandardMaterial;
  readonly hull: BufferGeometry;
  readonly hullMaterial: MeshStandardMaterial;
  readonly ring: BufferGeometry;
  readonly ringMaterial: MeshBasicMaterial;
}

/** Height above the board while dropping in: free fall, one bounce, then rest. */
const dropHeight = (age: number): number => {
  if (age < FALL_TIME) {
    return DROP_HEIGHT - 0.5 * GRAVITY * age * age;
  }
  const since = age - FALL_TIME;
  if (age < LAND_TIME) {
    return BOUNCE_SPEED * since - 0.5 * GRAVITY * since * since;
  }
  return 0;
};

/** Vertical squash (0..1) from each impact: a quick flatten-and-recover, the second one softer. */
const impactSquash = (age: number): number => {
  const pulse = (since: number, strength: number) =>
    since >= 0 && since < IMPACT_TIME
      ? strength * Math.sin((Math.PI * since) / IMPACT_TIME)
      : 0;
  return (
    pulse(age - FALL_TIME, IMPACT_SQUASH) +
    pulse(age - LAND_TIME, IMPACT_SQUASH * DROP_BOUNCE)
  );
};

/**
 * Whether `square` lies on a piece's current move (past its start, up to and including where it
 * lands). A knight's L has no square strictly inside it, so only its landing square counts.
 */
const passesOver = (piece: PieceState, square: Square): boolean => {
  const dx = piece.square.file - piece.fromSquare.file;
  const dy = piece.square.rank - piece.fromSquare.rank;
  const px = square.file - piece.fromSquare.file;
  const py = square.rank - piece.fromSquare.rank;
  const along = px * dx + py * dy;
  return px * dy - py * dx === 0 && along > 0 && along <= dx * dx + dy * dy;
};

/** One cylinder section of the shell, standing on `bottom`, at (x, z) on the square. */
const section = (
  radiusTop: number,
  radiusBottom: number,
  bottom: number,
  height: number,
  x: number,
  z: number,
  turn: number
): BufferGeometry => {
  const geometry = new CylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    SHELL_SEGMENTS
  );
  geometry.rotateY(turn);
  geometry.translate(x, bottom + height / 2, z);
  return geometry;
};

/** One part of the single centred shell (a pickup is worth one shell), merged into one draw. */
const single = (
  build: (x: number, z: number, turn: number) => BufferGeometry[]
): BufferGeometry => {
  const parts = build(0, 0, 0);
  const merged = mergeGeometries(parts, false);
  for (const part of parts) {
    part.dispose();
  }
  if (merged === null) {
    throw new Error("pickups: failed to merge shell geometry");
  }
  return merged;
};

const createKit = (): PickupKit => {
  const ring = new RingGeometry(RING_INNER, RING_OUTER, 32);
  ring.rotateX(-Math.PI / 2);
  return {
    brass: single((x, z, turn) => [
      section(RIM_RADIUS, RIM_RADIUS, 0, RIM_HEIGHT, x, z, turn),
      section(
        HEAD_RADIUS,
        HEAD_RADIUS,
        RIM_HEIGHT,
        HEAD_HEIGHT - RIM_HEIGHT,
        x,
        z,
        turn
      ),
    ]),
    // No environment map in the main scene, so a high metalness would read as dull brown.
    brassMaterial: new MeshStandardMaterial({
      color: PALETTE.shellBrass,
      emissive: PALETTE.shellBrass,
      emissiveIntensity: 0.1,
      flatShading: true,
      metalness: 0.2,
      roughness: 0.36,
      transparent: true,
    }),
    crimp: single((x, z, turn) => [
      section(CRIMP_RADIUS, HULL_RADIUS, HULL_TOP, CRIMP_HEIGHT, x, z, turn),
    ]),
    crimpMaterial: new MeshStandardMaterial({
      color: PALETTE.redDark,
      flatShading: true,
      roughness: 0.5,
      transparent: true,
    }),
    hull: single((x, z, turn) => [
      section(
        HULL_RADIUS,
        HULL_RADIUS,
        HEAD_HEIGHT,
        HULL_TOP - HEAD_HEIGHT,
        x,
        z,
        turn
      ),
    ]),
    // A touch of self-glow keeps the red vivid on the shadowed side of a piece.
    hullMaterial: new MeshStandardMaterial({
      color: PALETTE.red,
      emissive: PALETTE.red,
      emissiveIntensity: 0.12,
      flatShading: true,
      roughness: 0.45,
      transparent: true,
    }),
    ring,
    ringMaterial: new MeshBasicMaterial({
      color: PALETTE.pickupGlow,
      depthWrite: false,
      opacity: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      toneMapped: false,
      transparent: true,
    }),
  };
};

const disposeKit = (kit: PickupKit): void => {
  kit.brass.dispose();
  kit.crimp.dispose();
  kit.hull.dispose();
  kit.ring.dispose();
  kit.brassMaterial.dispose();
  kit.crimpMaterial.dispose();
  kit.hullMaterial.dispose();
  kit.ringMaterial.dispose();
};

/**
 * One shell box on the board. Materials are cloned per view (same shader program, so no compile
 * hitch) because a popping or crushed box fades on its own while the others stay solid. Views are
 * pooled: the materials live as long as the layer.
 */
class PickupView {
  /** At the square's centre on the board; never rotated or scaled. */
  readonly root = new Group();
  /** Spin, bob, squash and the exit animations; its origin is the shells' base. */
  private readonly body = new Group();
  private readonly shells: readonly Mesh[];
  private readonly shellMaterials: readonly MeshStandardMaterial[];
  private readonly hullMaterial: MeshStandardMaterial;
  private readonly ring: Mesh;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly ping: Mesh;
  private readonly pingMaterial: MeshBasicMaterial;
  /** Body position (root space) when the exit began. */
  private readonly start = new Vector3();
  private readonly toward = new Vector3();
  private readonly offset = new Vector3();
  id = -1;
  phase: PickupPhase = "live";
  /** The piece whose move crushed this box (the crush waits for its model to arrive). */
  crusherId: string | null = null;
  square: Square = { file: 0, rank: 0 };
  /**
   * Drawn age (game-seconds): the last seen `pickup.age` plus `ageOffset`; held once the sim has
   * removed the pickup.
   */
  private age = 0;
  /** Skips the drop for a box that was already at rest when the layer first saw it. */
  private ageOffset = 0;
  private seed = 0;
  private spin = 0;
  private bobPhase = 0;
  private bobBlend = 0;
  private pingPhase = 0;
  private exitAge = 0;

  constructor(kit: PickupKit) {
    this.hullMaterial = kit.hullMaterial.clone();
    const crimpMaterial = kit.crimpMaterial.clone();
    const brassMaterial = kit.brassMaterial.clone();
    this.shellMaterials = [this.hullMaterial, crimpMaterial, brassMaterial];
    this.shells = [
      new Mesh(kit.hull, this.hullMaterial),
      new Mesh(kit.crimp, crimpMaterial),
      new Mesh(kit.brass, brassMaterial),
    ];
    for (const shell of this.shells) {
      shell.castShadow = true;
      shell.receiveShadow = true;
      this.body.add(shell);
    }
    this.ringMaterial = kit.ringMaterial.clone();
    this.pingMaterial = kit.ringMaterial.clone();
    this.ring = new Mesh(kit.ring, this.ringMaterial);
    this.ping = new Mesh(kit.ring, this.pingMaterial);
    for (const ring of [this.ring, this.ping]) {
      ring.position.y = RING_Y;
      // Over the threat tiles (1) and danger tile (2), under the aim fan (3, 4).
      ring.renderOrder = 2;
      this.root.add(ring);
    }
    this.root.add(this.body);
    this.root.visible = false;
  }

  /**
   * `settled`: the box was already on the board when the layer first saw it (the opening boxes of a
   * new game), so it starts at rest, hovering. The sim spawns those at age 0 and the pre-game
   * overlay renders without stepping, so otherwise they would hang above eye height until play
   * started, then take ~50 real seconds to fall at the idle time scale.
   */
  spawn(pickup: PickupState, settled: boolean): void {
    this.id = pickup.id;
    this.square = pickup.square;
    this.ageOffset = settled ? Math.max(0, SETTLED_AGE - pickup.age) : 0;
    this.age = pickup.age + this.ageOffset;
    this.phase = "live";
    this.crusherId = null;
    this.seed = Math.random() * Math.PI * 2;
    this.spin = 0;
    this.bobPhase = this.seed;
    this.pingPhase = Math.random();
    this.bobBlend = settled ? 1 : 0;
    this.exitAge = 0;
    this.root.name = `pickup:${pickup.id}`;
    squareToWorld(this.root.position, pickup.square);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, this.seed, 0);
    this.body.scale.set(1, 1, 1);
    this.ring.scale.set(1, 1, 1);
    this.setOpacity(1);
    this.setGlow(0);
    for (const shell of this.shells) {
      shell.castShadow = true;
    }
    this.root.visible = true;
  }

  /** Track the sim's `pickup.age` while the box is still on the board. */
  observe(age: number): void {
    this.age = age + this.ageOffset;
  }

  /** Lying on the board (or still dropping in): bob, spin and the findability rings. */
  updateLive(frame: PickupFrame): void {
    const { realDt } = frame;
    if (frame.live) {
      this.spin += realDt * SPIN_RATE;
      this.bobPhase += realDt * BOB_RATE;
      this.pingPhase = (this.pingPhase + realDt / PING_PERIOD) % 1;
      this.bobBlend =
        this.age >= LAND_TIME ? damp(this.bobBlend, 1, 3, realDt) : 0;
    }
    const squash = impactSquash(this.age);
    this.body.position.set(
      0,
      dropHeight(this.age) +
        this.bobBlend * (HOVER + BOB_AMPLITUDE * Math.sin(this.bobPhase)),
      0
    );
    this.body.rotation.y = this.seed + this.spin;
    this.body.scale.set(1 + 0.5 * squash, 1 - squash, 1 + 0.5 * squash);

    this.ring.visible = frame.live;
    this.ping.visible = frame.live;
    const pulse = 0.5 + 0.5 * Math.sin(frame.clock * 3.2 + this.seed);
    this.ringMaterial.opacity = 0.36 + 0.26 * pulse;
    const ping = this.pingPhase;
    this.ping.scale.setScalar(1 + 0.5 * easeOutCubic(ping));
    this.pingMaterial.opacity = 0.5 * (1 - ping) ** 2;
  }

  beginPop(): void {
    this.beginExit("pop");
    // A fading body would still drop a full-strength shadow.
    for (const shell of this.shells) {
      shell.castShadow = false;
    }
  }

  beginCrush(): void {
    this.beginExit("crush");
  }

  /** Collected: scale up, flash gold and fade while rising toward the camera. True when done. */
  updatePop(frame: PickupFrame): boolean {
    this.exitAge += frame.realDt;
    const t = clamp01(this.exitAge / POP_TIME);
    const e = easeOutCubic(t);
    // Root space is the world shifted to the square (root is never rotated or scaled); forward(yaw)
    // in world space is (-sin yaw, 0, -cos yaw).
    this.toward
      .copy(frame.eye)
      .sub(this.root.position)
      .add(
        this.offset.set(
          -Math.sin(frame.eyeYaw) * POP_AHEAD,
          -POP_BELOW,
          -Math.cos(frame.eyeYaw) * POP_AHEAD
        )
      );
    this.body.position.lerpVectors(this.start, this.toward, POP_REACH * e);
    const punch = Math.sin(Math.PI * clamp01(t / 0.5));
    this.body.scale.setScalar(
      (1 + POP_GROW * punch) * (1 - 0.35 * smoothstep(0.4, 1, t))
    );
    this.body.rotation.y += frame.realDt * 9;
    this.setOpacity(1 - smoothstep(0.35, 1, t));
    this.setGlow(1 - t);
    this.ping.visible = false;
    this.ring.scale.setScalar(1 + 0.5 * e);
    this.ringMaterial.opacity = 0.7 * (1 - t);
    return t >= 1;
  }

  /**
   * Crushed: pressed flat and spread, then faded. True when done. `press` (0..1) is how far the
   * crushing piece's model has come over the shells, or null when there is no moving piece to
   * follow. The press follows the piece because at the idle time scale the piece creeps on game
   * time while the effect clock has a real-time floor, so the clock alone would flatten the box many
   * real seconds before the piece got onto it. Once flat (or with no piece) it runs on that clock.
   */
  updateCrush(frame: PickupFrame, press: number | null): boolean {
    if (press === null || this.exitAge >= PRESS_TIME) {
      this.exitAge += frame.effectDt;
    } else {
      this.exitAge = Math.max(this.exitAge, press * PRESS_TIME);
    }
    const t = clamp01(this.exitAge / CRUSH_TIME);
    const flat = easeOutCubic(clamp01(this.exitAge / PRESS_TIME));
    this.body.position.set(0, this.start.y * (1 - flat), 0);
    this.body.scale.set(1 + 0.5 * flat, 1 - 0.88 * flat, 1 + 0.5 * flat);
    this.setOpacity(1 - smoothstep(0.45, 1, t));
    this.ping.visible = false;
    this.ringMaterial.opacity = 0.45 * (1 - t);
    return t >= 1;
  }

  /** World point just above the shells' base, where crush fragments spray from. */
  burstOrigin(target: Vector3): Vector3 {
    target.copy(this.root.position).add(this.body.position);
    target.y += 0.12;
    return target;
  }

  hide(): void {
    this.root.visible = false;
    this.id = -1;
    this.crusherId = null;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const material of this.shellMaterials) {
      material.dispose();
    }
    this.ringMaterial.dispose();
    this.pingMaterial.dispose();
  }

  private beginExit(phase: "pop" | "crush"): void {
    this.phase = phase;
    this.exitAge = 0;
    this.start.copy(this.body.position);
  }

  private setOpacity(opacity: number): void {
    for (const material of this.shellMaterials) {
      material.opacity = opacity;
    }
  }

  /** Gold self-glow of the collect pop (0 = the resting red). */
  private setGlow(glow: number): void {
    const material = this.hullMaterial;
    if (glow <= 0) {
      material.emissive.set(PALETTE.red);
      material.emissiveIntensity = 0.12;
      return;
    }
    material.emissive.set(PALETTE.sparkGlow);
    material.emissiveIntensity = 0.8 * glow;
  }
}

/** A crush fragment: like the shatter debris, it bounces once, then lies still and shrinks out. */
interface Fragment {
  age: number;
  readonly angularVelocity: Vector3;
  bounces: number;
  readonly color: Color;
  readonly position: Vector3;
  resting: boolean;
  readonly rotation: Euler;
  readonly size: number;
  readonly velocity: Vector3;
}

const randomRange = (min: number, max: number) =>
  min + Math.random() * (max - min);

/** Height of the surface under a point: the board top, or the void floor beyond the frame. */
const groundAt = (position: Vector3) =>
  Math.abs(position.x) <= BOARD_EDGE && Math.abs(position.z) <= BOARD_EDGE
    ? 0
    : VOID_FLOOR_Y;

const stepFragment = (fragment: Fragment, dt: number): void => {
  fragment.age += dt;
  if (fragment.resting) {
    return;
  }
  fragment.velocity.y -= GRAVITY * dt;
  fragment.position.addScaledVector(fragment.velocity, dt);
  fragment.rotation.x += fragment.angularVelocity.x * dt;
  fragment.rotation.y += fragment.angularVelocity.y * dt;
  fragment.rotation.z += fragment.angularVelocity.z * dt;
  const floor = groundAt(fragment.position) + fragment.size * 0.5;
  if (fragment.position.y > floor || fragment.velocity.y > 0) {
    return;
  }
  fragment.position.y = floor;
  if (fragment.bounces > 0) {
    fragment.bounces -= 1;
    fragment.velocity.y = -fragment.velocity.y * FRAGMENT_BOUNCE;
    fragment.velocity.x *= 0.5;
    fragment.velocity.z *= 0.5;
    return;
  }
  fragment.resting = true;
};

/**
 * Red hull and brass shards from crushed boxes, all in one instanced mesh. Same unlit,
 * per-instance-colour material as the shatter sparks, so it shares their (pre-compiled) program.
 */
class FragmentSpray {
  readonly mesh: InstancedMesh;
  private readonly geometry = new TetrahedronGeometry(1, 0);
  private readonly material = new MeshBasicMaterial({
    color: "#FFFFFF",
    toneMapped: false,
  });
  private readonly red = new Color(PALETTE.red);
  /** Mostly hull, some crimp, a few brass flecks from the heads. */
  private readonly colors = [
    this.red,
    this.red,
    new Color(PALETTE.redDark),
    new Color(PALETTE.shellBrass),
  ];
  private fragments: Fragment[] = [];
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();

  constructor() {
    this.mesh = new InstancedMesh(this.geometry, this.material, MAX_FRAGMENTS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // Create the colour attribute up front: it is part of the shader program key, and the
    // renderer's warm-up compiles this mesh before any crush happens.
    for (let index = 0; index < MAX_FRAGMENTS; index += 1) {
      this.mesh.setColorAt(index, this.red);
    }
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    // Fragments scatter beyond any static bound; skip culling instead of recomputing it.
    this.mesh.frustumCulled = false;
  }

  burst(origin: Vector3): void {
    for (let index = 0; index < FRAGMENTS_PER_CRUSH; index += 1) {
      if (this.fragments.length >= MAX_FRAGMENTS) {
        return;
      }
      const angle = Math.random() * Math.PI * 2;
      const outward = randomRange(0.5, 1.6);
      const color = this.colors[index % this.colors.length] ?? this.red;
      this.fragments.push({
        age: 0,
        angularVelocity: new Vector3(
          randomRange(-16, 16),
          randomRange(-16, 16),
          randomRange(-16, 16)
        ),
        bounces: 1,
        color,
        position: new Vector3(
          origin.x + Math.cos(angle) * randomRange(0, 0.1),
          origin.y + randomRange(-0.06, 0.08),
          origin.z + Math.sin(angle) * randomRange(0, 0.1)
        ),
        resting: false,
        rotation: new Euler(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        ),
        size: randomRange(0.03, 0.06),
        velocity: new Vector3(
          Math.cos(angle) * outward,
          randomRange(1.2, 2.6),
          Math.sin(angle) * outward
        ),
      });
    }
  }

  update(dt: number): void {
    if (this.fragments.length === 0) {
      return;
    }
    const alive: Fragment[] = [];
    for (const fragment of this.fragments) {
      stepFragment(fragment, dt);
      if (fragment.age < FRAGMENT_LIFE) {
        alive.push(fragment);
      }
    }
    this.fragments = alive;
    for (let index = 0; index < alive.length; index += 1) {
      const fragment = alive[index];
      if (!fragment) {
        continue;
      }
      const shrink =
        1 - smoothstep(FRAGMENT_LIFE * 0.55, FRAGMENT_LIFE, fragment.age);
      this.quaternion.setFromEuler(fragment.rotation);
      this.scale.setScalar(Math.max(1e-4, fragment.size * shrink));
      this.matrix.compose(fragment.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(index, this.matrix);
      this.mesh.setColorAt(index, fragment.color);
    }
    this.mesh.count = alive.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    this.fragments = [];
    this.mesh.count = 0;
  }

  dispose(): void {
    this.clear();
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Shell pickups: a single upright shotgun shell on a pulsing gold ring, keyed by pickup id. They drop
 * in on GAME time (a box that spawns while the king stands still hangs in the air; the opening
 * boxes are already down), bob and spin on REAL time, pop toward the camera when collected and are
 * pressed flat into red and brass shards when a piece moves over them — as the piece's model gets
 * there, not when the sim decided.
 */
export class PickupLayer {
  readonly group = new Group();
  private readonly kit = createKit();
  private readonly views = new Map<number, PickupView>();
  private readonly pool: PickupView[] = [];
  private readonly fragments = new FragmentSpray();
  private readonly seen = new Set<number>();
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly drawn = new Vector3();
  private readonly origin = new Vector3();
  /**
   * True from clear() until the next sync: the boxes that sync finds were on the board before this
   * layer started drawing (a new game's opening boxes), so they start at rest instead of dropping.
   */
  private settleNext = true;

  constructor() {
    this.group.name = "pickups";
    this.group.add(this.fragments.mesh);
    // One hidden view in the graph from the start, so the renderer's shader warm-up compiles the
    // shell and ring programs; otherwise the first pickup to appear would hitch.
    this.pool.push(this.createView());
  }

  /** The sim collected a box: pop it toward the camera. Call only for events of a fresh step. */
  onCollected(pickupId: number): void {
    const view = this.views.get(pickupId);
    if (view && view.phase === "live") {
      view.beginPop();
    }
  }

  /** A piece moved over a box: squash it once that piece's model reaches it. */
  onCrushed(pickupId: number, pieceId: string): void {
    const view = this.views.get(pickupId);
    if (view && view.phase === "live") {
      view.phase = "pendingCrush";
      view.crusherId = pieceId;
    }
  }

  sync(world: WorldState, frame: PickupFrame, pieces: PieceLocator): void {
    this.seen.clear();
    for (const pickup of world.pickups) {
      this.seen.add(pickup.id);
      const view = this.views.get(pickup.id) ?? this.acquire(pickup);
      if (view.phase === "live") {
        view.observe(pickup.age);
        view.updateLive(frame);
      }
    }
    this.settleNext = false;
    for (const [id, view] of this.views) {
      if (!this.seen.has(id)) {
        this.updateGone(world, view, frame, pieces);
      }
    }
    this.fragments.update(frame.effectDt);
  }

  clear(): void {
    for (const view of this.views.values()) {
      this.recycle(view);
    }
    this.fragments.clear();
    this.settleNext = true;
  }

  dispose(): void {
    this.clear();
    for (const view of this.pool) {
      view.dispose();
    }
    this.pool.length = 0;
    this.fragments.dispose();
    disposeKit(this.kit);
    this.group.removeFromParent();
  }

  /** A box the sim no longer has: play out its exit, then return the view to the pool. */
  private updateGone(
    world: WorldState,
    view: PickupView,
    frame: PickupFrame,
    pieces: PieceLocator
  ): void {
    if (view.phase === "live") {
      // No event seen (several sim steps between renders): infer what happened from the board.
      this.infer(world, view);
    }
    if (view.phase === "pop") {
      if (view.updatePop(frame)) {
        this.recycle(view);
      }
      return;
    }
    const press = this.pressOf(world, view, pieces);
    if (view.phase === "pendingCrush") {
      if (press !== null && press <= 0) {
        view.updateLive(frame);
        return;
      }
      // Burst on contact, when the audio's mirror of `pressOf` plays the crunch.
      view.beginCrush();
      this.fragments.burst(view.burstOrigin(this.origin));
    }
    if (view.updateCrush(frame, press)) {
      this.recycle(view);
    }
  }

  private infer(world: WorldState, view: PickupView): void {
    if (sameSquare(squareAt(world.player.pos), view.square)) {
      view.beginPop();
      return;
    }
    const crusher = world.pieces.find(
      (piece) => piece.phase === "moving" && passesOver(piece, view.square)
    );
    view.phase = "pendingCrush";
    view.crusherId = crusher ? crusher.id : null;
  }

  /**
   * How far (0..1) the crushing piece's drawn base has come over the box along its path: 0 until it
   * is within contact distance, 1 once it is over the shells' centre. The sim crushes a box the
   * instant a move starts (squares are logical), but the model glides there on game time, and with
   * time crawling that can take many real seconds. Null when there is no moving piece to follow
   * (game over, crusher unknown, shot, or its move over): the crush then runs on the effect clock.
   */
  private pressOf(
    world: WorldState,
    view: PickupView,
    pieces: PieceLocator
  ): number | null {
    if (world.status !== "playing" || view.crusherId === null) {
      return null;
    }
    const id = view.crusherId;
    const piece = world.pieces.find((candidate) => candidate.id === id);
    // A crusher already on a later move (several sim steps between renders) is no guide either.
    if (piece?.phase !== "moving" || !passesOver(piece, view.square)) {
      return null;
    }
    const drawn = pieces.positionOf(piece.id, this.drawn);
    if (!drawn) {
      return null;
    }
    squareToWorld(this.from, piece.fromSquare);
    squareToWorld(this.to, piece.square);
    const dx = this.to.x - this.from.x;
    const dz = this.to.z - this.from.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-3) {
      return null;
    }
    const along = (point: Vector3) =>
      ((point.x - this.from.x) * dx + (point.z - this.from.z) * dz) / length;
    return clamp01(
      (along(drawn) - along(view.root.position) + CONTACT_DISTANCE) /
        CONTACT_DISTANCE
    );
  }

  private acquire(pickup: PickupState): PickupView {
    const view = this.pool.pop() ?? this.createView();
    view.spawn(pickup, this.settleNext);
    this.views.set(pickup.id, view);
    return view;
  }

  private recycle(view: PickupView): void {
    this.views.delete(view.id);
    view.hide();
    this.pool.push(view);
  }

  /** Pooled views stay in the graph (hidden) for the layer's lifetime. */
  private createView(): PickupView {
    const view = new PickupView(this.kit);
    this.group.add(view.root);
    return view;
  }
}
