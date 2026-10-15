import { describe, expect, test } from "bun:test";
import { Effect, ManagedRuntime } from "effect";
import { isOnBoard, sameSquare, squareKey } from "../geometry";
import { mulberry32 } from "../random";
import { CoreLive, GameFactory } from "../seams";
import {
  DEFAULT_SETUP,
  EASY_SETUP,
  findSetup,
  HARD_SETUP,
  isDifficulty,
  MEDIUM_SETUP,
  SETUPS,
  squareName,
} from "../setups";
import { createWorld } from "../simulation";
import type {
  FrameInput,
  PieceKind,
  SetupDefinition,
  SetupPiece,
} from "../types";
import { FRAME, frame, makeConfig, makeDeps, run } from "./fixtures";

const countKinds = (setup: SetupDefinition): Record<PieceKind, number> => {
  const counts: Record<PieceKind, number> = {
    bishop: 0,
    king: 0,
    knight: 0,
    pawn: 0,
    queen: 0,
    rook: 0,
  };
  for (const entry of setup.white) {
    counts[entry.kind] += 1;
  }
  return counts;
};

const label = (entry: SetupPiece): string =>
  `${entry.kind}@${squareName(entry.square)}`;

describe("difficulties", () => {
  test("are listed easiest first and Easy is the default", () => {
    expect(SETUPS.map((setup) => setup.id)).toEqual(["easy", "medium", "hard"]);
    expect(DEFAULT_SETUP).toBe(EASY_SETUP);
  });

  test("Easy is the original army: 5 pawns, a rook, a bishop and the king", () => {
    expect(countKinds(EASY_SETUP)).toEqual({
      bishop: 1,
      king: 1,
      knight: 0,
      pawn: 5,
      queen: 0,
      rook: 1,
    });
  });

  test("Medium adds a rook, a bishop and 3 pawns", () => {
    expect(countKinds(MEDIUM_SETUP)).toEqual({
      bishop: 2,
      king: 1,
      knight: 0,
      pawn: 8,
      queen: 0,
      rook: 2,
    });
  });

  test("Hard adds two knights and a queen on top of Medium", () => {
    expect(countKinds(HARD_SETUP)).toEqual({
      bishop: 2,
      king: 1,
      knight: 2,
      pawn: 8,
      queen: 1,
      rook: 2,
    });
  });

  test("each harder army keeps every piece of the easier one on the same square", () => {
    const pairs: [SetupDefinition, SetupDefinition][] = [
      [EASY_SETUP, MEDIUM_SETUP],
      [MEDIUM_SETUP, HARD_SETUP],
    ];
    for (const [easier, harder] of pairs) {
      const harderPieces = new Set(harder.white.map(label));
      for (const entry of easier.white) {
        expect(harderPieces.has(label(entry))).toBe(true);
      }
    }
  });

  test("every army is legal: on the board, one piece per square, clear of the king's start", () => {
    for (const setup of SETUPS) {
      const keys = setup.white.map((entry) => squareKey(entry.square));
      expect(new Set(keys).size).toBe(keys.length);
      for (const entry of setup.white) {
        expect(isOnBoard(entry.square)).toBe(true);
        expect(sameSquare(entry.square, setup.playerStart)).toBe(false);
      }
    }
  });
});

describe("findSetup", () => {
  test("resolves every difficulty by id", () => {
    for (const setup of SETUPS) {
      expect(findSetup(setup.id)).toBe(setup);
      expect(isDifficulty(setup.id)).toBe(true);
    }
  });

  test("maps the pre-difficulty 'skirmish' id to Easy", () => {
    expect(findSetup("skirmish")).toBe(EASY_SETUP);
  });

  test("returns undefined for unknown ids", () => {
    expect(findSetup("nightmare")).toBeUndefined();
    expect(isDifficulty("nightmare")).toBe(false);
  });
});

describe("GameFactory seam", () => {
  test("builds a game for each difficulty, and Easy when none is given", async () => {
    const runtime = ManagedRuntime.make(CoreLive);
    const pieceCount = (setupId?: string) =>
      runtime.runSync(
        Effect.gen(function* () {
          const factory = yield* GameFactory;
          const game = yield* factory.create(setupId ? { setupId } : {});
          return game.world.pieces.length;
        })
      );
    expect(pieceCount()).toBe(EASY_SETUP.white.length);
    expect(pieceCount("medium")).toBe(MEDIUM_SETUP.white.length);
    expect(pieceCount("hard")).toBe(16);
    await runtime.dispose();
  });

  test("rejects an unknown difficulty with a typed error", async () => {
    const runtime = ManagedRuntime.make(CoreLive);
    const failure = runtime.runSync(
      Effect.gen(function* () {
        const factory = yield* GameFactory;
        return yield* factory.create({ setupId: "nightmare" });
      }).pipe(
        Effect.map(() => "created"),
        Effect.catchTag("UnknownSetupError", (error) =>
          Effect.succeed(error.setupId)
        )
      )
    );
    expect(failure).toBe("nightmare");
    await runtime.dispose();
  });
});

describe("Hard under load", () => {
  test("a seeded full-army game keeps one living piece per square", () => {
    const config = { ...makeConfig(), setup: HARD_SETUP };
    for (let seed = 1; seed <= 6; seed += 1) {
      const world = createWorld(config, mulberry32(seed));
      const deps = makeDeps({}, seed);
      const random = mulberry32(seed * 7919);
      const wander = (index: number): FrameInput =>
        index % 45 === 0
          ? frame({ fire: true })
          : frame({
              lookYaw: (random() - 0.5) * 0.05,
              moveX: Math.sin(index / 37 + seed),
              moveY: Math.cos(index / 53 + seed),
            });
      run(world, deps, 20, {
        input: wander,
        until: (current) => {
          const living = current.pieces.filter(
            (entry) => entry.phase !== "dead"
          );
          const keys = new Set(living.map((entry) => squareKey(entry.square)));
          expect(keys.size).toBe(living.length);
          return current.status !== "playing";
        },
      });
      expect(world.realTime).toBeGreaterThan(FRAME);
    }
  });
});
