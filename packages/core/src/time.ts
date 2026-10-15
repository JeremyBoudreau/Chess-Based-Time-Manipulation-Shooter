import { clamp } from "./geometry";
import type { TimePolicyData } from "./types";

/** Raw player-activity signals sampled each frame. */
export interface TimeSignals {
  /** Camera angular speed in radians per real second. */
  readonly lookSpeed: number;
  /** |velocity| / moveSpeed, 0..1. */
  readonly moveFraction: number;
  readonly reloading: boolean;
  /** True while a post-shot burst is active. */
  readonly shotBurst: boolean;
}

/** Looking around speeds time up, but never all the way: aiming alone must stay a "free" action. */
const lookScale = (policy: TimePolicyData, lookSpeed: number): number => {
  if (policy.lookFullSpeed <= 0) {
    return lookSpeed > 0 ? policy.lookMaxScale : 0;
  }
  return Math.min(policy.lookMaxScale, lookSpeed / policy.lookFullSpeed);
};

/**
 * The SUPERHOT rule: time flows at the speed of the player's most "active" signal.
 * Returns the *target* scale in [idleScale, 1]; the simulation smooths towards it.
 */
export const targetTimeScale = (
  policy: TimePolicyData,
  signals: TimeSignals
): number => {
  const target = Math.max(
    policy.idleScale,
    clamp(signals.moveFraction, 0, 1),
    lookScale(policy, signals.lookSpeed),
    signals.reloading ? 1 : 0,
    signals.shotBurst ? 1 : 0
  );
  return clamp(target, policy.idleScale, 1);
};
