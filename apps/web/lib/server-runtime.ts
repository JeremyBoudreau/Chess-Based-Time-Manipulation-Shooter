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

const globalForRuntime = globalThis as typeof globalThis & {
  __buckshotServerRuntime?: ServerRuntime;
};

/**
 * The one server runtime. Cached on `globalThis` so Next.js dev hot reloads reuse the built layer
 * (and its database connection) instead of building a fresh one per reload.
 */
export const serverRuntime: ServerRuntime =
  globalForRuntime.__buckshotServerRuntime ?? ManagedRuntime.make(ServerLive);
globalForRuntime.__buckshotServerRuntime = serverRuntime;

/** Runs a server effect to a promise; typed failures reject, so handle the ones you expect first. */
export const runServer = <A, E>(
  effect: Effect.Effect<A, E, ServerServices>
): Promise<A> => serverRuntime.runPromise(effect);
