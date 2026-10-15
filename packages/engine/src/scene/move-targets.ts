import { BOARD_SIZE, sameSquare, type WorldState } from "@buckshot/core";
import {
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import { squareToWorld } from "./coords";
import { PALETTE } from "./palette";

/** Just under the threat tiles (y = 0.004), so a threatened destination still reads red. */
const MARKER_Y = 0.003;
const MAX_MARKERS = BOARD_SIZE * BOARD_SIZE;

/**
 * Pale tiles under the square a moving piece already occupies. The sim hands a piece its
 * destination (occupancy, pellet hits) the instant a move starts, but the model glides there on
 * GAME time, so with time frozen a slide can hang halfway for many real seconds. Squares are the
 * hitboxes: this shows the one that counts while the model is still in transit.
 */
export class MoveTargetLayer {
  readonly group = new Group();
  private readonly geometry = new PlaneGeometry(0.94, 0.94);
  private readonly material = new MeshBasicMaterial({
    color: PALETTE.ivory,
    depthWrite: false,
    opacity: 0.3,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
    transparent: true,
  });
  private readonly tiles: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();

  constructor() {
    this.group.name = "move-targets";
    this.geometry.rotateX(-Math.PI / 2);
    this.tiles = new InstancedMesh(this.geometry, this.material, MAX_MARKERS);
    this.tiles.instanceMatrix.setUsage(DynamicDrawUsage);
    this.tiles.frustumCulled = false;
    this.tiles.count = 0;
    // Drawn before the threat tiles (renderOrder 1) so red blends over ivory where both apply.
    this.tiles.renderOrder = 0;
    this.group.add(this.tiles);
  }

  update(world: WorldState, clock: number): void {
    let count = 0;
    if (world.status === "playing") {
      for (const piece of world.pieces) {
        const inTransit =
          piece.phase === "moving" &&
          !sameSquare(piece.fromSquare, piece.square);
        if (inTransit && count < MAX_MARKERS) {
          squareToWorld(this.position, piece.square, MARKER_Y);
          this.matrix.makeTranslation(this.position);
          this.tiles.setMatrixAt(count, this.matrix);
          count += 1;
        }
      }
    }
    this.tiles.count = count;
    this.tiles.instanceMatrix.needsUpdate = true;
    // A slow pulse on REAL time, so the marker stays legible while the world is frozen.
    this.material.opacity = 0.24 + 0.12 * (0.5 + 0.5 * Math.sin(clock * 4));
  }

  dispose(): void {
    this.tiles.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
