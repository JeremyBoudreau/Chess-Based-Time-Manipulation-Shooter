/** Loaded + reserve at or below this and the HUD starts pointing at the shells on the board. */
const LOW_AMMO = 2;

export interface AmmoHintInput {
  readonly loaded: number;
  /** Shells lying on the board right now. */
  readonly pickupsOnBoard: number;
  readonly reserve: number;
  /** The HUD's `shellSpawnRate`: 1 normally, above 1 while core's low-ammo boost is on. */
  readonly shellSpawnRate: number;
}

/** What the hint line says, and whether it is the blinking red "act now" kind. */
export interface AmmoHintLine {
  readonly text: string;
  readonly urgent: boolean;
}

/**
 * The hint line, most urgent first: totally dry → go get a shell; barrels empty → reload; running
 * low → the board has more. With no shell on the board yet, it says to keep moving instead: shells
 * drop on a game-time timer, and game time barely passes unless you move. The low-ammo boost only
 * speeds that timer up, so the boosted lines still say to move, and they take the factor from the
 * HUD (core's rate) instead of assuming one, so they only claim a boost core is applying.
 */
export const ammoHint = ({
  loaded,
  pickupsOnBoard,
  reserve,
  shellSpawnRate,
}: AmmoHintInput): AmmoHintLine | null => {
  const shellsOut = pickupsOnBoard > 0;
  const faster = shellSpawnRate > 1 ? `${shellSpawnRate}× faster` : null;
  if (loaded + reserve === 0) {
    if (shellsOut) {
      return { text: "Out of shells — grab one off the board", urgent: true };
    }
    return {
      text: faster
        ? `Out of shells — they drop ${faster}, keep moving`
        : "Out of shells — keep moving",
      urgent: true,
    };
  }
  if (loaded === 0) {
    return { text: "R — reload", urgent: true };
  }
  if (loaded + reserve <= LOW_AMMO) {
    if (shellsOut) {
      return { text: "Shells on the board — walk over them", urgent: false };
    }
    return {
      text: faster
        ? `Low — shells drop ${faster} as you move`
        : "Low — shells drop as you move",
      urgent: false,
    };
  }
  return null;
};
