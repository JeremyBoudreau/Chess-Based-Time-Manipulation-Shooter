import {
  type CreateGameOptions,
  IDLE_INPUT,
  type RunResult,
  type Simulation,
  toRunResult,
  type WorldState,
} from "@buckshot/core";
import { GameAudio } from "./audio";
import { HudStore } from "./hud";
import { InputController } from "./input";
import { GameRenderer } from "./renderer";
import { createGame } from "./runtime";

/** Longest real-time step we simulate; a stalled tab must not teleport pellets through pieces. */
const MAX_FRAME_SECONDS = 0.1;
/** Above 2x the GPU cost grows quadratically for no visible gain. */
const MAX_PIXEL_RATIO = 2;
/**
 * R is also the reload key and gets mashed, so a reflex press just after the kill (or the capture)
 * must not wipe the death camera, the chant or the results card. Only a deliberate R restarts.
 */
const RESTART_GRACE_MS = 800;

/** No id means "core's default setup", so the option is left out rather than sent as undefined. */
const gameOptions = (setupId: string | undefined): CreateGameOptions =>
  setupId ? { setupId } : {};

export interface GameClientOptions {
  readonly canvas: HTMLCanvasElement;
  /** Element whose size drives the renderer (observed with a ResizeObserver). */
  readonly container: HTMLElement;
  /** Supply a store when the UI subscribes before the client exists; otherwise one is created. */
  readonly hud?: HudStore;
  /** The loop stopped because something threw (renderer/simulation bug). */
  readonly onError?: (error: unknown) => void;
  /** Called once per game when the run ends (won or lost), outside the animation frame. */
  readonly onGameOver?: (result: RunResult) => void;
  /** A pointer-lock request was refused (e.g. re-clicking too soon after Escape). */
  readonly onLockError?: () => void;
  /**
   * Setup (difficulty) to start on; core's default setup when omitted. Only the first game uses
   * it: `restart({ setupId })` switches, and every later restart keeps the latest choice.
   */
  readonly setupId?: string;
}

export interface RestartOptions {
  /** Switch to this setup (difficulty); omitted = replay the current one. */
  readonly setupId?: string;
}

/**
 * Owns one browser game session: simulation, renderer, input, audio and the HUD store, glued by a
 * `requestAnimationFrame` loop. Framework-agnostic on purpose so React only mounts/unmounts it and
 * reads the HUD store; nothing in the hot loop goes through React.
 *
 * Pause model: pointer lock *is* the pause switch. Without it the world is not stepped but is still
 * rendered (so the scene stays visible under the pause overlay). After game over the world keeps
 * being stepped with idle input so death/victory animations can finish.
 */
export class GameClient {
  readonly hud: HudStore;

  private readonly options: GameClientOptions;
  private readonly renderer: GameRenderer;
  private readonly input: InputController;
  private readonly audio: GameAudio;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribers: (() => void)[] = [];
  private simulation: Simulation;
  /**
   * The setup id restarts rebuild, as requested (undefined = core's default). Kept apart from the
   * world's resolved id so R-to-restart and "Play again" replay exactly what was asked for.
   */
  private requestedSetupId: string | undefined;
  private rafId: number | null = null;
  private lastFrame = 0;
  private gameOverReported: boolean;
  /** `performance.now()` when the current game ended; gates the instant restart. */
  private gameOverAt = 0;
  private disposed: boolean;

  constructor(options: GameClientOptions) {
    this.gameOverReported = false;
    this.disposed = false;
    this.options = options;
    this.requestedSetupId = options.setupId;
    this.hud = options.hud ?? new HudStore();
    // Pure simulation first: if core or the renderer throws, nothing with listeners exists yet.
    this.simulation = createGame(gameOptions(this.requestedSetupId));
    this.renderer = new GameRenderer({ canvas: options.canvas });
    this.input = new InputController({ target: options.canvas });
    this.audio = new GameAudio();
    this.resizeObserver = new ResizeObserver(this.handleResize);
    try {
      this.renderer.reset(this.simulation.world);
      // Before React subscribes, so the UI never shows the default setup for a frame.
      this.publishHud();
      this.unsubscribers.push(
        this.input.onKey(this.handleKey),
        this.input.onLockChange(this.handleLockChange)
      );
      if (options.onLockError) {
        this.unsubscribers.push(this.input.onLockError(options.onLockError));
      }
      this.resizeObserver.observe(options.container);
      this.handleResize();
      this.startLoop();
    } catch (error) {
      // Half-built: release listeners and GPU resources before surfacing the error.
      this.dispose();
      throw error;
    }
  }

  /** The live world (read-only use: debugging, analytics). */
  get world(): WorldState {
    return this.simulation.world;
  }

  /** Id of the setup (difficulty) on the board, as core resolved it (legacy ids map to theirs). */
  get setupId(): string {
    return this.simulation.world.config.setup.id;
  }

  /**
   * Begin/resume play. Call from a click handler: pointer lock and the AudioContext both need the
   * user gesture.
   */
  start(): void {
    if (this.disposed) {
      return;
    }
    this.audio.unlock();
    this.input.requestLock();
  }

  /** Give the cursor back (results screen buttons) without counting as a pause. */
  releasePointer(): void {
    this.input.exitLock();
  }

  /**
   * Fresh game; keeps pointer lock so play resumes instantly. Pass `setupId` to switch difficulty:
   * the board is rebuilt for that army and later restarts keep it. An unknown id throws before
   * anything changes, so the current game survives a bad request.
   */
  restart(options: RestartOptions = {}): void {
    if (this.disposed) {
      return;
    }
    const setupId = options.setupId ?? this.requestedSetupId;
    this.simulation = createGame(gameOptions(setupId));
    this.requestedSetupId = setupId;
    this.gameOverReported = false;
    this.hud.reset();
    this.input.reset();
    this.audio.reset();
    this.renderer.reset(this.simulation.world);
    // Now rather than on the next frame: the overlays (difficulty picker, results card) follow the
    // snapshot, and a hidden tab may not run another frame for a while.
    this.publishHud();
    this.lastFrame = performance.now();
    this.startLoop();
  }

  /** Look sensitivity in rad/px. */
  setSensitivity(radiansPerPixel: number): void {
    this.input.sensitivity = radiansPerPixel;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver.disconnect();
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.input.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }

  /** The HUD snapshot for the world as it stands, outside the loop (no step, no events). */
  private publishHud(): void {
    const { world } = this.simulation;
    this.hud.update(world, {
      paused: world.status === "playing" && !this.input.isLocked,
    });
  }

  private startLoop(): void {
    if (this.disposed || this.rafId !== null) {
      return;
    }
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const dt = Math.min(
      MAX_FRAME_SECONDS,
      Math.max(0, (now - this.lastFrame) / 1000)
    );
    this.lastFrame = now;
    try {
      this.tick(dt);
    } catch (error) {
      this.fail(error);
    }
  };

  private tick(dt: number): void {
    const { world } = this.simulation;
    const playing = world.status === "playing";
    const paused = playing && !this.input.isLocked;
    // Always drain the input so deltas latched while switching never leak into a later frame.
    const input = this.input.sample();
    if (!paused) {
      this.simulation.step(playing ? input : IDLE_INPUT, dt);
    }
    this.detectGameOver(world);
    this.renderer.render(world, dt);
    this.audio.setPaused(paused);
    this.audio.update(world);
    this.hud.update(world, { paused });
    // Events belong to one step. Clearing them after they are consumed means a paused frame (no
    // step) can never replay the previous step's shots, hits and kills in the renderer or audio.
    world.events.length = 0;
  }

  private detectGameOver(world: WorldState): void {
    if (this.gameOverReported || world.status === "playing") {
      return;
    }
    this.gameOverReported = true;
    this.gameOverAt = performance.now();
    const result = toRunResult(world);
    this.hud.setLastResult(result);
    const { onGameOver } = this.options;
    if (onGameOver) {
      // Outside the frame: React state updates and server calls must not stall or break the loop.
      queueMicrotask(() => onGameOver(result));
    }
  }

  private fail(error: unknown): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.input.exitLock();
    if (this.options.onError) {
      this.options.onError(error);
      return;
    }
    throw error;
  }

  private readonly handleKey = (code: string): void => {
    if (
      code === "KeyR" &&
      this.simulation.world.status !== "playing" &&
      performance.now() - this.gameOverAt >= RESTART_GRACE_MS
    ) {
      // SUPERHOT-style instant retry; keydown is a user gesture, so re-lock if the cursor was freed.
      this.restart();
      this.start();
    }
  };

  private readonly handleLockChange = (locked: boolean): void => {
    if (locked) {
      // The click that granted the lock is still a live user activation.
      this.audio.unlock();
    }
    // Don't count the time spent paused as one huge frame.
    this.lastFrame = performance.now();
  };

  private readonly handleResize = (): void => {
    const { clientWidth, clientHeight } = this.options.container;
    if (clientWidth === 0 || clientHeight === 0) {
      return;
    }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.renderer.resize(clientWidth, clientHeight, pixelRatio);
  };
}
