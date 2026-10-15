import type { WorldState } from "@buckshot/core";
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import {
  boardToWorld,
  clamp01,
  damp,
  easeInOutCubic,
  easeOutCubic,
} from "./coords";
import { EYE_HEIGHT } from "./palette";

const BASE_FOV = 62;
/** Degrees the view widens at a full sprint: the speed reads before the legs do. */
const SPRINT_FOV_KICK = 7;
/** 1/s: eases the sprint feel in and out in ~0.15 s. */
const SPRINT_RESPONSE = 16;
/** Head-bob amplitude gain at a full sprint (longer, heavier strides). */
const SPRINT_BOB_DEPTH = 0.7;
/** Step cadence gain at a full sprint (on top of the walking cadence). */
const SPRINT_BOB_QUICKEN = 0.3;
const SHAKE_TIME = 0.18;
const SHAKE_AMPLITUDE = 0.028;
const DEATH_TIME = 2;
const DEATH_ROLL = (25 * Math.PI) / 180;
const DEATH_EYE = 0.34;
/** How far the dying king topples back, away from the attacker, while sinking. */
const DEATH_FALL_BACK = 0.85;
const VICTORY_TIME = 3;
const VICTORY_PUSH = 0.8;

const UP = new Vector3(0, 1, 0);
const VIEW_AXIS = new Vector3(0, 0, 1);

/** Where the death cam should look and from which side the blow came. */
export interface DeathFocus {
  /** World position of the attacker's base. */
  readonly base: Vector3;
  /** Attacker model height (the cam looks up at roughly its head). */
  readonly height: number;
}

/**
 * The first-person camera: eye height, head bob with speed, a sprint FOV kick, a kick of shake per
 * shot, and the two cinematic endings — the SUPERHOT death (roll and sink while staring at the
 * attacker) and a slow push-in toward the fallen white king on victory.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(BASE_FOV, 1, 0.03, 120);
  private readonly eye = new Vector3();
  private readonly offset = new Vector3();
  private readonly target = new Vector3();
  private readonly look = new Matrix4();
  private readonly startQuat = new Quaternion();
  private readonly endQuat = new Quaternion();
  private readonly roll = new Quaternion();
  private readonly startPos = new Vector3();
  private readonly endPos = new Vector3();
  /** Direction the dying king topples, fixed on the first death frame (see `updateDeath`). */
  private readonly fallDir = new Vector3();
  private hasFallDir: boolean;
  private shakeAge = Number.POSITIVE_INFINITY;
  private bobPhase = 0;
  private speed = 0;
  /** Smoothed 0..1 sprint envelope (FOV kick, deeper and quicker bob). */
  private sprint = 0;
  private endAge = 0;
  private ending: "none" | "lost" | "won" = "none";

  constructor() {
    this.camera.rotation.order = "YXZ";
    this.hasFallDir = false;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  reset(world: WorldState): void {
    this.shakeAge = Number.POSITIVE_INFINITY;
    this.bobPhase = 0;
    this.speed = 0;
    this.sprint = 0;
    this.applyFov();
    this.endAge = 0;
    this.ending = "none";
    this.hasFallDir = false;
    this.placeFirstPerson(world, 0, 0, false);
  }

  onShot(): void {
    this.shakeAge = 0;
  }

  /**
   * `focus` is the attacker on a loss or where the white king fell on a win; null falls back to a
   * plain fall / no push-in. `walking` is false on frames the world did not step (paused), whose
   * stale `player.velocity` must not keep the head bobbing.
   */
  update(
    world: WorldState,
    realDt: number,
    clock: number,
    focus: DeathFocus | null,
    walking: boolean
  ): void {
    this.shakeAge += realDt;
    // `sprinting` is as stale as `velocity` on frames without a step; it also eases out on death.
    const sprinting = walking && world.player.sprinting;
    this.sprint = damp(this.sprint, sprinting ? 1 : 0, SPRINT_RESPONSE, realDt);
    this.applyFov();
    if (world.status === "playing") {
      this.ending = "none";
      this.placeFirstPerson(world, realDt, clock, walking);
      return;
    }
    if (this.ending === "none") {
      this.ending = world.status;
      this.endAge = 0;
      this.hasFallDir = false;
      this.startPos.copy(this.camera.position);
      this.startQuat.copy(this.camera.quaternion);
    }
    this.endAge += realDt;
    if (this.ending === "lost") {
      this.updateDeath(world, focus);
    } else {
      this.updateVictory(focus);
    }
  }

  private placeFirstPerson(
    world: WorldState,
    realDt: number,
    clock: number,
    walking: boolean
  ): void {
    const { player } = world;
    // Zero when the world did not step, so the damp below eases the bob out instead of looping it.
    const velocity = walking
      ? Math.hypot(player.velocity.x, player.velocity.y)
      : 0;
    const speed = clamp01(
      velocity / Math.max(1e-3, world.config.player.moveSpeed)
    );
    this.speed = damp(this.speed, speed, 8, realDt);
    // Cadence follows walking speed only; a sprint quickens it by a fixed factor instead of the
    // full 1.6× leg speed, which would turn the bob into a jitter.
    const cadence = Math.min(velocity, world.config.player.moveSpeed);
    this.bobPhase +=
      realDt * cadence * 4.4 * (1 + SPRINT_BOB_QUICKEN * this.sprint);
    const s = this.speed * (1 + SPRINT_BOB_DEPTH * this.sprint);
    const bobY = 0.032 * s * Math.sin(this.bobPhase * 2);
    const bobSide = 0.018 * s * Math.sin(this.bobPhase);

    boardToWorld(this.eye, player.pos.x, player.pos.y, EYE_HEIGHT + bobY);
    // right(yaw) in world space is (cos yaw, 0, -sin yaw).
    this.eye.x += Math.cos(player.yaw) * bobSide;
    this.eye.z -= Math.sin(player.yaw) * bobSide;

    const shake =
      this.shakeAge < SHAKE_TIME ? (1 - this.shakeAge / SHAKE_TIME) ** 2 : 0;
    if (shake > 0) {
      this.offset.set(
        Math.sin(clock * 91) * SHAKE_AMPLITUDE * shake,
        Math.sin(clock * 113 + 1.3) * SHAKE_AMPLITUDE * shake,
        Math.sin(clock * 71 + 2.1) * SHAKE_AMPLITUDE * shake
      );
      this.eye.add(this.offset);
    }
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(
      player.pitch + 0.03 * shake + 0.004 * s * Math.sin(this.bobPhase * 2),
      player.yaw,
      0.006 * s * Math.sin(this.bobPhase)
    );
  }

  private applyFov(): void {
    const fov = BASE_FOV + SPRINT_FOV_KICK * this.sprint;
    if (Math.abs(fov - this.camera.fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** SUPERHOT death: topple back and sink to the board, rolling, eyes locked on the attacker. */
  private updateDeath(world: WorldState, focus: DeathFocus | null): void {
    const t = easeOutCubic(clamp01(this.endAge / DEATH_TIME));
    const { player } = world;
    boardToWorld(this.endPos, player.pos.x, player.pos.y, DEATH_EYE);
    if (focus) {
      if (!this.hasFallDir) {
        // Fix the direction once, away from where the blow came from: on the first death frame the
        // attacker still stands on its starting square. Recomputing it every frame would swing it
        // (up to 180°) as the lunge carries the attacker through us to the centre of our square.
        this.fallDir.set(
          this.endPos.x - focus.base.x,
          0,
          this.endPos.z - focus.base.z
        );
        if (this.fallDir.lengthSq() < 1e-6) {
          // Attacker already on our spot: fall back opposite to where we were facing.
          this.fallDir.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
        }
        this.fallDir.normalize();
        this.hasFallDir = true;
      }
      this.endPos.addScaledVector(this.fallDir, DEATH_FALL_BACK);
      // Only the gaze follows the lunge.
      this.target.copy(focus.base);
      this.target.y += focus.height * 0.75;
    } else {
      this.target
        .copy(this.endPos)
        .add(
          this.offset.set(-Math.sin(player.yaw), 0.6, -Math.cos(player.yaw))
        );
    }
    this.camera.position.lerpVectors(this.startPos, this.endPos, t);
    this.look.lookAt(this.camera.position, this.target, UP);
    this.endQuat.setFromRotationMatrix(this.look);
    this.roll.setFromAxisAngle(VIEW_AXIS, DEATH_ROLL * t);
    this.endQuat.multiply(this.roll);
    this.camera.quaternion.slerpQuaternions(this.startQuat, this.endQuat, t);
  }

  /** Optional victory beat: drift toward where the white king fell. */
  private updateVictory(focus: DeathFocus | null): void {
    if (!focus) {
      return;
    }
    const t = easeInOutCubic(clamp01(this.endAge / VICTORY_TIME));
    this.offset.set(
      focus.base.x - this.startPos.x,
      0,
      focus.base.z - this.startPos.z
    );
    const distance = this.offset.length();
    if (distance < 1e-3) {
      return;
    }
    this.offset.multiplyScalar(
      Math.min(VICTORY_PUSH, distance * 0.5) / distance
    );
    this.camera.position.copy(this.startPos).addScaledVector(this.offset, t);
  }
}
