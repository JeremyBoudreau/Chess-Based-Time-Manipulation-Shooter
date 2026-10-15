import { DEFAULT_SETUP, findSetup, type SetupDefinition } from "@buckshot/core";

/** The query parameter that picks a difficulty on /play and /leaderboard. */
export const DIFFICULTY_PARAM = "difficulty";

/**
 * The setup a `?difficulty=` value names, or Easy when it is missing or unknown. Links carrying it
 * are meant to be shared, so a stale or mistyped value lands on a page rather than an error; legacy
 * ids resolve the way `findSetup` resolves them.
 */
export const setupFromParam = (
  value: string | readonly string[] | undefined
): SetupDefinition => {
  const id = typeof value === "string" ? value : value?.[0];
  return (id === undefined ? undefined : findSetup(id)) ?? DEFAULT_SETUP;
};

/** `path` scoped to one difficulty, always explicit so a shared link means the same thing later. */
export const withDifficulty = (path: string, setupId: string): string =>
  `${path}?${DIFFICULTY_PARAM}=${encodeURIComponent(setupId)}`;
