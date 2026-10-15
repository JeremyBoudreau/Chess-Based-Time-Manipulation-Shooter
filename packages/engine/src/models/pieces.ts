import type { PieceKind } from "@buckshot/core";
import {
  BoxGeometry,
  type BufferGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Shape,
  Vector2,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** [radius, height] pairs in square units (1 = one board square). Repeated heights make ledges. */
type Profile = readonly (readonly [number, number])[];

/** Ten radial segments: the faceted low-poly look of the Sketchfab Staunton set. */
const RADIAL_SEGMENTS = 10;

const PAWN: Profile = [
  [0, 0],
  [0.33, 0],
  [0.33, 0.05],
  [0.31, 0.055],
  [0.31, 0.065],
  [0.32, 0.07],
  [0.32, 0.12],
  [0.29, 0.13],
  [0.24, 0.24],
  [0.24, 0.35],
  [0.22, 0.37],
  [0.18, 0.37],
  [0.14, 0.65],
  [0.18, 0.66],
  [0.18, 0.7],
  [0.16, 0.705],
  [0.16, 0.715],
  [0.17, 0.72],
  [0.15, 0.76],
  [0.1, 0.77],
  [0.15, 0.835],
  [0.158, 0.92],
  [0.123, 0.99],
  [0.068, 1.035],
  [0, 1.05],
];

const ROOK: Profile = [
  [0, 0],
  [0.33, 0],
  [0.33, 0.05],
  [0.31, 0.055],
  [0.31, 0.065],
  [0.32, 0.07],
  [0.32, 0.12],
  [0.29, 0.13],
  [0.29, 0.2],
  [0.22, 0.36],
  [0.2, 0.37],
  [0.2, 0.44],
  [0.17, 0.45],
  [0.16, 0.67],
  [0.18, 0.88],
  [0.24, 0.98],
  [0.24, 1.17],
  [0.232, 1.175],
  [0.232, 1.185],
  [0.24, 1.19],
  [0.24, 1.21],
  [0.18, 1.21],
  [0.18, 1.19],
  [0, 1.19],
];

const KNIGHT_BASE: Profile = [
  [0, 0],
  [0.33, 0],
  [0.33, 0.05],
  [0.31, 0.055],
  [0.31, 0.065],
  [0.32, 0.07],
  [0.32, 0.12],
  [0.29, 0.13],
  [0.29, 0.2],
  [0.23, 0.36],
  [0.225, 0.36],
  [0.225, 0.47],
  [0.21, 0.48],
  [0.21, 0.53],
  [0, 0.53],
];

/** Side silhouette of the knight's head: x points toward the snout, y is height. */
const KNIGHT_HEAD: Profile = [
  [-0.21, 0.53],
  [0.24, 0.53],
  [0.15, 0.63],
  [0.13, 0.87],
  [0.14, 0.93],
  [0.22, 0.93],
  [0.27, 0.99],
  [0.21, 1.18],
  [0.12, 1.4],
  [-0.1, 1.37],
  [-0.18, 1.26],
  [-0.23, 0.87],
];

const BISHOP: Profile = [
  [0, 0],
  [0.34, 0],
  [0.34, 0.05],
  [0.32, 0.055],
  [0.32, 0.065],
  [0.33, 0.07],
  [0.33, 0.13],
  [0.3, 0.14],
  [0.3, 0.2],
  [0.22, 0.42],
  [0.2, 0.42],
  [0.2, 0.47],
  [0.155, 0.47],
  [0.15, 0.94],
  [0.18, 0.94],
  [0.18, 0.99],
  [0.14, 1.02],
  [0.08, 1.03],
  [0.08, 1.05],
  [0.1, 1.05],
  [0.1, 1.07],
  [0.085, 1.08],
  [0.13, 1.15],
  [0.135, 1.22],
  [0.12, 1.3],
  [0.085, 1.36],
  [0.055, 1.39],
  [0.025, 1.41],
  [0.04, 1.43],
  [0.04, 1.47],
  [0.025, 1.495],
  [0, 1.5],
];

const QUEEN: Profile = [
  [0, 0],
  [0.33, 0],
  [0.33, 0.05],
  [0.31, 0.055],
  [0.31, 0.065],
  [0.32, 0.07],
  [0.32, 0.12],
  [0.29, 0.13],
  [0.29, 0.2],
  [0.27, 0.21],
  [0.18, 0.39],
  [0.18, 0.46],
  [0.145, 0.46],
  [0.14, 1.0],
  [0.215, 1.0],
  [0.215, 1.06],
  [0.14, 1.06],
  [0.13, 1.13],
  [0.18, 1.2],
  [0.225, 1.27],
  [0.24, 1.33],
  [0.24, 1.58],
  [0.19, 1.58],
  [0.19, 1.56],
  [0.15, 1.56],
  [0.15, 1.62],
  [0.1, 1.62],
  [0.1, 1.66],
  [0.05, 1.67],
  [0.075, 1.72],
  [0.06, 1.765],
  [0.035, 1.79],
  [0, 1.8],
];

const KING: Profile = [
  [0, 0],
  [0.34, 0],
  [0.34, 0.05],
  [0.32, 0.055],
  [0.32, 0.065],
  [0.33, 0.07],
  [0.33, 0.13],
  [0.3, 0.14],
  [0.3, 0.19],
  [0.27, 0.2],
  [0.21, 0.34],
  [0.2, 0.34],
  [0.2, 0.42],
  [0.155, 0.42],
  [0.146, 0.94],
  [0.22, 0.94],
  [0.22, 0.99],
  [0.18, 0.99],
  [0.18, 1.02],
  [0.145, 1.02],
  [0.145, 1.06],
  [0.125, 1.07],
  [0.3, 1.52],
  [0.3, 1.62],
  [0.22, 1.7],
  [0.14, 1.7],
  [0.14, 1.76],
  [0, 1.76],
];

/**
 * Height of each piece's tallest point, so HP pips and damage numbers can float just above it
 * without measuring bounding boxes every frame.
 */
export const PIECE_HEIGHTS: Readonly<Record<PieceKind, number>> = {
  bishop: 1.5,
  king: 1.95,
  knight: 1.4,
  pawn: 1.05,
  queen: 1.8,
  rook: 1.3,
};

/**
 * mergeGeometries needs every part to agree on indexing; lathes and boxes are indexed, extrusions
 * are not, so everything is converted to non-indexed (flat shading does not need shared vertices).
 */
const nonIndexed = (geometry: BufferGeometry): BufferGeometry => {
  if (geometry.index === null) {
    return geometry;
  }
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  return flat;
};

const lathe = (profile: Profile): BufferGeometry =>
  nonIndexed(
    new LatheGeometry(
      profile.map(([radius, height]) => new Vector2(radius, height)),
      RADIAL_SEGMENTS
    )
  );

/** A box placed on a ring around the piece axis, its depth pointing radially outward. */
const ringBox = (
  angle: number,
  radius: number,
  size: readonly [radial: number, height: number, tangential: number],
  centerY: number
): BufferGeometry => {
  const [radial, height, tangential] = size;
  const box = new BoxGeometry(radial, height, tangential);
  box.rotateY(-angle);
  box.translate(Math.cos(angle) * radius, centerY, Math.sin(angle) * radius);
  return nonIndexed(box);
};

/** `count` crenellations evenly spaced around the axis. */
const crown = (
  count: number,
  radius: number,
  size: readonly [number, number, number],
  centerY: number
): BufferGeometry[] =>
  Array.from({ length: count }, (_, index) =>
    ringBox((index / count) * Math.PI * 2, radius, size, centerY)
  );

const merge = (parts: BufferGeometry[]): BufferGeometry => {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) {
    part.dispose();
  }
  if (merged === null) {
    throw new Error("pieces: failed to merge piece geometry");
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
};

const buildKnightHead = (): BufferGeometry => {
  const thickness = 0.3;
  const bevel = 0.02;
  const shape = new Shape(KNIGHT_HEAD.map(([x, y]) => new Vector2(x, y)));
  const head = new ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 1,
    depth: thickness - bevel * 2,
    steps: 1,
  });
  head.translate(0, 0, -(thickness - bevel * 2) / 2);
  return nonIndexed(head);
};

const buildKingCross = (): BufferGeometry[] => {
  const stem = new BoxGeometry(0.07, 0.19, 0.06);
  stem.translate(0, 1.855, 0);
  const bar = new BoxGeometry(0.17, 0.05, 0.06);
  bar.translate(0, 1.895, 0);
  return [nonIndexed(stem), nonIndexed(bar)];
};

const BUILDERS: Readonly<Record<PieceKind, () => BufferGeometry>> = {
  bishop: () => merge([lathe(BISHOP)]),
  king: () => merge([lathe(KING), ...buildKingCross()]),
  knight: () => merge([lathe(KNIGHT_BASE), buildKnightHead()]),
  pawn: () => merge([lathe(PAWN)]),
  queen: () =>
    merge([lathe(QUEEN), ...crown(8, 0.215, [0.05, 0.05, 0.075], 1.605)]),
  rook: () =>
    merge([lathe(ROOK), ...crown(6, 0.21, [0.06, 0.09, 0.11], 1.255)]),
};

const cache = new Map<PieceKind, BufferGeometry>();

/**
 * One merged, flat-shaded geometry per piece kind, built lazily and shared by every piece view —
 * eight pieces never need eight copies of the same lathe.
 */
export const pieceGeometry = (kind: PieceKind): BufferGeometry => {
  const cached = cache.get(kind);
  if (cached) {
    return cached;
  }
  const built = BUILDERS[kind]();
  cache.set(kind, built);
  return built;
};

/**
 * Free the shared piece geometries. Called by the renderer's dispose; a later renderer simply
 * rebuilds them on first use.
 */
export const disposePieceGeometries = (): void => {
  for (const geometry of cache.values()) {
    geometry.dispose();
  }
  cache.clear();
};
