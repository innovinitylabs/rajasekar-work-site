"use strict";

/**
 * The single persistence layer. PostgreSQL is the only authoritative store.
 *
 * Concurrency model: optimistic locking. Every mutable row carries an integer
 * `version`. A write must state the version it was based on; if the row has
 * moved on, the write is rejected with VERSION_CONFLICT (HTTP 409) and the
 * current row is returned, so a stale browser tab can never silently overwrite
 * newer data.
 */

const db = require("./db");
const { StoreError, withTransaction, translateError } = db;
const { MIGRATIONS } = require("./migrations");
const { validateProfile, validateApplication, validateMaster } = require("./validate");
const { normalizeMaster } = require("../resume-resolve");
const seedMaster = require("../resume-data.json");
const seedProfiles = require("./seed-profiles");
const seedApplications = require("./seed-applications");

const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].id;

const PROFILE_COLS = `id, name, is_default, position, target_title, summary_override,
  selected_experience, selected_bullets, selected_skills, selected_projects,
  section_visibility, layout, accent_color, project_detail, options, version, created_at, updated_at`;

const APPLICATION_COLS = `id, company, job_title, job_description,
  to_char(application_date, 'YYYY-MM-DD') AS application_date, profile_id, status, notes,
  selected_skills, selected_experience, generated_resume_version, version, created_at, updated_at`;

const iso = (d) => (d instanceof Date ? d.toISOString() : d);

const profileFromRow = (r) => ({
  id: r.id,
  name: r.name,
  isDefault: r.is_default,
  position: r.position,
  targetTitle: r.target_title,
  summaryOverride: r.summary_override,
  selectedExperience: r.selected_experience,
  selectedBullets: r.selected_bullets,
  selectedSkills: r.selected_skills,
  selectedProjects: r.selected_projects,
  sectionVisibility: r.section_visibility,
  layout: r.layout,
  accentColor: r.accent_color,
  projectDetail: r.project_detail,
  options: r.options,
  version: r.version,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const applicationFromRow = (r) => ({
  id: r.id,
  company: r.company,
  jobTitle: r.job_title,
  jobDescription: r.job_description,
  applicationDate: r.application_date,
  profileId: r.profile_id,
  status: r.status,
  notes: r.notes,
  selectedSkills: r.selected_skills,
  selectedExperience: r.selected_experience,
  generatedResumeVersion: r.generated_resume_version,
  version: r.version,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

const validationError = (errors) =>
  new StoreError(
    "VALIDATION",
    400,
    `Invalid data: ${errors.map((e) => `${e.field} ${e.message}`).join("; ")}`,
    errors
  );

const requireVersion = (v) => {
  if (!Number.isInteger(v) || v < 1) {
    throw validationError([
      { field: "version", message: "is required and must be the integer version you last loaded" },
    ]);
  }
  return v;
};

const toJson = (v) => JSON.stringify(v);

const createStore = (getPool = db.getPool) => {
  let readyPromise = null;
  let readyPool = null;

  /* ----------------------------- initialisation ----------------------------- */

  const seedOnce = async (client, marker, fn) => {
    const { rowCount } = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [marker]);
    if (rowCount > 0) return false;
    await fn();
    await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [marker]);
    return true;
  };

  const insertProfileRow = async (client, p, position) => {
    await client.query(
      `INSERT INTO profiles (id, name, is_default, position, target_title, summary_override,
         selected_experience, selected_bullets, selected_skills, selected_projects,
         section_visibility, layout, accent_color, project_detail, options)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15::jsonb)`,
      [
        p.id, p.name, p.isDefault, position, p.targetTitle, p.summaryOverride,
        toJson(p.selectedExperience), toJson(p.selectedBullets), toJson(p.selectedSkills),
        toJson(p.selectedProjects), toJson(p.sectionVisibility), p.layout, p.accentColor, p.projectDetail, toJson(p.options || {}),
      ]
    );
  };

  const insertApplicationRow = async (client, a) => {
    await client.query(
      `INSERT INTO applications (id, company, job_title, job_description, application_date,
         profile_id, status, notes, selected_skills, selected_experience, generated_resume_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
      [
        a.id, a.company, a.jobTitle, a.jobDescription, a.applicationDate, a.profileId,
        a.status, a.notes, toJson(a.selectedSkills), toJson(a.selectedExperience),
        a.generatedResumeVersion,
      ]
    );
  };

  /** Migrates the schema and performs the one-time seed. Safe to call on every cold start. */
  const initialize = async (pool) => {
    await db.migrate(pool);
    await withTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [727002]);

      await seedOnce(client, "seed:master:v1", async () => {
        const { value, errors } = validateMaster(seedMaster);
        if (errors.length) throw validationError(errors);
        await client.query(
          "INSERT INTO master_resume (id, data, version, updated_by) VALUES (1, $1::jsonb, 1, 'seed')",
          [toJson(value)]
        );
        await client.query(
          "INSERT INTO master_resume_history (version, data, saved_by) VALUES (1, $1::jsonb, 'seed')",
          [toJson(value)]
        );
      });

      await seedOnce(client, "seed:profiles:v1", async () => {
        const { rows } = await client.query("SELECT data FROM master_resume WHERE id = 1");
        const master = normalizeMaster(rows[0].data);
        let position = 0;
        for (const raw of seedProfiles) {
          const { value, errors } = validateProfile(raw, master);
          if (errors.length) throw validationError(errors);
          await insertProfileRow(client, value, position++);
        }
      });

      await seedOnce(client, "seed:applications:v1", async () => {
        for (const raw of seedApplications) {
          const { value, errors } = validateApplication(raw);
          if (errors.length) throw validationError(errors);
          await insertApplicationRow(client, value);
        }
      });
    });
  };

  const ready = async () => {
    const pool = getPool();
    if (readyPool !== pool || !readyPromise) {
      readyPool = pool;
      readyPromise = initialize(pool).catch((err) => {
        readyPromise = null; // allow retry on next request
        throw err;
      });
    }
    await readyPromise;
    return pool;
  };

  /** Wraps an operation: ensures schema, runs it, translates driver errors. */
  const run = async (fn) => {
    try {
      const pool = await ready();
      return await fn(pool);
    } catch (err) {
      throw translateError(err);
    }
  };

  /* --------------------------------- master --------------------------------- */

  const readMaster = async (q) => {
    const { rows } = await q.query(
      "SELECT data, version, updated_at, updated_by FROM master_resume WHERE id = 1"
    );
    if (!rows.length) throw new StoreError("NOT_FOUND", 404, "Master resume has not been initialised.");
    const r = rows[0];
    return {
      version: r.version,
      updatedAt: iso(r.updated_at),
      updatedBy: r.updated_by,
      doc: r.data,
      master: normalizeMaster(r.data),
    };
  };

  const getMaster = () => run((pool) => readMaster(pool));

  const updateMaster = (expectedVersion, input, actor) =>
    run((pool) =>
      withTransaction(pool, async (client) => {
        requireVersion(expectedVersion);
        const { value, errors } = validateMaster(input);
        if (errors.length) throw validationError(errors);

        const { rows } = await client.query(
          "SELECT version FROM master_resume WHERE id = 1 FOR UPDATE"
        );
        if (!rows.length) throw new StoreError("NOT_FOUND", 404, "Master resume has not been initialised.");
        if (rows[0].version !== expectedVersion) {
          const current = await readMaster(client);
          throw new StoreError(
            "VERSION_CONFLICT",
            409,
            "The master resume was changed elsewhere. Reload to see the latest version.",
            { current }
          );
        }

        // Existing profiles must still resolve against the edited master.
        const newMaster = normalizeMaster(value);
        const { rows: profileRows } = await client.query(`SELECT ${PROFILE_COLS} FROM profiles`);
        const broken = [];
        for (const row of profileRows) {
          const p = profileFromRow(row);
          const check = validateProfile(p, newMaster);
          if (check.errors.length) {
            broken.push({ profileId: p.id, problems: check.errors.map((e) => `${e.field} ${e.message}`) });
          }
        }
        if (broken.length) {
          throw new StoreError(
            "REFERENCES_BROKEN",
            409,
            "This change would remove experience, bullets, skills or projects that profiles still use. Update those profiles first.",
            { broken }
          );
        }

        const nextVersion = expectedVersion + 1;
        await client.query(
          "UPDATE master_resume SET data = $1::jsonb, version = $2, updated_at = now(), updated_by = $3 WHERE id = 1",
          [toJson(value), nextVersion, actor || null]
        );
        await client.query(
          "INSERT INTO master_resume_history (version, data, saved_by) VALUES ($1, $2::jsonb, $3)",
          [nextVersion, toJson(value), actor || null]
        );
        return readMaster(client);
      })
    );

  /* -------------------------------- profiles -------------------------------- */

  const listProfiles = () =>
    run(async (pool) => {
      const { rows } = await pool.query(`SELECT ${PROFILE_COLS} FROM profiles ORDER BY position, created_at, id`);
      return rows.map(profileFromRow);
    });

  const getProfile = (id) =>
    run(async (pool) => {
      const { rows } = await pool.query(`SELECT ${PROFILE_COLS} FROM profiles WHERE id = $1`, [id]);
      if (!rows.length) throw new StoreError("NOT_FOUND", 404, `Profile "${id}" was not found.`);
      return profileFromRow(rows[0]);
    });

  const createProfile = (input) =>
    run((pool) =>
      withTransaction(pool, async (client) => {
        const { master } = await readMaster(client);
        const { value, errors } = validateProfile(input, master);
        if (errors.length) throw validationError(errors);

        if (value.isDefault) await client.query("UPDATE profiles SET is_default = false WHERE is_default");
        const { rows: pos } = await client.query("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM profiles");
        // A fresh database must always end up with exactly one default.
        const { rows: cnt } = await client.query("SELECT count(*)::int AS n FROM profiles");
        if (cnt[0].n === 0) value.isDefault = true;
        await insertProfileRow(client, value, pos[0].next);
        const { rows } = await client.query(`SELECT ${PROFILE_COLS} FROM profiles WHERE id = $1`, [value.id]);
        return profileFromRow(rows[0]);
      })
    );

  const updateProfile = (id, expectedVersion, input) =>
    run((pool) =>
      withTransaction(pool, async (client) => {
        requireVersion(expectedVersion);
        const { master } = await readMaster(client);
        const { value, errors } = validateProfile({ ...input, id }, master);
        if (errors.length) throw validationError(errors);

        const { rows: cur } = await client.query(
          `SELECT ${PROFILE_COLS} FROM profiles WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!cur.length) throw new StoreError("NOT_FOUND", 404, `Profile "${id}" was not found.`);
        if (cur[0].version !== expectedVersion) {
          throw new StoreError(
            "VERSION_CONFLICT",
            409,
            "This profile was changed elsewhere. Reload to see the latest version.",
            { current: profileFromRow(cur[0]) }
          );
        }
        if (cur[0].is_default && !value.isDefault) {
          throw validationError([
            { field: "isDefault", message: "there must always be a default profile; make another profile the default instead" },
          ]);
        }
        if (value.isDefault && !cur[0].is_default) {
          await client.query("UPDATE profiles SET is_default = false WHERE is_default");
        }

        await client.query(
          `UPDATE profiles SET name=$2, is_default=$3, target_title=$4, summary_override=$5,
             selected_experience=$6::jsonb, selected_bullets=$7::jsonb, selected_skills=$8::jsonb,
             selected_projects=$9::jsonb, section_visibility=$10::jsonb, layout=$11, accent_color=$12,
             project_detail=$13, options=$14::jsonb, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [
            id, value.name, value.isDefault, value.targetTitle, value.summaryOverride,
            toJson(value.selectedExperience), toJson(value.selectedBullets), toJson(value.selectedSkills),
            toJson(value.selectedProjects), toJson(value.sectionVisibility), value.layout, value.accentColor,
            value.projectDetail, toJson(value.options || {}),
          ]
        );
        const { rows } = await client.query(`SELECT ${PROFILE_COLS} FROM profiles WHERE id = $1`, [id]);
        return profileFromRow(rows[0]);
      })
    );

  const deleteProfile = (id, expectedVersion) =>
    run((pool) =>
      withTransaction(pool, async (client) => {
        requireVersion(expectedVersion);
        const { rows } = await client.query(
          `SELECT ${PROFILE_COLS} FROM profiles WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!rows.length) throw new StoreError("NOT_FOUND", 404, `Profile "${id}" was not found.`);
        if (rows[0].version !== expectedVersion) {
          throw new StoreError("VERSION_CONFLICT", 409, "This profile was changed elsewhere. Reload and try again.", {
            current: profileFromRow(rows[0]),
          });
        }
        if (rows[0].is_default) {
          throw validationError([{ field: "id", message: "the default profile cannot be deleted; make another profile the default first" }]);
        }
        await client.query("DELETE FROM profiles WHERE id = $1", [id]);
        return { id, deleted: true };
      })
    );

  /* ------------------------------ applications ------------------------------ */

  const listApplications = () =>
    run(async (pool) => {
      const { rows } = await pool.query(
        `SELECT ${APPLICATION_COLS} FROM applications ORDER BY application_date DESC, created_at DESC, id`
      );
      return rows.map(applicationFromRow);
    });

  const createApplication = (input) =>
    run((pool) =>
      withTransaction(pool, async (client) => {
        const { value, errors } = validateApplication(input);
        if (errors.length) throw validationError(errors);
        await insertApplicationRow(client, value);
        const { rows } = await client.query(`SELECT ${APPLICATION_COLS} FROM applications WHERE id = $1`, [value.id]);
        return applicationFromRow(rows[0]);
      })
    );

  const updateApplication = (id, expectedVersion, input) =>
    run((pool) =>
      withTransaction(pool, async (client) => {
        requireVersion(expectedVersion);
        const { value, errors } = validateApplication({ ...input, id });
        if (errors.length) throw validationError(errors);

        const { rows: cur } = await client.query(
          `SELECT ${APPLICATION_COLS} FROM applications WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!cur.length) throw new StoreError("NOT_FOUND", 404, `Application "${id}" was not found.`);
        if (cur[0].version !== expectedVersion) {
          throw new StoreError("VERSION_CONFLICT", 409, "This application was changed elsewhere. Reload to see the latest version.", {
            current: applicationFromRow(cur[0]),
          });
        }
        await client.query(
          `UPDATE applications SET company=$2, job_title=$3, job_description=$4, application_date=$5,
             profile_id=$6, status=$7, notes=$8, selected_skills=$9::jsonb, selected_experience=$10::jsonb,
             generated_resume_version=$11, version = version + 1, updated_at = now()
           WHERE id = $1`,
          [
            id, value.company, value.jobTitle, value.jobDescription, value.applicationDate,
            value.profileId, value.status, value.notes, toJson(value.selectedSkills),
            toJson(value.selectedExperience), value.generatedResumeVersion,
          ]
        );
        const { rows } = await client.query(`SELECT ${APPLICATION_COLS} FROM applications WHERE id = $1`, [id]);
        return applicationFromRow(rows[0]);
      })
    );

  const deleteApplication = (id, expectedVersion) =>
    run((pool) =>
      withTransaction(pool, async (client) => {
        requireVersion(expectedVersion);
        const { rows } = await client.query(
          `SELECT ${APPLICATION_COLS} FROM applications WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!rows.length) throw new StoreError("NOT_FOUND", 404, `Application "${id}" was not found.`);
        if (rows[0].version !== expectedVersion) {
          throw new StoreError("VERSION_CONFLICT", 409, "This application was changed elsewhere. Reload and try again.", {
            current: applicationFromRow(rows[0]),
          });
        }
        await client.query("DELETE FROM applications WHERE id = $1", [id]);
        return { id, deleted: true };
      })
    );

  /* ------------------------------ export / admin ----------------------------- */

  /** Consistent snapshot of everything, for backups. */
  const exportAll = () =>
    run((pool) =>
      withTransaction(
        pool,
        async (client) => {
          const m = await readMaster(client);
          const { rows: p } = await client.query(`SELECT ${PROFILE_COLS} FROM profiles ORDER BY position, created_at, id`);
          const { rows: a } = await client.query(
            `SELECT ${APPLICATION_COLS} FROM applications ORDER BY application_date DESC, created_at DESC, id`
          );
          return {
            format: "rajasekar-resume-backup",
            schemaVersion: SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            master: { version: m.version, updatedAt: m.updatedAt, data: m.doc },
            profiles: p.map(profileFromRow),
            applications: a.map(applicationFromRow),
          };
        },
        { isolation: "REPEATABLE READ", readOnly: true }
      )
    );

  /**
   * Replaces ALL data with a snapshot produced by exportAll(). Everything is
   * validated first and applied in one transaction: either the whole snapshot
   * is restored or nothing changes. The master gets a new version (and a
   * history row) so older browser tabs hit a conflict instead of overwriting.
   */
  const restoreAll = (snapshot, actor = "restore") =>
    run((pool) =>
      withTransaction(pool, async (client) => {
        if (!snapshot || snapshot.format !== "rajasekar-resume-backup" || !snapshot.master || !Array.isArray(snapshot.profiles) || !Array.isArray(snapshot.applications)) {
          throw validationError([{ field: "snapshot", message: "is not a rajasekar-resume-backup export" }]);
        }
        const { rows: cur } = await client.query("SELECT version FROM master_resume WHERE id = 1 FOR UPDATE");
        const master = validateMaster(snapshot.master.data);
        if (master.errors.length) throw validationError(master.errors);
        const normalized = normalizeMaster(master.value);

        const profiles = snapshot.profiles.map((p) => {
          const r = validateProfile(p, normalized);
          if (r.errors.length) throw validationError(r.errors.map((e) => ({ ...e, field: `profiles.${p && p.id}.${e.field}` })));
          return { ...r.value, version: Number.isInteger(p.version) && p.version > 0 ? p.version : 1, createdAt: p.createdAt };
        });
        if (profiles.filter((p) => p.isDefault).length !== 1) {
          throw validationError([{ field: "profiles", message: "must contain exactly one default profile" }]);
        }
        const profileIds = new Set(profiles.map((p) => p.id));
        const applications = snapshot.applications.map((a) => {
          const r = validateApplication(a);
          if (r.errors.length) throw validationError(r.errors.map((e) => ({ ...e, field: `applications.${a && a.id}.${e.field}` })));
          if (r.value.profileId && !profileIds.has(r.value.profileId)) r.value.profileId = null;
          return { ...r.value, version: Number.isInteger(a.version) && a.version > 0 ? a.version : 1, createdAt: a.createdAt };
        });

        const next = (cur.length ? cur[0].version : 0) + 1;
        if (cur.length) {
          await client.query(
            "UPDATE master_resume SET data=$1::jsonb, version=$2, updated_at=now(), updated_by=$3 WHERE id=1",
            [toJson(master.value), next, actor]
          );
        } else {
          await client.query("INSERT INTO master_resume (id, data, version, updated_by) VALUES (1, $1::jsonb, $2, $3)", [toJson(master.value), next, actor]);
        }
        await client.query("INSERT INTO master_resume_history (version, data, saved_by) VALUES ($1, $2::jsonb, $3)", [next, toJson(master.value), actor]);

        await client.query("DELETE FROM applications");
        await client.query("DELETE FROM profiles");
        let position = 0;
        for (const p of profiles) {
          await insertProfileRow(client, p, position++);
          await client.query("UPDATE profiles SET version=$2, created_at=COALESCE($3::timestamptz, created_at) WHERE id=$1", [p.id, p.version, p.createdAt || null]);
        }
        for (const a of applications) {
          await insertApplicationRow(client, a);
          await client.query("UPDATE applications SET version=$2, created_at=COALESCE($3::timestamptz, created_at) WHERE id=$1", [a.id, a.version, a.createdAt || null]);
        }
        return { masterVersion: next, profiles: profiles.length, applications: applications.length };
      })
    );

  const status = () =>
    run(async (pool) => {
      const { rows } = await pool.query(
        `SELECT (SELECT count(*)::int FROM profiles) AS profiles,
                (SELECT count(*)::int FROM applications) AS applications,
                (SELECT version FROM master_resume WHERE id = 1) AS master_version`
      );
      return {
        backend: "postgres",
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        profiles: rows[0].profiles,
        applications: rows[0].applications,
        masterVersion: rows[0].master_version,
      };
    });

  /* ------------------------------ session revocation ------------------------- */

  const revokeSession = (jti, expiresAtMs) =>
    run(async (pool) => {
      await pool.query("DELETE FROM revoked_sessions WHERE expires_at < now()");
      await pool.query(
        "INSERT INTO revoked_sessions (jti, expires_at) VALUES ($1, to_timestamp($2 / 1000.0)) ON CONFLICT (jti) DO NOTHING",
        [jti, expiresAtMs]
      );
    });

  const isSessionRevoked = (jti) =>
    run(async (pool) => {
      const { rowCount } = await pool.query("SELECT 1 FROM revoked_sessions WHERE jti = $1", [jti]);
      return rowCount > 0;
    });

  return {
    ready,
    getMaster,
    updateMaster,
    listProfiles,
    getProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    listApplications,
    createApplication,
    updateApplication,
    deleteApplication,
    exportAll,
    restoreAll,
    status,
    revokeSession,
    isSessionRevoked,
  };
};

module.exports = { createStore, defaultStore: createStore(), SCHEMA_VERSION };
