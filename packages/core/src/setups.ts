import type { SetupDefinition, SetupPiece, Square } from "./types";

const sq = (name: string): Square => {
  const file = name.charCodeAt(0) - "a".charCodeAt(0);
  const rank = Number(name.slice(1)) - 1;
  return { file, rank };
};

const place = (
  kind: SetupPiece["kind"],
  ...squares: readonly string[]
): SetupPiece[] => squares.map((name) => ({ kind, square: sq(name) }));

/** The three difficulties, easiest first. Each one is the previous army plus reinforcements. */
export type Difficulty = "easy" | "medium" | "hard";

/** Easy: a stripped-down white army (5 pawns, a rook, a bishop and the king). */
export const EASY_SETUP: SetupDefinition = {
  description: "Five pawns, a rook, a bishop and their king.",
  id: "easy",
  name: "Easy",
  playerStart: sq("e8"),
  white: [
    ...place("pawn", "c2", "d2", "e2", "f2", "g2"),
    ...place("rook", "h1"),
    ...place("bishop", "c1"),
    ...place("king", "e1"),
  ],
};

/** Medium: Easy plus the other rook, the other bishop and three more pawns (a full pawn line). */
export const MEDIUM_SETUP: SetupDefinition = {
  description: "Eight pawns, both rooks, both bishops and their king.",
  id: "medium",
  name: "Medium",
  playerStart: EASY_SETUP.playerStart,
  white: [
    ...EASY_SETUP.white,
    ...place("rook", "a1"),
    ...place("bishop", "f1"),
    ...place("pawn", "a2", "b2", "h2"),
  ],
};

/** Hard: Medium plus both knights and the queen — the full sixteen-piece white army. */
export const HARD_SETUP: SetupDefinition = {
  description: "The full white army: both knights and the queen join in.",
  id: "hard",
  name: "Hard",
  playerStart: MEDIUM_SETUP.playerStart,
  white: [
    ...MEDIUM_SETUP.white,
    ...place("knight", "b1", "g1"),
    ...place("queen", "d1"),
  ],
};

/** Every playable setup, easiest first (the order the UI lists them in). */
export const SETUPS: readonly SetupDefinition[] = [
  EASY_SETUP,
  MEDIUM_SETUP,
  HARD_SETUP,
];

export const DEFAULT_SETUP = EASY_SETUP;

/** Ids saved by earlier versions, mapped to the setup they meant ("skirmish" was today's Easy). */
const LEGACY_SETUP_IDS: Readonly<Record<string, string>> = {
  skirmish: EASY_SETUP.id,
};

/**
 * Looks a setup up by id, also accepting legacy ids so runs saved before difficulties existed
 * still resolve (for display and server-side plausibility checks).
 */
export const findSetup = (id: string): SetupDefinition | undefined => {
  const resolved = LEGACY_SETUP_IDS[id] ?? id;
  return SETUPS.find((setup) => setup.id === resolved);
};

export const isDifficulty = (id: string): id is Difficulty =>
  SETUPS.some((setup) => setup.id === id);

export const squareName = (square: Square): string =>
  `${String.fromCharCode("a".charCodeAt(0) + square.file)}${square.rank + 1}`;

export const parseSquare = sq;
