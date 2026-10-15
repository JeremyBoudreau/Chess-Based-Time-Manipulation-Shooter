import { db, schema } from "@buckshot/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { Context, Data, Effect, Layer } from "effect";
import { CALLSIGN_RULE, normalizeCallsign } from "./callsign";

/** Only ever used outside production with no secret configured, so local dev works with zero setup. */
const DEV_FALLBACK_SECRET =
  "buckshot-gambit-dev-only-secret-7f3a9c1e5b2d8f4a6c0e9b7d3f1a5c8e";

/**
 * Fails closed in production. The fallback is committed to the repo, and Better Auth trusts any
 * JWT signed with the secret (e.g. /verify-email mints a session from one), so running on it would
 * let anyone sign in as any user whose email they know. `next build` evaluates this module with
 * NODE_ENV=production but serves nothing, so it may use the fallback; at runtime the import throws
 * and every request fails loudly instead. AUTH_SECRET is read here because an explicit `secret`
 * shadows Better Auth's own lookup of it; with only BETTER_AUTH_SECRETS (the rotation list) set,
 * this returns undefined and Better Auth reads the list itself.
 */
const resolveSecret = (): string | undefined => {
  const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.BETTER_AUTH_SECRETS) {
    return undefined;
  }
  const productionRuntime =
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build";
  if (productionRuntime) {
    throw new Error(
      "[buckshot/auth] BETTER_AUTH_SECRET must be set in production; refusing to start on the committed development secret."
    );
  }
  return DEV_FALLBACK_SECRET;
};

/** Rejects blank or oversized callsigns at the database layer, whichever endpoint sent them. */
const requireCallsign = (name: unknown): string => {
  const callsign = normalizeCallsign(name);
  if (callsign === null) {
    throw new APIError("BAD_REQUEST", { message: CALLSIGN_RULE });
  }
  return callsign;
};

const MIN_PASSWORD_LENGTH = 8;

/** The process-wide Better Auth instance (email + password, cookies set through Next.js). */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
  /*
   * Better Auth's sign-up and update-user schemas accept any string as `name`, so the callsign
   * rules are enforced here rather than trusted from the form. Better Auth merges `data` over the
   * original fields; updates that leave the name alone (email verification, email change) pass.
   */
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: { name: requireCallsign(user.name) },
        }),
      },
      update: {
        before: async (user) =>
          user.name === undefined
            ? undefined
            : { data: { name: requireCallsign(user.name) } },
      },
    },
  },
  emailAndPassword: {
    autoSignIn: true,
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  // nextCookies must stay last so it sees cookies set by every other plugin.
  plugins: [nextCookies()],
  secret: resolveSecret(),
});

/** Route handlers for app/api/auth/[...all]; exported here so the app needs no direct better-auth dependency. */
export const authHandler = toNextJsHandler(auth);

export interface AuthUser {
  readonly email: string;
  readonly id: string;
  readonly name: string;
}

export interface AuthSession {
  readonly user: AuthUser;
}

export class AuthError extends Data.TaggedError("AuthError")<{
  readonly cause: unknown;
}> {}

export interface AuthShape {
  /** Resolves the signed-in user from request headers (cookies), or null when signed out. */
  readonly getSession: (
    headers: Headers
  ) => Effect.Effect<AuthSession | null, AuthError>;
}

/** Narrows Better Auth's session payload to the fields the app actually relies on. */
const toAuthSession = (
  session: { user: { id: string; name: string; email: string } } | null
): AuthSession | null =>
  session
    ? {
        user: {
          email: session.user.email,
          id: session.user.id,
          name: session.user.name,
        },
      }
    : null;

/** Seam: who is playing. Swap the layer to fake a signed-in user in tests. */
export class Auth extends Context.Service<Auth, AuthShape>()(
  "@buckshot/auth/Auth"
) {
  static readonly Default = Layer.succeed(Auth, {
    getSession: (headers: Headers) =>
      Effect.tryPromise({
        catch: (cause) => new AuthError({ cause }),
        try: () => auth.api.getSession({ headers }),
      }).pipe(Effect.map(toAuthSession)),
  });

  /** A fixed session, for tests and storybook-style previews. */
  static readonly fixed = (session: AuthSession | null) =>
    Layer.succeed(Auth, { getSession: () => Effect.succeed(session) });
}
