import { type PieceKind, type PieceState, sameSquare } from "@buckshot/core";
import { Color, Group, Mesh, type MeshStandardMaterial, Vector3 } from "three";
import { PIECE_HEIGHTS, pieceGeometry } from "../models/pieces";
import { clamp01, easeInOutCubic, squareToWorld } from "./coords";
import { HpPips } from "./labels";
import { PALETTE } from "./palette";

/** Per-frame inputs every view needs; built once per frame by the renderer. */
export interface ViewFrame {
  /** Monotonic real-time clock (seconds) for effects that stay alive while time is frozen. */
  readonly clock: number;
  /** False once the game is over: telegraphs stop shaking/blinking and the board freezes. */
  readonly live: boolean;
  /** Player position in world space (pieces that have a "face" turn toward it). */
  readonly playerWorld: Vector3;
  readonly realDt: number;
}

const RED = new Color(PALETTE.red);
const WHITE = new Color("#FFFFFF");
const IVORY = new Color(PALETTE.ivory);
const HOP_HEIGHT = 0.25;
const KNIGHT_HOP_HEIGHT = 0.45;
const SHAKE_AMPLITUDE = 0.035;
const WOBBLE_AMPLITUDE = 0.07;
/** Real seconds of the white pop shown when a pawn promotes. */
const PROMOTE_FLASH = 0.45;
const PIP_CLEARANCE = 0.2;

/** Telegraph intensity 0..1, or 0 once the game is over (everything freezes on the final frame). */
const telegraphLevel = (piece: PieceState, frame: ViewFrame) =>
  frame.live && piece.phase === "telegraph"
    ? clamp01(piece.telegraphProgress)
    : 0;

/** easeInBack: a small wind-up then a snap forward, so a lethal capture reads as a lunge. */
const lunge = (t: number) => {
  const overshoot = 1.9;
  return t * t * ((overshoot + 1) * t - overshoot);
};

/** Pieces whose silhouette has a front turn toward the player; lathe pieces stay put. */
const facingOffset = (kind: PieceKind): number | null => {
  if (kind === "knight") {
    return 0;
  }
  if (kind === "king") {
    // The cross is modelled across X; turn it broadside to the player.
    return Math.PI / 2;
  }
  return null;
};

/**
 * The visual twin of one `PieceState`. It owns a cloned material (so blinking one piece never
 * tints another) and keeps only cosmetic state: blink phase, flash envelopes, last seen HP/kind.
 */
export class PieceView {
  readonly id: string;
  /** Logical board position + hop; children inherit it. */
  readonly root = new Group();
  /** Shake and wobble live here so the HP pips ride along with the piece. */
  private readonly body = new Group();
  private readonly mesh: Mesh;
  private readonly material: MeshStandardMaterial;
  private readonly pips = new HpPips();
  private readonly seed = Math.random() * 100;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private kind: PieceKind;
  private blinkPhase = 0;
  private flashStart = 0;
  private lastHitFlash = 0;
  private promoteFlash = 0;
  /** HP seen on the previous sync (the layer diffs it to spawn damage numbers). */
  lastHp: number;
  dead = false;

  constructor(piece: PieceState, material: MeshStandardMaterial) {
    this.id = piece.id;
    this.kind = piece.kind;
    this.lastHp = piece.hp;
    this.material = material;
    this.mesh = new Mesh(pieceGeometry(piece.kind), material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.body.add(this.mesh);
    this.body.add(this.pips.sprite);
    this.root.add(this.body);
    this.root.name = `piece:${piece.id}`;
    this.placePips();
  }

  /** World position just above the piece's crown (where damage numbers spawn). */
  crown(target: Vector3): Vector3 {
    this.root.getWorldPosition(target);
    target.y += PIECE_HEIGHTS[this.kind] + 0.12;
    return target;
  }

  /** World position of the piece's base (used by the death cam and shatter). */
  base(target: Vector3): Vector3 {
    return this.root.getWorldPosition(target);
  }

  get height(): number {
    return PIECE_HEIGHTS[this.kind];
  }

  /** Mirror the piece for this frame; returns true on the frame it dies (time to shatter). */
  sync(piece: PieceState, frame: ViewFrame): boolean {
    if (piece.kind !== this.kind) {
      this.promote(piece.kind);
    }
    const dead = piece.phase === "dead";
    const died = dead && !this.dead;
    this.dead = dead;
    this.root.visible = !dead;
    if (dead) {
      return died;
    }
    this.place(piece);
    this.face(frame.playerWorld);
    this.shake(piece, frame);
    this.tint(piece, frame);
    this.pips.update(piece.hp, piece.maxHp);
    return false;
  }

  private promote(kind: PieceKind): void {
    this.kind = kind;
    this.mesh.geometry = pieceGeometry(kind);
    this.promoteFlash = PROMOTE_FLASH;
    this.placePips();
  }

  private placePips(): void {
    this.pips.sprite.position.set(
      0,
      PIECE_HEIGHTS[this.kind] + PIP_CLEARANCE,
      0
    );
  }

  private place(piece: PieceState): void {
    squareToWorld(this.to, piece.square);
    const t = clamp01(piece.moveProgress);
    if (t >= 1 || sameSquare(piece.fromSquare, piece.square)) {
      this.root.position.copy(this.to);
      return;
    }
    squareToWorld(this.from, piece.fromSquare);
    let eased: number;
    let hop: number;
    if (piece.isAttacking) {
      eased = lunge(t);
      hop = 0.1 * Math.sin(Math.PI * t);
    } else {
      eased = easeInOutCubic(t);
      const height = piece.kind === "knight" ? KNIGHT_HOP_HEIGHT : HOP_HEIGHT;
      hop = height * Math.sin(Math.PI * t);
    }
    this.root.position.lerpVectors(this.from, this.to, eased);
    this.root.position.y += hop;
  }

  private face(playerWorld: Vector3): void {
    const offset = facingOffset(this.kind);
    if (offset === null) {
      this.mesh.rotation.y = 0;
      return;
    }
    const dx = playerWorld.x - this.root.position.x;
    const dz = playerWorld.z - this.root.position.z;
    // Rotating +X by θ about Y gives (cos θ, 0, -sin θ): solve for the snout to hit the player.
    this.mesh.rotation.y = Math.atan2(-dz, dx) + offset;
  }

  /** Telegraph shake: oscillates on REAL time so a frozen world still looks alive and dangerous. */
  private shake(piece: PieceState, frame: ViewFrame): void {
    const p = telegraphLevel(piece, frame);
    if (p <= 0) {
      this.body.position.set(0, 0, 0);
      this.body.rotation.set(0, 0, 0);
      return;
    }
    const c = frame.clock;
    const s = this.seed;
    const amplitude = SHAKE_AMPLITUDE * (0.35 + p);
    this.body.position.set(
      amplitude * (0.6 * Math.sin(c * 53 + s) + 0.4 * Math.sin(c * 87 + s * 2)),
      0,
      amplitude * (0.6 * Math.sin(c * 61 + s * 3) + 0.4 * Math.sin(c * 97 + s))
    );
    const wobble = WOBBLE_AMPLITUDE * p;
    this.body.rotation.set(
      wobble * Math.sin(c * 31 + s * 5),
      0,
      wobble * Math.sin(c * 37 + s * 7)
    );
  }

  /** Emissive priority: hit flash (white → red) > promotion pop > telegraph blink. */
  private tint(piece: PieceState, frame: ViewFrame): void {
    const { material } = this;
    material.color.copy(IVORY);
    this.promoteFlash = Math.max(0, this.promoteFlash - frame.realDt);

    if (piece.hitFlash > this.lastHitFlash + 1e-6) {
      this.flashStart = piece.hitFlash;
    }
    this.lastHitFlash = piece.hitFlash;
    if (piece.hitFlash > 0 && this.flashStart > 0) {
      const k = clamp01(piece.hitFlash / this.flashStart);
      material.emissive.copy(WHITE).lerp(RED, 1 - k);
      material.emissiveIntensity = 0.25 + 1.4 * k;
      return;
    }
    if (this.promoteFlash > 0) {
      material.emissive.copy(WHITE);
      material.emissiveIntensity = 1.6 * (this.promoteFlash / PROMOTE_FLASH);
      return;
    }

    const p = telegraphLevel(piece, frame);
    if (p <= 0) {
      this.blinkPhase = 0;
      material.emissiveIntensity = 0;
      return;
    }
    // Frequency rises 5 → 14 Hz; integrating it keeps the blink continuous as it speeds up.
    this.blinkPhase += frame.realDt * (5 + 9 * p);
    const on = this.blinkPhase % 1 < 0.5;
    material.emissive.copy(RED);
    material.emissiveIntensity = on ? 0.4 + 1.2 * p : 0.06 * p;
    if (on) {
      // Emissive alone over near-white ivory tone-maps to pink; the albedo itself must go red.
      material.color.lerp(RED, 0.45 + 0.55 * p);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.pips.dispose();
    this.material.dispose();
  }
}
