import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PICKUPS,
  DEFAULT_PIECE_CATALOG,
  DEFAULT_PLAYER,
  DEFAULT_SHOTGUN,
  DEFAULT_TIME_POLICY,
} from "../config";
import { isOnBoard, squareAt, squareCenter } from "../geometry";
import { mulberry32 } from "../random";
import { moveTravel, squaresPassed } from "../rules";
import { SKIRMISH_SETUP, squareName } from "../setups";
import { createSimulation, createWorld, stepWorld } from "../simulation";
import { maxTimeScale, targetTimeScale } from "../time";
import type { GameEvent, PieceState, Square, WorldState } from "../types";
import {
  eventsOfType,
  FRAME,
  frame,
  fullSpeed,
  makeConfig,
  makeDeps,
  makeWorld,
  pickup,
  run,
  sq,
  waitBrain,
} from "./fixtures";

const FIRE = frame({ fire: true });
const RELOAD = frame({ reload: true });
/** With yaw = π (facing White), strafing right walks towards the a-file — open board from e8. */
const SPRINT = frame({ moveX: 1, sprint: true });
/** No opening boxes and a clock that never runs out: the test places every box itself. */
const NO_SPAWNS = { initialPickups: 0, spawnInterval: 1e6 } as const;

const skirmishWhite = () =>
  SKIRMISH_SETUP.white.map(
    (entry) => [entry.kind, squareName(entry.square)] as const
  );

const kingSteps = (a: Square, b: Square): number =>
  Math.max(Math.abs(a.file - b.file), Math.abs(a.rank - b.rank));

const speedOf = (world: WorldState): number =>
  Math.hypot(world.player.velocity.x, world.player.velocity.y);

/** The spawn rule: on the board, off every living piece and box, and far enough from the king. */
const expectValidSpawn = (world: WorldState, square: Square): void => {
  expect(isOnBoard(square)).toBe(true);
  const onPiece = world.pieces.some(
    (entry) =>
      entry.phase !== "dead" && squareName(entry.square) === squareName(square)
  );
  expect(onPiece).toBe(false);
  expect(kingSteps(square, squareAt(world.player.pos))).toBeGreaterThanOrEqual(
    world.config.pickups.minSpawnDistance
  );
};

const pickupNames = (world: WorldState): string[] =>
  world.pickups.map((box) => squareName(box.square)).sort();

const crushedNames = (events: readonly GameEvent[]): string[] =>
  eventsOfType(events, "pickupCrushed")
    .map((event) => squareName(event.square))
    .sort();

const untilMoved = (world: WorldState): boolean =>
  world.events.some((event) => event.type === "pieceMoved");

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

  test("opens with a few shell boxes, away from the king and the army", () => {
    const { initialPickups, shellsPerPickup, spawnInterval, spawnJitter } =
      DEFAULT_PICKUPS;
    for (let seed = 1; seed <= 20; seed += 1) {
      const world = createWorld(
        makeConfig({ white: skirmishWhite() }),
        mulberry32(seed)
      );
      expect(world.pickups.map((box) => box.id)).toEqual(
        Array.from({ length: initialPickups }, (_, index) => index + 1)
      );
      expect(world.nextPickupId).toBe(initialPickups + 1);
      expect(new Set(pickupNames(world)).size).toBe(initialPickups);
      for (const box of world.pickups) {
        expect(box.age).toBe(0);
        expect(box.shells).toBe(shellsPerPickup);
        expectValidSpawn(world, box.square);
      }
      expect(world.pickupTimer).toBeGreaterThanOrEqual(
        spawnInterval * (1 - spawnJitter)
      );
      expect(world.pickupTimer).toBeLessThanOrEqual(
        spawnInterval * (1 + spawnJitter)
      );
      expect(world.stats.shellsCollected).toBe(0);
      expect(world.player.sprinting).toBe(false);
      expect(world.events).toEqual([]);
    }
  });

  test("never opens with more boxes than the board may hold", () => {
    const world = makeWorld({ pickups: { initialPickups: 9, maxOnBoard: 4 } });
    expect(world.pickups).toHaveLength(4);
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
    expect(DEFAULT_TIME_POLICY.idleScale).toBeGreaterThan(0);
    expect(world.gameTime).toBeCloseTo(DEFAULT_TIME_POLICY.idleScale * 10, 6);
    expect(world.pieces.every((entry) => entry.phase === "idle")).toBe(true);
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

describe("sprint", () => {
  const { moveSpeed } = DEFAULT_PLAYER;
  const { idleScale, sprintScale } = DEFAULT_TIME_POLICY;

  test("Shift moves the king sprintScale times faster than walking", () => {
    const world = makeWorld();
    const deps = makeDeps({ decide: waitBrain });
    stepWorld(world, SPRINT, FRAME, deps);
    expect(sprintScale).toBeGreaterThan(1);
    expect(speedOf(world)).toBeCloseTo(moveSpeed * sprintScale);
    expect(world.player.sprinting).toBe(true);

    stepWorld(world, frame({ moveX: 1 }), FRAME, deps);
    expect(speedOf(world)).toBeCloseTo(moveSpeed);
    expect(world.player.sprinting).toBe(false);
  });

  test("a full sprint runs time faster than real time", () => {
    const world = makeWorld();
    run(world, makeDeps({ decide: waitBrain }), 0.8, { input: SPRINT });
    expect(world.player.sprinting).toBe(true);
    expect(world.timeScale).toBeCloseTo(sprintScale, 3);
    expect(world.gameTime).toBeGreaterThan(world.realTime);
    expect(world.stats.distanceMoved).toBeCloseTo(
      moveSpeed * sprintScale * 0.8,
      3
    );
  });

  test("sprint speed and sprint time are the same factor", () => {
    for (const scale of [1.25, 1.75, 2.5]) {
      const config = makeConfig();
      const time = { ...config.time, sprintScale: scale };
      const world = createWorld({ ...config, time }, mulberry32(7));
      // One policy feeds both the legs (via config) and the clock (via deps), as the seams do.
      const deps = makeDeps({
        decide: waitBrain,
        targetScale: (signals) => targetTimeScale(time, signals),
      });
      // Short enough that even a 2.5x sprint from e8 never reaches the board edge.
      run(world, deps, 0.6, { input: SPRINT });
      expect(speedOf(world) / moveSpeed).toBeCloseTo(scale, 6);
      expect(world.timeScale).toBeCloseTo(scale, 2);
    }
  });

  test("holding Shift while standing still does not speed time up", () => {
    const world = makeWorld();
    run(world, makeDeps({ decide: waitBrain }), 2, {
      input: frame({ sprint: true }),
    });
    expect(world.player.sprinting).toBe(false);
    expect(world.gameTime).toBeCloseTo(idleScale * 2, 6);
  });

  test("sprinting into a wall does not speed time up either", () => {
    const world = makeWorld();
    const deps = makeDeps({ decide: waitBrain });
    // Backwards from e8 runs straight into the board's back edge within a few frames.
    const intoWall = frame({ moveY: -1, sprint: true });
    run(world, deps, 0.5, { input: intoWall });
    expect(world.player.sprinting).toBe(false);
    const before = world.gameTime;
    run(world, deps, 2, { input: intoWall });
    expect(world.player.sprinting).toBe(false);
    expect(world.gameTime - before).toBeCloseTo(idleScale * 2, 2);
    expect(world.timeScale).toBeCloseTo(idleScale, 4);
  });

  test("a sprinting reload costs its full game time but less real time", () => {
    const world = makeWorld();
    const deps = makeDeps({ decide: waitBrain });
    const { reloadDuration } = DEFAULT_SHOTGUN;
    stepWorld(world, FIRE, FRAME, deps);
    const gameBefore = world.gameTime;
    const realBefore = world.realTime;
    stepWorld(world, { ...SPRINT, reload: true }, FRAME, deps);
    expect(world.events).toContainEqual({ type: "reloadStart" });
    expect(world.timeScale).toBeGreaterThanOrEqual(1);

    let peak = 0;
    const events = run(world, deps, 3, {
      input: SPRINT,
      until: (current) => {
        peak = Math.max(peak, current.timeScale);
        return current.player.reloadTimer === 0;
      },
    });
    expect(eventsOfType(events, "reloadEnd")).toEqual([
      { loaded: DEFAULT_SHOTGUN.capacity, type: "reloadEnd" },
    ]);
    const top = maxTimeScale(DEFAULT_TIME_POLICY);
    const gameSpent = world.gameTime - gameBefore;
    expect(gameSpent).toBeGreaterThan(reloadDuration - 1e-9);
    expect(gameSpent).toBeLessThan(reloadDuration + FRAME * top);
    const realSpent = world.realTime - realBefore;
    expect(realSpent).toBeLessThan(reloadDuration * 0.6);
    expect(realSpent).toBeGreaterThan(reloadDuration / top);
    // Reloading stacks on top of the sprint: the world runs past the plain sprint scale.
    expect(peak).toBeGreaterThan(sprintScale + 0.3);
    expect(peak).toBeLessThanOrEqual(top + 1e-9);
  });

  test("reloading stacks with movement: still 1x, walking 1.5x", () => {
    const deps = makeDeps({ decide: waitBrain });
    const peakDuringReload = (input: typeof SPRINT): number => {
      const world = makeWorld();
      stepWorld(world, FIRE, FRAME, deps);
      stepWorld(world, { ...input, reload: true }, FRAME, deps);
      let peak = 0;
      run(world, deps, 3, {
        input,
        until: (current) => {
          peak = Math.max(peak, current.timeScale);
          return current.player.reloadTimer === 0;
        },
      });
      return peak;
    };
    expect(peakDuringReload(frame())).toBeCloseTo(1, 6);
    const walking = peakDuringReload(frame({ moveX: 1 }));
    expect(walking).toBeGreaterThan(1.4);
    expect(walking).toBeLessThanOrEqual(1.5 + 1e-9);
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

  test("a long frame cannot wedge the player between two side-by-side pieces", () => {
    const world = makeWorld({
      white: [
        ["pawn", "d7"],
        ["pawn", "e7"],
      ],
    });
    world.player.pos = { x: 4, y: 7.6 };
    const deps = makeDeps({ decide: waitBrain });
    const push = frame({ moveY: 1 });
    let lowest = world.player.pos.y;
    const track = (current: WorldState) => {
      lowest = Math.min(lowest, current.player.pos.y);
      return false;
    };
    // Press into the notch between d7 and e7, take one hitch frame, then keep pushing.
    run(world, deps, 30 * FRAME, { input: push, until: track });
    stepWorld(world, push, 0.1, deps);
    track(world);
    run(world, deps, 2, { input: push, until: track });
    expect(lowest).toBeGreaterThan(7 - 0.12);
    expect(squareAt(world.player.pos).rank).toBe(7);
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

  test("pellets fired from a square's corner cannot slip diagonally between two pieces", () => {
    const world = makeWorld({
      playerStart: "e5",
      shotgun: { pellets: 1, spreadDegrees: 0, spreadJitter: 0 },
      white: [
        ["pawn", "f5"],
        ["pawn", "e6"],
        ["king", "f6"],
      ],
    });
    const deps = makeDeps({ decide: waitBrain, targetScale: fullSpeed });
    world.player.yaw = -Math.PI / 4;
    // Walk into e5's north-east corner, so the barrel itself sits inside f6.
    run(world, deps, 2, { input: frame({ moveY: 1 }) });
    expect(squareName(squareAt(world.player.pos))).toBe("e5");
    expect(world.player.pos.x).toBeGreaterThan(4.85);
    expect(world.player.pos.y).toBeGreaterThan(4.85);

    const events = run(world, deps, 2, {
      input: (index) => (index === 0 ? FIRE : frame()),
    });
    const hits = eventsOfType(events, "pieceHit");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe("pawn");
    expect(pieceAt(world, "f6").hp).toBe(world.config.pieces.king.maxHp);
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

  test("reserve shells no longer regenerate on their own", () => {
    const world = makeWorld({
      pickups: NO_SPAWNS,
      shotgun: { reserveStart: 0 },
    });
    run(world, makeDeps({ decide: waitBrain, targetScale: fullSpeed }), 5);
    expect(world.gameTime).toBeGreaterThan(4);
    expect(world.player.reserve).toBe(0);
  });
});

describe("pickups", () => {
  const { reserveMax } = DEFAULT_SHOTGUN;
  const still = () => makeDeps({ decide: waitBrain });

  test("boxes drop on the spawn clock, in game time", () => {
    const interval = 1;
    const world = makeWorld({
      pickups: {
        initialPickups: 0,
        maxOnBoard: 10,
        spawnInterval: interval,
        spawnJitter: 0,
      },
    });
    const spawnTimes: number[] = [];
    const events = run(
      world,
      makeDeps({ decide: waitBrain, targetScale: fullSpeed }),
      4.5,
      {
        until: (current) => {
          if (current.events.some((event) => event.type === "pickupSpawned")) {
            spawnTimes.push(current.gameTime);
          }
          return false;
        },
      }
    );
    expect(spawnTimes).toHaveLength(4);
    let previous = 0;
    for (const time of spawnTimes) {
      expect(time - previous).toBeGreaterThan(interval - 1e-9);
      expect(time - previous).toBeLessThan(interval + FRAME + 1e-9);
      previous = time;
    }
    const spawned = eventsOfType(events, "pickupSpawned");
    expect(spawned.map((event) => event.pickupId)).toEqual([1, 2, 3, 4]);
    expect(
      world.pickups.map((box) => ({
        pickupId: box.id,
        square: box.square,
        type: "pickupSpawned",
      }))
    ).toEqual(spawned);
    const [oldest, newest] = [world.pickups[0], world.pickups.at(-1)];
    expect(oldest?.age).toBeCloseTo(world.gameTime - (spawnTimes[0] ?? 0), 9);
    expect(newest?.age).toBeCloseTo(world.gameTime - (spawnTimes[3] ?? 0), 9);
  });

  test("boxes never land on a piece, another box, or near the king", () => {
    // e8's neighbourhood: d7 holds a piece, a2 and h1 sit outside it.
    const cases = [
      { expected: 64 - 6 - 2, minSpawnDistance: 2 },
      { expected: 64 - 15 - 2, minSpawnDistance: 3 },
    ];
    for (const { expected, minSpawnDistance } of cases) {
      const world = makeWorld({
        pickups: {
          initialPickups: 0,
          maxOnBoard: 64,
          minSpawnDistance,
          spawnInterval: 0.005,
          spawnJitter: 0,
        },
        white: [
          ["pawn", "a2"],
          ["rook", "h1"],
          ["king", "d7"],
        ],
      });
      const events = run(
        world,
        makeDeps({ decide: waitBrain, targetScale: fullSpeed }),
        3
      );
      // Every candidate square filled, then attempts with no room are skipped.
      expect(world.pickups).toHaveLength(expected);
      expect(eventsOfType(events, "pickupSpawned")).toHaveLength(expected);
      expect(new Set(pickupNames(world)).size).toBe(expected);
      for (const box of world.pickups) {
        expectValidSpawn(world, box.square);
      }
    }
  });

  test("never more than maxOnBoard, and the clock keeps restarting while full", () => {
    const interval = 0.25;
    const world = makeWorld({
      pickups: {
        initialPickups: 0,
        maxOnBoard: 3,
        spawnInterval: interval,
        spawnJitter: 0,
      },
    });
    const deps = makeDeps({ decide: waitBrain, targetScale: fullSpeed });
    const events = run(world, deps, 4, {
      until: (current) => {
        expect(current.pickups.length).toBeLessThanOrEqual(3);
        expect(current.pickupTimer).toBeGreaterThan(0);
        expect(current.pickupTimer).toBeLessThanOrEqual(interval);
        return false;
      },
    });
    expect(world.pickups).toHaveLength(3);
    expect(eventsOfType(events, "pickupSpawned")).toHaveLength(3);

    // Taking a box frees a slot, but the replacement waits for the clock.
    const [taken] = world.pickups;
    if (!taken) {
      throw new Error("expected a box");
    }
    world.player.reserve = 0;
    world.player.pos = squareCenter(taken.square);
    world.pickupTimer = 0.2;
    stepWorld(world, frame(), FRAME, deps);
    expect(world.pickups).toHaveLength(2);
    const collectedAt = world.gameTime;
    run(world, deps, 1, { until: (current) => current.pickups.length === 3 });
    expect(world.gameTime - collectedAt).toBeGreaterThan(0.2 - FRAME);
    expect(world.gameTime - collectedAt).toBeLessThan(0.2 + FRAME);
  });

  test("walking onto a box tops the reserve up to reserveMax", () => {
    const world = makeWorld({ pickups: NO_SPAWNS });
    const box = pickup("e7");
    world.pickups = [box];
    world.player.reserve = reserveMax - 1;
    const events = run(world, still(), 1, {
      input: frame({ moveY: 1 }),
      until: (current) => current.pickups.length === 0,
    });
    expect(squareName(squareAt(world.player.pos))).toBe("e7");
    expect(eventsOfType(events, "pickupCollected")).toEqual([
      {
        pickupId: box.id,
        reserve: reserveMax,
        shells: 1,
        square: box.square,
        type: "pickupCollected",
      },
    ]);
    expect(world.player.reserve).toBe(reserveMax);
    expect(world.stats.shellsCollected).toBe(1);
  });

  test("a box hands over all its shells when there is room, even while time creeps", () => {
    const world = makeWorld({ pickups: NO_SPAWNS });
    const box = pickup("c5");
    world.pickups = [box];
    world.player.reserve = 1;
    world.player.pos = squareCenter(box.square);
    stepWorld(world, frame(), FRAME, still());
    expect(world.timeScale).toBeLessThan(0.05);
    expect(world.player.reserve).toBe(1 + box.shells);
    expect(world.stats.shellsCollected).toBe(box.shells);
    expect(world.pickups).toEqual([]);
    expect(world.events).toContainEqual({
      pickupId: box.id,
      reserve: 1 + box.shells,
      shells: box.shells,
      square: box.square,
      type: "pickupCollected",
    });
  });

  test("a full reserve leaves the box on the board for later", () => {
    const world = makeWorld({ pickups: NO_SPAWNS });
    const box = pickup("c5");
    world.pickups = [box];
    world.player.pos = squareCenter(box.square);
    const events = run(world, still(), 0.5);
    expect(world.player.reserve).toBe(reserveMax);
    expect(world.pickups).toEqual([box]);
    expect(eventsOfType(events, "pickupCollected")).toEqual([]);
    expect(world.stats.shellsCollected).toBe(0);

    world.player.reserve = reserveMax - 3;
    stepWorld(world, frame(), FRAME, still());
    expect(world.player.reserve).toBe(reserveMax - 3 + box.shells);
    expect(world.pickups).toEqual([]);
  });
});

describe("pieces crushing pickups", () => {
  /** Where the crusher was along its move when each box broke. */
  interface Crush {
    readonly frame: number;
    readonly progress: number;
    readonly square: string;
  }

  /** Runs until the first move has fully landed (or the game is over), logging every crush. */
  const crushTest = (
    options: { playerStart: string; white: [PieceState["kind"], string] },
    boxes: readonly string[]
  ) => {
    const world = makeWorld({
      pickups: NO_SPAWNS,
      playerStart: options.playerStart,
      white: [options.white],
    });
    world.pickups = boxes.map((square) => pickup(square));
    const crushes: Crush[] = [];
    let frameIndex = 0;
    let movedAt = -1;
    const events = run(world, makeDeps({ targetScale: fullSpeed }), 20, {
      until: (current) => {
        frameIndex += 1;
        if (untilMoved(current)) {
          movedAt = frameIndex;
        }
        for (const event of eventsOfType(current.events, "pickupCrushed")) {
          crushes.push({
            frame: frameIndex,
            progress: current.pieces[0]?.moveProgress ?? Number.NaN,
            square: squareName(event.square),
          });
        }
        return (
          current.status !== "playing" ||
          (movedAt > 0 && current.pieces[0]?.phase !== "moving")
        );
      },
    });
    return { crushes, events, movedAt, world };
  };

  test("a rook sliding over boxes crushes them; one past its destination survives", () => {
    const { events, world } = crushTest(
      { playerStart: "f7", white: ["rook", "a1"] },
      ["a4", "a7", "a8", "c3"]
    );
    expect(eventsOfType(events, "pieceMoved")).toEqual([
      { from: sq("a1"), pieceId: "rook-0", to: sq("a7"), type: "pieceMoved" },
    ]);
    expect(crushedNames(events)).toEqual(["a4", "a7"]);
    expect(
      eventsOfType(events, "pickupCrushed").every(
        (event) => event.pieceId === "rook-0"
      )
    ).toBe(true);
    expect(pickupNames(world)).toEqual(["a8", "c3"]);
  });

  test("a sliding piece crushes each box only as it reaches it, not when it sets off", () => {
    const { crushes, movedAt, world } = crushTest(
      { playerStart: "f7", white: ["rook", "a1"] },
      ["a2", "a4", "a7"]
    );
    expect(movedAt).toBeGreaterThan(0);
    expect(crushes.map((crush) => crush.square)).toEqual(["a2", "a4", "a7"]);
    expect(crushes.every((crush) => crush.frame > movedAt)).toBe(true);
    // a1 → a7 is six squares; each box breaks as the rook's centre crosses into its square.
    const [a2, a4, a7] = crushes;
    expect(moveTravel(a2?.progress ?? 0)).toBeGreaterThanOrEqual(0.5 / 6);
    expect(moveTravel(a2?.progress ?? 1)).toBeLessThan(2.5 / 6);
    expect(moveTravel(a4?.progress ?? 0)).toBeGreaterThanOrEqual(2.5 / 6);
    expect(moveTravel(a4?.progress ?? 1)).toBeLessThan(5.5 / 6);
    expect(moveTravel(a7?.progress ?? 0)).toBeGreaterThanOrEqual(5.5 / 6);
    expect(a2?.frame).toBeLessThan(a4?.frame ?? 0);
    expect(a4?.frame).toBeLessThan(a7?.frame ?? 0);
    expect(world.pickups).toEqual([]);
  });

  test("a piece shot dead mid-move spares the boxes it never reached", () => {
    const world = makeWorld({
      pickups: NO_SPAWNS,
      pieces: {
        pawn: { ...DEFAULT_PIECE_CATALOG.pawn, moveDuration: 2 },
      },
      playerStart: "d7",
      white: [["pawn", "d4"]],
    });
    world.pickups = [pickup("d5")];
    const deps = makeDeps({ targetScale: fullSpeed });
    run(world, deps, 20, { until: untilMoved });
    const [pawn] = world.pieces;
    if (!pawn) {
      throw new Error("expected the pawn");
    }
    expect(squareName(pawn.square)).toBe("d5");
    expect(pickupNames(world)).toEqual(["d5"]);

    // Facing White from d7, the shot runs straight down the d-file into the gliding pawn.
    pawn.hp = 1;
    const events = run(world, deps, 1, {
      input: (index) => (index === 0 ? FIRE : frame()),
      until: (current) => current.pieces[0]?.phase === "dead",
    });
    expect(pawn.phase).toBe("dead");
    expect(pawn.moveProgress).toBeLessThan(0.5);
    expect(eventsOfType(events, "pickupCrushed")).toEqual([]);

    run(world, deps, 1);
    expect(pickupNames(world)).toEqual(["d5"]);
    // Nothing guards the square any more, so the box is the player's to take.
    world.player.reserve = 0;
    world.player.pos = squareCenter(sq("d5"));
    stepWorld(world, frame(), FRAME, deps);
    expect(world.pickups).toEqual([]);
    expect(world.player.reserve).toBe(DEFAULT_PICKUPS.shellsPerPickup);
  });

  test("the player can grab a box on a slider's path before the slider gets there", () => {
    const world = makeWorld({
      pickups: NO_SPAWNS,
      playerStart: "f7",
      white: [["rook", "a1"]],
    });
    world.pickups = [pickup("a5"), pickup("a7")];
    const deps = makeDeps({ targetScale: fullSpeed });
    run(world, deps, 20, { until: untilMoved });
    expect(squareName(world.pieces[0]?.square ?? sq("a1"))).toBe("a7");
    expect(pickupNames(world)).toEqual(["a5", "a7"]);

    // The rook has set off for a7; the king dashes onto a5 ahead of it.
    world.player.reserve = 0;
    world.player.pos = squareCenter(sq("a5"));
    const events = run(world, deps, 2, {
      until: (current) => current.pieces[0]?.phase !== "moving",
    });
    expect(
      eventsOfType(events, "pickupCollected").map((event) => event.pickupId)
    ).toEqual([pickup("a5").id]);
    expect(crushedNames(events)).toEqual(["a7"]);
    expect(world.player.reserve).toBe(DEFAULT_PICKUPS.shellsPerPickup);
  });

  test("a knight only crushes the box it lands on, and only once it lands", () => {
    const { crushes, events, world } = crushTest(
      { playerStart: "c8", white: ["knight", "b1"] },
      ["b2", "c2", "c3"]
    );
    expect(eventsOfType(events, "pieceMoved")[0]?.to).toEqual(sq("c3"));
    expect(crushedNames(events)).toEqual(["c3"]);
    expect(crushes.map((crush) => crush.progress)).toEqual([1]);
    expect(pickupNames(world)).toEqual(["b2", "c2"]);
  });

  test("a pawn's double push crushes both squares", () => {
    const { events, world } = crushTest(
      { playerStart: "e8", white: ["pawn", "e2"] },
      ["e3", "e4", "e5"]
    );
    expect(eventsOfType(events, "pieceMoved")[0]?.to).toEqual(sq("e4"));
    expect(crushedNames(events)).toEqual(["e3", "e4"]);
    expect(pickupNames(world)).toEqual(["e5"]);
  });

  test("an attack crushes the boxes on its way at once, including one under the king", () => {
    const { crushes, events, world } = crushTest(
      { playerStart: "a8", white: ["rook", "a1"] },
      ["a5", "a8", "b5"]
    );
    expect(world.status).toBe("lost");
    expect(crushedNames(events)).toEqual(["a5", "a8"]);
    expect(crushes.map((crush) => crush.progress)).toEqual([0, 0]);
    expect(pickupNames(world)).toEqual(["b5"]);
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
          sprint: rng() < 0.4,
        });
      }
      return {
        ...current,
        fire: rng() < 0.05,
        reload: rng() < 0.02,
      };
    };
  };

  /**
   * Boxes are unique, on the board, and never more than allowed. No box survives under a resting
   * piece or on a square a moving piece has already passed over; one may still sit ahead of a
   * moving piece, its destination included, until the piece gets there.
   */
  const checkPickups = (world: WorldState): void => {
    const squares = world.pickups.map((box) => squareName(box.square));
    expect(world.pickups.length).toBeLessThanOrEqual(
      world.config.pickups.maxOnBoard
    );
    expect(new Set(squares).size).toBe(squares.length);
    const covered = new Set<string>();
    for (const entry of world.pieces) {
      if (entry.phase === "dead") {
        continue;
      }
      const passed =
        entry.phase === "moving" ? squaresPassed(entry) : [entry.square];
      for (const square of passed) {
        covered.add(squareName(square));
      }
    }
    for (const box of world.pickups) {
      expect(isOnBoard(box.square)).toBe(true);
      expect(covered.has(squareName(box.square))).toBe(false);
    }
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
    expect(world.timeScale).toBeLessThanOrEqual(
      maxTimeScale(world.config.time) + 1e-9
    );
    checkPickups(world);
  };

  test("random skirmishes never break the board rules", () => {
    const outcomes = new Set<string>();
    let collected = 0;
    let crushed = 0;
    let fastest = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const config = makeConfig({ white: skirmishWhite() });
      const deps = makeDeps({}, seed);
      const world = createWorld(config, deps.rng);
      const events = run(world, deps, 90, {
        input: randomInput(mulberry32(seed * 7919)),
        until: (current) => {
          checkInvariants(current);
          fastest = Math.max(fastest, current.timeScale);
          return current.status !== "playing";
        },
      });
      collected += eventsOfType(events, "pickupCollected").length;
      crushed += eventsOfType(events, "pickupCrushed").length;
      outcomes.add(world.status);
    }
    expect(outcomes.has("lost")).toBe(true);
    // The random walks really exercise the new rules, not just survive them.
    expect(collected).toBeGreaterThan(0);
    expect(crushed).toBeGreaterThan(0);
    expect(fastest).toBeGreaterThan(1);
  });

  test("the board rules hold at the longest simulated frame too", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const config = makeConfig({ white: skirmishWhite() });
      const deps = makeDeps({}, seed);
      const world = createWorld(config, deps.rng);
      run(world, deps, 90, {
        dt: 0.1,
        input: randomInput(mulberry32(seed * 104_729)),
        until: (current) => {
          checkInvariants(current);
          return current.status !== "playing";
        },
      });
    }
  });
});
