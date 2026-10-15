import { describe, expect, test } from "bun:test";
import { DEFAULT_TIME_POLICY } from "../config";
import { type TimeSignals, targetTimeScale } from "../time";

const still: TimeSignals = {
  lookSpeed: 0,
  moveFraction: 0,
  reloading: false,
  shotBurst: false,
};

const target = (signals: Partial<TimeSignals>) =>
  targetTimeScale(DEFAULT_TIME_POLICY, { ...still, ...signals });

describe("targetTimeScale", () => {
  test("standing still runs at the idle scale", () => {
    expect(target({})).toBe(DEFAULT_TIME_POLICY.idleScale);
  });

  test("walking maps 1:1 to time and is clamped", () => {
    expect(target({ moveFraction: 0.5 })).toBeCloseTo(0.5);
    expect(target({ moveFraction: 1 })).toBe(1);
    expect(target({ moveFraction: 3 })).toBe(1);
    expect(target({ moveFraction: -2 })).toBe(DEFAULT_TIME_POLICY.idleScale);
  });

  test("looking speeds time up, capped below full speed", () => {
    const halfLook = DEFAULT_TIME_POLICY.lookFullSpeed / 4;
    expect(target({ lookSpeed: halfLook })).toBeCloseTo(0.25);
    expect(target({ lookSpeed: 1000 })).toBe(DEFAULT_TIME_POLICY.lookMaxScale);
  });

  test("reloading and shot bursts force full speed", () => {
    expect(target({ reloading: true })).toBe(1);
    expect(target({ shotBurst: true })).toBe(1);
  });

  test("the most active signal wins", () => {
    expect(target({ lookSpeed: 1000, moveFraction: 0.9 })).toBeCloseTo(0.9);
    expect(target({ lookSpeed: 1000, moveFraction: 0.2 })).toBe(
      DEFAULT_TIME_POLICY.lookMaxScale
    );
  });

  test("a zero idle scale freezes time completely", () => {
    const frozen = { ...DEFAULT_TIME_POLICY, idleScale: 0 };
    expect(targetTimeScale(frozen, still)).toBe(0);
  });
});
