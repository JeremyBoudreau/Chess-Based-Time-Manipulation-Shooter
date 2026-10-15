import { randomBytes } from "node:crypto";
import { db, schema } from "@buckshot/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { Context, Data, Effect, Layer } from "effect";
import { CALLSIGN_RULE, normalizeCallsign } from "./callsign";

/**
 * The signing secret only ever comes from the environment — never from source — in every
 * environment, so there is nothing in the repo that could leak and be used to forge sessions
 * (Better Auth trusts any token signed with it). AUTH_SECRET is read here because an explicit
 * `secret` shadows Better Auth's own lookup of it; with only BETTER_AUTH_SECRETS (the rotation list)
 * set, this returns undefined and Better Auth reads the list itself.
 *
 * The one exception is `next build`: it evaluates this module to collect page data but serves no
 * requests, so it gets a throwaway random secret that dies with the build process.
 */
const resolveSecret = (): string | undefined => {
  const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.BETTER_AUTH_SECRETS) {
    return undefined;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return randomBytes(32).toString("base64");
  }
  throw new Error(
    "[buckshot/auth] BETTER_AUTH_SECRET is not set. Copy apps/web/.env.example to apps/web/.env.local and set it, e.g. `openssl rand -base64 32`."
  );
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
