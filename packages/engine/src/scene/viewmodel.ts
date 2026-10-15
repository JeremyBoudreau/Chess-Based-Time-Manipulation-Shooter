import type { GameConfig, WorldState } from "@buckshot/core";
import {
  AdditiveBlending,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  PointLight,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import {
  BARREL_X,
  BARREL_Y,
  buildShotgun,
  type ShotgunParts,
} from "../models/shotgun";
import { clamp01, damp, easeOutCubic, smoothstep } from "./coords";
import { Disposables } from "./disposables";
import { PALETTE } from "./palette";

/** Where the gun rests in view space (lower right, barrels angled slightly toward the crosshair). */
const REST = new Vector3(0.235, -0.27, -0.6);
const REST_YAW = 0.12;
const REST_PITCH = 0.06;
/** Recoil pivots near the grip so the muzzle climbs. */
const RECOIL_PIVOT = new Vector3(0, -0.07, 0.1);
const RECOIL_PITCH = (12 * Math.PI) / 180;
const RECOIL_BACK = 0.09;
const RECOIL_ATTACK = 0.035;
const RECOIL_RECOVER = 0.25;
const BREAK_ANGLE = (35 * Math.PI) / 180;
/** Game seconds of the muzzle puff. */
const FLASH_LIFE = 0.3;
/** Game seconds of the muzzle light pop. */
const POP_LIFE = 0.1;
const FLASH_SIZE = 0.2;

/** Recoil envelope: a near-instant kick, then an eased return. */
const kick = (age: number, attack: number, recover: number) => {
  if (age < 0) {
    return 0;
  }
  if (age < attack) {
    return age / attack;
  }
  return 1 - easeOutCubic(clamp01((age - attack) / recover));
};

const wrapAngle = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

/** A soft pale-cyan starburst, drawn once into a canvas texture. */
const createFlashTexture = (): CanvasTexture => {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("viewmodel: 2D canvas context unavailable");
  }
  const half = size / 2;
  const glow = context.createRadialGradient(half, half, 0, half, half, half);
  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.18, "rgba(232, 251, 255, 0.95)");
  glow.addColorStop(0.5, "rgba(200, 240, 255, 0.35)");
  glow.addColorStop(1, "rgba(200, 240, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);
  context.translate(half, half);
  context.fillStyle = "rgba(255, 255, 255, 0.85)";
  const spikes = 7;
  for (let index = 0; index < spikes; index += 1) {
    context.rotate((Math.PI * 2) / spikes);
    context.beginPath();
    context.moveTo(-5, 0);
    context.lineTo(0, -half * (0.75 + (0.25 * ((index * 37) % 3)) / 2));
    context.lineTo(5, 0);
    context.closePath();
    context.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

/**
 * The first-person sawed-off, drawn in its own scene/camera pass after a depth clear so it can never
 * clip into pieces. Pure presentation: it reads player state (velocity, reload timer) and reacts to
 * shot/dry-fire/reload events with recoil, a break-action reload and a muzzle flash.
 */
export class Viewmodel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(56, 1, 0.01, 10);
  private readonly resources = new Disposables();
  private readonly rig = new Group();
  private readonly recoil = new Group();
  private readonly parts: ShotgunParts;
  private readonly flash: Sprite;
  private readonly flashMaterial: SpriteMaterial;
  private readonly light: PointLight;
  private readonly flashOffset = new Vector3(0, 0, -0.04);
  private shotAge = Number.POSITIVE_INFINITY;
  private dryAge = Number.POSITIVE_INFINITY;
  private closeAge = Number.POSITIVE_INFINITY;
  private flashAge = Number.POSITIVE_INFINITY;
  private dropAge = 0;
  private bobPhase = 0;
  private speed = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private shellsToLoad = 2;
  /** The barrel that fired last (pellets appear to leave this muzzle). */
  private activeMuzzle = 1;

  constructor() {
    this.scene.name = "viewmodel";
    this.scene.add(this.camera);
    this.scene.add(
      this.resources.track(
        new HemisphereLight(PALETTE.sky, PALETTE.ground, 1.9)
      )
    );
    const key = this.resources.track(new DirectionalLight("#FFFFFF", 2.2));
    key.position.set(-1, 2.2, 1.2);
    // A cool rim from behind-right gives the near-black metal its teal edge highlights.
    const rim = this.resources.track(new DirectionalLight("#8FE6F0", 2.4));
    rim.position.set(2, 0.8, -1.5);
    this.scene.add(key, rim);
    this.light = new PointLight(PALETTE.muzzle, 0, 1.6, 2);
    this.scene.add(this.light);

    this.parts = buildShotgun(this.resources);
    this.parts.root.position.copy(RECOIL_PIVOT).negate();
    this.recoil.position.copy(RECOIL_PIVOT);
    this.recoil.add(this.parts.root);
    this.rig.add(this.recoil);
    this.camera.add(this.rig);

    this.flashMaterial = this.resources.track(
      new SpriteMaterial({
        blending: AdditiveBlending,
        color: PALETTE.muzzle,
        depthWrite: false,
        map: this.resources.track(createFlashTexture()),
        toneMapped: false,
        transparent: true,
      })
    );
    this.flash = new Sprite(this.flashMaterial);
    this.flash.visible = false;
    this.flash.renderOrder = 5;
  }

  /** Light intensity (0..1) of the muzzle pop, mirrored by the main scene's light. */
  get pop(): number {
    return this.flashAge < POP_LIFE ? (1 - this.flashAge / POP_LIFE) ** 2 : 0;
  }

  /**
   * Screen position (NDC) of the muzzle that fired last. The gun lives in its own pass with its own
   * fov, so this is how world-space pellets line up with the barrel on screen.
   */
  muzzleNdc(target: Vector3): Vector3 {
    const [left, right] = this.parts.muzzles;
    (this.activeMuzzle === 1 ? right : left).getWorldPosition(target);
    return target.project(this.camera);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  reset(world: WorldState): void {
    this.shotAge = Number.POSITIVE_INFINITY;
    this.dryAge = Number.POSITIVE_INFINITY;
    this.closeAge = Number.POSITIVE_INFINITY;
    this.flashAge = Number.POSITIVE_INFINITY;
    this.dropAge = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.lastYaw = world.player.yaw;
    this.lastPitch = world.player.pitch;
    this.flash.visible = false;
  }

  onShot(loadedAfter: number): void {
    this.shotAge = 0;
    this.flashAge = 0;
    // Fire the right barrel first, then the left.
    this.activeMuzzle = loadedAfter >= 1 ? 1 : 0;
    const [left, right] = this.parts.muzzles;
    const muzzle = this.activeMuzzle === 1 ? right : left;
    muzzle.add(this.flash);
    this.flash.position.copy(this.flashOffset);
    this.flash.material.rotation = Math.random() * Math.PI * 2;
  }

  onDryFire(): void {
    this.dryAge = 0;
  }

  onReloadStart(world: WorldState): void {
    const missing = world.config.shotgun.capacity - world.player.loaded;
    // The sim loads min(missing, reserve) shells when the reload completes.
    this.shellsToLoad = Math.max(1, Math.min(2, missing, world.player.reserve));
  }

  onReloadEnd(): void {
    this.closeAge = 0;
  }

  update(
    world: WorldState,
    realDt: number,
    effectDt: number,
    clock: number
  ): void {
    this.shotAge += realDt;
    this.dryAge += realDt;
    this.closeAge += realDt;
    this.flashAge += effectDt;
    this.updateSway(world, realDt, clock);
    this.updateRecoil();
    this.updateReload(world.player.reloadTimer, world.config);
    this.updateFlash();
    this.dropAge = world.status === "lost" ? this.dropAge + realDt : 0;
    if (this.dropAge > 0) {
      const drop = smoothstep(0, 0.8, this.dropAge);
      this.rig.position.y -= 0.45 * drop;
      this.rig.rotation.x -= 0.5 * drop;
    }
  }

  private updateSway(world: WorldState, realDt: number, clock: number): void {
    const { player } = world;
    const speed = clamp01(
      Math.hypot(player.velocity.x, player.velocity.y) /
        Math.max(1e-3, world.config.player.moveSpeed)
    );
    this.speed = damp(this.speed, speed, 10, realDt);
    this.bobPhase +=
      realDt * Math.hypot(player.velocity.x, player.velocity.y) * 4.4;

    const dt = Math.max(realDt, 1e-3);
    const yawRate = wrapAngle(player.yaw - this.lastYaw) / dt;
    const pitchRate = (player.pitch - this.lastPitch) / dt;
    this.lastYaw = player.yaw;
    this.lastPitch = player.pitch;
    const clampSway = (value: number) =>
      Math.max(-0.035, Math.min(0.035, value));
    this.swayX = damp(this.swayX, clampSway(yawRate * 0.006), 12, realDt);
    this.swayY = damp(this.swayY, clampSway(-pitchRate * 0.006), 12, realDt);

    const s = this.speed;
    const bobX = 0.011 * s * Math.sin(this.bobPhase);
    const bobY = -0.009 * s * Math.abs(Math.cos(this.bobPhase));
    const breathe = 0.0025 * Math.sin(clock * 1.7);
    this.rig.position.set(
      REST.x + bobX + this.swayX,
      REST.y + bobY + breathe + this.swayY,
      REST.z + 0.012 * s
    );
    this.rig.rotation.set(
      REST_PITCH + this.swayY * 1.2,
      REST_YAW,
      this.swayX * 2.4 + 0.004 * Math.sin(clock * 1.1)
    );
  }

  private updateRecoil(): void {
    const shot = kick(this.shotAge, RECOIL_ATTACK, RECOIL_RECOVER);
    const dry = kick(this.dryAge, 0.02, 0.1);
    const close = kick(this.closeAge, 0.02, 0.12);
    this.recoil.rotation.x = RECOIL_PITCH * shot + 0.035 * dry - 0.03 * close;
    this.recoil.position.set(
      RECOIL_PIVOT.x,
      RECOIL_PIVOT.y + 0.018 * shot,
      RECOIL_PIVOT.z + RECOIL_BACK * shot + 0.012 * dry + 0.006 * close
    );
  }

  /** Break-action reload driven by the sim's reload timer: open, two shells slide in, snap shut. */
  private updateReload(reloadTimer: number, config: GameConfig): void {
    const duration = config.shotgun.reloadDuration;
    const r =
      reloadTimer > 0 && duration > 0 ? clamp01(1 - reloadTimer / duration) : 0;
    const reloading = reloadTimer > 0;
    const open = reloading
      ? smoothstep(0, 0.2, r) * (1 - smoothstep(0.84, 0.92, r))
      : 0;
    this.parts.hinge.rotation.x = -BREAK_ANGLE * open;
    const tilt = reloading
      ? smoothstep(0, 0.22, r) * (1 - smoothstep(0.86, 1, r))
      : 0;
    this.rig.rotation.z += 0.32 * tilt;
    this.rig.rotation.x += 0.16 * tilt;
    this.rig.position.x -= 0.04 * tilt;
    this.rig.position.y += 0.03 * tilt;

    const spans: readonly (readonly [number, number])[] = [
      [0.28, 0.58],
      [0.44, 0.74],
    ];
    for (let index = 0; index < this.parts.shells.length; index += 1) {
      const shell = this.parts.shells[index];
      const span = spans[index];
      if (!(shell && span)) {
        continue;
      }
      // With one shell to load, it goes into the right barrel (the one that fired first).
      const used = this.shellsToLoad >= 2 || index === 1;
      const p = smoothstep(span[0], span[1], r);
      shell.visible = reloading && used && r > span[0] - 0.12 && r < 0.95;
      const x = BARREL_X[index] ?? 0;
      // Drops in from just above the open breech, then slides home along the bore.
      shell.position.set(
        x,
        BARREL_Y + 0.06 * (1 - smoothstep(0, 0.4, p)),
        0.13 * (1 - smoothstep(0.25, 1, p))
      );
    }
  }

  private updateFlash(): void {
    const t = this.flashAge / FLASH_LIFE;
    this.flash.visible = t < 1;
    this.light.intensity = 2.5 * this.pop;
    if (t >= 1) {
      return;
    }
    const scale = FLASH_SIZE * (0.6 + 0.8 * easeOutCubic(t));
    this.flash.scale.set(scale, scale, 1);
    this.flashMaterial.opacity = (1 - t) ** 2;
    this.flash.getWorldPosition(this.light.position);
  }

  dispose(): void {
    this.flash.removeFromParent();
    this.light.dispose();
    this.resources.dispose();
    this.scene.clear();
  }
}
