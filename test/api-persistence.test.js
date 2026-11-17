"use strict";

/**
 * End-to-end persistence tests against a REAL PostgreSQL database.
 *
 *   TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/resume_test npm test
 *
 * The database name must contain "test": the schema is wiped before the run.
 * Without TEST_DATABASE_URL these tests are skipped (and reported as skipped,
 * never as passed).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const TEST_URL = process.env.TEST_DATABASE_URL || "";
const skip = !TEST_URL
  ? "TEST_DATABASE_URL not set: persistence tests need a real PostgreSQL database"
  : !/test/i.test(new URL(TEST_URL).pathname)
    ? "TEST_DATABASE_URL database name must contain 'test' (the schema is wiped)"
    : false;

const { SECRET, adminRequest, createMockReqRes, cookieFor, call } = require("./helpers");

if (!skip) {
  process.env.DATABASE_URL = TEST_URL;
  process.env.SESSION_SECRET = SECRET;
  process.env.ADMIN_GITHUB_USERNAME = "innovinitylabs";
}

const loadModules = () => ({
  db: require("../lib/db"),
  store: require("../lib/store"),
  profiles: require("../api/profiles"),
  applications: require("../api/applications"),
  master: require("../api/master"),
  exporter: require("../api/export"),
  logout: require("../api/auth/logout"),
  session: require("../api/auth/session"),
});

let m;
const wipe = async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_URL });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.end();
};

test("setup: wipe schema", { skip }, async () => {
  await wipe();
  m = loadModules();
});

const getBootstrap = async () => {
  const { req, res } = adminRequest("GET");
  return call(m.profiles, req, res);
};

test("first request migrates the schema and seeds master, 4 profiles and the legacy application exactly once", { skip }, async () => {
  const out = await getBootstrap();
  assert.equal(out.status, 200);
  assert.equal(out.body.storage.backend, "postgres");
  assert.deepEqual(out.body.profiles.map((p) => p.id), ["data-engineer", "ai-product-engineer", "database-developer", "anthropic-research-residency"]);
  assert.equal(out.body.profiles.filter((p) => p.isDefault).length, 1);
  assert.equal(out.body.applications.length, 1);
  assert.equal(out.body.master.projects.length, 8);
  assert.equal(out.body.masterVersion, 1);

  // Seeding is recorded, so it never repeats.
  const again = await getBootstrap();
  assert.equal(again.body.profiles.length, 4);
});

test("PERSISTENCE: created profile survives a closed pool + brand-new store (simulated cold start)", { skip }, async () => {
  const body = {
    id: "persist-check",
    name: "Persist Check",
    targetTitle: "Backend Engineer",
    selectedExperience: ["exp-digit-insurance"],
    selectedSkills: ["skill-databases"],
    selectedProjects: ["project-uravu", "project-pocket-astro"],
    sectionVisibility: { projects: true },
    layout: "ats-classic",
    accentColor: "#112233",
    projectDetail: "compact",
  };
  const { req, res } = adminRequest("POST", { body });
  const created = await call(m.profiles, req, res);
  assert.equal(created.status, 201);
  assert.equal(created.body.profile.version, 1);

  await m.db.closePool(); // drop every connection, as a cold serverless instance would
  const freshStore = m.store.createStore(); // new instance, no in-process memory of the write
  const found = (await freshStore.listProfiles()).find((p) => p.id === "persist-check");
  assert.ok(found, "profile must still exist");
  assert.deepEqual(found.selectedProjects, ["project-uravu", "project-pocket-astro"]);
  assert.equal(found.projectDetail, "compact");
  assert.equal(found.accentColor, "#112233");
});

test("PERSISTENCE: data is visible from a separate OS process (another instance/device)", { skip }, async () => {
  const script = `
    process.env.DATABASE_URL = ${JSON.stringify(TEST_URL)};
    const { defaultStore } = require(${JSON.stringify(path.join(__dirname, "..", "lib", "store"))});
    const db = require(${JSON.stringify(path.join(__dirname, "..", "lib", "db"))});
    defaultStore.listProfiles().then(async (p) => { console.log(JSON.stringify(p.map(x => x.id))); await db.closePool(); });
  `;
  const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8" });
  assert.ok(JSON.parse(out.trim()).includes("persist-check"));
});

test("profile update bumps the version; stale version -> 409 VERSION_CONFLICT with the current row", { skip }, async () => {
  let r = adminRequest("PUT", { body: { id: "persist-check", version: 1, name: "Persist Check", targetTitle: "Renamed", layout: "ats-classic" } });
  const ok = await call(m.profiles, r.req, r.res);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.profile.version, 2);
  assert.equal(ok.body.profile.targetTitle, "Renamed");

  r = adminRequest("PUT", { body: { id: "persist-check", version: 1, name: "Stale tab", layout: "ats-classic" } });
  const stale = await call(m.profiles, r.req, r.res);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "VERSION_CONFLICT");
  assert.equal(stale.body.details.current.targetTitle, "Renamed", "stale writer must not have overwritten the newer data");
});

test("CONCURRENCY: two simultaneous updates from the same base version -> exactly one wins", { skip }, async () => {
  const mk = (title) => adminRequest("PUT", { body: { id: "persist-check", version: 2, name: "Persist Check", targetTitle: title, layout: "ats-classic" } });
  const a = mk("From session A");
  const b = mk("From session B");
  const [ra, rb] = await Promise.all([call(m.profiles, a.req, a.res), call(m.profiles, b.req, b.res)]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
  const stored = (await m.store.defaultStore.listProfiles()).find((p) => p.id === "persist-check");
  assert.equal(stored.version, 3);
  assert.ok(["From session A", "From session B"].includes(stored.targetTitle));
});

test("CONCURRENCY: 25 parallel application inserts are all stored; duplicate id inserts yield one 201 and rest 409", { skip }, async () => {
  const mkApp = (id) =>
    adminRequest("POST", { body: { id, company: `Co ${id}`, jobTitle: "Data Engineer", applicationDate: "2026-11-12", status: "Applied", profileId: "data-engineer" } });
  const inserts = Array.from({ length: 25 }, (_, i) => {
    const { req, res } = mkApp(`par-${i}`);
    return call(m.applications, req, res);
  });
  assert.ok((await Promise.all(inserts)).every((o) => o.status === 201));

  const dupes = await Promise.all(
    Array.from({ length: 5 }, () => {
      const { req, res } = mkApp("dup-1");
      return call(m.applications, req, res);
    })
  );
  assert.equal(dupes.filter((o) => o.status === 201).length, 1);
  assert.equal(dupes.filter((o) => o.status === 409).length, 4);

  const list = adminRequest("GET");
  const all = await call(m.applications, list.req, list.res);
  assert.equal(all.body.applications.filter((a) => a.id.startsWith("par-")).length, 25);
});

test("application status update persists with version check and survives a cold start", { skip }, async () => {
  let r = adminRequest("PUT", { body: { id: "par-0", version: 1, company: "Co par-0", jobTitle: "Data Engineer", applicationDate: "2026-11-12", status: "Interviewing", profileId: "data-engineer" } });
  const out = await call(m.applications, r.req, r.res);
  assert.equal(out.status, 200);
  assert.equal(out.body.application.status, "Interviewing");
  assert.equal(out.body.application.version, 2);

  await m.db.closePool();
  const fresh = m.store.createStore();
  const stored = (await fresh.listApplications()).find((a) => a.id === "par-0");
  assert.equal(stored.status, "Interviewing");
  assert.equal(stored.applicationDate, "2026-11-12");

  r = adminRequest("PUT", { body: { id: "par-0", version: 1, company: "x", jobTitle: "y", applicationDate: "2026-11-12", status: "Rejected" } });
  assert.equal((await call(m.applications, r.req, r.res)).status, 409);
});

test("INVALID PAYLOADS are rejected with 400 and nothing is written", { skip }, async () => {
  const bad = [
    ["profiles", "POST", { id: "Bad ID!", name: "x" }],
    ["profiles", "POST", { id: "ok-id", name: "" }],
    ["profiles", "POST", { id: "ok-id2", name: "x", layout: "neon" }],
    ["profiles", "POST", { id: "ok-id3", name: "x", accentColor: "red" }],
    ["profiles", "POST", { id: "ok-id4", name: "x", selectedProjects: ["project-does-not-exist"] }],
    ["profiles", "POST", { id: "ok-id5", name: "x", selectedExperience: ["exp-nope"] }],
    ["profiles", "POST", { id: "ok-id6", name: "x", selectedBullets: { "exp-appzwork": ["exp-appzwork-b99"] } }],
    ["profiles", "POST", { id: "ok-id7", name: "x", sectionVisibility: { hackme: true } }],
    ["profiles", "POST", { id: "ok-id8", name: "x".repeat(121) }],
    ["applications", "POST", { id: "a1", company: "", jobTitle: "x", applicationDate: "2026-11-12", status: "Applied" }],
    ["applications", "POST", { id: "a2", company: "x", jobTitle: "x", applicationDate: "2026-02-30", status: "Applied" }],
    ["applications", "POST", { id: "a3", company: "x", jobTitle: "x", applicationDate: "2026-11-12", status: "Hired!!" }],
    ["applications", "POST", { id: "a4", company: "x", jobTitle: "x", applicationDate: "2026-11-12", status: "Applied", profileId: "no-such-profile" }],
  ];
  for (const [which, method, body] of bad) {
    const { req, res } = adminRequest(method, { body });
    const out = await call(m[which], req, res);
    assert.equal(out.status, 400, `${which} ${JSON.stringify(body)} -> ${out.status} ${JSON.stringify(out.body)}`);
  }
  const boot = await getBootstrap();
  assert.ok(!boot.body.profiles.some((p) => p.id.startsWith("ok-id")));
  assert.ok(!boot.body.applications.some((a) => ["a1", "a2", "a3", "a4"].includes(a.id)));

  // malformed JSON and non-object bodies
  let r = createMockReqRes({ method: "POST", headers: { cookie: cookieFor("innovinitylabs"), "content-type": "application/json" }, body: "{not json" });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 400);
  r = createMockReqRes({ method: "POST", headers: { cookie: cookieFor("innovinitylabs"), "content-type": "application/json" }, body: "[1,2]" });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 400);
});

test("CSRF: writes need JSON content-type and a same-origin Origin header", { skip }, async () => {
  let r = createMockReqRes({ method: "POST", headers: { cookie: cookieFor("innovinitylabs"), "content-type": "text/plain" }, body: "{}" });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 403);
  r = adminRequest("POST", { body: { id: "csrf-x", name: "x" }, origin: "https://evil.example" });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 403);
  r = adminRequest("POST", { body: { id: "csrf-ok", name: "csrf ok" }, origin: "http://localhost:3000" });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 201);
});

test("default-profile rules: single default enforced; default cannot be deleted or demoted", { skip }, async () => {
  const boot = await getBootstrap();
  const def = boot.body.profiles.find((p) => p.isDefault);

  let r = adminRequest("DELETE", { query: { id: def.id, version: String(def.version) } });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 400);

  r = adminRequest("PUT", { body: { ...def, isDefault: false } });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 400);

  const other = boot.body.profiles.find((p) => p.id === "database-developer");
  r = adminRequest("PUT", { body: { ...other, isDefault: true } });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 200);
  const after = await getBootstrap();
  assert.equal(after.body.profiles.filter((p) => p.isDefault).length, 1);
  assert.equal(after.body.profiles.find((p) => p.isDefault).id, "database-developer");

  // restore
  const cur = after.body.profiles.find((p) => p.id === "data-engineer");
  r = adminRequest("PUT", { body: { ...cur, isDefault: true } });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 200);
});

test("delete profile: needs the current version, and detaches (not deletes) applications", { skip }, async () => {
  const boot = await getBootstrap();
  const p = boot.body.profiles.find((x) => x.id === "csrf-ok");
  let r = adminRequest("POST", { body: { id: "with-app", name: "With App" } });
  const created = await call(m.profiles, r.req, r.res);
  r = adminRequest("POST", { body: { id: "app-on-with-app", company: "C", jobTitle: "T", applicationDate: "2026-11-01", status: "Draft", profileId: "with-app" } });
  assert.equal((await call(m.applications, r.req, r.res)).status, 201);

  r = adminRequest("DELETE", { query: { id: "with-app", version: "99" } });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 409);
  r = adminRequest("DELETE", { query: { id: "with-app", version: String(created.body.profile.version) } });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 200);

  const apps = await call(m.applications, ...Object.values(adminRequest("GET")));
  const kept = apps.body.applications.find((a) => a.id === "app-on-with-app");
  assert.ok(kept, "application must survive profile deletion");
  assert.equal(kept.profileId, null);
  assert.ok(p);
});

test("MASTER: edit persists, bumps version, keeps history, rejects stale writes and breaking edits", { skip }, async () => {
  let r = adminRequest("GET");
  const cur = await call(m.master, r.req, r.res);
  const data = JSON.parse(JSON.stringify(cur.body.data));
  data.summary = data.summary + " (edited)";

  r = adminRequest("PUT", { body: { version: cur.body.version, data } });
  const saved = await call(m.master, r.req, r.res);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, cur.body.version + 1);

  await m.db.closePool();
  const fresh = m.store.createStore();
  assert.match((await fresh.getMaster()).doc.summary, /\(edited\)$/);

  r = adminRequest("PUT", { body: { version: cur.body.version, data } });
  assert.equal((await call(m.master, r.req, r.res)).status, 409);

  // removing a project that a profile still selects is refused
  const broken = JSON.parse(JSON.stringify(saved.body.data));
  broken.projects = broken.projects.filter((p) => p.id !== "project-uravu");
  r = adminRequest("PUT", { body: { version: saved.body.version, data: broken } });
  const refused = await call(m.master, r.req, r.res);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "REFERENCES_BROKEN");

  // invalid master document
  const invalid = JSON.parse(JSON.stringify(saved.body.data));
  invalid.projects[0].status = "Launched into orbit";
  r = adminRequest("PUT", { body: { version: saved.body.version, data: invalid } });
  assert.equal((await call(m.master, r.req, r.res)).status, 400);

  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_URL });
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM master_resume_history");
  await pool.end();
  assert.equal(rows[0].n, 2, "seed version + edited version are both kept");
});

test("EXPORT: authenticated backup contains master, profiles and applications", { skip }, async () => {
  const { req, res } = adminRequest("GET");
  const out = await call(m.exporter, req, res);
  assert.equal(out.status, 200);
  assert.match(out.headers["content-disposition"], /attachment; filename="rajasekar-resume-backup-/);
  assert.equal(out.body.format, "rajasekar-resume-backup");
  assert.equal(out.body.master.data.projects.length, 8);
  assert.ok(out.body.profiles.length >= 3);
  assert.ok(out.body.applications.length >= 26);
});

test("LOGOUT revokes the session server-side: the same cookie is rejected afterwards", { skip }, async () => {
  const cookie = cookieFor("innovinitylabs");
  let r = adminRequest("GET", { cookie });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 200);

  r = adminRequest("POST", { cookie, body: {} });
  const out = await call(m.logout, r.req, r.res);
  assert.equal(out.status, 200);
  assert.equal(out.body.revoked, true);

  r = adminRequest("GET", { cookie });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 401);
  r = adminRequest("GET", { cookie });
  const sess = await call(m.session, r.req, r.res);
  assert.equal(sess.body.authenticated, false);

  // a different, unrevoked session still works
  r = adminRequest("GET");
  assert.equal((await call(m.profiles, r.req, r.res)).status, 200);
});

test("DB constraints hold even when the API is bypassed", { skip }, async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_URL });
  await assert.rejects(pool.query("INSERT INTO profiles (id, name, is_default) VALUES ('second-default','x', true)"), /profiles_single_default/);
  await assert.rejects(pool.query("INSERT INTO profiles (id, name, layout) VALUES ('bad-layout','x','neon')"));
  await assert.rejects(pool.query("INSERT INTO applications (id, company, job_title, application_date, status) VALUES ('c1','x','y','2026-01-01','Nope')"));
  await assert.rejects(pool.query("INSERT INTO master_resume (id, data) VALUES (2, '{}')"));
  await pool.end();
});

const getMasterDoc = async () => {
  const { req, res } = adminRequest("GET");
  return (await call(m.master, req, res)).body;
};
const putMaster = async (version, data) => {
  const { req, res } = adminRequest("PUT", { body: { version, data } });
  return call(m.master, req, res);
};
const lnk = (label, url, extra = {}) => ({ label, url, type: "website", primary: false, visible: true, ...extra });

test("PROJECT LINKS: create multi-link project, edit, reorder, change primary, hide, remove - persisted after a cold start", { skip }, async () => {
  let cur = await getMasterDoc();
  let data = JSON.parse(JSON.stringify(cur.data));
  data.projects.push({
    id: "project-links-demo", title: "Links Demo", category: "", status: "Prototype", role: "Sole developer", period: "",
    description: "Demo", technologies: ["Node"], bullets: [], isPublic: true, needsReview: false,
    links: [lnk("Official Website", "https://example.com", { primary: true }), lnk("Generator", "https://gen.example.com", { type: "generator" }), lnk("GitHub", "https://github.com/innovinitylabs/x", { type: "github" })],
  });
  let out = await putMaster(cur.version, data);
  assert.equal(out.status, 200, JSON.stringify(out.body));

  // edit label/url, make Generator primary, hide GitHub, reorder
  cur = out.body;
  data = JSON.parse(JSON.stringify(cur.data));
  const proj = data.projects.find((p) => p.id === "project-links-demo");
  proj.links[0].primary = false;
  proj.links[1].primary = true;
  proj.links[1].label = "Art Platform";
  proj.links[1].url = "https://art.example.com";
  proj.links[2].visible = false;
  proj.links.reverse();
  out = await putMaster(cur.version, data);
  assert.equal(out.status, 200, JSON.stringify(out.body));

  await m.db.closePool();
  const fresh = await m.store.createStore().getMaster();
  const saved = fresh.doc.projects.find((p) => p.id === "project-links-demo");
  assert.deepEqual(saved.links.map((l) => l.label), ["GitHub", "Art Platform", "Official Website"]);
  assert.equal(saved.links.filter((l) => l.primary).length, 1);
  assert.equal(saved.links.find((l) => l.primary).label, "Art Platform");
  assert.equal(saved.links.find((l) => l.label === "GitHub").visible, false);
  // the profile picker / resolver still sees the project
  assert.ok(fresh.master.projects.some((p) => p.id === "project-links-demo"));

  // remove a link
  data = JSON.parse(JSON.stringify(fresh.doc));
  data.projects.find((p) => p.id === "project-links-demo").links.splice(0, 1);
  out = await putMaster(fresh.version, data);
  assert.equal(out.status, 200);
  assert.equal(out.body.data.projects.find((p) => p.id === "project-links-demo").links.length, 2);
});

test("PROJECT LINKS: invalid URLs, two primaries and a stale version are rejected and nothing changes", { skip }, async () => {
  const cur = await getMasterDoc();
  const mutate = (fn) => { const d = JSON.parse(JSON.stringify(cur.data)); fn(d.projects.find((p) => p.id === "project-links-demo")); return d; };
  for (const [name, fn] of [
    ["bad url", (p) => (p.links[0].url = "example dot com")],
    ["javascript url", (p) => (p.links[0].url = "javascript:alert(1)")],
    ["two primaries", (p) => p.links.forEach((l) => (l.primary = true))],
    ["bad type", (p) => (p.links[0].type = "portal")],
  ]) {
    const out = await putMaster(cur.version, mutate(fn));
    assert.equal(out.status, 400, `${name}: ${JSON.stringify(out.body)}`);
  }
  const unchanged = await getMasterDoc();
  assert.equal(unchanged.version, cur.version);
  const stale = await putMaster(cur.version - 1, mutate(() => {}));
  assert.equal(stale.status, 409);
});

test("BACKUP + RESTORE: export includes links; restore into a changed database brings everything back", { skip }, async () => {
  const exp = adminRequest("GET");
  const snap = (await call(m.exporter, exp.req, exp.res)).body;
  const demo = snap.master.data.projects.find((p) => p.id === "project-links-demo");
  assert.equal(demo.links.length, 2, "export carries project links");
  const madras = snap.master.data.projects.find((p) => p.id === "project-madras-checks");
  assert.ok(madras.links.some((l) => l.url === "https://art.madraschecks.com" && l.type === "generator"));

  // damage the live data
  let cur = await getMasterDoc();
  const broken = JSON.parse(JSON.stringify(cur.data));
  broken.projects.find((p) => p.id === "project-madras-checks").links = [];
  assert.equal((await putMaster(cur.version, broken)).status, 200);
  const del = adminRequest("DELETE", { query: { id: "par-1", version: "1" } });
  await call(m.applications, del.req, del.res);

  const result = await m.store.defaultStore.restoreAll(JSON.parse(JSON.stringify(snap)));
  assert.ok(result.masterVersion > cur.version);
  assert.equal(result.profiles, snap.profiles.length);
  assert.equal(result.applications, snap.applications.length);

  cur = await getMasterDoc();
  assert.deepEqual(cur.data.projects.find((p) => p.id === "project-madras-checks").links, madras.links);
  assert.deepEqual(cur.data.projects.find((p) => p.id === "project-links-demo").links, demo.links);
  const again = adminRequest("GET");
  const snap2 = (await call(m.exporter, again.req, again.res)).body;
  assert.deepEqual(snap2.profiles.map((p) => [p.id, p.selectedProjects, p.version]), snap.profiles.map((p) => [p.id, p.selectedProjects, p.version]));
  assert.deepEqual(snap2.applications.map((a) => a.id).sort(), snap.applications.map((a) => a.id).sort(), "all applications (incl. the deleted one) are back");
});

test("RESTORE is all-or-nothing: an invalid snapshot changes nothing", { skip }, async () => {
  const exp = adminRequest("GET");
  const snap = (await call(m.exporter, exp.req, exp.res)).body;
  const before = (await getMasterDoc()).version;
  const bad = JSON.parse(JSON.stringify(snap));
  bad.profiles[0].selectedProjects = ["project-nope"];
  await assert.rejects(m.store.defaultStore.restoreAll(bad), /unknown project id/);
  const bad2 = JSON.parse(JSON.stringify(snap));
  bad2.master.data.projects[0].links[0].url = "nope";
  await assert.rejects(m.store.defaultStore.restoreAll(bad2));
  await assert.rejects(m.store.defaultStore.restoreAll({ format: "other" }));
  assert.equal((await getMasterDoc()).version, before);
  assert.equal((await getBootstrap()).body.profiles.length, snap.profiles.length);
});

test("MIGRATION 003 upgrades a legacy master in place (no table dropped) and records a history row", { skip }, async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_URL });
  const { rows } = await pool.query("SELECT data, version FROM master_resume WHERE id = 1");
  const legacy = rows[0].data;
  legacy.projects.find((p) => p.id === "project-uravu").links = [{ label: "uravu-site.vercel.app", url: "https://uravu-site.vercel.app" }];
  await pool.query("UPDATE master_resume SET data = $1::jsonb WHERE id = 1", [JSON.stringify(legacy)]);
  await pool.query("DELETE FROM schema_migrations WHERE id = '003_project_links_v2'");
  const tablesBefore = (await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;

  await m.db.migrate(pool);

  const after = (await pool.query("SELECT data, version, updated_by FROM master_resume WHERE id = 1")).rows[0];
  const uravu = after.data.projects.find((p) => p.id === "project-uravu");
  assert.equal(uravu.links[0].url, "https://www.uravu.social");
  assert.equal(uravu.links[0].primary, true);
  assert.equal(after.version, rows[0].version + 1);
  assert.equal(after.updated_by, "migration-003");
  assert.equal((await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, tablesBefore);
  assert.equal((await pool.query("SELECT count(*)::int n FROM master_resume_history WHERE saved_by='migration-003'")).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM profiles")).rows[0].n >= 3, true, "profiles untouched");
  await m.db.migrate(pool); // idempotent
  assert.equal((await pool.query("SELECT version FROM master_resume WHERE id = 1")).rows[0].version, after.version);
  await pool.end();
});

test("PROFILE PREVIEW data: a profile that selects the multi-link project still resolves", { skip }, async () => {
  const boot = await getBootstrap();
  const p = boot.body.profiles.find((x) => x.id === "ai-product-engineer");
  const r = adminRequest("PUT", { body: { ...p, selectedProjects: ["project-links-demo", ...p.selectedProjects] } });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 200);
  const after = await getBootstrap();
  const { resolveProfile } = require("../resume-resolve");
  const resolved = resolveProfile(after.body.profiles.find((x) => x.id === "ai-product-engineer"), after.body.master);
  assert.equal(resolved.projects[0].id, "project-links-demo");
});

test("MIGRATION 004 upgrades a pre-two-page database in place and is idempotent", { skip }, async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_URL });
  const { rows } = await pool.query("SELECT data, version FROM master_resume WHERE id = 1");
  const legacy = rows[0].data;
  legacy.experience.find((e) => e.id === "exp-independent").bullets = ["Independently build software products, creative technology, web applications, generative art systems, and AI-assisted applications"];
  delete legacy.experience.find((e) => e.id === "exp-appzwork").context;
  const i = legacy.skills.findIndex((x) => x.id === "skill-devops");
  legacy.skills.splice(i, 2, { id: "skill-devops-developer-tools", group: "DevOps and Developer Tools", items: ["Docker", "Git", "Cursor"] });
  legacy.projects.find((p) => p.id === "project-madras-checks").links.splice(1, 0, { label: "Art Page", url: "https://madraschecks.com/art/", type: "website", primary: false, visible: true });
  legacy.projects.reverse();
  await pool.query("UPDATE master_resume SET data = $1::jsonb WHERE id = 1", [JSON.stringify(legacy)]);
  await pool.query(
    "UPDATE profiles SET selected_projects='[\"project-onchainrugs\",\"project-uravu\"]', project_detail='compact', selected_skills='[\"skill-programming-languages\",\"skill-devops-developer-tools\",\"skill-currently-learning\"]' WHERE id='data-engineer'"
  );
  await pool.query("UPDATE profiles SET selected_skills='[\"skill-databases\",\"skill-devops-developer-tools\",\"skill-currently-learning\"]' WHERE id='ai-product-engineer'");
  await pool.query("DELETE FROM schema_migrations WHERE id = '004_two_page_resume'");
  const tables = (await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;

  await m.db.migrate(pool);

  const after = (await pool.query("SELECT data, version, updated_by FROM master_resume WHERE id = 1")).rows[0];
  const d = after.data;
  assert.equal(d.experience.find((e) => e.id === "exp-independent").bullets.length, 4);
  assert.deepEqual(d.experience.find((e) => e.id === "exp-appzwork").context.map((c) => c.split(":")[0]), ["BMO Capital Accounts", "EvoBrix-X"]);
  assert.ok(d.skills.some((x) => x.id === "skill-devops") && d.skills.some((x) => x.id === "skill-developer-tools"));
  assert.ok(!d.skills.some((x) => x.id === "skill-devops-developer-tools"));
  assert.deepEqual(d.projects.find((p) => p.id === "project-madras-checks").links.filter((l) => l.visible).map((l) => l.url), ["https://madraschecks.com", "https://art.madraschecks.com"]);
  assert.equal(d.projects[0].id, "project-links-demo", "order is left alone when you have added your own projects");
  assert.equal(after.updated_by, "migration-004");

  const de = (await pool.query("SELECT selected_projects, project_detail, selected_skills, version FROM profiles WHERE id='data-engineer'")).rows[0];
  assert.equal(de.project_detail, "showcase");
  assert.equal(de.selected_projects.length, 8);
  assert.ok(!de.selected_skills.includes("skill-currently-learning") && !de.selected_skills.includes("skill-developer-tools"));
  const ai = (await pool.query("SELECT selected_skills FROM profiles WHERE id='ai-product-engineer'")).rows[0];
  assert.deepEqual(ai.selected_skills, ["skill-databases", "skill-devops", "skill-developer-tools"]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, tables, "no table dropped or added");
  await assert.rejects(pool.query("UPDATE profiles SET project_detail='huge' WHERE id='data-engineer'"));

  const v = after.version;
  await m.db.migrate(pool);
  assert.equal((await pool.query("SELECT version FROM master_resume WHERE id=1")).rows[0].version, v);
  await pool.end();
});

test("MIGRATION 005 adds profile options, upgrades master, and inserts the research profile without touching other profiles", { skip }, async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: TEST_URL });
  const before = (await pool.query("SELECT id, version, selected_skills, selected_projects FROM profiles WHERE id IN ('data-engineer','database-developer') ORDER BY id")).rows;
  const { rows } = await pool.query("SELECT data FROM master_resume WHERE id = 1");
  const legacy = rows[0].data;
  const ind = legacy.experience.find((e) => e.id === "exp-independent");
  ind.bullets = ind.bullets.slice(0, 4); // the four bullets that existed before migration 005
  legacy.education = legacy.education.filter((e) => e.id !== "edu-datacamp-deep-learning");
  legacy.education[0].level = "B.E.";
  legacy.skills = legacy.skills.filter((x) => x.id !== "skill-ai-systems");
  const uravu = legacy.projects.find((p) => p.id === "project-uravu");
  uravu.links = uravu.links.filter((l) => !/research/.test(l.url));
  await pool.query("UPDATE master_resume SET data = $1::jsonb WHERE id = 1", [JSON.stringify(legacy)]);
  await pool.query("DELETE FROM profiles WHERE id = 'anthropic-research-residency'");
  await pool.query("UPDATE profiles SET options = '{}'::jsonb");
  await pool.query("DELETE FROM schema_migrations WHERE id = '005_profile_options_research_profile'");

  await m.db.migrate(pool);

  const d = (await pool.query("SELECT data FROM master_resume WHERE id = 1")).rows[0].data;
  assert.equal(d.experience.find((e) => e.id === "exp-independent").bullets.length, 5);
  assert.equal(d.education[0].level, "B.E. in Civil Engineering");
  assert.ok(d.education.some((e) => e.id === "edu-datacamp-deep-learning" && e.meta === "Introductory course"));
  assert.ok(d.skills.some((x) => x.id === "skill-ai-systems"));
  assert.ok(d.projects.find((p) => p.id === "project-uravu").links.some((l) => l.url === "https://www.uravu.social/research"));

  const research = (await pool.query("SELECT name, project_detail, options, selected_projects FROM profiles WHERE id = 'anthropic-research-residency'")).rows[0];
  assert.equal(research.name, "Anthropic Research Residency");
  assert.equal(research.options.displayName, "Rajasekar Chandrasekar");
  assert.deepEqual(research.selected_projects, ["project-uravu", "project-pocket-astro", "project-onchainrugs", "project-madras-checks"]);
  const after = (await pool.query("SELECT id, version, selected_skills, selected_projects, options FROM profiles WHERE id IN ('data-engineer','database-developer') ORDER BY id")).rows;
  after.forEach((a, i) => {
    assert.deepEqual(a.selected_skills, before[i].selected_skills, "skills untouched");
    assert.deepEqual(a.selected_projects, before[i].selected_projects, "projects untouched");
    assert.deepEqual(a.options.selectedEducation, ["edu-rmk-engineering-college"], "existing profile keeps only the degree");
  });
  const v = (await pool.query("SELECT version FROM master_resume WHERE id=1")).rows[0].version;
  await m.db.migrate(pool);
  assert.equal((await pool.query("SELECT version FROM master_resume WHERE id=1")).rows[0].version, v, "idempotent");
  assert.equal((await pool.query("SELECT count(*)::int n FROM profiles WHERE id='anthropic-research-residency'")).rows[0].n, 1);
  await pool.end();
});

test("RESEARCH PROFILE via the API: persisted options survive a cold start and a restore", { skip }, async () => {
  const boot = await getBootstrap();
  const p = boot.body.profiles.find((x) => x.id === "anthropic-research-residency");
  assert.ok(p, "profile is in the bootstrap");
  assert.equal(p.options.displayName, "Rajasekar Chandrasekar");
  const edited = { ...p, options: { ...p.options, extraSections: [...p.options.extraSections, { heading: "Note", paragraphs: ["Edited via API."] }] } };
  const r = adminRequest("PUT", { body: edited });
  assert.equal((await call(m.profiles, r.req, r.res)).status, 200);
  await m.db.closePool();
  const fresh = (await m.store.createStore().listProfiles()).find((x) => x.id === "anthropic-research-residency");
  assert.equal(fresh.options.extraSections.at(-1).heading, "Note");
  const bad = adminRequest("PUT", { body: { ...fresh, options: { selectedEducation: ["edu-nope"] } } });
  assert.equal((await call(m.profiles, bad.req, bad.res)).status, 400);

  const exp = adminRequest("GET");
  const snap = (await call(m.exporter, exp.req, exp.res)).body;
  assert.equal(snap.profiles.find((x) => x.id === "anthropic-research-residency").options.displayName, "Rajasekar Chandrasekar");
  await m.store.defaultStore.restoreAll(JSON.parse(JSON.stringify(snap)));
  const again = (await getBootstrap()).body.profiles.find((x) => x.id === "anthropic-research-residency");
  assert.deepEqual(again.options, snap.profiles.find((x) => x.id === "anthropic-research-residency").options);
});

test("teardown", { skip }, async () => {
  await m.db.closePool();
});
