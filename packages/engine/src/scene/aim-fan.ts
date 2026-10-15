import type { ShotgunStats, WorldState } from "@buckshot/core";
import {
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Plane,
  PlaneGeometry,
  RingGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { boardToWorld, HALF_BOARD } from "./coords";
import { PALETTE } from "./palette";
import { SPAWN_AHEAD } from "./pellets";

const FAN_Y = 0.007;
/** Mirrors core shotgun.ts MAX_SPREAD_OVERSHOOT: the clamp on how far jitter may carry a pellet. */
const MAX_SPREAD_OVERSHOOT = 1.15;
/** The fan starts a little in front of the player so it never sits under the camera. */
const INNER_RADIUS = 0.35;
const LINE_WIDTH = 0.022;
const ARC_WIDTH = 0.03;
const TICK_LENGTH = 0.16;
const TICK_STEP_DEGREES = 8;

/**
 * Keep the decal on the tiles: past the board edge it would float over the void like a pane of
 * pink glass. Needs `renderer.localClippingEnabled`.
 */
const BOARD_CLIP = [
  new Plane(new Vector3(-1, 0, 0), HALF_BOARD),
  new Plane(new Vector3(1, 0, 0), HALF_BOARD),
  new Plane(new Vector3(0, 0, -1), HALF_BOARD),
  new Plane(new Vector3(0, 0, 1), HALF_BOARD),
];

/**
 * Ring sector centred on local -Z (the camera's forward once the group takes the player's yaw).
 * RingGeometry measures θ from +X in its XY plane; after laying it flat, θ = π/2 is -Z.
 */
const sector = (inner: number, outer: number, halfAngle: number) => {
  const ring = new RingGeometry(
    inner,
    outer,
    48,
    1,
    Math.PI / 2 - halfAngle,
    halfAngle * 2
  );
  ring.rotateX(-Math.PI / 2);
  return ring;
};

/** A thin flat strip from `from` to `to` along a ray at `angle` from forward (+ = left). */
const ray = (angle: number, from: number, to: number, width: number) => {
  const strip = new PlaneGeometry(width, to - from);
  strip.rotateX(-Math.PI / 2);
  // After rotateX the strip runs along Z; centre it on the ray's forward (-Z) section.
  strip.translate(0, 0, -(from + to) / 2);
  strip.rotateY(angle);
  return strip;
};

/**
 * Widest angle (radians, either side of aim) a pellet can actually fly at, per core `pelletAngles`:
 * the edge bin's centre plus its full jitter, capped by the overshoot clamp. Drawing only
 * ±spreadDegrees would hide the band past the edge where edge pellets often land.
 */
const reachHalfAngle = (stats: ShotgunStats): number => {
  const spread = (stats.spreadDegrees * Math.PI) / 180;
  const bin = (2 * spread) / Math.max(1, Math.floor(stats.pellets));
  return Math.min(
    spread * MAX_SPREAD_OVERSHOOT,
    spread + 0.5 * bin * stats.spreadJitter
  );
};

const merge = (parts: BufferGeometry[]) => {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) {
    part.dispose();
  }
  if (merged === null) {
    throw new Error("aim-fan: failed to merge geometry");
  }
  return merged;
};

/** Edge rays, the max-range arc, and T-ticks hanging inward off the arc (Shotgun King's aim arc). */
const buildLines = (range: number, halfAngle: number) => {
  const parts: BufferGeometry[] = [
    ray(halfAngle, INNER_RADIUS, range, LINE_WIDTH),
    ray(-halfAngle, INNER_RADIUS, range, LINE_WIDTH),
    sector(range - ARC_WIDTH, range, halfAngle),
  ];
  const step = (TICK_STEP_DEGREES * Math.PI) / 180;
  const ticks = Math.max(1, Math.round((halfAngle * 2) / step));
  for (let index = 0; index <= ticks; index += 1) {
    const angle = -halfAngle + (index / ticks) * halfAngle * 2;
    parts.push(ray(angle, range - TICK_LENGTH, range, LINE_WIDTH));
    // The crossbar of the T: a short arc piece hugging the max-range line.
    parts.push(
      sector(range - ARC_WIDTH * 2.2, range, step * 0.18).rotateY(angle)
    );
  }
  return merge(parts);
};

/**
 * A faint red floor decal under the player showing exactly where the buckshot fan can reach. It
 * follows the camera every frame, even with time frozen, so aiming never waits on the sim.
 */
export class AimFan {
  readonly group = new Group();
  private readonly fill: Mesh;
  private readonly lines: Mesh;
  private readonly fillMaterial = new MeshBasicMaterial({
    clippingPlanes: BOARD_CLIP,
    color: PALETTE.red,
    depthWrite: false,
    opacity: 0.06,
    toneMapped: false,
    transparent: true,
  });
  private readonly lineMaterial = new MeshBasicMaterial({
    clippingPlanes: BOARD_CLIP,
    color: PALETTE.red,
    depthWrite: false,
    opacity: 0.24,
    toneMapped: false,
    transparent: true,
  });
  private range = -1;
  private halfAngle = -1;

  constructor() {
    this.group.name = "aim-fan";
    this.fill = new Mesh(new BufferGeometry(), this.fillMaterial);
    this.lines = new Mesh(new BufferGeometry(), this.lineMaterial);
    this.fill.renderOrder = 3;
    this.lines.renderOrder = 4;
    this.group.add(this.fill, this.lines);
  }

  update(world: WorldState): void {
    this.rebuildIfNeeded(world.config.shotgun);
    const { player } = world;
    this.group.visible = world.status === "playing" && player.alive;
    // Apex at the muzzle: pellets spawn SPAWN_AHEAD along forward(yaw) = (-sin, cos) and fly
    // `pelletRange` from there, so a fan centred on the player would fall short of their reach.
    boardToWorld(
      this.group.position,
      player.pos.x - Math.sin(player.yaw) * SPAWN_AHEAD,
      player.pos.y + Math.cos(player.yaw) * SPAWN_AHEAD,
      FAN_Y
    );
    this.group.rotation.set(0, player.yaw, 0);
  }

  private rebuildIfNeeded(stats: ShotgunStats): void {
    const halfAngle = reachHalfAngle(stats);
    if (stats.pelletRange === this.range && halfAngle === this.halfAngle) {
      return;
    }
    this.range = stats.pelletRange;
    this.halfAngle = halfAngle;
    this.fill.geometry.dispose();
    this.lines.geometry.dispose();
    this.fill.geometry = sector(INNER_RADIUS, this.range, halfAngle);
    this.lines.geometry = buildLines(this.range, halfAngle);
  }

  dispose(): void {
    this.fill.geometry.dispose();
    this.lines.geometry.dispose();
    this.fillMaterial.dispose();
    this.lineMaterial.dispose();
    this.group.removeFromParent();
  }
}
