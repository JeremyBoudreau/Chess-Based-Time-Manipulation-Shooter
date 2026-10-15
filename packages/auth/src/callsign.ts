/**
 * Callsign rules, shared by the sign-up form (instant feedback) and the server-side Better Auth
 * hooks (the real gate, since `/api/auth/sign-up/email` and `/update-user` accept any string).
 * Dependency-free so the browser bundle can import it without pulling in the server auth instance.
 */

/** Long enough for a handle, short enough to fit a leaderboard cell and the header link. */
export const MAX_CALLSIGN_LENGTH = 24;

/** The trimmed callsign when it has 1..MAX_CALLSIGN_LENGTH characters, otherwise null. */
export const normalizeCallsign = (name: unknown): string | null => {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed.length > 0 && trimmed.length <= MAX_CALLSIGN_LENGTH
    ? trimmed
    : null;
};

/** The message both the form and the server show when a callsign breaks the rule. */
export const CALLSIGN_RULE = `Callsigns need 1–${MAX_CALLSIGN_LENGTH} characters.`;
