"use strict";

/**
 * Pure resume-system helpers (no storage, no file writes).
 *
 * Persistence lives in lib/store.js (PostgreSQL). resume-data.json and
 * lib/seed-*.js are only the one-time seed for a brand-new database.
 */

const { slugify, normalizeMaster, resolveProfile } = require("../resume-resolve");
const SEED_PROFILES = require("./seed-profiles");

/** Reads the seed master document (resume-data.json) without modifying it. */
const loadRawResumeData = () => JSON.parse(JSON.stringify(require("../resume-data.json")));

/** Normalised master built from the given raw document, or from the seed file. */
const getMasterResume = (raw = null) => normalizeMaster(raw || loadRawResumeData());

module.exports = {
  slugify,
  loadRawResumeData,
  getMasterResume,
  normalizeMaster,
  resolveProfile,
  SEED_PROFILES,
};
