#!/usr/bin/env node
/**
 * Apply db/migrations/*.sql in filename order, once each.
 *
 * Deliberately a standalone script rather than something the app runs on first
 * request: migrations that fire from request handlers race each other across
 * instances, and a failed one then surfaces as a mystery 500 instead of a
 * failed deploy. Run it in the deploy step.
 *
 *   npm run db:migrate
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "db", "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Nothing to migrate.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

await client.connect();

try {
  await client.query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query("select name from schema_migrations")).rows.map((r) => r.name),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    // Each migration is atomic: a syntax error halfway through leaves the
    // database exactly as it was, and the migration stays unrecorded so the
    // next run retries it.
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
      ran++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`failed ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(ran === 0 ? "up to date" : `${ran} migration(s) applied`);
} finally {
  await client.end();
}
