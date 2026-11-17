"use strict";

/**
 * Ordered, append-only list of schema migrations.
 * Never edit an applied migration; add a new one instead.
 * Kept as JS (not .sql files) so serverless bundles always contain them.
 */
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
];

module.exports = { MIGRATIONS };
