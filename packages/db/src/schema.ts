import type { KillCounts, PieceKind } from "@buckshot/core";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * SQLite expression for "now" in epoch milliseconds, matching `timestamp_ms` columns. Exported so
 * queries that compare against `created_at` use the database clock that wrote it.
 */
export const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/*
 * Better Auth core tables. Property names must match Better Auth's field names (the drizzle
 * adapter checks them at startup); column names are snake_case like the Better Auth CLI output.
 */

export const user = sqliteTable("user", {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(nowMs)
    .notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(nowMs)
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = sqliteTable(
  "session",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export const account = sqliteTable(
  "account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    accountId: text("account_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .notNull(),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

export const verification = sqliteTable(
  "verification",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);

/** One finished game. Mirrors `RunResult` from @buckshot/core plus ownership and bookkeeping. */
export const run = sqliteTable(
  "run",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .notNull(),
    distanceMoved: real("distance_moved").notNull(),
    gameTimeMs: integer("game_time_ms").notNull(),
    id: text("id").primaryKey(),
    killedBy: text("killed_by").$type<PieceKind>(),
    kills: text("kills", { mode: "json" }).$type<KillCounts>().notNull(),
    outcome: text("outcome", { enum: ["won", "lost"] }).notNull(),
    pelletsFired: integer("pellets_fired").notNull(),
    pelletsHit: integer("pellets_hit").notNull(),
    realTimeMs: integer("real_time_ms").notNull(),
    setupId: text("setup_id").notNull(),
    shotsFired: integer("shots_fired").notNull(),
    totalKills: integer("total_kills").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("run_userId_idx").on(table.userId),
    index("run_outcome_gameTimeMs_idx").on(table.outcome, table.gameTimeMs),
  ]
);

/** Every table, keyed the way Better Auth's drizzle adapter and drizzle's query API expect. */
export const schema = { account, run, session, user, verification };

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
export type Run = typeof run.$inferSelect;
export type NewRun = typeof run.$inferInsert;
