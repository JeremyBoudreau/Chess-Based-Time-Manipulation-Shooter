import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PLAYER,
  DEFAULT_SHOTGUN,
  DEFAULT_TIME_POLICY,
} from "../config";
import { isOnBoard, squareAt } from "../geometry";
import { mulberry32 } from "../random";
import { SKIRMISH_SETUP, squareName } from "../setups";
import { createSimulation, createWorld, stepWorld } from "../simulation";
import type { GameEvent, PieceState, WorldState } from "../types";
import {
  eventsOfType,
  FRAME,
  frame,
  fullSpeed,
  makeConfig,
  makeDeps,
  makeWorld,
  run,
  waitBrain,
} from "./fixtures";

const FIRE = frame({ fire: true });
const RELOAD = frame({ reload: true });

const pieceAt = (world: WorldState, square: string): PieceState => {
  const found = world.pieces.find(
    (candidate) => squareName(candidate.square) === square
  );
  if (!found) {
    throw new Error(`no piece on ${square}`);
  }
  return found;
};

const types = (events: readonly GameEvent[]) =>
  events.map((event) => event.type);

describe("createWorld", () => {
  test("starts the player on the setup square facing White with a full gun", () => {
    const config = makeConfig({
      white: SKIRMISH_SETUP.white.map(
        (entry) => [entry.kind, squareName(entry.square)] as const
      ),
    });
    const world = createWorld(config, mulberry32(1));
    expect(world.status).toBe("playing");
    expect(world.player.pos).toEqual({ x: 4.5, y: 7.5 });
    expect(world.player.yaw).toBe(Math.PI);
    expect(world.player.loaded).toBe(DEFAULT_SHOTGUN.capacity);
    expect(world.player.reserve).toBe(DEFAULT_SHOTGUN.reserveStart);
    expect(world.timeScale).toBe(DEFAULT_TIME_POLICY.idleScale);
    expect(world.pieces.map((entry) => entry.id)).toEqual([
      "pawn-0",
      "pawn-1",
      "pawn-2",
      "pawn-3",
      "pawn-4",
      "rook-5",
      "bishop-6",
      "king-7",
    ]);
    for (const entry of world.pieces) {
      const definition = config.pieces[entry.kind];
      expect(entry.hp).toBe(definition.maxHp);
      expect(entry.actionTimer).toBeGreaterThan(
        definition.telegraphDuration + 1
      );
      expect(entry.actionTimer).toBeLessThanOrEqual(
        definition.telegraphDuration + 1 + definition.actionInterval * 1.5
      );
    }
    expect(Object.values(world.stats.kills).every((count) => count === 0)).toBe(
      true
    );
  });

  test("createSimulation steps its own world", () => {
    const sim = createSimulation(makeConfig(), makeDeps());
    expect(sim.step(frame(), FRAME)).toBe(sim.world);
    expect(sim.world.realTime).toBeCloseTo(FRAME);
  });
});

describe("time", () => {
  test("standing still for 10 seconds barely moves the clock", () => {
    const world = makeWorld();
    run(world, makeDeps(), 10);
    expect(world.realTime).toBeCloseTo(10, 6);
    expect(world.gameTime).toBeCloseTo(DEFAULT_TIME_POLICY.idleScale * 10, 6);
  });

  test("walking makes time flow at roughly full speed", () => {
    const world = makeWorld();
    const pace = (index: number) =>
      frame({ moveY: Math.floor(index / 60) % 2 === 0 ? 1 : -1 });
    run(world, makeDeps({ decide: waitBrain }), 10, { input: pace });
    expect(world.gameTime).toBeGreaterThan(9.8);
    expect(world.gameTime).toBeLessThan(10);
    expect(world.stats.distanceMoved).toBeCloseTo(
      DEFAULT_PLAYER.moveSpeed * 10,
      3
    );
  });

  test("huge frame times are clamped", () => {
    const world = makeWorld();
    stepWorld(world, frame(), 5, makeDeps());
    expect(world.realTime).toBeCloseTo(0.1);
  });
});

describe("movement", () => {
  test("pieces and the board edge stop the player", () => {
    const world = makeWorld({ playerStart: "e5", white: [["pawn", "e4"]] });
    const deps = makeDeps({ decide: waitBrain });
    run(world, deps, 1, { input: frame({ moveY: 1 }) });
    expect(world.player.pos.y).toBeCloseTo(4 - 0.12 + DEFAULT_PLAYER.radius, 6);
    expect(world.player.pos.x).toBeCloseTo(4.5, 6);
    run(world, deps, 3, { input: frame({ moveY: -1 }) });
    expect(world.player.pos.y).toBeCloseTo(8 - DEFAULT_PLAYER.radius, 6);
  });

  test("velocity reflects the real displacement", () => {
    const world = makeWorld();
    stepWorld(world, frame({ moveX: 1 }), FRAME, makeDeps());
    expect(
      Math.hypot(world.player.velocity.x, world.player.velocity.y)
    ).toBeCloseTo(DEFAULT_PLAYER.moveSpeed);
  });
});

describe("shotgun", () => {
  test("firing spawns a pellet fan, uses a shell and respects the cooldown", () => {
    const world = makeWorld();
    const deps = makeDeps();
    stepWorld(world, FIRE, FRAME, deps);
    expect(world.pellets).toHaveLength(DEFAULT_SHOTGUN.pellets);
    expect(world.player.loaded).toBe(DEFAULT_SHOTGUN.capacity - 1);
    expect(world.stats.shotsFired).toBe(1);
    expect(world.stats.pelletsFired).toBe(DEFAULT_SHOTGUN.pellets);
    expect(world.events).toContainEqual({ pellets: 5, type: "shot" });
    expect(new Set(world.pellets.map((pellet) => pellet.id)).size).toBe(5);
    expect(world.nextPelletId).toBe(6);

    stepWorld(world, FIRE, FRAME, deps);
    expect(world.stats.shotsFired).toBe(1);
  });

  test("pellets expire once they have flown their range", () => {
    const world = makeWorld();
    let furthest = 0;
    const events = run(world, makeDeps({ targetScale: fullSpeed }), 2, {
      input: (index) => (index === 0 ? FIRE : frame()),
      until: (current) => {
        for (const pellet of current.pellets) {
          furthest = Math.max(furthest, pellet.traveled);
        }
        return false;
      },
    });
    expect(world.pellets).toHaveLength(0);
    expect(eventsOfType(events, "pelletExpired")).toHaveLength(5);
    expect(furthest).toBeLessThanOrEqual(DEFAULT_SHOTGUN.pelletRange + 1e-9);
    expect(furthest).toBeGreaterThan(DEFAULT_SHOTGUN.pelletRange - 1);
  });

  test("a point-blank shot kills an adjacent pawn", () => {
    const world = makeWorld({
      playerStart: "e5",
      white: [
        ["pawn", "e4"],
        ["king", "h1"],
      ],
    });
    const events = run(
      world,
      makeDeps({ decide: waitBrain, targetScale: fullSpeed }),
      0.5,
      {
        input: (index) => (index === 0 ? FIRE : frame()),
      }
    );
    const pawn = pieceAt(world, "e4");
    expect(pawn.phase).toBe("dead");
    expect(world.stats.kills.pawn).toBe(1);
    expect(world.stats.pelletsHit).toBe(3);
    expect(eventsOfType(events, "pieceHit")).toHaveLength(3);
    expect(eventsOfType(events, "pieceKilled")).toEqual([
      {
        kind: "pawn",
        pieceId: "pawn-0",
        square: pawn.square,
        type: "pieceKilled",
      },
    ]);
    expect(world.status).toBe("playing");
  });

  test("reloading consumes reserve and takes reloadDuration at full speed", () => {
    const world = makeWorld();
    const deps = makeDeps({ decide: waitBrain });
    stepWorld(world, FIRE, FRAME, deps);
    stepWorld(world, RELOAD, FRAME, deps);
    expect(world.events).toContainEqual({ type: "reloadStart" });
    expect(world.timeScale).toBe(1);
    const started = world.realTime - FRAME;

    stepWorld(world, FIRE, FRAME, deps);
    expect(world.stats.shotsFired).toBe(1);

    const events = run(world, deps, 3, {
      until: (current) => current.player.reloadTimer === 0,
    });
    expect(world.realTime - started).toBeGreaterThan(
      DEFAULT_SHOTGUN.reloadDuration - 1e-9
    );
    expect(world.realTime - started).toBeLessThan(
      DEFAULT_SHOTGUN.reloadDuration + FRAME * 1.5
    );
    expect(eventsOfType(events, "reloadEnd")).toEqual([
      { loaded: 2, type: "reloadEnd" },
    ]);
    expect(world.player.loaded).toBe(DEFAULT_SHOTGUN.capacity);
    expect(world.player.reserve).toBe(DEFAULT_SHOTGUN.reserveStart - 1);
  });

  test("reloading a full gun does nothing", () => {
    const world = makeWorld();
    stepWorld(world, RELOAD, FRAME, makeDeps());
    expect(world.player.reloadTimer).toBe(0);
    expect(world.events).toEqual([]);
  });

  test("an empty gun dry-fires", () => {
    const world = makeWorld({ shotgun: { reserveStart: 0 } });
    const trigger = (index: number) => (index % 20 === 0 ? FIRE : frame());
    const events = run(world, makeDeps({ decide: waitBrain }), 1, {
      input: trigger,
    });
    expect(world.player.loaded).toBe(0);
    expect(types(events).filter((type) => type === "shot")).toHaveLength(2);
    expect(eventsOfType(events, "dryFire").length).toBeGreaterThanOrEqual(1);
    expect(world.stats.shotsFired).toBe(2);
  });

  test("reserve shells regenerate in game time up to the cap", () => {
    const world = makeWorld({
      shotgun: { reserveRegenInterval: 0.5, reserveStart: 0 },
    });
    const deps = makeDeps({ decide: waitBrain, targetScale: fullSpeed });
    const events = run(world, deps, 2);
    const expected = Math.floor(world.gameTime / 0.5);
    expect(world.player.reserve).toBe(expected);
    expect(eventsOfType(events, "shellRegenerated")).toHaveLength(expected);
    run(world, deps, 5);
    expect(world.player.reserve).toBe(DEFAULT_SHOTGUN.reserveMax);
  });
});

describe("pieces", () => {
  test("a rook on the king's file captures the king after telegraphing", () => {
    const world = makeWorld({ white: [["rook", "e1"]] }, 4);
    const telegraphTimes: number[] = [];
    let capturedAt = Number.NaN;
    const events = run(world, makeDeps({ targetScale: fullSpeed }, 4), 20, {
      until: (current) => {
        if (current.events.some((event) => event.type === "pieceTelegraph")) {
          telegraphTimes.push(current.gameTime);
        }
        if (current.status !== "playing") {
          capturedAt = current.gameTime;
          return true;
        }
        return false;
      },
    });
    const rook = pieceAt(world, "e8");
    expect(world.status).toBe("lost");
    expect(world.killedBy).toBe("rook");
    expect(world.player.alive).toBe(false);
    expect(rook.isAttacking).toBe(true);
    expect(squareName(rook.fromSquare)).toBe("e1");
    expect(eventsOfType(events, "kingCaptured")).toEqual([
      { kind: "rook", pieceId: "rook-0", type: "kingCaptured" },
    ]);
    const telegraphedAt = telegraphTimes.at(-1) ?? Number.NaN;
    expect(capturedAt - telegraphedAt).toBeCloseTo(1.2, 1);

    const frozenAt = world.gameTime;
    run(world, makeDeps(), 1);
    expect(world.gameTime).toBe(frozenAt);
    expect(rook.moveProgress).toBe(1);
    expect(world.events).toEqual([]);
  });

  test("killing the white king wins", () => {
    const world = makeWorld({
      pieces: {
        king: {
          actionInterval: 5.2,
          intervalJitter: 0.25,
          kind: "king",
          maxHp: 5,
          moveDuration: 0.4,
          telegraphDuration: 1.3,
        },
      },
      playerStart: "e5",
      white: [["king", "e4"]],
    });
    const events = run(world, makeDeps({ targetScale: fullSpeed }), 0.5, {
      input: (index) => (index === 0 ? FIRE : frame()),
      until: (current) => current.status !== "playing",
    });
    expect(world.status).toBe("won");
    expect(world.stats.kills.king).toBe(1);
    expect(types(events)).toContain("victory");
    expect(world.player.alive).toBe(true);
    const frozenAt = world.gameTime;
    run(world, makeDeps(), 0.5, { input: frame({ moveY: 1 }) });
    expect(world.gameTime).toBe(frozenAt);
  });

  test("a pawn reaching the last rank promotes to a queen", () => {
    const world = makeWorld({ playerStart: "a8", white: [["pawn", "e7"]] });
    const events = run(world, makeDeps({ targetScale: fullSpeed }), 20, {
      until: (current) =>
        current.events.some((event) => event.type === "piecePromoted"),
    });
    const promoted = pieceAt(world, "e8");
    expect(promoted.kind).toBe("queen");
    expect(promoted.hp).toBe(9);
    expect(eventsOfType(events, "pieceMoved")).toHaveLength(1);
    expect(squareAt(world.player.pos)).toEqual({ file: 0, rank: 7 });
  });

  test("telegraphing pieces animate towards their action", () => {
    const world = makeWorld({ white: [["pawn", "a2"]] });
    run(world, makeDeps({ decide: waitBrain, targetScale: fullSpeed }), 20, {
      until: (current) => current.pieces[0]?.phase === "telegraph",
    });
    run(world, makeDeps({ decide: waitBrain, targetScale: fullSpeed }), 0.5);
    const [pawn] = world.pieces;
    expect(pawn?.phase).toBe("telegraph");
    expect(pawn?.telegraphProgress).toBeGreaterThan(0.3);
    expect(pawn?.telegraphProgress).toBeLessThan(1);
  });
});

describe("invariants", () => {
  const randomInput = (rng: () => number) => {
    let current = frame();
    return (index: number) => {
      if (index % 30 === 0) {
        current = frame({
          lookYaw: (rng() - 0.5) * 0.1,
          moveX: rng() * 2 - 1,
          moveY: rng() * 2 - 1,
        });
      }
      return {
        ...current,
        fire: rng() < 0.05,
        reload: rng() < 0.02,
      };
    };
  };

  const checkInvariants = (world: WorldState): void => {
    const { radius } = world.config.player;
    const living = world.pieces.filter((entry) => entry.phase !== "dead");
    const occupied = new Set(living.map((entry) => squareName(entry.square)));
    expect(occupied.size).toBe(living.length);
    for (const entry of living) {
      expect(isOnBoard(entry.square)).toBe(true);
    }
    const { player } = world;
    expect(player.pos.x).toBeGreaterThanOrEqual(radius - 1e-9);
    expect(player.pos.x).toBeLessThanOrEqual(8 - radius + 1e-9);
    expect(player.pos.y).toBeGreaterThanOrEqual(radius - 1e-9);
    expect(player.pos.y).toBeLessThanOrEqual(8 - radius + 1e-9);
    if (world.status === "playing") {
      expect(occupied.has(squareName(squareAt(player.pos)))).toBe(false);
    }
    expect(player.loaded).toBeGreaterThanOrEqual(0);
    expect(player.loaded).toBeLessThanOrEqual(world.config.shotgun.capacity);
    expect(player.reserve).toBeGreaterThanOrEqual(0);
    expect(player.reserve).toBeLessThanOrEqual(world.config.shotgun.reserveMax);
    expect(world.timeScale).toBeGreaterThan(0);
    expect(world.timeScale).toBeLessThanOrEqual(1);
  };

  test("random skirmishes never break the board rules", () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const config = makeConfig({
        white: SKIRMISH_SETUP.white.map(
          (entry) => [entry.kind, squareName(entry.square)] as const
        ),
      });
      const deps = makeDeps({}, seed);
      const world = createWorld(config, deps.rng);
      run(world, deps, 90, {
        input: randomInput(mulberry32(seed * 7919)),
        until: (current) => {
          checkInvariants(current);
          return current.status !== "playing";
        },
      });
      outcomes.add(world.status);
    }
    expect(outcomes.has("lost")).toBe(true);
  });
});
