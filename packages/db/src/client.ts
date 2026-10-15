import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { Context, Layer } from "effect";
import { schema } from "./schema";

/**
 * apps/web and packages/db both sit two levels below the repo root, so this relative URL points at
 * the same file whether Next.js or drizzle-kit opened it.
 */
export const DEFAULT_DATABASE_URL = "file:../../buckshot.db";

export type DrizzleDb = LibSQLDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  __buckshotDb?: DrizzleDb;
};

/**
 * Connection settings from the environment. DATABASE_* wins; TURSO_* (the names Turso's Vercel
 * integration injects) is accepted too, so a marketplace-provisioned database works unrenamed. An
 * empty token means "no token" (local file).
 */
export const databaseUrl = (): string =>
  process.env.DATABASE_URL ||
  process.env.TURSO_DATABASE_URL ||
  DEFAULT_DATABASE_URL;

export const databaseAuthToken = (): string | undefined =>
  process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined;

const createDb = (): DrizzleDb => {
  const client = createClient({
    authToken: databaseAuthToken(),
    url: databaseUrl(),
  });
  return drizzle(client, { schema });
};

/**
 * The process-wide drizzle client. Cached on `globalThis` because Next.js dev re-evaluates modules
 * on every hot reload, which would otherwise open a new libsql connection each time.
 */
export const db: DrizzleDb = globalForDb.__buckshotDb ?? createDb();
globalForDb.__buckshotDb = db;

/** Seam: the database handle. Swap the layer to point repositories at a test database. */
export class Database extends Context.Service<
  Database,
  { readonly db: DrizzleDb }
>()("@buckshot/db/Database") {
  static readonly Default = Layer.succeed(Database, { db });

  /** Builds a Database layer around any drizzle client (e.g. an in-memory libsql for tests). */
  static readonly fromClient = (client: DrizzleDb) =>
    Layer.succeed(Database, { db: client });
}
