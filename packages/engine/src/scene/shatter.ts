import type { PieceKind } from "@buckshot/core";
import {
  Color,
  DodecahedronGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  TetrahedronGeometry,
  Vector3,
} from "three";
import { PIECE_HEIGHTS } from "../models/pieces";
import { VOID_FLOOR_Y } from "./board";
import { HALF_BOARD } from "./coords";
import { PALETTE } from "./palette";

const GRAVITY = 9.8;
const BOUNCE = 0.32;
const FRICTION = 0.55;
/** Game-seconds over which the chunks' yellow glow fades out. */
const GLOW_DURATION = 1;
const SPARKS_PER_BURST = 150;
const BOARD_EDGE = HALF_BOARD + 0.45;

/** One rigid fragment: position/velocity in world space, a spin, and how many bounces it has left. */
interface Particle {
  readonly angularVelocity: Vector3;
  bounces: number;
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

/**
 * Integrate one particle on GAME time: with time frozen the debris hangs in the air (SUPERHOT).
 * It bounces once, then lies still for good.
 */
const stepParticle = (particle: Particle, dt: number): void => {
  if (particle.resting || dt <= 0) {
    return;
  }
  particle.velocity.y -= GRAVITY * dt;
  particle.position.addScaledVector(particle.velocity, dt);
  particle.rotation.x += particle.angularVelocity.x * dt;
  particle.rotation.y += particle.angularVelocity.y * dt;
  particle.rotation.z += particle.angularVelocity.z * dt;
  const floor = groundAt(particle.position) + particle.size * 0.55;
  if (particle.position.y > floor || particle.velocity.y > 0) {
    return;
  }
  particle.position.y = floor;
  if (particle.bounces > 0) {
    particle.bounces -= 1;
    particle.velocity.y = -particle.velocity.y * BOUNCE;
    particle.velocity.x *= FRICTION;
    particle.velocity.z *= FRICTION;
    particle.angularVelocity.multiplyScalar(0.5);
    return;
  }
  particle.resting = true;
  particle.velocity.set(0, 0, 0);
};

const spawnParticle = (
  origin: Vector3,
  height: number,
  size: number,
  power: number
): Particle => {
  const angle = Math.random() * Math.PI * 2;
  const outward = randomRange(0.6, 2.2) * power;
  return {
    angularVelocity: new Vector3(
      randomRange(-14, 14),
      randomRange(-14, 14),
      randomRange(-14, 14)
    ),
    bounces: 1,
    position: new Vector3(
      origin.x + Math.cos(angle) * randomRange(0, 0.22),
      origin.y + randomRange(0.15, height),
      origin.z + Math.sin(angle) * randomRange(0, 0.22)
    ),
    resting: false,
    rotation: new Euler(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    ),
    size,
    velocity: new Vector3(
      Math.cos(angle) * outward,
      randomRange(2, 4.6) * power,
      Math.sin(angle) * outward
    ),
  };
};

/** One piece's death: ivory chunks (individual meshes) + red sparks (one instanced mesh). */
class Burst {
  readonly group = new Group();
  private readonly chunks: { mesh: Mesh; particle: Particle }[] = [];
  private readonly sparks: Particle[] = [];
  private readonly sparkMesh: InstancedMesh;
  private readonly chunkMaterial: MeshStandardMaterial;
  private glow = GLOW_DURATION;
  /** True once every fragment rests and the glow is gone: no more per-frame work. */
  private settled: boolean;
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();

  constructor(
    origin: Vector3,
    kind: PieceKind,
    big: boolean,
    resources: {
      chunk: DodecahedronGeometry;
      spark: TetrahedronGeometry;
      sparkMaterial: MeshBasicMaterial;
    }
  ) {
    this.settled = false;
    const height = PIECE_HEIGHTS[kind];
    const power = big ? 1.45 : 1;
    this.chunkMaterial = new MeshStandardMaterial({
      color: PALETTE.ivory,
      emissive: PALETTE.sparkGlow,
      emissiveIntensity: 1.4,
      flatShading: true,
      roughness: 0.55,
    });
    const chunkCount = big ? 16 : 6 + Math.floor(Math.random() * 5);
    for (let index = 0; index < chunkCount; index += 1) {
      const size = randomRange(0.09, big ? 0.22 : 0.17);
      const particle = spawnParticle(origin, height, size, power * 0.8);
      const mesh = new Mesh(resources.chunk, this.chunkMaterial);
      mesh.scale.set(
        size * randomRange(0.6, 1.1),
        size * randomRange(0.5, 1),
        size * randomRange(0.6, 1.2)
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.chunks.push({ mesh, particle });
      this.group.add(mesh);
    }

    const sparkCount = big ? SPARKS_PER_BURST * 2 : SPARKS_PER_BURST;
    this.sparkMesh = new InstancedMesh(
      resources.spark,
      resources.sparkMaterial,
      sparkCount
    );
    this.sparkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.sparkMesh.castShadow = false;
    const red = new Color(PALETTE.red);
    const dark = new Color(PALETTE.redDark);
    for (let index = 0; index < sparkCount; index += 1) {
      this.sparks.push(
        spawnParticle(origin, height, randomRange(0.012, 0.03), power * 0.85)
      );
      this.sparkMesh.setColorAt(index, Math.random() < 0.6 ? red : dark);
    }
    if (this.sparkMesh.instanceColor) {
      this.sparkMesh.instanceColor.needsUpdate = true;
    }
    // Sparks scatter beyond any static bound; skip culling instead of recomputing it every frame.
    this.sparkMesh.frustumCulled = false;
    this.group.add(this.sparkMesh);
    this.write();
  }

  update(gameDt: number): void {
    if (this.settled) {
      return;
    }
    this.glow = Math.max(0, this.glow - gameDt);
    this.chunkMaterial.emissiveIntensity =
      1.4 * (this.glow / GLOW_DURATION) ** 1.5;
    let moving = this.glow > 0;
    for (const { particle } of this.chunks) {
      stepParticle(particle, gameDt);
      moving ||= !particle.resting;
    }
    for (const spark of this.sparks) {
      stepParticle(spark, gameDt);
      moving ||= !spark.resting;
    }
    this.write();
    this.settled = !moving;
  }

  private write(): void {
    for (const { mesh, particle } of this.chunks) {
      mesh.position.copy(particle.position);
      mesh.rotation.copy(particle.rotation);
    }
    for (let index = 0; index < this.sparks.length; index += 1) {
      const spark = this.sparks[index];
      if (spark) {
        this.quaternion.setFromEuler(spark.rotation);
        this.scale.setScalar(spark.size);
        this.matrix.compose(spark.position, this.quaternion, this.scale);
        this.sparkMesh.setMatrixAt(index, this.matrix);
      }
    }
    this.sparkMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.chunkMaterial.dispose();
    this.sparkMesh.dispose();
  }
}

/**
 * Death shatter: the piece bursts into faceted ivory chunks glowing yellow plus a spray of tiny red
 * tetrahedra. Everything runs on game time and the chunks stay on the board as debris.
 */
export class ShatterLayer {
  readonly group = new Group();
  private bursts: Burst[] = [];
  private readonly chunkGeometry = new DodecahedronGeometry(1, 0);
  private readonly sparkGeometry = new TetrahedronGeometry(1, 0);
  private readonly sparkMaterial = new MeshBasicMaterial({
    color: "#FFFFFF",
    toneMapped: false,
  });

  constructor() {
    this.group.name = "shatter";
  }

  /**
   * Shatter a piece at `origin`, the world position of its base as drawn rather than its logical
   * square: a piece killed mid-move must burst where the player saw it, not where it was headed.
   */
  burst(origin: Vector3, kind: PieceKind, big: boolean): void {
    const burst = new Burst(origin, kind, big, {
      chunk: this.chunkGeometry,
      spark: this.sparkGeometry,
      sparkMaterial: this.sparkMaterial,
    });
    this.bursts.push(burst);
    this.group.add(burst.group);
  }

  /**
   * A throwaway one-spark mesh for shader warm-up. The sparks are the only mesh drawn with
   * per-instance colour, so their program would otherwise compile (and hitch) on the first kill.
   * The caller compiles and then disposes it; geometry and material stay owned by this layer.
   */
  warmUpObject(): InstancedMesh {
    const mesh = new InstancedMesh(this.sparkGeometry, this.sparkMaterial, 1);
    mesh.setColorAt(0, new Color(PALETTE.red));
    return mesh;
  }

  update(gameDt: number): void {
    for (const burst of this.bursts) {
      burst.update(gameDt);
    }
  }

  clear(): void {
    for (const burst of this.bursts) {
      burst.dispose();
    }
    this.bursts = [];
  }

  dispose(): void {
    this.clear();
    this.chunkGeometry.dispose();
    this.sparkGeometry.dispose();
    this.sparkMaterial.dispose();
    this.group.removeFromParent();
  }
}
