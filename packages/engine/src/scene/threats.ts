import {
  BOARD_SIZE,
  type Square,
  squareAt,
  threatenedSquares,
  type WorldState,
} from "@buckshot/core";
import {
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import { squareToWorld } from "./coords";
import { PALETTE } from "./palette";

const OVERLAY_Y = 0.004;
const MAX_SQUARES = BOARD_SIZE * BOARD_SIZE;

/**
 * Red floor tiles under every square a telegraphing piece will hit when it acts. The player's own
 * square, when threatened, gets a brighter, faster pulse: that is the "move NOW" signal.
 */
export class ThreatLayer {
  readonly group = new Group();
  private readonly geometry = new PlaneGeometry(0.94, 0.94);
  private readonly material = new MeshBasicMaterial({
    color: PALETTE.red,
    depthWrite: false,
    opacity: 0.3,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
    transparent: true,
  });
  private readonly dangerMaterial = this.material.clone();
  private readonly tiles: InstancedMesh;
  private readonly danger: Mesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();

  constructor() {
    this.group.name = "threats";
    this.geometry.rotateX(-Math.PI / 2);
    this.tiles = new InstancedMesh(this.geometry, this.material, MAX_SQUARES);
    this.tiles.instanceMatrix.setUsage(DynamicDrawUsage);
    this.tiles.frustumCulled = false;
    this.tiles.count = 0;
    this.tiles.renderOrder = 1;
    this.danger = new Mesh(this.geometry, this.dangerMaterial);
    this.danger.renderOrder = 2;
    this.danger.visible = false;
    this.group.add(this.tiles, this.danger);
  }

  update(world: WorldState, clock: number): void {
    const squares: readonly Square[] =
      world.status === "playing" ? threatenedSquares(world) : [];
    const player = squareAt(world.player.pos);
    let count = 0;
    let playerThreatened = false;
    for (const square of squares) {
      if (square.file === player.file && square.rank === player.rank) {
        playerThreatened = true;
      } else if (count < MAX_SQUARES) {
        squareToWorld(this.position, square, OVERLAY_Y);
        this.matrix.makeTranslation(this.position);
        this.tiles.setMatrixAt(count, this.matrix);
        count += 1;
      }
    }
    this.tiles.count = count;
    this.tiles.instanceMatrix.needsUpdate = true;
    this.material.opacity = 0.25 + 0.15 * (0.5 + 0.5 * Math.sin(clock * 6));

    this.danger.visible = playerThreatened;
    if (playerThreatened) {
      const pulse = 0.5 + 0.5 * Math.sin(clock * 15);
      squareToWorld(this.danger.position, player, OVERLAY_Y + 0.001);
      this.danger.scale.setScalar(1 + 0.04 * pulse);
      this.dangerMaterial.opacity = 0.42 + 0.33 * pulse;
    }
  }

  dispose(): void {
    this.tiles.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.dangerMaterial.dispose();
    this.group.removeFromParent();
  }
}
