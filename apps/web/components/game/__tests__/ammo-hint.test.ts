// The web app does not install @types/bun (core and db do), so the runner's own module has no
// declarations here; drop this directive once it does — tsc will flag it as unused.
// @ts-expect-error bun:test is provided by `bun test` at runtime
import { describe, expect, test } from "bun:test";
import { type AmmoHintInput, ammoHint } from "../ammo-hint";

const hint = (input: Partial<AmmoHintInput>): string | null =>
  ammoHint({
    loaded: 2,
    pickupsOnBoard: 0,
    reserve: 0,
    shellSpawnRate: 1,
    ...input,
  })?.text ?? null;

describe("ammoHint", () => {
  test("nearly dry with nothing on the board: the boost line still says to move", () => {
    // Shells drop on game time, which barely passes standing still, so a boosted hint that only
    // said "faster" would have the player wait for drops that never come.
    expect(hint({ loaded: 1, shellSpawnRate: 2 })).toBe(
      "Low — shells drop 2× faster as you move"
    );
    expect(hint({ loaded: 0, shellSpawnRate: 2 })).toBe(
      "Out of shells — they drop 2× faster, keep moving"
    );
  });

  test("takes the factor from the HUD rate instead of assuming 2×", () => {
    expect(hint({ loaded: 1, shellSpawnRate: 1.5 })).toBe(
      "Low — shells drop 1.5× faster as you move"
    );
    expect(hint({ loaded: 0, shellSpawnRate: 3 })).toBe(
      "Out of shells — they drop 3× faster, keep moving"
    );
  });

  test("claims no boost when core is not applying one", () => {
    expect(hint({ loaded: 2 })).toBe("Low — shells drop as you move");
    expect(hint({ loaded: 0 })).toBe("Out of shells — keep moving");
  });

  test("shells already on the board beat the drop-rate line", () => {
    expect(hint({ loaded: 1, pickupsOnBoard: 1, shellSpawnRate: 2 })).toBe(
      "Shells on the board — walk over them"
    );
    expect(hint({ loaded: 0, pickupsOnBoard: 2, shellSpawnRate: 2 })).toBe(
      "Out of shells — grab one off the board"
    );
  });

  test("empty barrels with reserve say reload; plenty of shells says nothing", () => {
    expect(
      ammoHint({ loaded: 0, pickupsOnBoard: 0, reserve: 3, shellSpawnRate: 1 })
    ).toEqual({
      text: "R — reload",
      urgent: true,
    });
    expect(hint({ loaded: 2, reserve: 1 })).toBeNull();
  });
});
