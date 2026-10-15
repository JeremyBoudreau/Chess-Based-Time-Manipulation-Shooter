import type { PieceKind, SetupDefinition } from "@buckshot/core";
import { withNext } from "@/lib/safe-next";

/** A chess side starts with sixteen pieces; an army that size is the whole thing. */
const FULL_ARMY_SIZE = 16;
/** Strongest first, the order a player sizes up an army in. */
const COMPOSITION_ORDER: readonly PieceKind[] = [
  "king",
  "queen",
  "rook",
  "bishop",
  "knight",
  "pawn",
];

/** The query parameter that carries the difficulty, so a refresh or a shared link keeps it. */
export const DIFFICULTY_PARAM = "difficulty";

export interface DifficultyOption {
  /** "Five pawns, a rook, …" straight from the setup. */
  readonly description: string;
  /** True when this is a complete chess army (the hardest setup today). */
  readonly fullArmy: boolean;
  readonly id: string;
  readonly name: string;
  readonly pieceCount: number;
  /** How many of each kind White fields, strongest first; kinds it lacks are left out. */
  readonly pieces: readonly {
    readonly count: number;
    readonly kind: PieceKind;
  }[];
}

/**
 * Plain, serialisable summaries of the playable setups. The play page builds them on the server
 * from core's SETUPS and hands them to the client, so the game UI shows the real armies without
 * importing @buckshot/core's runtime into the first bundle (the engine loads it lazily).
 */
export const describeDifficulties = (
  setups: readonly SetupDefinition[]
): DifficultyOption[] =>
  setups.map((setup) => ({
    description: setup.description,
    fullArmy: setup.white.length >= FULL_ARMY_SIZE,
    id: setup.id,
    name: setup.name,
    pieceCount: setup.white.length,
    pieces: COMPOSITION_ORDER.map((kind) => ({
      count: setup.white.filter((piece) => piece.kind === kind).length,
      kind,
    })).filter((entry) => entry.count > 0),
  }));

/** "8 pieces", or "16 pieces — full army". */
export const armySizeLabel = (option: DifficultyOption): string =>
  option.fullArmy
    ? `${option.pieceCount} pieces — full army`
    : `${option.pieceCount} pieces`;

/** The option for `id`, if it is one of the listed difficulties. */
export const findDifficulty = (
  options: readonly DifficultyOption[],
  id: string
): DifficultyOption | undefined => options.find((option) => option.id === id);

/**
 * The listed difficulty that `params` names, else `fallback`. GameView seeds its pick from the
 * live URL rather than from the server's prop: after `replaceDifficultyInUrl`, a back/forward
 * restore replays the page's original render (and its original prop) under the newer URL.
 */
export const difficultyFromParams = (
  options: readonly DifficultyOption[],
  params: Pick<URLSearchParams, "get"> | null,
  fallback: string
): string => {
  const id = params?.get(DIFFICULTY_PARAM);
  return id !== null && id !== undefined && findDifficulty(options, id)
    ? id
    : fallback;
};

/**
 * `path` scoped to one difficulty. It mirrors `withDifficulty` in `@/lib/difficulty`, which the
 * game UI does not import because that module pulls @buckshot/core's runtime into the first bundle.
 */
export const difficultyHref = (path: string, id: string): string =>
  `${path}?${new URLSearchParams({ [DIFFICULTY_PARAM]: id }).toString()}`;

/**
 * Sign-in link that brings the player back to the same difficulty afterwards (the auth form only
 * honours same-origin `?next=` paths, and the query string survives that check).
 */
export const signInHref = (difficultyId: string): string =>
  withNext("/sign-in", difficultyHref("/play", difficultyId));

/**
 * Put the difficulty in the address bar without a navigation. Next.js syncs native
 * `history.replaceState` with its router, so this neither reloads, scrolls nor re-runs the server
 * page (which would refetch the session on every pick); other query parameters are kept. Next's
 * stored render still carries the old `?difficulty=`, though, so readers must take the pick from
 * `useSearchParams` (see `difficultyFromParams`), never from the page's props.
 */
export const replaceDifficultyInUrl = (id: string): void => {
  const params = new URLSearchParams(window.location.search);
  params.set(DIFFICULTY_PARAM, id);
  window.history.replaceState(null, "", `?${params.toString()}`);
};
