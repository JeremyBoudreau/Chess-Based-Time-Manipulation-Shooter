import { clamp } from "./geometry";
import type { TimePolicyData } from "./types";

/** Raw player-activity signals sampled each frame. */
export interface TimeSignals {
  /** Camera angular speed in radians per real second. */
  readonly lookSpeed: number;
  /**
   * |velocity| / walking speed: 1 at a walk, `sprintScale` at a full sprint. The clock's leg term is
   * exactly this ratio, which is what ties sprint speed and sprint time together.
   */
  readonly moveFraction: number;
  readonly reloading: boolean;
  /** True while a post-shot burst is active. */
  readonly shotBurst: boolean;
  /** Sprint held AND actually moving: Shift alone (standing still, or pressed into a wall) is false. */
  readonly sprinting: boolean;
}

/** Looking around speeds time up, but never all the way: aiming alone must stay a "free" action. */
const lookScale = (policy: TimePolicyData, lookSpeed: number): number => {
  if (policy.lookFullSpeed <= 0) {
    return lookSpeed > 0 ? policy.lookMaxScale : 0;
  }
  return Math.min(policy.lookMaxScale, lookSpeed / policy.lookFullSpeed);
};

/**
 * Time follows the legs: the leg term is your speed relative to a walk, so a walk is 1× and a full
 * sprint is `sprintScale`× — the same factor the legs were sped up by. The activity cap keeps a
 * non-sprinting king at 1×.
 */
const moveScale = (signals: TimeSignals): number =>
  Math.max(0, signals.moveFraction);

/** Ceiling for legs + camera: real time, or the sprint scale while sprinting. */
const activityCap = (policy: TimePolicyData, sprinting: boolean): number =>
  sprinting ? Math.max(1, policy.sprintScale) : 1;

/** The fastest the world can ever run: a full sprint during a reload. */
export const maxTimeScale = (policy: TimePolicyData): number =>
  Math.max(1, policy.sprintScale) + policy.reloadCapBonus;

/**
 * The SUPERHOT rule, with stacking effects:
 *   - legs + camera add up, capped at 1 (the cap rises to `sprintScale` while sprinting);
 *   - reloading adds `reloadBonus` on top and lifts that cap by `reloadCapBonus`, so a still reload
 *     runs at 1×, walking while reloading at 1.5× and sprinting while reloading at 2.25×;
 *   - a post-shot burst briefly guarantees at least real time.
 * Returns the *target* scale in [idleScale, maxTimeScale]; the simulation smooths towards it.
 */
export const targetTimeScale = (
  policy: TimePolicyData,
  signals: TimeSignals
): number => {
  const cap = activityCap(policy, signals.sprinting);
  const activity = Math.min(
    cap,
    moveScale(signals) + lookScale(policy, signals.lookSpeed)
  );
  const reloaded = signals.reloading
    ? Math.min(activity + policy.reloadBonus, cap + policy.reloadCapBonus)
    : activity;
  const target = signals.shotBurst ? Math.max(reloaded, 1) : reloaded;
  return clamp(target, policy.idleScale, maxTimeScale(policy));
};
