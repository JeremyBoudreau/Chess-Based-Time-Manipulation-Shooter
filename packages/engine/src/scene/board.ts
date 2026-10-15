import { BOARD_SIZE } from "@buckshot/core";
import {
  BoxGeometry,
  type BufferGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  ShadowMaterial,
  Shape,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HALF_BOARD } from "./coords";
import { Disposables } from "./disposables";
import { PALETTE } from "./palette";

/** Visible gap between tiles: the dark slab shows through as thin seams. */
const SEAM = 0.028;
const TILE_THICKNESS = 0.03;
const SLAB_THICKNESS = 0.12;
const FRAME_WIDTH = 0.45;
const FRAME_BEVEL = 0.05;
/** The frame stands a hair above the tiles so its bevel catches light along the board edge. */
const FRAME_TOP = 0.035;
/** The white void floor sits well below the board so the board reads as floating. */
export const VOID_FLOOR_Y = -2.4;

const buildTiles = (light: boolean): BufferGeometry => {
  const tiles: BufferGeometry[] = [];
  for (let rank = 0; rank < BOARD_SIZE; rank += 1) {
    for (let file = 0; file < BOARD_SIZE; file += 1) {
      // a1 (0, 0) is a dark square.
      const isLight = (file + rank) % 2 === 1;
      if (isLight === light) {
        const tile = new BoxGeometry(1 - SEAM, TILE_THICKNESS, 1 - SEAM);
        tile.translate(
          file + 0.5 - HALF_BOARD,
          -TILE_THICKNESS / 2,
          HALF_BOARD - (rank + 0.5)
        );
        tiles.push(tile);
      }
    }
  }
  const merged = mergeGeometries(tiles, false);
  for (const tile of tiles) {
    tile.dispose();
  }
  if (merged === null) {
    throw new Error("board: failed to merge tiles");
  }
  return merged;
};

/** A square ring with a chamfered top edge, extruded downward from just above the board. */
const buildFrame = (): BufferGeometry => {
  const outer = HALF_BOARD + FRAME_WIDTH - FRAME_BEVEL;
  const inner = HALF_BOARD + FRAME_BEVEL;
  const shape = new Shape();
  shape.moveTo(-outer, -outer);
  shape.lineTo(outer, -outer);
  shape.lineTo(outer, outer);
  shape.lineTo(-outer, outer);
  shape.lineTo(-outer, -outer);
  const hole = new Path();
  hole.moveTo(-inner, -inner);
  hole.lineTo(-inner, inner);
  hole.lineTo(inner, inner);
  hole.lineTo(inner, -inner);
  hole.lineTo(-inner, -inner);
  shape.holes.push(hole);
  const depth = SLAB_THICKNESS + FRAME_TOP + 0.04;
  const frame = new ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelOffset: 0,
    bevelSegments: 1,
    bevelSize: FRAME_BEVEL,
    bevelThickness: FRAME_BEVEL * 0.6,
    curveSegments: 1,
    depth: depth - FRAME_BEVEL * 1.2,
    steps: 1,
  });
  // Shape lies in XY, extrusion runs along +Z; lay it flat with the bevelled face up.
  frame.rotateX(-Math.PI / 2);
  frame.translate(0, FRAME_TOP - depth + FRAME_BEVEL * 0.6, 0);
  return frame;
};

/**
 * The floating chessboard: caramel/plum tiles with dark seams over a slab, a bevelled rosewood
 * frame, and the white void floor far below that catches the board's soft shadow.
 */
export class Board {
  readonly group = new Group();
  private readonly resources = new Disposables();

  constructor() {
    this.group.name = "board";
    const track = <T extends { dispose: () => void }>(item: T) =>
      this.resources.track(item);

    const tileMaterial = (color: string) =>
      track(
        new MeshStandardMaterial({ color, flatShading: true, roughness: 0.62 })
      );

    const lightTiles = new Mesh(
      track(buildTiles(true)),
      tileMaterial(PALETTE.tileLight)
    );
    const darkTiles = new Mesh(
      track(buildTiles(false)),
      tileMaterial(PALETTE.tileDark)
    );
    for (const tiles of [lightTiles, darkTiles]) {
      tiles.receiveShadow = true;
      tiles.castShadow = false;
      this.group.add(tiles);
    }

    const slabGeometry = track(
      new BoxGeometry(BOARD_SIZE + 0.1, SLAB_THICKNESS, BOARD_SIZE + 0.1)
    );
    slabGeometry.translate(0, -TILE_THICKNESS * 0.6 - SLAB_THICKNESS / 2, 0);
    const slab = new Mesh(
      slabGeometry,
      track(new MeshStandardMaterial({ color: PALETTE.seam, roughness: 0.9 }))
    );
    slab.receiveShadow = true;
    slab.castShadow = true;
    this.group.add(slab);

    const frame = new Mesh(
      track(buildFrame()),
      track(
        new MeshStandardMaterial({
          color: PALETTE.frame,
          flatShading: true,
          roughness: 0.48,
        })
      )
    );
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.group.add(frame);

    const floorGeometry = track(new PlaneGeometry(240, 240));
    floorGeometry.rotateX(-Math.PI / 2);
    // Unlit and not tone-mapped: ACES would turn a lit white floor grey. The soft board shadow is
    // laid on top by a shadow-only catcher.
    const floor = new Mesh(
      floorGeometry,
      track(
        new MeshBasicMaterial({ color: PALETTE.voidFloor, toneMapped: false })
      )
    );
    floor.position.y = VOID_FLOOR_Y;
    const shadowCatcher = new Mesh(
      floorGeometry,
      track(
        new ShadowMaterial({
          color: PALETTE.voidShadow,
          opacity: 0.28,
          transparent: true,
        })
      )
    );
    shadowCatcher.position.y = VOID_FLOOR_Y + 0.002;
    shadowCatcher.receiveShadow = true;
    this.group.add(floor, shadowCatcher);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.resources.dispose();
  }
}
