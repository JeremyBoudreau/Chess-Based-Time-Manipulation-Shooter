import type { PieceState, WorldState } from "@buckshot/core";
import { Group, MeshStandardMaterial, Vector3 } from "three";
import { DamageNumber } from "./labels";
import { PALETTE } from "./palette";
import { PieceView, type ViewFrame } from "./piece-view";

/** Game-seconds within which further hits on the same piece grow the existing number. */
const MERGE_WINDOW = 0.3;

/**
 * All white pieces, keyed by id, plus their floating damage numbers. It diffs each piece against
 * the previous frame (HP drops, phase → dead) instead of trusting it saw every event, so effects
 * stay correct even if the client steps the simulation more than once per render.
 */
export class PieceLayer {
  readonly group = new Group();
  private readonly views = new Map<string, PieceView>();
  private numbers: DamageNumber[] = [];
  private readonly baseMaterial = new MeshStandardMaterial({
    color: PALETTE.ivory,
    emissive: "#000000",
    flatShading: true,
    metalness: 0,
    roughness: 0.55,
  });
  private readonly scratch = new Vector3();
  private readonly seen = new Set<string>();

  constructor() {
    this.group.name = "pieces";
  }

  /** Sync every view; returns the pieces that died this frame (the caller shatters them). */
  sync(world: WorldState, frame: ViewFrame): PieceState[] {
    const killed: PieceState[] = [];
    this.seen.clear();
    for (const piece of world.pieces) {
      this.seen.add(piece.id);
      const view = this.viewFor(piece);
      if (piece.hp < view.lastHp && !view.dead) {
        this.addDamage(view, view.lastHp - piece.hp, world.gameTime);
      }
      view.lastHp = piece.hp;
      if (view.sync(piece, frame)) {
        killed.push(piece);
      }
    }
    for (const [id, view] of this.views) {
      if (!this.seen.has(id)) {
        view.dispose();
        this.views.delete(id);
      }
    }
    this.updateNumbers(frame.realDt);
    return killed;
  }

  /** World position of a piece's base, or null if it is unknown (death cam target). */
  positionOf(id: string, target: Vector3): Vector3 | null {
    const view = this.views.get(id);
    return view ? view.base(target) : null;
  }

  /** Height of a piece's model (death cam looks at roughly its head). */
  heightOf(id: string): number {
    return this.views.get(id)?.height ?? 1;
  }

  clear(): void {
    for (const view of this.views.values()) {
      view.dispose();
    }
    this.views.clear();
    for (const label of this.numbers) {
      label.dispose();
    }
    this.numbers = [];
  }

  dispose(): void {
    this.clear();
    this.baseMaterial.dispose();
    this.group.removeFromParent();
  }

  private viewFor(piece: PieceState): PieceView {
    const existing = this.views.get(piece.id);
    if (existing) {
      return existing;
    }
    const view = new PieceView(piece, this.baseMaterial.clone());
    // A piece first seen already dead (e.g. after reset) must not shatter again.
    view.dead = piece.phase === "dead";
    this.views.set(piece.id, view);
    this.group.add(view.root);
    return view;
  }

  private addDamage(view: PieceView, amount: number, gameTime: number): void {
    const merge = this.numbers.find(
      (existing) =>
        existing.pieceId === view.id &&
        gameTime - existing.lastHitGameTime <= MERGE_WINDOW &&
        !existing.finished
    );
    if (merge) {
      merge.add(amount, gameTime);
      return;
    }
    const label = new DamageNumber(
      view.id,
      view.crown(this.scratch),
      amount,
      gameTime
    );
    this.numbers.push(label);
    this.group.add(label.sprite);
  }

  private updateNumbers(realDt: number): void {
    const alive: DamageNumber[] = [];
    for (const label of this.numbers) {
      label.update(realDt);
      if (label.finished) {
        label.dispose();
      } else {
        alive.push(label);
      }
    }
    this.numbers = alive;
  }
}
