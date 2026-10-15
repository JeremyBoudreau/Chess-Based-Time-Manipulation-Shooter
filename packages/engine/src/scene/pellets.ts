import type { PelletState, Vec2, WorldState } from "@buckshot/core";
import {
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { boardToWorld, smoothstep } from "./coords";
import { EYE_HEIGHT, PALETTE, PELLET_FLIGHT_HEIGHT } from "./palette";

const SLUG_RADIUS = 0.045;
const SLUG_STRETCH = 1.6;
const TRAIL_RADIUS = 0.038;
const TRAIL_MAX_LENGTH = 1.2;
/**
 * Board units over which a pellet eases from the on-screen muzzle line down to flight height.
 * Anything at y = 0.6 closer than ~1.3 units is below the bottom of a level view, so a shorter
 * descent would make pellets dive off-screen before reappearing in the distance.
 */
const DESCENT_DISTANCE = 1.4;
/** The sim spawns pellets this far ahead of the player (simulation.ts MUZZLE_OFFSET). */
const SPAWN_AHEAD = 0.25;
/** Steepest / highest the muzzle line may point, so extreme pitch never launches pellets oddly. */
const MIN_RAY_PITCH = -1.1;
const MAX_RAY_PITCH = 0.35;
/**
 * Pellets are hidden until they pass the on-screen muzzle (~1 unit from the eye): closer than that
 * they would loom huge in front of the lens. Trails grow from this point, never from inside the gun.
 */
const MUZZLE_CLEARANCE = 0.7;
/** Seconds for a dead pellet's trail to collapse into its slug. */
const COLLAPSE_TIME = 0.1;

/**
 * Where the first-person muzzle appears on screen, in normalised device coordinates, plus the
 * main camera's projection terms; the renderer measures it from the viewmodel every frame.
 */
export interface MuzzleRay {
  readonly aspect: number;
  readonly ndcX: number;
  readonly ndcY: number;
  /** tan(vertical fov / 2) of the main camera. */
  readonly tanHalfFov: number;
}

/** Visual pellet: a group oriented with +Z pointing back along the trail. */
interface PelletView {
  collapse: number;
  readonly group: Group;
  live: boolean;
  /** Sideways drift per unit of forward distance along the muzzle line (captured at spawn). */
  raySide: number;
  /** Height gained per unit of forward distance along the muzzle line (captured at spawn). */
  raySlope: number;
  /** World-space right vector of the player at spawn. */
  readonly side: Vector3;
  readonly slug: Mesh;
  readonly trail: Mesh;
  /** Trail length when the pellet died (collapses from here). */
  trailLength: number;
}

/**
 * World point at board (x, y), `traveled` units into the flight. The sim's pellets fly flat at the
 * player's centre; visually they first follow the eye→muzzle line (so they leave the gun on
 * screen) and then settle onto the true path at flight height.
 */
const flightPoint = (
  target: Vector3,
  point: Vec2,
  traveled: number,
  view: PelletView
): Vector3 => {
  const settle = smoothstep(0, DESCENT_DISTANCE, traveled);
  const ahead = SPAWN_AHEAD + traveled;
  const lineHeight = EYE_HEIGHT + view.raySlope * ahead;
  boardToWorld(
    target,
    point.x,
    point.y,
    lineHeight + (PELLET_FLIGHT_HEIGHT - lineHeight) * settle
  );
  return target.addScaledVector(view.side, view.raySide * ahead * (1 - settle));
};

/**
 * Buckshot pellets: near-black faceted slugs dragging solid red cone trails. Views are pooled and
 * tracked by pellet id; when a pellet leaves the world its trail collapses into the slug first.
 */
export class PelletLayer {
  readonly group = new Group();
  private readonly views = new Map<number, PelletView>();
  private readonly pool: PelletView[] = [];
  private readonly slugGeometry = new IcosahedronGeometry(SLUG_RADIUS, 0);
  private readonly trailGeometry: ConeGeometry;
  private readonly slugMaterial = new MeshStandardMaterial({
    color: PALETTE.metal,
    emissive: "#0B2226",
    emissiveIntensity: 0.6,
    flatShading: true,
    metalness: 0.7,
    roughness: 0.3,
  });
  private readonly trailMaterial = new MeshBasicMaterial({
    color: PALETTE.red,
    toneMapped: false,
  });
  private readonly position = new Vector3();
  private readonly tail = new Vector3();
  private readonly alive = new Set<number>();
  private readonly tailPoint = { x: 0, y: 0 };

  constructor() {
    this.group.name = "pellets";
    // Unit cone with its base at the slug (z = 0) and its tip one unit behind (z = 1).
    this.trailGeometry = new ConeGeometry(1, 1, 6, 1, true);
    this.trailGeometry.translate(0, 0.5, 0);
    this.trailGeometry.rotateX(Math.PI / 2);
  }

  sync(world: WorldState, effectDt: number, muzzle: MuzzleRay): void {
    this.alive.clear();
    for (const pellet of world.pellets) {
      if (pellet.alive) {
        this.alive.add(pellet.id);
        this.updateLive(world, pellet, muzzle);
      }
    }
    for (const [id, view] of this.views) {
      if (!this.alive.has(id)) {
        this.collapse(id, view, effectDt);
      }
    }
  }

  clear(): void {
    for (const [id, view] of this.views) {
      this.recycle(id, view);
    }
  }

  dispose(): void {
    this.clear();
    this.pool.length = 0;
    this.slugGeometry.dispose();
    this.trailGeometry.dispose();
    this.slugMaterial.dispose();
    this.trailMaterial.dispose();
    this.group.removeFromParent();
  }

  private updateLive(
    world: WorldState,
    pellet: PelletState,
    muzzle: MuzzleRay
  ): void {
    let view = this.views.get(pellet.id);
    if (!view) {
      view = this.acquire(pellet.id);
      const { pitch, yaw } = world.player;
      // right(yaw) in board space is (cos, sin); in world that is (cos, 0, -sin).
      view.side.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const rayPitch = pitch + Math.atan(muzzle.ndcY * muzzle.tanHalfFov);
      view.raySlope = Math.tan(
        Math.min(MAX_RAY_PITCH, Math.max(MIN_RAY_PITCH, rayPitch))
      );
      view.raySide = muzzle.ndcX * muzzle.tanHalfFov * muzzle.aspect;
    }
    view.group.visible = pellet.traveled >= MUZZLE_CLEARANCE;
    const length = Math.min(
      pellet.traveled - MUZZLE_CLEARANCE,
      TRAIL_MAX_LENGTH
    );
    flightPoint(this.position, pellet.pos, pellet.traveled, view);
    const back = Math.max(MUZZLE_CLEARANCE, pellet.traveled - length);
    this.tailPoint.x = pellet.origin.x + pellet.dir.x * back;
    this.tailPoint.y = pellet.origin.y + pellet.dir.y * back;
    flightPoint(this.tail, this.tailPoint, back, view);
    view.trailLength = this.tail.distanceTo(this.position);
    this.place(view, view.trailLength);
  }

  private place(view: PelletView, trailLength: number): void {
    view.group.position.copy(this.position);
    if (trailLength > 1e-4) {
      // Object3D.lookAt points local +Z at the target: the trail's tip end.
      view.group.lookAt(this.tail);
    }
    view.trail.visible = trailLength > 0.01;
    view.trail.scale.set(
      TRAIL_RADIUS,
      TRAIL_RADIUS,
      Math.max(1e-3, trailLength)
    );
  }

  private collapse(id: number, view: PelletView, effectDt: number): void {
    if (view.live) {
      view.live = false;
      view.collapse = 0;
    }
    view.collapse += effectDt / COLLAPSE_TIME;
    if (view.collapse >= 1) {
      this.recycle(id, view);
      return;
    }
    const k = 1 - view.collapse;
    view.trail.scale.set(
      TRAIL_RADIUS * k,
      TRAIL_RADIUS * k,
      view.trailLength * k
    );
    view.slug.scale.set(k, k, SLUG_STRETCH * k);
  }

  private acquire(id: number): PelletView {
    const view = this.pool.pop() ?? this.createView();
    view.live = true;
    view.collapse = 0;
    view.trailLength = 0;
    view.slug.scale.set(1, 1, SLUG_STRETCH);
    view.group.visible = true;
    this.views.set(id, view);
    this.group.add(view.group);
    return view;
  }

  private recycle(id: number, view: PelletView): void {
    this.views.delete(id);
    view.group.visible = false;
    view.group.removeFromParent();
    this.pool.push(view);
  }

  private createView(): PelletView {
    const group = new Group();
    const slug = new Mesh(this.slugGeometry, this.slugMaterial);
    slug.castShadow = true;
    const trail = new Mesh(this.trailGeometry, this.trailMaterial);
    group.add(slug, trail);
    return {
      collapse: 0,
      group,
      live: true,
      raySide: 0,
      raySlope: 0,
      side: new Vector3(),
      slug,
      trail,
      trailLength: 0,
    };
  }
}
