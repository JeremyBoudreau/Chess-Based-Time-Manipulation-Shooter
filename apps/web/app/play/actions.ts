"use server";

import { Auth } from "@buckshot/auth";
import { decodeRunResult } from "@buckshot/core";
import { RunRepository } from "@buckshot/db";
import { Data, Effect } from "effect";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { findImplausibility } from "@/lib/run-plausibility";
import { runServer } from "@/lib/server-runtime";

export type SaveRunResponse =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly personalBest: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "unauthenticated" | "invalid" | "error";
    };

class Unauthenticated extends Data.TaggedError("Unauthenticated")<
  Record<never, never>
> {}

class ImplausibleRun extends Data.TaggedError("ImplausibleRun")<{
  readonly reason: string;
}> {}

const failure = (reason: "unauthenticated" | "invalid" | "error") =>
  Effect.succeed<SaveRunResponse>({ ok: false, reason });

/**
 * Persists a finished run for the signed-in player. The payload comes straight from the browser,
 * so it is decoded against the RunResult schema and sanity-checked before it can reach the
 * leaderboard, and the repository refuses saves that arrive faster than the run could have been
 * played (so one payload cannot be replayed to farm the boards). Never throws: every failure maps
 * to a reason the game UI can show.
 */
export async function saveRunAction(input: unknown): Promise<SaveRunResponse> {
  const requestHeaders = await headers();

  const program = Effect.gen(function* () {
    const auth = yield* Auth;
    const session = yield* auth.getSession(requestHeaders);
    if (!session) {
      return yield* new Unauthenticated();
    }

    const result = yield* decodeRunResult(input);
    const implausibility = findImplausibility(result);
    if (implausibility) {
      return yield* new ImplausibleRun({ reason: implausibility });
    }

    const runs = yield* RunRepository;
    const saved = yield* runs.save(session.user.id, result);
    const response: SaveRunResponse = {
      ok: true,
      personalBest: saved.personalBest,
      runId: saved.id,
    };
    return response;
  }).pipe(
    Effect.catchTags({
      AuthError: (error) =>
        Effect.logError("saveRun: session lookup failed", error.cause).pipe(
          Effect.andThen(failure("error"))
        ),
      DbError: (error) =>
        Effect.logError(`saveRun: ${error.operation} failed`, error.cause).pipe(
          Effect.andThen(failure("error"))
        ),
      ImplausibleRun: (error) =>
        Effect.logWarning(`saveRun: rejected run (${error.reason})`).pipe(
          Effect.andThen(failure("invalid"))
        ),
      RunTooSoon: (error) =>
        Effect.logWarning(
          `saveRun: rejected run (another save within ${error.windowMs}ms)`
        ).pipe(Effect.andThen(failure("invalid"))),
      SchemaError: () => failure("invalid"),
      Unauthenticated: () => failure("unauthenticated"),
    }),
    Effect.withSpan("saveRunAction")
  );

  try {
    const response = await runServer(program);
    if (response.ok) {
      revalidatePath("/leaderboard");
      revalidatePath("/profile");
    }
    return response;
  } catch {
    return { ok: false, reason: "error" };
  }
}
