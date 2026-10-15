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

/**
 * The SUPERHOT rule: time flows at the speed of the player's most "active" signal.
 * Returns the *target* scale in [idleScale, 1]; the simulation smooths towards it.
 */
export const targetTimeScale = (
  _policy: TimePolicyData,
  _signals: TimeSignals
): number => {
  throw new Error("not implemented");
};
