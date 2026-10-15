import { defineConfig } from "drizzle-kit";

/**
 * The "turso" dialect drives @libsql/client, which accepts both local `file:` URLs and remote
 * Turso URLs — so one config serves local dev and production.
 */
export default defineConfig({
  dbCredentials: {
    authToken:
      process.env.DATABASE_AUTH_TOKEN ||
      process.env.TURSO_AUTH_TOKEN ||
      undefined,
    url:
      process.env.DATABASE_URL ||
      process.env.TURSO_DATABASE_URL ||
      "file:../../buckshot.db",
  },
  dialect: "turso",
  out: "./drizzle",
  schema: "./src/schema.ts",
});
