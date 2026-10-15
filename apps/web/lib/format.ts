const MS_PER_SECOND = 1000;

/** Game-time is the headline number of a run, always shown in seconds with two decimals. */
export const formatGameTime = (ms: number): string =>
  `${(ms / MS_PER_SECOND).toFixed(2)}s`;

/** Whole-number percentage for ratios in 0..1. */
export const formatPercent = (ratio: number): string =>
  `${Math.round(ratio * 100)}%`;

/** Accuracy of one run, treating "fired nothing" as 0 rather than NaN. */
export const accuracyOf = (pelletsHit: number, pelletsFired: number): number =>
  pelletsFired > 0 ? pelletsHit / pelletsFired : 0;

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
});

/** Short, locale-stable date for tables (server-rendered, so a fixed locale avoids hydration drift). */
export const formatDate = (date: Date): string => dateFormatter.format(date);

/** "rook" → "Rook". */
export const capitalize = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);
