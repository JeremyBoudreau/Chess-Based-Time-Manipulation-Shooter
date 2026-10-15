import {
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
    this.hud = options.hud ?? new HudStore();
    // Pure simulation first: if core or the renderer throws, nothing with listeners exists yet.
    this.simulation = createGame(this.createOptions());
    this.renderer = new GameRenderer({ canvas: options.canvas });
    this.input = new InputController({ target: options.canvas });
    this.audio = new GameAudio();
    this.resizeObserver = new ResizeObserver(this.handleResize);
    try {
      this.renderer.reset(this.simulation.world);
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

  /** Fresh game with the same setup; keeps pointer lock so play resumes instantly. */
  restart(): void {
    if (this.disposed) {
      return;
    }
    this.simulation = createGame(this.createOptions());
    this.gameOverReported = false;
    this.hud.reset();
    this.input.reset();
    this.audio.reset();
    this.renderer.reset(this.simulation.world);
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

  private createOptions() {
    return this.options.setupId ? { setupId: this.options.setupId } : {};
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
