import {
  clamp,
  type GameEvent,
  type PieceState,
  right,
  type Square,
  squareCenter,
  type WorldState,
} from "@buckshot/core";

/** Low-pass cutoff of the world bus while time is (almost) frozen. */
const FROZEN_CUTOFF_HZ = 500;
/** Low-pass cutoff of the world bus at full-speed time (effectively open). */
const OPEN_CUTOFF_HZ = 18_000;
/** Skip filter automation unless the cutoff moved by more than this fraction. */
const CUTOFF_EPSILON = 0.01;
const FILTER_TIME_CONSTANT = 0.04;
const MASTER_VOLUME = 0.75;
const MUTE_TIME_CONSTANT = 0.05;
const AMBIENT_FROZEN_GAIN = 0.018;
const AMBIENT_FLOWING_GAIN = 0.07;
const AMBIENT_TIME_CONSTANT = 0.12;
const NOISE_SECONDS = 2;
/** Envelopes ramp from/to this instead of 0 because exponential ramps cannot reach zero. */
const SILENCE = 0.0001;
/** Extra seconds a voice is kept connected after its envelope ends. */
const VOICE_TAIL = 0.15;
/** Board units at which a piece sound is at half volume. */
const HALF_VOLUME_DISTANCE = 4;
const MAX_PAN = 0.8;
const ATTACK_LOUDNESS = 1.8;

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
 *
 * The AudioContext is created lazily on the first user gesture because browsers refuse to start
 * audio before one.
 */
export class GameAudio {
  private graph: AudioGraph | null = null;
  private muted: boolean;
  private paused: boolean;
  private playing: boolean;
  private lastCutoff = OPEN_CUTOFF_HZ;
  private disposed: boolean;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    this.muted = false;
    this.paused = true;
    this.playing = true;
    this.disposed = false;
    window.addEventListener("pointerdown", this.unlock, true);
    window.addEventListener("keydown", this.unlock, true);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Create (or resume) the AudioContext. Safe to call repeatedly; must run inside a user gesture. */
  readonly unlock = (): void => {
    if (this.disposed) {
      return;
    }
    if (!this.graph) {
      this.graph = createGraph();
      this.applyMute(0);
    }
    if (this.graph.ctx.state === "suspended") {
      this.graph.ctx.resume().catch(() => {
        // Still no gesture: the next pointerdown/keydown will try again.
      });
    }
  };

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMute(MUTE_TIME_CONSTANT);
  }

  /** Flip mute and return the new state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

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
    this.followTime(graph, world.timeScale);
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

  private applyMute(timeConstant: number): void {
    const { graph } = this;
    if (!graph) {
      return;
    }
    const target = this.muted ? 0 : MASTER_VOLUME;
    const now = graph.ctx.currentTime;
    if (timeConstant <= 0) {
      graph.master.gain.setValueAtTime(target, now);
      return;
    }
    graph.master.gain.setTargetAtTime(target, now, timeConstant);
  }

  private followTime(graph: AudioGraph, timeScale: number): void {
    const scale = clamp(timeScale, 0, 1);
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
      case "shellRegenerated":
        this.shellTick(graph);
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

  private shellTick(graph: AudioGraph): void {
    const t = graph.ctx.currentTime;
    this.tone(graph, graph.direct, t, {
      attack: 0.002,
      decay: 0.07,
      freq: 1320,
      peak: 0.07,
      type: "sine",
    });
    this.tone(graph, graph.direct, t + 0.01, {
      attack: 0.002,
      decay: 0.05,
      freq: 1980,
      peak: 0.03,
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
 * world ──┐                           ├─ master (mute) ─ compressor ─ speakers
 * ambient ┴─ timeFilter (follows time)┘
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
  master.gain.value = 0;
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
    timeFilter,
    world,
  };
};
