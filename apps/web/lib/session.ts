import { Auth, type AuthSession } from "@buckshot/auth";
import { Effect } from "effect";
import { headers } from "next/headers";
import { cache } from "react";
import { runServer } from "./server-runtime";

/**
 * The signed-in viewer for the current request, or null. Wrapped in React `cache` so the header,
 * layout and page share one lookup per request; an auth failure renders as signed out.
 */
export const getViewer = cache(async (): Promise<AuthSession | null> => {
  const requestHeaders = await headers();
  return runServer(
    Effect.gen(function* () {
      const auth = yield* Auth;
      return yield* auth.getSession(requestHeaders);
    }).pipe(
      Effect.catchTag("AuthError", (error) =>
        Effect.logError("Session lookup failed", error.cause).pipe(
          Effect.as(null)
        )
      )
    )
  );
});
