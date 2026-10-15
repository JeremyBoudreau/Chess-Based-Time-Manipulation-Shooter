import { Auth } from "@buckshot/auth";
import { RunRepository } from "@buckshot/db";
import { type Effect, Layer, ManagedRuntime } from "effect";

/**
 * Server-only: this module opens the database. Import it from server components, route handlers
 * and server actions — never from a "use client" module.
 */

/** Every seam the server needs, each with its default (singleton) implementation. */
export const ServerLive = Layer.mergeAll(RunRepository.Default, Auth.Default);

export type ServerServices = Layer.Success<typeof ServerLive>;

type ServerRuntime = ManagedRuntime.ManagedRuntime<ServerServices, never>;

/**
 * The one server runtime, built once per evaluation of this module (once per production server
 * process). Deliberately not cached on `globalThis`: a cached runtime would keep running the old
 * service closures after a dev hot reload. The expensive part, the libsql connection, is already
 * reused across reloads by the cache in packages/db/src/client.ts, and both layers hold nothing
 * that needs disposing, so a stale runtime is simply garbage-collected with its module.
 */
export const serverRuntime: ServerRuntime = ManagedRuntime.make(ServerLive);

/** Runs a server effect to a promise; typed failures reject, so handle the ones you expect first. */
export const runServer = <A, E>(
  effect: Effect.Effect<A, E, ServerServices>
): Promise<A> => serverRuntime.runPromise(effect);
