"use strict";

/**
 * Ordered, append-only list of schema migrations.
 * Never edit an applied migration; add a new one instead.
 * Kept as JS (not .sql files) so serverless bundles always contain them.
 */
const { normalizeLinks } = require("../resume-resolve");

/**
 * 003: project links gain type/primary/visible, and the verified custom
 * domains replace bare Vercel deployment URLs. Data-only (projects live inside
 * the master JSONB document), so no table is altered or dropped.
 *
 * A Vercel URL is only replaced when it is still exactly the old value, so any
 * link you have edited yourself is left alone. The replaced deployment URL is
 * kept as a hidden link, never deleted.
 */
const VERIFIED_PRIMARY = {
  "project-onchainrugs": { from: "https://onchain-rugs.vercel.app", to: "https://onchainrugs.art" },
  "project-uravu": { from: "https://uravu-site.vercel.app", to: "https://www.uravu.social" },
  "project-madras-checks": { from: "https://madraschecks-site.vercel.app", to: "https://madraschecks.com" },
};
const VERIFIED_EXTRA = {
  "project-madras-checks": [
    { label: "Art Page", url: "https://madraschecks.com/art/", type: "website" },
    { label: "Art Platform & Generator", url: "https://art.madraschecks.com", type: "generator" },
  ],
};

const upgradeProjectLinks = (doc) => {
  let changed = false;
  for (const project of doc.projects || []) {
    const before = JSON.stringify(project.links || []);
    let links = normalizeLinks(project.links);
    const fix = VERIFIED_PRIMARY[project.id];
    if (fix) {
      const hit = links.find((l) => l.visible && l.url.replace(/\/$/, "") === fix.from);
      if (hit) {
        links = links.filter((l) => l !== hit);
        links.unshift({ label: "Official Website", url: fix.to, type: "website", primary: true, visible: true });
        links.push({ label: "Vercel deployment", url: fix.from, type: "demo", primary: false, visible: false });
        let at = 1;
        for (const extra of VERIFIED_EXTRA[project.id] || []) {
          if (!links.some((l) => l.url.replace(/\/$/, "") === extra.url.replace(/\/$/, ""))) {
            links.splice(at++, 0, { ...extra, primary: false, visible: true });
          }
        }
      }
    }
    // normalizeLinks marks the first link primary; with a primary placed first that stays unique
    const seen = links.filter((l) => l.primary);
    if (seen.length > 1) links.forEach((l, i) => (l.primary = i === links.findIndex((x) => x.primary)));
    project.links = links;
    if (JSON.stringify(links) !== before) changed = true;
  }
  return changed;
};

const MIGRATIONS = [
  {
    id: "001_init",
    sql: `
      CREATE TABLE master_resume (
        id          smallint    PRIMARY KEY CHECK (id = 1),
        data        jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
        version     integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        updated_by  text
      );

      CREATE TABLE master_resume_history (
        version   integer     PRIMARY KEY,
        data      jsonb       NOT NULL,
        saved_at  timestamptz NOT NULL DEFAULT now(),
        saved_by  text
      );

      CREATE TABLE profiles (
        id                   text        PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
        name                 text        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
        is_default           boolean     NOT NULL DEFAULT false,
        position             integer     NOT NULL DEFAULT 0,
        target_title         text        NOT NULL DEFAULT '' CHECK (char_length(target_title) <= 200),
        summary_override     text        CHECK (summary_override IS NULL OR char_length(summary_override) <= 2000),
        selected_experience  jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_experience) = 'array'),
        selected_bullets     jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(selected_bullets) = 'object'),
        selected_skills      jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_skills) = 'array'),
        selected_projects    jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_projects) = 'array'),
        section_visibility   jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(section_visibility) = 'object'),
        layout               text        NOT NULL DEFAULT 'ats-classic' CHECK (layout IN ('ats-classic', 'modern-visual', 'executive')),
        accent_color         text        NOT NULL DEFAULT '#2457c5' CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
        project_detail       text        NOT NULL DEFAULT 'detailed' CHECK (project_detail IN ('detailed', 'compact')),
        version              integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now()
      );
      -- At most one default profile, enforced by the database itself.
      CREATE UNIQUE INDEX profiles_single_default ON profiles ((true)) WHERE is_default;

      CREATE TABLE applications (
        id                        text        PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
        company                   text        NOT NULL CHECK (char_length(btrim(company)) BETWEEN 1 AND 200),
        job_title                 text        NOT NULL CHECK (char_length(btrim(job_title)) BETWEEN 1 AND 200),
        job_description           text        NOT NULL DEFAULT '' CHECK (char_length(job_description) <= 20000),
        application_date          date        NOT NULL,
        profile_id                text        REFERENCES profiles(id) ON DELETE SET NULL,
        status                    text        NOT NULL CHECK (status IN ('Draft','Applied','Screening','Interviewing','Offered','Rejected','Archived')),
        notes                     text        NOT NULL DEFAULT '' CHECK (char_length(notes) <= 5000),
        selected_skills           jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_skills) = 'array'),
        selected_experience       jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_experience) = 'array'),
        generated_resume_version  text        NOT NULL DEFAULT '',
        version                   integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
        created_at                timestamptz NOT NULL DEFAULT now(),
        updated_at                timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX applications_status_idx ON applications (status);
      CREATE INDEX applications_date_idx ON applications (application_date DESC);
    `,
  },
  {
    id: "002_revoked_sessions",
    sql: `
      -- Server-side logout: a signed session cookie is rejected once its id is listed here.
      CREATE TABLE revoked_sessions (
        jti         text        PRIMARY KEY,
        expires_at  timestamptz NOT NULL,
        revoked_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX revoked_sessions_expiry_idx ON revoked_sessions (expires_at);
    `,
  },
  {
    id: "003_project_links_v2",
    run: async (client) => {
      const { rows } = await client.query("SELECT data, version FROM master_resume WHERE id = 1 FOR UPDATE");
      if (!rows.length) return; // fresh database: the seed already uses the new shape
      const doc = rows[0].data;
      if (!upgradeProjectLinks(doc)) return;
      const next = rows[0].version + 1;
      await client.query(
        "UPDATE master_resume SET data = $1::jsonb, version = $2, updated_at = now(), updated_by = 'migration-003' WHERE id = 1",
        [JSON.stringify(doc), next]
      );
      await client.query(
        "INSERT INTO master_resume_history (version, data, saved_by) VALUES ($1, $2::jsonb, 'migration-003')",
        [next, JSON.stringify(doc)]
      );
    },
  },
];

module.exports = { MIGRATIONS, upgradeProjectLinks };
