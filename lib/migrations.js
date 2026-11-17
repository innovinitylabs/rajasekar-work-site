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

/* 004: two-page resume content. Conservative: only untouched seed values are replaced. */
const PROJECT_ORDER = [
  "project-madras-checks", "project-onchainrugs", "project-anekaroopam", "project-uravu",
  "project-hard-copy", "project-rotate-the-cow", "project-pocket-astro", "project-valipokkann",
];
const NEW_INDEPENDENT = [
  "Design and build complete software products independently, from architecture to deployment, across web (Next.js, React, TypeScript), native iOS and macOS (Swift, SwiftUI) and generative-art applications; the web products run on Vercel under their own domains",
  "Built OnchainRugs end to end: Solidity ERC721A contracts (Foundry), multi-chain wallet integration (wagmi, viem, RainbowKit), a deterministic p5-compatible renderer shared by browser, server and Puppeteer-generated previews, and a webhook that keeps an Upstash Redis cache in sync with chain events",
  "Implemented backend and data workflows: Next.js server actions with Zod validation, Neon PostgreSQL persistence with SQL migrations and transactional email via Resend (Uravu), and GitHub OAuth on Vercel serverless functions for a Decap CMS content workflow (Valipokkann)",
  "Developing Pocket Astro, an offline-first SwiftUI app for iOS and macOS on a native C and Swift calculation layer, checked against a Python oracle with golden fixtures and numerical parity tests; use Cursor, Claude, ChatGPT and GitHub Copilot across design, implementation and testing",
];
const APPZWORK_CONTEXT = [
  "BMO Capital Accounts: banking and capital accounts project",
  "EvoBrix-X: insurance-sector project by CNSI",
];

const upgradeTwoPageMaster = (doc) => {
  const before = JSON.stringify(doc);
  const ind = (doc.experience || []).find((e) => e.id === "exp-independent");
  if (ind && /^Independently build software products/.test(ind.bullets[0] || "")) ind.bullets = [...NEW_INDEPENDENT];
  const app = (doc.experience || []).find((e) => e.id === "exp-appzwork");
  if (app && !(app.context && app.context.length)) app.context = [...APPZWORK_CONTEXT];
  const madras = (doc.projects || []).find((p) => p.id === "project-madras-checks");
  if (madras) {
    madras.links = (madras.links || []).filter((l) => l.url.replace(/\/$/, "") !== "https://madraschecks.com/art");
    for (const l of madras.links) if (l.url === "https://art.madraschecks.com" && l.label === "Art Platform & Generator") l.label = "Art Platform";
  }
  const skills = doc.skills || [];
  const at = skills.findIndex((s) => s.id === "skill-devops-developer-tools");
  if (at >= 0) {
    skills.splice(
      at, 1,
      { id: "skill-devops", group: "DevOps", items: ["Docker", "Git", "Linux", "GitHub Workflows"] },
      { id: "skill-developer-tools", group: "Developer Tools", items: ["Cursor", "Claude", "ChatGPT", "GPT Codex", "GitHub Copilot"] }
    );
  }
  const ids = (doc.projects || []).map((p) => p.id);
  if (ids.length === PROJECT_ORDER.length && PROJECT_ORDER.every((i) => ids.includes(i))) {
    doc.projects = PROJECT_ORDER.map((i) => doc.projects.find((p) => p.id === i));
  }
  return JSON.stringify(doc) !== before;
};

const DE_SKILLS = [
  "skill-programming-languages", "skill-data-engineering", "skill-databases",
  "skill-backend-development", "skill-cloud-data-platforms", "skill-devops",
];

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

MIGRATIONS.push({
  id: "004_two_page_resume",
  run: async (client) => {
    await client.query("ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_project_detail_check");
    await client.query(
      "ALTER TABLE profiles ADD CONSTRAINT profiles_project_detail_check CHECK (project_detail IN ('detailed', 'compact', 'showcase'))"
    );

    const { rows } = await client.query("SELECT data, version FROM master_resume WHERE id = 1 FOR UPDATE");
    if (rows.length) {
      const doc = rows[0].data;
      if (upgradeTwoPageMaster(doc)) {
        const next = rows[0].version + 1;
        await client.query(
          "UPDATE master_resume SET data=$1::jsonb, version=$2, updated_at=now(), updated_by='migration-004' WHERE id=1",
          [JSON.stringify(doc), next]
        );
        await client.query(
          "INSERT INTO master_resume_history (version, data, saved_by) VALUES ($1, $2::jsonb, 'migration-004')",
          [next, JSON.stringify(doc)]
        );
      }
    }

    const { rows: profiles } = await client.query("SELECT id, selected_skills, selected_projects FROM profiles");
    for (const p of profiles) {
      let skills = p.selected_skills.flatMap((id) =>
        id === "skill-devops-developer-tools" ? ["skill-devops", "skill-developer-tools"] : [id]
      );
      let extra = "";
      const params = [p.id];
      if (p.id === "data-engineer" && JSON.stringify(p.selected_projects) === JSON.stringify(["project-onchainrugs", "project-uravu"])) {
        // untouched seed Data Engineer profile -> the deliberate two-page layout
        skills = [...DE_SKILLS];
        params.push(JSON.stringify(PROJECT_ORDER));
        extra = ", selected_projects = $3::jsonb, selected_bullets = '{}'::jsonb, project_detail = 'showcase'";
      } else if (p.id === "ai-product-engineer" || p.id === "database-developer") {
        skills = skills.filter((id) => id !== "skill-currently-learning");
      }
      if (JSON.stringify(skills) === JSON.stringify(p.selected_skills) && !extra) continue;
      params.splice(1, 0, JSON.stringify(skills));
      await client.query(
        `UPDATE profiles SET selected_skills = $2::jsonb${extra}, version = version + 1, updated_at = now() WHERE id = $1`,
        params
      );
    }
  },
});

module.exports = { MIGRATIONS, upgradeProjectLinks, upgradeTwoPageMaster };
