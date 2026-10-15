/** Where signing in or up lands when no page asked to be returned to. */
export const DEFAULT_AFTER_AUTH = "/play";

/** Sending someone back to an auth page after auth would only bounce them again. */
const AUTH_PAGES: ReadonlySet<string> = new Set(["/sign-in", "/sign-up"]);

/** A throwaway origin to resolve relative paths against; nothing is ever fetched from it. */
const PARSE_ORIGIN = "http://buckshot.invalid";

/**
 * The same-origin path in a `?next=` value, or `fallback`. The value is attacker-controlled (any
 * link can set it), so it is parsed the way a browser would rather than prefix-matched: `//host`,
 * `/\host` and tab-smuggled variants all resolve to another origin and are rejected, which keeps
 * the auth pages from becoming an open redirect.
 */
export const safeNext = (
  value: unknown,
  fallback: string = DEFAULT_AFTER_AUTH
): string => {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(value, PARSE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PARSE_ORIGIN || AUTH_PAGES.has(url.pathname)) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
};

/** `path` carrying `next` as its return destination, omitted when that is the default anyway. */
export const withNext = (path: string, next: string): string =>
  next === DEFAULT_AFTER_AUTH
    ? path
    : `${path}?next=${encodeURIComponent(next)}`;
