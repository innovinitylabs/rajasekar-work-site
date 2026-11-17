#!/usr/bin/env node
"use strict";

/**
 * Writes a consistent JSON snapshot (master + profiles + applications) to a file.
 *   DATABASE_URL=postgres://... npm run db:backup -- backups/resume.json
 */
const fs = require("fs");
const path = require("path");
const db = require("../lib/db");
const { defaultStore: store } = require("../lib/store");

(async () => {
  const out = process.argv[2] || `resume-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  try {
    const snapshot = await store.exportAll();
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
    console.log(`Backup written to ${out} (${snapshot.profiles.length} profiles, ${snapshot.applications.length} applications, master v${snapshot.master.version})`);
  } catch (err) {
    console.error("Backup failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.closePool();
  }
})();
