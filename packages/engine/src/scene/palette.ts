/**
 * The whole art direction in one place: a SUPERHOT white/cyan void, a low-poly Staunton set and a
 * single danger red. Every visual module reads from here so a palette tweak never needs a hunt.
 */
export const PALETTE = {
  background: "#E9F2F6",
  cream: "#FFF4DC",
  fog: "#DCEBF2",
  frame: "#522C1E",
  ground: "#B8CCD8",
  ivory: "#ECE4D6",
  metal: "#0A0C0E",
  metalSpecular: "#46AEBB",
  muzzle: "#E8FBFF",
  red: "#E80C0C",
  redDark: "#981A1B",
  seam: "#2A1B19",
  shellBrass: "#C9A24A",
  sky: "#F2FAFF",
  slab: "#3A2420",
  sparkGlow: "#FFD04A",
  tileDark: "#7A5A66",
  tileLight: "#D0905F",
  voidFloor: "#F3F8FA",
  voidShadow: "#45667A",
  walnut: "#4E3B30",
} as const;

/**
 * Eye height of the black king in world units (board surface is y = 0). FPS Chess keeps the camera
 * at pawn-head height so the enemy king and bishop tower over you like pillars.
 */
export const EYE_HEIGHT = 0.95;

/** Pellets cruise at this height so they visibly pass through pawns (1.05 tall). */
export const PELLET_FLIGHT_HEIGHT = 0.6;
