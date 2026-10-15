import { db, schema } from "@buckshot/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { Context, Data, Effect, Layer } from "effect";

/** Only ever used when BETTER_AUTH_SECRET is unset, so local dev works with zero setup. */
const DEV_FALLBACK_SECRET =
  "buckshot-gambit-dev-only-secret-7f3a9c1e5b2d8f4a6c0e9b7d3f1a5c8e";

/** Falls back to a dev secret but shouts about it in production, where sessions would be forgeable. */
const resolveSecret = (): string => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[buckshot/auth] BETTER_AUTH_SECRET is not set; using the insecure development secret."
    );
  }
  return DEV_FALLBACK_SECRET;
};

const MIN_PASSWORD_LENGTH = 8;

/** The process-wide Better Auth instance (email + password, cookies set through Next.js). */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  database: drizzleAdapter(db, { provider: "sqlite", schema }),
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
