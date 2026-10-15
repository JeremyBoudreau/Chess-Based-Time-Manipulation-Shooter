// The web app does not install @types/bun (core and db do), so the runner's own module has no
// declarations here; drop this directive once it does — tsc will flag it as unused.
// @ts-expect-error bun:test is provided by `bun test` at runtime
import { describe, expect, test } from "bun:test";
import { SETUPS } from "@buckshot/core";
import { safeNext } from "@/lib/safe-next";
import {
  describeDifficulties,
  difficultyFromParams,
  difficultyHref,
  signInHref,
} from "../difficulty";

const OPTIONS = describeDifficulties(SETUPS);

describe("difficultyFromParams", () => {
  test("takes a listed difficulty from the URL over the fallback", () => {
    expect(
      difficultyFromParams(
        OPTIONS,
        new URLSearchParams("difficulty=easy"),
        "hard"
      )
    ).toBe("easy");
  });

  test("falls back when the URL has no, or no listed, difficulty", () => {
    expect(difficultyFromParams(OPTIONS, new URLSearchParams(), "hard")).toBe(
      "hard"
    );
    expect(
      difficultyFromParams(
        OPTIONS,
        new URLSearchParams("difficulty=nightmare"),
        "medium"
      )
    ).toBe("medium");
    expect(difficultyFromParams(OPTIONS, null, "easy")).toBe("easy");
  });
});

describe("difficultyHref", () => {
  test("scopes a path to one difficulty", () => {
    expect(difficultyHref("/leaderboard", "medium")).toBe(
      "/leaderboard?difficulty=medium"
    );
  });
});

describe("signInHref", () => {
  test("returns the player to the same difficulty after signing in", () => {
    for (const id of ["easy", "medium", "hard"]) {
      const href = signInHref(id);
      expect(href.startsWith("/sign-in?next=")).toBe(true);
      const next = new URL(href, "http://x.invalid").searchParams.get("next");
      // The auth form only follows destinations that pass safeNext; the difficulty must survive it.
      expect(safeNext(next)).toBe(`/play?difficulty=${id}`);
    }
  });
});
