import type { FrameInput } from "@buckshot/core";

/** Radians of camera rotation per pixel of mouse travel. */
export const DEFAULT_LOOK_SENSITIVITY = 0.0022;

/**
 * Some browsers (notably Chrome on Windows) occasionally report a huge `movementX` spike when the
 * cursor is re-centred under pointer lock. Clamping each event keeps one bad sample from spinning
 * the king around and, because looking advances time, from fast-forwarding the world.
 */
const MAX_EVENT_DELTA_PX = 240;

const DIAGONAL_SCALE = Math.SQRT1_2;

const FORWARD_KEYS = new Set(["KeyW", "ArrowUp"]);
const BACK_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);
/** Either Shift sprints, so left- and right-handed layouts both work. */
const SPRINT_KEYS = new Set(["ShiftLeft", "ShiftRight"]);
/**
 * Stands in for "some Shift is down" when an event's modifier flag reports a Shift we never saw
 * go down: it was already held when the pointer locked, and its auto-repeats are ignored.
 */
const ADOPTED_SHIFT = "ShiftLeft";
/** Keys whose browser default (page scroll) must be suppressed while playing. */
const GAME_KEYS = new Set([
  ...FORWARD_KEYS,
  ...BACK_KEYS,
  ...LEFT_KEYS,
  ...RIGHT_KEYS,
  "Space",
]);

const PRIMARY_BUTTON = 0;

export interface InputControllerOptions {
  /** Look sensitivity in rad/px (default {@link DEFAULT_LOOK_SENSITIVITY}). */
  readonly sensitivity?: number;
  /** Element that captures the pointer; clicking it while unlocked requests pointer lock. */
  readonly target: HTMLElement;
}

type LockListener = (locked: boolean) => void;
type KeyListener = (code: string) => void;

/**
 * Turns raw DOM events into the simulation's per-frame {@link FrameInput}.
 *
 * Why a polled controller instead of event callbacks: the simulation is stepped once per animation
 * frame, so mouse deltas must be accumulated between frames and edge-triggered actions (fire,
 * reload) must be latched until the next `sample()` — otherwise a click between two frames would
 * be lost or applied twice. Pointer lock doubles as the pause switch: no lock, no game.
 */
export class InputController {
  /** Look sensitivity in rad/px; settable at runtime (e.g. from a settings menu). */
  sensitivity: number;

  private readonly target: HTMLElement;
  private readonly held = new Set<string>();
  private readonly lockListeners = new Set<LockListener>();
  private readonly keyListeners = new Set<KeyListener>();
  private readonly errorListeners = new Set<() => void>();
  private dx = 0;
  private dy = 0;
  private firePressed: boolean;
  private reloadPressed: boolean;
  private locked: boolean;
  private disposed: boolean;

  constructor(options: InputControllerOptions) {
    this.firePressed = false;
    this.reloadPressed = false;
    this.disposed = false;
    this.target = options.target;
    this.sensitivity = options.sensitivity ?? DEFAULT_LOOK_SENSITIVITY;
    this.target.addEventListener("click", this.handleTargetClick);
    document.addEventListener("pointerlockchange", this.handleLockChange);
    document.addEventListener("pointerlockerror", this.handleLockError);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.locked = document.pointerLockElement === this.target;
  }

  /** True while the pointer is locked to the target, i.e. while the game is unpaused. */
  get isLocked(): boolean {
    return this.locked;
  }

  /**
   * Request pointer lock. Must be called from a user-gesture handler (click / keydown), which is
   * why the React "click to play" button calls this directly instead of waiting for a canvas click.
   */
  requestLock(): void {
    if (this.disposed || this.locked) {
      return;
    }
    try {
      const result: unknown = this.target.requestPointerLock();
      if (result instanceof Promise) {
        // Chrome rejects re-locking within ~1 s of an Escape exit; the overlay simply stays up.
        result.catch(this.handleLockError);
      }
    } catch {
      this.handleLockError();
    }
  }

  /** Release the pointer (e.g. to let the player click result-screen buttons). */
  exitLock(): void {
    if (document.pointerLockElement === this.target) {
      document.exitPointerLock();
    }
  }

  /** Subscribe to lock changes. Returns an unsubscribe function. */
  onLockChange(listener: LockListener): () => void {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  }

  /** Subscribe to failed lock requests (so a UI can say "click again"). */
  onLockError(listener: () => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /**
   * Subscribe to non-repeating key presses (`KeyboardEvent.code`), locked or not. Used for
   * meta keys the simulation does not know about (instant restart).
   */
  onKey(listener: KeyListener): () => void {
    this.keyListeners.add(listener);
    return () => this.keyListeners.delete(listener);
  }

  /** Read this frame's input, then clear the per-frame accumulators and edges. */
  sample(): FrameInput {
    const moveX = this.axis(RIGHT_KEYS, LEFT_KEYS);
    const moveY = this.axis(FORWARD_KEYS, BACK_KEYS);
    const diagonal = moveX !== 0 && moveY !== 0;
    const moveScale = diagonal ? DIAGONAL_SCALE : 1;
    const input: FrameInput = {
      fire: this.firePressed,
      lookPitch: -this.dy * this.sensitivity,
      lookYaw: -this.dx * this.sensitivity,
      moveX: moveX * moveScale,
      moveY: moveY * moveScale,
      reload: this.reloadPressed,
      sprint: this.anyHeld(SPRINT_KEYS),
    };
    this.clearFrame();
    return input;
  }

  /** Drop everything latched or held (after a restart, so the restart key is not also a reload). */
  reset(): void {
    this.held.clear();
    this.clearFrame();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.exitLock();
    this.target.removeEventListener("click", this.handleTargetClick);
    document.removeEventListener("pointerlockchange", this.handleLockChange);
    document.removeEventListener("pointerlockerror", this.handleLockError);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.lockListeners.clear();
    this.keyListeners.clear();
    this.errorListeners.clear();
  }

  /** +1 / -1 / 0 for a pair of key groups; opposite keys cancel out like in most shooters. */
  private axis(positive: Set<string>, negative: Set<string>): number {
    return Number(this.anyHeld(positive)) - Number(this.anyHeld(negative));
  }

  private anyHeld(keys: Set<string>): boolean {
    for (const code of keys) {
      if (this.held.has(code)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Reconcile the sprint keys with the Shift flag every input event carries. The flag is the OS's
   * own view of the modifier, so it un-sticks a sprint whose keyup went to an OS shortcut instead
   * of the page, and it picks up a Shift that was already held when the pointer locked. Adopting
   * one that way is safe even right after a resume: sprint does nothing until the king walks.
   */
  private syncShift(shiftDown: boolean): void {
    if (!shiftDown) {
      for (const code of SPRINT_KEYS) {
        this.held.delete(code);
      }
      return;
    }
    if (!this.anyHeld(SPRINT_KEYS)) {
      this.held.add(ADOPTED_SHIFT);
    }
  }

  private clearFrame(): void {
    this.dx = 0;
    this.dy = 0;
    this.firePressed = false;
    this.reloadPressed = false;
  }

  private readonly handleTargetClick = (): void => {
    if (!this.locked) {
      this.requestLock();
    }
  };

  private readonly handleLockChange = (): void => {
    const locked = document.pointerLockElement === this.target;
    if (locked === this.locked) {
      return;
    }
    this.locked = locked;
    // Anything held or latched while switching is stale: never resume walking into a piece.
    this.reset();
    for (const listener of this.lockListeners) {
      listener(locked);
    }
  };

  private readonly handleLockError = (): void => {
    for (const listener of this.errorListeners) {
      listener();
    }
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.locked) {
      return;
    }
    this.syncShift(event.shiftKey);
    this.dx += clampDelta(event.movementX);
    this.dy += clampDelta(event.movementY);
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.locked) {
      return;
    }
    this.syncShift(event.shiftKey);
    if (event.button === PRIMARY_BUTTON) {
      this.firePressed = true;
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.locked && GAME_KEYS.has(event.code)) {
      event.preventDefault();
    }
    if (isTypingTarget(event.target)) {
      return;
    }
    if (this.locked) {
      // Before the repeat check: a Shift held through a resume only ever sends repeats.
      this.syncShift(event.shiftKey);
    }
    if (event.repeat) {
      return;
    }
    if (this.locked) {
      this.held.add(event.code);
      if (event.code === "KeyR") {
        this.reloadPressed = true;
      }
    }
    for (const listener of this.keyListeners) {
      listener(event.code);
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
    if (this.locked) {
      this.syncShift(event.shiftKey);
    }
  };

  private readonly handleBlur = (): void => {
    this.reset();
  };
}

const clampDelta = (value: number): number =>
  Math.max(-MAX_EVENT_DELTA_PX, Math.min(MAX_EVENT_DELTA_PX, value || 0));

/** Never steal keys from text inputs (none exist in-game today, but the overlay may grow some). */
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT");
