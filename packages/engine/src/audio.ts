import {
  clamp,
  type GameEvent,
  maxTimeScale,
  type PieceState,
  right,
  type Square,
  squareCenter,
  type WorldState,
} from "@buckshot/core";
import { easeInOutCubic } from "./scene/coords";
import { CONTACT_DISTANCE, DROP_HEIGHT, GRAVITY } from "./scene/pickups";

/** Low-pass cutoff of the world bus while time is (almost) frozen. */
const FROZEN_CUTOFF_HZ = 500;
/** Low-pass cutoff of the world bus at full-speed time (effectively open). */
const OPEN_CUTOFF_HZ = 18_000;
/** Skip filter automation unless the cutoff moved by more than this fraction. */
const CUTOFF_EPSILON = 0.01;
const FILTER_TIME_CONSTANT = 0.04;
const MASTER_VOLUME = 0.75;
const AMBIENT_FROZEN_GAIN = 0.018;
const AMBIENT_FLOWING_GAIN = 0.07;
const AMBIENT_TIME_CONSTANT = 0.12;
/**
 * Past real speed (sprinting) the low-pass is already wide open, so the overdrive is heard as an
 * airy rush instead: a band of noise that fades in as time climbs from 1× to `maxTimeScale` (a sprint
 * during a reload).
 */
const RUSH_MAX_GAIN = 0.045;
const RUSH_CENTRE_HZ = 2400;
const RUSH_TIME_CONSTANT = 0.18;
/** Skip rush automation unless its gain moved by more than this (absolute). */
const RUSH_EPSILON = 0.001;
const NOISE_SECONDS = 2;
/** Envelopes ramp from/to this instead of 0 because exponential ramps cannot reach zero. */
const SILENCE = 0.0001;
/** Extra seconds a voice is kept connected after its envelope ends. */
const VOICE_TAIL = 0.15;
/** Board units at which a piece sound is at half volume. */
const HALF_VOLUME_DISTANCE = 4;
const MAX_PAN = 0.8;
const ATTACK_LOUDNESS = 1.8;
/**
 * Shared with the pickup layer so pickup sounds play when the shell is *seen* to land or break, not
 * when the sim decides it: it drops in on game time, and a crushing piece meets it
 * CONTACT_DISTANCE board units before its centre along the piece's path.
 */
const BOX_FALL_TIME = Math.sqrt((2 * DROP_HEIGHT) / GRAVITY);

/** A box the sim has already removed, whose crunch waits for the crushing piece's model. */
interface PendingCrush {
  readonly pieceId: string;
  readonly square: Square;
}

interface ToneOptions {
  readonly attack: number;
  readonly decay: number;
  readonly endFreq?: number;
  readonly freq: number;
  /** Optional low-pass applied to this oscillator only (tames sawtooth/square edges). */
  readonly lowpass?: number;
  readonly peak: number;
  readonly type: OscillatorType;
}

interface NoiseOptions {
  readonly attack: number;
  readonly decay: number;
  readonly endFreq?: number;
  readonly filter: BiquadFilterType;
  readonly freq: number;
  readonly peak: number;
  readonly q?: number;
}

interface AudioGraph {
  readonly ambient: GainNode;
  readonly compressor: DynamicsCompressorNode;
  readonly ctx: AudioContext;
  /** Player-side sounds (gun, stingers): crisp regardless of time scale. */
  readonly direct: GainNode;
  readonly drones: readonly OscillatorNode[];
  readonly master: GainNode;
  readonly noise: AudioBuffer;
  readonly noiseBed: AudioBufferSourceNode;
  /** Sprint overdrive bed: silent up to 1× time, audible only while time outruns real time. */
  readonly rush: GainNode;
  readonly rushBed: AudioBufferSourceNode;
  readonly timeFilter: BiquadFilterNode;
  /** World sounds (pieces, ambience): muffled by `timeFilter` when time is frozen. */
  readonly world: GainNode;
}

const random = (min: number, max: number): number =>
  min + Math.random() * (max - min);

/**
 * Fully synthesized WebAudio sound design — no asset files to download, and every sound can be
 * varied per play so a hundred shots never sound like one sample on loop.
 *
 * The SUPERHOT cue is the time filter: world sounds and an ambient bed pass through a low-pass
 * whose cutoff (and the bed's gain) follow `world.timeScale`, so standing still literally muffles
 * the world. The player's own gun bypasses it: your actions are always crisp, the world is not.
 * Sprinting pushes time past 1×; the filter simply stays open and a faint rush bed takes over.
 *
 * The AudioContext is created lazily on the first user gesture because browsers refuse to start
 * audio before one.
 */
export class GameAudio {
  private graph: AudioGraph | null = null;
  private paused: boolean;
  private playing: boolean;
  private lastCutoff = OPEN_CUTOFF_HZ;
  private lastRush = 0;
  private disposed: boolean;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** Boxes first seen still dropping in; each thuds once, when its game-time fall ends. */
  private readonly falling = new Set<number>();
  /** Pickup ids below this have been seen already (the sim hands them out in increasing order). */
  private nextPickupId = 0;
  private readonly pendingCrushes: PendingCrush[] = [];

  constructor() {
    this.paused = true;
    this.playing = true;
    this.disposed = false;
    window.addEventListener("pointerdown", this.unlock, true);
    window.addEventListener("keydown", this.unlock, true);
  }

  /** Create (or resume) the AudioContext. Safe to call repeatedly; must run inside a user gesture. */
  readonly unlock = (): void => {
    if (this.disposed) {
      return;
    }
    if (!this.graph) {
      this.graph = createGraph();
    }
    if (this.graph.ctx.state === "suspended") {
      this.graph.ctx.resume().catch(() => {
        // Still no gesture: the next pointerdown/keydown will try again.
      });
    }
  };

  /** While paused the ambient bed fades out so the pause screen is quiet. */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Play this step's events and track the time scale. Call once per frame after `step`. */
  update(world: WorldState): void {
    const { graph } = this;
    if (!graph) {
      return;
    }
    this.playing = world.status === "playing";
    for (const event of world.events) {
      this.play(graph, world, event);
    }
    this.landBoxes(graph, world);
    this.crushBoxes(graph, world);
    this.followTime(graph, world.timeScale, maxTimeScale(world.config.time));
  }

  /** Forget the run's boxes (pickup ids restart with a new world). Call when the game restarts. */
  reset(): void {
    this.falling.clear();
    this.nextPickupId = 0;
    this.pendingCrushes.length = 0;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    window.removeEventListener("pointerdown", this.unlock, true);
    window.removeEventListener("keydown", this.unlock, true);
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    const { graph } = this;
    this.graph = null;
    if (graph) {
      graph.ctx.close().catch(() => {
        // Already closed.
      });
    }
  }

  /**
   * Map the time scale onto the world bus. The filter and the ambient bed saturate at 1× (fully
   * open, fully flowing); anything above that, up to `topScale`, only drives the rush bed.
   */
  private followTime(
    graph: AudioGraph,
    timeScale: number,
    topScale: number
  ): void {
    const scale = clamp(timeScale, 0, 1);
    const overdrive =
      topScale > 1 ? clamp((timeScale - 1) / (topScale - 1), 0, 1) : 0;
    const now = graph.ctx.currentTime;
    const cutoff =
      FROZEN_CUTOFF_HZ * (OPEN_CUTOFF_HZ / FROZEN_CUTOFF_HZ) ** scale;
    if (Math.abs(cutoff - this.lastCutoff) / this.lastCutoff > CUTOFF_EPSILON) {
      graph.timeFilter.frequency.setTargetAtTime(
        cutoff,
        now,
        FILTER_TIME_CONSTANT
      );
      this.lastCutoff = cutoff;
    }
    const audible = this.playing && !this.paused;
    const ambient = audible
      ? AMBIENT_FROZEN_GAIN +
        (AMBIENT_FLOWING_GAIN - AMBIENT_FROZEN_GAIN) * scale
      : 0;
    graph.ambient.gain.setTargetAtTime(ambient, now, AMBIENT_TIME_CONSTANT);
    const rush = audible ? RUSH_MAX_GAIN * overdrive * overdrive : 0;
    const settledToSilence = rush === 0 && this.lastRush !== 0;
    if (Math.abs(rush - this.lastRush) > RUSH_EPSILON || settledToSilence) {
      graph.rush.gain.setTargetAtTime(rush, now, RUSH_TIME_CONSTANT);
      this.lastRush = rush;
    }
  }

  /**
   * Thud each box as it hits the board. A box spawns at the top of a game-time drop, so at the 1%
   * idle creep it can hang in the air for most of a minute; the sound waits for the impact. A box
   * first seen already down (it landed before audio unlocked) stays silent.
   */
  private landBoxes(graph: AudioGraph, world: WorldState): void {
    for (const pickup of world.pickups) {
      if (pickup.id >= this.nextPickupId) {
        this.nextPickupId = pickup.id + 1;
        if (pickup.age < BOX_FALL_TIME) {
          this.falling.add(pickup.id);
        }
      } else if (this.falling.has(pickup.id) && pickup.age >= BOX_FALL_TIME) {
        this.falling.delete(pickup.id);
        this.pickupLanded(graph, world, pickup.square);
      }
    }
    // Collected or crushed in mid-air: it never lands.
    for (const id of this.falling) {
      if (!world.pickups.some((pickup) => pickup.id === id)) {
        this.falling.delete(id);
      }
    }
  }

  /** Crunch each crushed box once the crushing piece's model reaches it (see `crusherArrived`). */
  private crushBoxes(graph: AudioGraph, world: WorldState): void {
    let kept = 0;
    for (const crush of this.pendingCrushes) {
      if (crusherArrived(world, crush)) {
        this.pickupCrushed(graph, world, crush.square);
      } else {
        this.pendingCrushes[kept] = crush;
        kept += 1;
      }
    }
    this.pendingCrushes.length = kept;
  }

  private play(graph: AudioGraph, world: WorldState, event: GameEvent): void {
    switch (event.type) {
      case "shot":
        this.shot(graph);
        break;
      case "dryFire":
        this.dryFire(graph);
        break;
      case "reloadStart":
        this.reloadStart(graph, world);
        break;
      case "reloadEnd":
        this.snapShut(graph, graph.ctx.currentTime);
        break;
      // A spawn is silent: the box is still at the top of its drop (see `landBoxes`).
      case "pickupCollected":
        this.pickupCollected(graph, event.shells);
        break;
      case "pickupCrushed":
        // The sim crushes at the start of the move; the crunch waits for the model (`crushBoxes`).
        this.pendingCrushes.push({
          pieceId: event.pieceId,
          square: event.square,
        });
        break;
      case "pieceTelegraph":
        this.telegraph(graph, world, event.pieceId);
        break;
      case "pieceMoved":
        this.pieceMoved(graph, world, event.pieceId, event.to);
        break;
      case "pieceHit":
        this.pieceHit(graph, world, event.pieceId, event.square, event.hp);
        break;
      case "pieceKilled":
        this.pieceKilled(graph, world, event.square);
        break;
      case "piecePromoted":
        this.promoted(graph, world, event.pieceId);
        break;
      case "kingCaptured":
        this.kingCaptured(graph);
        break;
      case "victory":
        this.victory(graph);
        break;
      default:
        break;
    }
  }

  // --- player sounds (direct bus) -------------------------------------------------------------

  private shot(graph: AudioGraph): void {
    const t = graph.ctx.currentTime;
    const pitch = random(0.94, 1.06);
    const out = graph.direct;
    this.noise(graph, out, t, {
      attack: 0.001,
      decay: 0.045,
      filter: "highpass",
      freq: 2600,
      peak: 0.85,
    });
    this.noise(graph, out, t, {
      attack: 0.002,
      decay: 0.34,
      endFreq: 520,
      filter: "lowpass",
      freq: 5200 * pitch,
      peak: 0.8,
      q: 0.9,
    });
    this.tone(graph, out, t, {
      attack: 0.002,
      decay: 0.26,
      endFreq: 36,
      freq: 128 * pitch,
      peak: 1,
      type: "sine",
    });
    this.noise(graph, out, t + 0.02, {
      attack: 0.03,
      decay: 0.95,
      endFreq: 260,
      filter: "lowpass",
      freq: 950,
      peak: 0.12,
    });
  }

  private dryFire(graph: AudioGraph): void {
    const t = graph.ctx.currentTime;
    this.noise(graph, graph.direct, t, {
      attack: 0.001,
      decay: 0.018,
      filter: "highpass",
      freq: 4200,
      peak: 0.32,
    });
    this.tone(graph, graph.direct, t, {
      attack: 0.001,
      decay: 0.03,
      freq: 1500,
      lowpass: 4000,
      peak: 0.08,
      type: "square",
    });
    this.tone(graph, graph.direct, t + 0.004, {
      attack: 0.001,
      decay: 0.06,
      freq: 2400,
      peak: 0.05,
      type: "triangle",
    });
  }

  /**
   * Break-open now, one insert per shell that will actually go in; the snap-shut waits for the
   * `reloadEnd` event so it stays in sync even though time ramps up smoothly.
   */
  private reloadStart(graph: AudioGraph, world: WorldState): void {
    const t = graph.ctx.currentTime;
    const { capacity, reloadDuration } = world.config.shotgun;
    const shells = Math.max(
      1,
      Math.min(capacity - world.player.loaded, world.player.reserve)
    );
    this.click(graph, t, 2300, 0.4);
    this.tone(graph, graph.direct, t + 0.01, {
      attack: 0.002,
      decay: 0.1,
      endFreq: 120,
      freq: 190,
      peak: 0.3,
      type: "sine",
    });
    for (let index = 0; index < shells; index += 1) {
      this.shellInsert(graph, t + reloadDuration * (0.3 + index * 0.25));
    }
  }

  private shellInsert(graph: AudioGraph, t: number): void {
    this.noise(graph, graph.direct, t, {
      attack: 0.01,
      decay: 0.07,
      endFreq: 2100,
      filter: "bandpass",
      freq: 700,
      peak: 0.22,
      q: 2,
    });
    this.click(graph, t + 0.075, 1700, 0.3);
    this.tone(graph, graph.direct, t + 0.075, {
      attack: 0.002,
      decay: 0.07,
      freq: 260,
      peak: 0.18,
      type: "triangle",
    });
  }

  private snapShut(graph: AudioGraph, t: number): void {
    this.click(graph, t, 2000, 0.55);
    this.tone(graph, graph.direct, t, {
      attack: 0.002,
      decay: 0.12,
      endFreq: 90,
      freq: 170,
      peak: 0.45,
      type: "sine",
    });
  }

  private click(graph: AudioGraph, t: number, freq: number, peak: number) {
    this.noise(graph, graph.direct, t, {
      attack: 0.001,
      decay: 0.025,
      filter: "bandpass",
      freq,
      peak,
      q: 3,
    });
  }

  /**
   * Scooping up a box: one hollow clack per shell that went into the reserve (normally two), then a
   * bright tick. On the direct bus — it is the player's action, so it must read crisply even when
   * the pickup happens at a near-frozen 1% time scale.
   */
  private pickupCollected(graph: AudioGraph, shells: number): void {
    const t = graph.ctx.currentTime;
    const clacks = clamp(Math.round(shells), 1, 3);
    for (let index = 0; index < clacks; index += 1) {
      const at = t + index * 0.065;
      const pitch = random(0.95, 1.05) * (1 + index * 0.08);
      this.click(graph, at, 1800 * pitch, 0.32);
      this.tone(graph, graph.direct, at, {
        attack: 0.001,
        decay: 0.055,
        endFreq: 210 * pitch,
        freq: 320 * pitch,
        peak: 0.16,
        type: "triangle",
      });
    }
    const tick = t + clacks * 0.065 + 0.02;
    this.tone(graph, graph.direct, tick, {
      attack: 0.002,
      decay: 0.09,
      freq: 1568,
      peak: 0.09,
      type: "sine",
    });
    this.tone(graph, graph.direct, tick + 0.012, {
      attack: 0.002,
      decay: 0.07,
      freq: 2349,
      peak: 0.045,
      type: "sine",
    });
  }

  private kingCaptured(graph: AudioGraph): void {
    const t = graph.ctx.currentTime;
    this.tone(graph, graph.direct, t, {
      attack: 0.005,
      decay: 1.5,
      endFreq: 26,
      freq: 92,
      peak: 0.95,
      type: "sine",
    });
    this.noise(graph, graph.direct, t, {
      attack: 0.004,
      decay: 1.2,
      endFreq: 70,
      filter: "lowpass",
      freq: 420,
      peak: 0.5,
    });
    this.tone(graph, graph.direct, t + 0.08, {
      attack: 0.02,
      decay: 1.7,
      endFreq: 98,
      freq: 392,
      lowpass: 1400,
      peak: 0.14,
      type: "sawtooth",
    });
  }

  private victory(graph: AudioGraph): void {
    const t = graph.ctx.currentTime;
    const chord = [523.25, 659.25, 783.99, 987.77, 1318.51];
    for (const [index, freq] of chord.entries()) {
      const start = t + index * 0.035;
      this.tone(graph, graph.direct, start, {
        attack: 0.01,
        decay: 2.4,
        freq,
        peak: 0.09,
        type: "triangle",
      });
      this.tone(graph, graph.direct, start, {
        attack: 0.01,
        decay: 1.6,
        freq: freq * 2,
        peak: 0.025,
        type: "sine",
      });
    }
  }

  // --- world sounds (time-filtered, spatialised) ----------------------------------------------

  private telegraph(graph: AudioGraph, world: WorldState, pieceId: string) {
    const piece = findPiece(world, pieceId);
    const out = this.spatial(graph, world, piece?.square ?? null, 1, 0.2);
    this.tone(graph, out, graph.ctx.currentTime, {
      attack: 0.004,
      decay: 0.08,
      endFreq: 1240,
      freq: 520,
      peak: 0.2,
      type: "triangle",
    });
  }

  private pieceMoved(
    graph: AudioGraph,
    world: WorldState,
    pieceId: string,
    to: Square
  ): void {
    const attacking = findPiece(world, pieceId)?.isAttacking ?? false;
    const loudness = attacking ? ATTACK_LOUDNESS : 1;
    const out = this.spatial(graph, world, to, loudness, 0.25);
    const t = graph.ctx.currentTime;
    const pitch = random(0.9, 1.1);
    this.noise(graph, out, t, {
      attack: 0.001,
      decay: 0.05,
      filter: "bandpass",
      freq: 1700 * pitch,
      peak: 0.5,
      q: 3,
    });
    this.tone(graph, out, t, {
      attack: 0.001,
      decay: 0.07,
      endFreq: 200 * pitch,
      freq: 270 * pitch,
      peak: 0.35,
      type: "triangle",
    });
    this.tone(graph, out, t + 0.004, {
      attack: 0.002,
      decay: 0.1,
      freq: 120 * pitch,
      peak: 0.28,
      type: "sine",
    });
  }

  private pieceHit(
    graph: AudioGraph,
    world: WorldState,
    pieceId: string,
    square: Square,
    hp: number
  ): void {
    const maxHp = findPiece(world, pieceId)?.maxHp ?? hp + 1;
    const wounded = 1 - clamp(hp / Math.max(1, maxHp), 0, 1);
    const freq = (170 + wounded * 130) * random(0.9, 1.12);
    const out = this.spatial(graph, world, square, 1, 0.2);
    const t = graph.ctx.currentTime;
    this.tone(graph, out, t, {
      attack: 0.002,
      decay: 0.13,
      endFreq: freq * 0.55,
      freq,
      peak: 0.55,
      type: "sine",
    });
    this.noise(graph, out, t, {
      attack: 0.001,
      decay: 0.05,
      filter: "lowpass",
      freq: 900,
      peak: 0.3,
    });
  }

  private pieceKilled(graph: AudioGraph, world: WorldState, square: Square) {
    const out = this.spatial(graph, world, square, 1, 0.8);
    const t = graph.ctx.currentTime;
    this.noise(graph, out, t, {
      attack: 0.001,
      decay: 0.45,
      filter: "highpass",
      freq: 3000,
      peak: 0.32,
    });
    this.noise(graph, out, t, {
      attack: 0.001,
      decay: 0.28,
      endFreq: 1800,
      filter: "bandpass",
      freq: 5200,
      peak: 0.26,
      q: 1.5,
    });
    const pings = 4 + Math.floor(Math.random() * 3);
    for (let index = 0; index < pings; index += 1) {
      this.tone(graph, out, t + random(0, 0.12), {
        attack: 0.002,
        decay: random(0.25, 0.6),
        freq: random(2200, 6200),
        peak: random(0.05, 0.11),
        type: "sine",
      });
    }
  }

  /**
   * A box hitting the board at the end of its drop: a soft cardboard thud and a small tick,
   * deliberately quiet (spawns are frequent) but panned, so you can tell roughly where to look.
   */
  private pickupLanded(graph: AudioGraph, world: WorldState, square: Square) {
    const out = this.spatial(graph, world, square, 0.55, 0.25);
    const t = graph.ctx.currentTime;
    this.tone(graph, out, t, {
      attack: 0.003,
      decay: 0.12,
      endFreq: 62,
      freq: 135,
      peak: 0.32,
      type: "sine",
    });
    this.noise(graph, out, t, {
      attack: 0.002,
      decay: 0.06,
      endFreq: 260,
      filter: "lowpass",
      freq: 900,
      peak: 0.2,
    });
    this.tone(graph, out, t + 0.06, {
      attack: 0.001,
      decay: 0.04,
      freq: 2100,
      peak: 0.045,
      type: "triangle",
    });
  }

  /** A piece moving over a box: a short gritty crunch of cardboard and brass. */
  private pickupCrushed(graph: AudioGraph, world: WorldState, square: Square) {
    const out = this.spatial(graph, world, square, 1, 0.2);
    const t = graph.ctx.currentTime;
    this.noise(graph, out, t, {
      attack: 0.001,
      decay: 0.1,
      endFreq: 380,
      filter: "bandpass",
      freq: 1300,
      peak: 0.42,
      q: 1.2,
    });
    this.tone(graph, out, t, {
      attack: 0.001,
      decay: 0.08,
      endFreq: 48,
      freq: 105,
      peak: 0.22,
      type: "sine",
    });
    const grains = 3 + Math.floor(Math.random() * 3);
    for (let index = 0; index < grains; index += 1) {
      this.noise(graph, out, t + random(0, 0.07), {
        attack: 0.001,
        decay: random(0.008, 0.02),
        filter: "bandpass",
        freq: random(1800, 4800),
        peak: random(0.14, 0.26),
        q: 4,
      });
    }
  }

  private promoted(graph: AudioGraph, world: WorldState, pieceId: string) {
    const piece = findPiece(world, pieceId);
    const out = this.spatial(graph, world, piece?.square ?? null, 1, 0.5);
    const t = graph.ctx.currentTime;
    this.tone(graph, out, t, {
      attack: 0.005,
      decay: 0.25,
      freq: 660,
      peak: 0.12,
      type: "sine",
    });
    this.tone(graph, out, t + 0.09, {
      attack: 0.005,
      decay: 0.35,
      freq: 990,
      peak: 0.12,
      type: "sine",
    });
  }

  // --- building blocks ------------------------------------------------------------------------

  /**
   * A short-lived panner + gain into the world bus, placed by where `square` is relative to the
   * king's facing, so you can hear which side a telegraph or clack came from.
   */
  private spatial(
    graph: AudioGraph,
    world: WorldState,
    square: Square | null,
    loudness: number,
    lifetime: number
  ): AudioNode {
    const { ctx } = graph;
    const panner = ctx.createStereoPanner();
    const gain = ctx.createGain();
    let pan = 0;
    let distanceGain = 1;
    if (square) {
      const centre = squareCenter(square);
      const dx = centre.x - world.player.pos.x;
      const dy = centre.y - world.player.pos.y;
      const dist = Math.hypot(dx, dy);
      const side = right(world.player.yaw);
      pan =
        dist > 0
          ? clamp((dx * side.x + dy * side.y) / dist, -1, 1) * MAX_PAN
          : 0;
      distanceGain = 1 / (1 + dist / HALF_VOLUME_DISTANCE);
    }
    panner.pan.value = pan;
    gain.gain.value = loudness * distanceGain;
    panner.connect(gain).connect(graph.world);
    this.later(lifetime + VOICE_TAIL, () => {
      panner.disconnect();
      gain.disconnect();
    });
    return panner;
  }

  private tone(
    graph: AudioGraph,
    out: AudioNode,
    t: number,
    options: ToneOptions
  ): void {
    const { ctx } = graph;
    const end = t + options.attack + options.decay;
    const osc = ctx.createOscillator();
    osc.type = options.type;
    osc.frequency.setValueAtTime(options.freq, t);
    if (options.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(options.endFreq, end);
    }
    const gain = ctx.createGain();
    envelope(gain.gain, t, options.peak, options.attack, options.decay);
    let head: AudioNode = osc;
    let filter: BiquadFilterNode | null = null;
    if (options.lowpass !== undefined) {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      head = osc.connect(filter);
    }
    head.connect(gain).connect(out);
    osc.onended = () => {
      osc.disconnect();
      filter?.disconnect();
      gain.disconnect();
    };
    osc.start(t);
    osc.stop(end + VOICE_TAIL);
  }

  private noise(
    graph: AudioGraph,
    out: AudioNode,
    t: number,
    options: NoiseOptions
  ): void {
    const { ctx } = graph;
    const end = t + options.attack + options.decay;
    const source = ctx.createBufferSource();
    source.buffer = graph.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = options.filter;
    filter.frequency.setValueAtTime(options.freq, t);
    if (options.endFreq !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(options.endFreq, end);
    }
    filter.Q.value = options.q ?? 0.7;
    const gain = ctx.createGain();
    envelope(gain.gain, t, options.peak, options.attack, options.decay);
    source.connect(filter).connect(gain).connect(out);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    const maxOffset = Math.max(0, NOISE_SECONDS - (end - t) - VOICE_TAIL);
    source.start(t, Math.random() * maxOffset);
    source.stop(end + VOICE_TAIL);
  }

  private later(seconds: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, seconds * 1000);
    this.timers.add(timer);
  }
}

const findPiece = (world: WorldState, id: string): PieceState | undefined =>
  world.pieces.find((piece) => piece.id === id);

/**
 * Mirrors the pickup layer's `crusherArrived` so the crunch and the visible shatter coincide. The
 * sim removes a box the instant a move starts, but the model glides there on game time (eased as
 * in piece-view), so wait until its drawn base is within contact distance of the box along the
 * path, or the move is over (arrived, killed mid-slide). A lethal lunge only happens once the game
 * is lost, when the layer crushes at once, so its easing never matters here.
 */
const crusherArrived = (world: WorldState, crush: PendingCrush): boolean => {
  if (world.status !== "playing") {
    return true;
  }
  const piece = findPiece(world, crush.pieceId);
  if (piece?.phase !== "moving") {
    return true;
  }
  const from = squareCenter(piece.fromSquare);
  const to = squareCenter(piece.square);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-3) {
    return true;
  }
  const box = squareCenter(crush.square);
  const boxAlong = ((box.x - from.x) * dx + (box.y - from.y) * dy) / length;
  const drawnAlong = easeInOutCubic(clamp(piece.moveProgress, 0, 1)) * length;
  return drawnAlong >= boxAlong - CONTACT_DISTANCE;
};

const envelope = (
  param: AudioParam,
  t: number,
  peak: number,
  attack: number,
  decay: number
): void => {
  param.setValueAtTime(SILENCE, t);
  param.exponentialRampToValueAtTime(Math.max(SILENCE, peak), t + attack);
  param.exponentialRampToValueAtTime(SILENCE, t + attack + decay);
};

const createNoiseBuffer = (ctx: AudioContext): AudioBuffer => {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }
  return buffer;
};

/**
 * direct ─────────────────────────────┐
 * world ──┐                           ├─ master ───────── compressor ─ speakers
 * ambient ┼─ timeFilter (follows time)┘
 * rush ───┘  (sprint overdrive only)
 */
const createGraph = (): AudioGraph => {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const noise = createNoiseBuffer(ctx);

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;
  compressor.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = MASTER_VOLUME;
  master.connect(compressor);

  const direct = ctx.createGain();
  direct.connect(master);

  const timeFilter = ctx.createBiquadFilter();
  timeFilter.type = "lowpass";
  timeFilter.frequency.value = OPEN_CUTOFF_HZ;
  timeFilter.Q.value = 0.9;
  timeFilter.connect(master);

  const world = ctx.createGain();
  world.connect(timeFilter);

  const ambient = ctx.createGain();
  ambient.gain.value = 0;
  ambient.connect(timeFilter);

  const bedFilter = ctx.createBiquadFilter();
  bedFilter.type = "bandpass";
  bedFilter.frequency.value = 650;
  bedFilter.Q.value = 0.6;
  bedFilter.connect(ambient);
  const noiseBed = ctx.createBufferSource();
  noiseBed.buffer = noise;
  noiseBed.loop = true;
  noiseBed.connect(bedFilter);
  noiseBed.start();

  // Its own looping source, started half a buffer in, so it never correlates with the bed above.
  const rush = ctx.createGain();
  rush.gain.value = 0;
  rush.connect(timeFilter);
  const rushFilter = ctx.createBiquadFilter();
  rushFilter.type = "bandpass";
  rushFilter.frequency.value = RUSH_CENTRE_HZ;
  rushFilter.Q.value = 0.45;
  rushFilter.connect(rush);
  const rushBed = ctx.createBufferSource();
  rushBed.buffer = noise;
  rushBed.loop = true;
  rushBed.connect(rushFilter);
  rushBed.start(0, NOISE_SECONDS / 2);

  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.35;
  droneGain.connect(ambient);
  const drones = [
    { detune: -6, freq: 55, type: "sine" as const },
    { detune: 5, freq: 82.4, type: "triangle" as const },
  ].map(({ detune, freq, type }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(droneGain);
    osc.start();
    return osc;
  });

  return {
    ambient,
    compressor,
    ctx,
    direct,
    drones,
    master,
    noise,
    noiseBed,
    rush,
    rushBed,
    timeFilter,
    world,
  };
};
