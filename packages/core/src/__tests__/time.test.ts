import { describe, expect, test } from "bun:test";
import { DEFAULT_TIME_POLICY } from "../config";
import { maxTimeScale, type TimeSignals, targetTimeScale } from "../time";

const still: TimeSignals = {
  lookSpeed: 0,
  moveFraction: 0,
  reloading: false,
  shotBurst: false,
  sprinting: false,
};

const target = (signals: Partial<TimeSignals>) =>
  targetTimeScale(DEFAULT_TIME_POLICY, { ...still, ...signals });

const { lookMaxScale, reloadBonus, reloadCapBonus, sprintScale } =
  DEFAULT_TIME_POLICY;

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

  test("a full sprint runs time faster than real time", () => {
    expect(sprintScale).toBeGreaterThan(1);
    expect(target({ moveFraction: 1, sprinting: true })).toBeCloseTo(
      sprintScale
    );
    expect(target({ moveFraction: 0.5, sprinting: true })).toBeCloseTo(
      0.5 * sprintScale
    );
    expect(target({ moveFraction: 3, sprinting: true })).toBeCloseTo(
      sprintScale
    );
  });

  test("the sprint flag alone does not speed time up", () => {
    expect(target({ sprinting: true })).toBe(DEFAULT_TIME_POLICY.idleScale);
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

  test("legs and camera add up, capped at real time", () => {
    expect(target({ lookSpeed: 1000, moveFraction: 0.2 })).toBeCloseTo(
      0.2 + lookMaxScale
    );
    expect(target({ lookSpeed: 1000, moveFraction: 0.9 })).toBe(1);
  });

  test("sprinting lifts the legs + camera cap to the sprint scale", () => {
    expect(
      target({ lookSpeed: 1000, moveFraction: 1, sprinting: true })
    ).toBeCloseTo(sprintScale);
    expect(
      target({ lookSpeed: 1000, moveFraction: 0.5, sprinting: true })
    ).toBeCloseTo(0.5 * sprintScale + lookMaxScale);
  });

  test("reloading adds a full second per second on top of activity", () => {
    expect(reloadBonus).toBe(1);
    expect(target({ moveFraction: 0.3, reloading: true })).toBeCloseTo(1.3);
    expect(
      target({
        lookSpeed: DEFAULT_TIME_POLICY.lookFullSpeed / 5,
        reloading: true,
      })
    ).toBeCloseTo(1.2);
  });

  test("reloading lifts the cap by half: still 1x, walking 1.5x, sprinting 2.25x", () => {
    expect(reloadCapBonus).toBe(0.5);
    expect(target({ reloading: true })).toBe(1);
    expect(target({ moveFraction: 1, reloading: true })).toBeCloseTo(1.5);
    expect(
      target({ lookSpeed: 1000, moveFraction: 1, reloading: true })
    ).toBeCloseTo(1.5);
    expect(
      target({ moveFraction: 1, reloading: true, sprinting: true })
    ).toBeCloseTo(sprintScale + reloadCapBonus);
  });

  test("maxTimeScale is a full sprint during a reload", () => {
    expect(maxTimeScale(DEFAULT_TIME_POLICY)).toBeCloseTo(2.25);
    expect(
      target({
        lookSpeed: 1000,
        moveFraction: 5,
        reloading: true,
        shotBurst: true,
        sprinting: true,
      })
    ).toBeCloseTo(maxTimeScale(DEFAULT_TIME_POLICY));
  });

  test("a zero idle scale freezes time completely", () => {
    const frozen = { ...DEFAULT_TIME_POLICY, idleScale: 0 };
    expect(targetTimeScale(frozen, still)).toBe(0);
  });

  test("a policy without a real sprint boost never exceeds full speed", () => {
    const flat = { ...DEFAULT_TIME_POLICY, sprintScale: 0.8 };
    expect(
      targetTimeScale(flat, { ...still, moveFraction: 1, sprinting: true })
    ).toBeCloseTo(0.8);
    expect(targetTimeScale(flat, { ...still, reloading: true })).toBe(1);
  });
});
