#!/usr/bin/env node
"use strict";

/**
 * Restores a backup made by `npm run db:backup` or the admin "Download backup".
 * REPLACES all profiles and applications and the master resume (a new master
 * version is written, the previous one stays in master_resume_history).
 *   DATABASE_URL=... npm run db:restore -- backups/resume.json --yes
 */
const fs = require("fs");
const db = require("../lib/db");
const { defaultStore: store } = require("../lib/store");

(async () => {
  const [file, flag] = process.argv.slice(2);
  if (!file || flag !== "--yes") {
    console.error("Usage: npm run db:restore -- <backup.json> --yes   (this replaces all current data)");
    process.exit(2);
  }
  try {
    const result = await store.restoreAll(JSON.parse(fs.readFileSync(file, "utf8")), "cli-restore");
    console.log("Restored:", result);
  } catch (err) {
    console.error("Restore failed (nothing was changed):", err.message);
    process.exitCode = 1;
  } finally {
    await db.closePool();
  }
})();
