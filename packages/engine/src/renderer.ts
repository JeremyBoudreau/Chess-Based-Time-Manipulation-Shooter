import type { GameEvent, PieceKind, Square, WorldState } from "@buckshot/core";
import {
  ACESFilmicToneMapping,
  MathUtils,
  PCFShadowMap,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { disposePieceGeometries } from "./models/pieces";
import { AimFan } from "./scene/aim-fan";
import { Board } from "./scene/board";
import { CameraRig, type DeathFocus } from "./scene/camera-rig";
import { boardToWorld, squareToWorld } from "./scene/coords";
import { Environment } from "./scene/environment";
import { PALETTE } from "./scene/palette";
import { type MuzzleRay, PelletLayer } from "./scene/pellets";
import { PieceLayer } from "./scene/piece-layer";
import { ShatterLayer } from "./scene/shatter";
import { ThreatLayer } from "./scene/threats";
import { Viewmodel } from "./scene/viewmodel";

export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
}

/** Longest frame the visual simulation will integrate (tab switches must not explode debris). */
const MAX_DT = 0.1;
/**
 * Cosmetic fades that run on game time still advance at least this fraction of real time, so a
 * frozen world never leaves a dead pellet trail or a muzzle puff hanging forever.
 */
const MIN_EFFECT_RATE = 0.12;
/**
 * The sim stops game time for good once the game ends, which would leave the final burst (the
 * white king's, or whatever was mid-air) frozen forever; afterwards debris plays out in slow motion.
 */
const AFTERMATH_RATE = 0.35;

/**
 * Draws a `WorldState` with three.js. Stateless with respect to game rules: it only reads the
 * world (and the per-step `world.events`) and keeps purely visual state (animations, particles).
 *
 * Two passes per frame: the world (board, pieces, pellets, debris, overlays) and then, after a
 * depth clear, the first-person shotgun — so the gun can never clip into a piece in your face.
 */
export class GameRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly environment: Environment;
  private readonly board = new Board();
  private readonly pieces = new PieceLayer();
  private readonly pellets = new PelletLayer();
  private readonly shatter = new ShatterLayer();
  private readonly threats = new ThreatLayer();
  private readonly aimFan = new AimFan();
  private readonly cameraRig = new CameraRig();
  private readonly viewmodel = new Viewmodel();
  private readonly muzzleLight = new PointLight(PALETTE.muzzle, 0, 7, 2);
  private readonly playerWorld = new Vector3();
  private readonly focusBase = new Vector3();
  private readonly forward = new Vector3();
  private readonly ndc = new Vector3();
  private clock = 0;
  private lastGameTime = 0;
  private lastRealTime = Number.NaN;
  private attackerId: string | null = null;
  private kingSquare: Square | null = null;

  constructor({ canvas }: RendererOptions) {
    this.renderer = new WebGLRenderer({
      antialias: true,
      canvas,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // The aim fan clips itself to the board.
    this.renderer.localClippingEnabled = true;
    // The viewmodel pass must draw over the world without wiping it.
    this.renderer.autoClear = false;

    this.environment = new Environment(this.scene);
    this.scene.add(
      this.board.group,
      this.threats.group,
      this.aimFan.group,
      this.pieces.group,
      this.pellets.group,
      this.shatter.group,
      this.muzzleLight,
      this.cameraRig.camera
    );
    const { width, height } = canvas;
    this.resize(Math.max(1, width), Math.max(1, height), 1);
  }

  /** Rebuild visuals for a new world (call after creating or restarting a game). */
  reset(world: WorldState): void {
    this.pieces.clear();
    this.pellets.clear();
    this.shatter.clear();
    this.attackerId = null;
    this.kingSquare = null;
    this.lastGameTime = world.gameTime;
    this.lastRealTime = world.realTime;
    this.cameraRig.reset(world);
    this.viewmodel.reset(world);
  }

  /** Render one frame. Call right after `simulation.step`; consumes `world.events`. */
  render(world: WorldState, realDt: number): void {
    const dt = Math.min(MAX_DT, Math.max(0, realDt));
    const gameDt = Math.min(
      dt,
      Math.max(0, world.gameTime - this.lastGameTime)
    );
    this.lastGameTime = world.gameTime;
    const effectDt = Math.max(gameDt, dt * MIN_EFFECT_RATE);
    this.clock += dt;

    // Events belong to the most recent step; only read them once per step.
    if (world.realTime !== this.lastRealTime) {
      this.lastRealTime = world.realTime;
      for (const event of world.events) {
        this.handleEvent(world, event);
      }
    }

    const { player } = world;
    boardToWorld(this.playerWorld, player.pos.x, player.pos.y, 0);
    const frame = {
      clock: this.clock,
      live: world.status === "playing",
      playerWorld: this.playerWorld,
      realDt: dt,
    };
    for (const piece of this.pieces.sync(world, frame)) {
      this.burst(piece.square, piece.kind);
    }
    this.pellets.sync(world, effectDt, this.muzzleRay());
    this.shatter.update(
      world.status === "playing" ? gameDt : dt * AFTERMATH_RATE
    );
    this.threats.update(world, this.clock);
    this.aimFan.update(world);
    this.cameraRig.update(world, dt, this.clock, this.focus(world));
    this.viewmodel.update(world, dt, effectDt, this.clock);
    this.updateMuzzleLight();

    this.renderer.clear();
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    // The canvas is laid out by CSS; only the drawing buffer follows the size.
    this.renderer.setSize(width, height, false);
    const aspect = width / Math.max(1, height);
    this.cameraRig.setAspect(aspect);
    this.viewmodel.setAspect(aspect);
  }

  dispose(): void {
    this.pieces.dispose();
    this.pellets.dispose();
    this.shatter.dispose();
    this.threats.dispose();
    this.aimFan.dispose();
    this.board.dispose();
    this.viewmodel.dispose();
    this.environment.dispose();
    this.muzzleLight.dispose();
    this.scene.clear();
    disposePieceGeometries();
    this.renderer.dispose();
  }

  private handleEvent(world: WorldState, event: GameEvent): void {
    switch (event.type) {
      case "shot":
        this.viewmodel.onShot(world.player.loaded);
        this.cameraRig.onShot();
        break;
      case "dryFire":
        this.viewmodel.onDryFire();
        break;
      case "reloadStart":
        this.viewmodel.onReloadStart(world);
        break;
      case "reloadEnd":
        this.viewmodel.onReloadEnd();
        break;
      case "kingCaptured":
        this.attackerId = event.pieceId;
        break;
      default:
        break;
    }
  }

  private burst(square: Square, kind: PieceKind): void {
    const big = kind === "king";
    if (big) {
      this.kingSquare = square;
    }
    this.shatter.burst(square, kind, big);
  }

  /** What the end-of-game camera looks at: the attacker on a loss, the fallen king on a win. */
  private focus(world: WorldState): DeathFocus | null {
    if (world.status === "lost" && this.attackerId !== null) {
      const base = this.pieces.positionOf(this.attackerId, this.focusBase);
      return base
        ? { base, height: this.pieces.heightOf(this.attackerId) }
        : null;
    }
    if (world.status === "won" && this.kingSquare !== null) {
      return {
        base: squareToWorld(this.focusBase, this.kingSquare),
        height: 1,
      };
    }
    return null;
  }

  /** Where the gun's muzzle sits on screen, expressed for the main camera. */
  private muzzleRay(): MuzzleRay {
    const { camera } = this.cameraRig;
    this.viewmodel.muzzleNdc(this.ndc);
    return {
      aspect: camera.aspect,
      ndcX: this.ndc.x,
      ndcY: this.ndc.y,
      tanHalfFov: Math.tan(MathUtils.degToRad(camera.fov / 2)),
    };
  }

  /** The main-scene half of the muzzle pop: a short flash of light in front of the player. */
  private updateMuzzleLight(): void {
    const { pop } = this.viewmodel;
    this.muzzleLight.intensity = 9 * pop;
    if (pop <= 0) {
      return;
    }
    const { camera } = this.cameraRig;
    camera.getWorldDirection(this.forward);
    this.muzzleLight.position
      .copy(camera.position)
      .addScaledVector(this.forward, 0.7);
    this.muzzleLight.position.y -= 0.3;
  }
}
