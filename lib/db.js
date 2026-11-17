"use strict";

const { Pool } = require("pg");
const { MIGRATIONS } = require("./migrations");

const MIGRATION_LOCK_KEY = 727001; // arbitrary app-wide advisory lock id

class StoreError extends Error {
  constructor(code, status, message, details) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const getConnectionString = () =>
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || "";

const isConfigured = () => Boolean(getConnectionString());

let pool = null;

/**
 * One small pool per serverless instance. Use the provider's *pooled*
 * connection string (e.g. Neon "-pooler" host) in production.
 */
const getPool = () => {
  if (!isConfigured()) {
    throw new StoreError(
      "STORAGE_NOT_CONFIGURED",
      503,
      "No database is configured. Set DATABASE_URL to a PostgreSQL connection string."
    );
  }
  if (!pool) {
    pool = new Pool({
      connectionString: getConnectionString(),
      max: Number(process.env.DB_POOL_MAX || 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });
    pool.on("error", () => {
      /* idle client errors must not crash the function */
    });
  }
  return pool;
};

const closePool = async () => {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
};

/** Runs fn inside a transaction on a dedicated client. */
const withTransaction = async (p, fn, { isolation, readOnly } = {}) => {
  const client = await p.connect();
  try {
    const mode = [
      isolation ? `ISOLATION LEVEL ${isolation}` : "",
      readOnly ? "READ ONLY" : "",
    ]
      .filter(Boolean)
      .join(" ");
    await client.query(`BEGIN ${mode}`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
};

/** Applies pending migrations once, serialised across instances by an advisory lock. */
const migrate = async (p) => {
  const client = await p.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          text        PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query("SELECT id FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.id));
    const ran = [];
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
        await client.query("COMMIT");
        ran.push(migration.id);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    return ran;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } catch {
      /* ignore */
    }
    client.release();
  }
};

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "EAI_AGAIN",
  "57P01",
  "57P03",
  "53300",
]);

/** Translates driver errors into StoreErrors with safe, user-facing messages. */
const translateError = (err) => {
  if (err instanceof StoreError) return err;
  const code = err && err.code;
  if (code === "23505") return new StoreError("CONFLICT", 409, "A record with that id already exists.");
  if (code === "23503")
    return new StoreError("VALIDATION", 400, "Refers to a record that does not exist.", [
      { field: "reference", message: "refers to a record that does not exist" },
    ]);
  if (code === "23514" || code === "23502" || (typeof code === "string" && code.startsWith("22"))) {
    return new StoreError("VALIDATION", 400, "The database rejected the data as invalid.");
  }
  if (CONNECTION_CODES.has(code) || (typeof code === "string" && code.startsWith("08")) || /timeout|terminat/i.test(String(err && err.message))) {
    return new StoreError("STORAGE_UNAVAILABLE", 503, "The database is currently unreachable. Nothing was saved.");
  }
  return err;
};

module.exports = {
  StoreError,
  isConfigured,
  getPool,
  closePool,
  withTransaction,
  migrate,
  translateError,
};
