// The web app does not install @types/bun (core and db do), so the runner's own module has no
// declarations here; drop this directive once it does — tsc will flag it as unused.
// @ts-expect-error bun:test is provided by `bun test` at runtime
import { describe, expect, test } from "bun:test";
import { EASY_SETUP, HARD_SETUP, MEDIUM_SETUP } from "@buckshot/core";
import { setupFromParam, withDifficulty } from "../difficulty";
import { armyOf, countPieces } from "../pieces";

describe("setupFromParam", () => {
  test("picks the named difficulty", () => {
    expect(setupFromParam("medium")).toBe(MEDIUM_SETUP);
    expect(setupFromParam("hard")).toBe(HARD_SETUP);
  });

  test("falls back to Easy for a missing or unknown value", () => {
    expect(setupFromParam(undefined)).toBe(EASY_SETUP);
    expect(setupFromParam("nightmare")).toBe(EASY_SETUP);
    expect(setupFromParam("")).toBe(EASY_SETUP);
    expect(setupFromParam("HARD")).toBe(EASY_SETUP);
  });

  test("uses the first of a repeated parameter", () => {
    expect(setupFromParam(["hard", "medium"])).toBe(HARD_SETUP);
    expect(setupFromParam([])).toBe(EASY_SETUP);
  });

  test("resolves the legacy id like findSetup", () => {
    expect(setupFromParam("skirmish")).toBe(EASY_SETUP);
  });
});

describe("withDifficulty", () => {
  test("adds the difficulty as a query parameter", () => {
    expect(withDifficulty("/play", "hard")).toBe("/play?difficulty=hard");
  });
});

describe("armyOf", () => {
  test("counts each kind, kings first and pawns last, skipping absent kinds", () => {
    expect(armyOf(EASY_SETUP)).toEqual([
      { count: 1, kind: "king" },
      { count: 1, kind: "rook" },
      { count: 1, kind: "bishop" },
      { count: 5, kind: "pawn" },
    ]);
    expect(armyOf(HARD_SETUP)).toEqual([
      { count: 1, kind: "king" },
      { count: 1, kind: "queen" },
      { count: 2, kind: "rook" },
      { count: 2, kind: "bishop" },
      { count: 2, kind: "knight" },
      { count: 8, kind: "pawn" },
    ]);
  });

  test("accounts for every piece the setup fields", () => {
    for (const setup of [EASY_SETUP, MEDIUM_SETUP, HARD_SETUP]) {
      const total = armyOf(setup).reduce((sum, entry) => sum + entry.count, 0);
      expect(total).toBe(setup.white.length);
    }
  });
});

describe("countPieces", () => {
  test("pluralises past one", () => {
    expect(countPieces(1, "rook")).toBe("1 rook");
    expect(countPieces(5, "pawn")).toBe("5 pawns");
  });
});
