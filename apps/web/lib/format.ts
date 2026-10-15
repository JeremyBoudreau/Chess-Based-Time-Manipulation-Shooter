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

/** Short date for tables; a fixed locale so the server and browser agree on the shape. */
export const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
};

const utcDateFormatter = new Intl.DateTimeFormat("en", {
  ...DATE_FORMAT,
  timeZone: "UTC",
});

/**
 * The server-rendered date, pinned to UTC and labelled as such: the server's own zone (UTC on
 * Vercel, anything locally) says nothing about the viewer's. `LocalTime` swaps in the viewer's
 * zone after hydration.
 */
export const formatDateUtc = (date: Date): string =>
  `${utcDateFormatter.format(date)} UTC`;

/** "rook" → "Rook". */
export const capitalize = (word: string): string =>
  word.charAt(0).toUpperCase() + word.slice(1);
