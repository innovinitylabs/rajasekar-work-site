#!/usr/bin/env node
"use strict";

/**
 * Applies pending schema migrations and the one-time seed to the database in
 * DATABASE_URL, then prints a status summary. Safe to run repeatedly.
 *   DATABASE_URL=postgres://... npm run db:migrate
 */
const db = require("../lib/db");
const { defaultStore: store } = require("../lib/store");

(async () => {
  if (!db.isConfigured()) {
    console.error("DATABASE_URL is not set; nothing to migrate.");
    process.exit(2);
  }
  try {
    await store.ready();
    console.log("Database ready:", await store.status());
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.closePool();
  }
})();
