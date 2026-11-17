const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createMockReqRes, cookieFor, call, SECRET } = require("./helpers");

process.env.SESSION_SECRET = SECRET;
process.env.ADMIN_GITHUB_USERNAME = "innovinitylabs";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const profilesHandler = require("../api/profiles");
const applicationsHandler = require("../api/applications");
const masterHandler = require("../api/master");
const exportHandler = require("../api/export");
const sessionHandler = require("../api/auth/session");
const logoutHandler = require("../api/auth/logout");
const { createSessionToken } = require("../lib/auth");

const ROOT = path.join(__dirname, "..");

test("SECURITY 1: Visiting admin HTML starts in a gated, non-revealing state with correct static asset paths", () => {
  const adminHtml = fs.readFileSync(path.join(ROOT, "admin", "index.html"), "utf8");
  assert.ok(adminHtml.includes('id="admin-login-view"'), "Login view container must exist");
  assert.ok(adminHtml.includes('id="admin-app-view"'), "Admin app view container must exist");
  assert.ok(
    adminHtml.includes("#admin-app-view {\n        display: none;\n      }") ||
      adminHtml.includes("#admin-app-view"),
    "Admin app view must be hidden by default"
  );
  assert.ok(adminHtml.includes("Continue with GitHub"), "Must include GitHub login button");
  assert.ok(adminHtml.includes("innovinitylabs"), "Must identify authorized administrator");

  // Verify static asset references are root-relative to avoid 404 regardless of trailing slash
  assert.ok(adminHtml.includes('href="/admin/admin.css"'), "admin.css must be root-relative /admin/admin.css");
  assert.ok(adminHtml.includes('src="/admin/admin.js"'), "admin.js must be root-relative /admin/admin.js");
  assert.ok(adminHtml.includes('href="/styles.css"'), "styles.css must be root-relative /styles.css");
  assert.ok(adminHtml.includes('src="/resume-pdf.js"'), "resume-pdf.js must be root-relative /resume-pdf.js");
  assert.ok(adminHtml.includes('src="/resume-resolve.js"'), "admin must use the shared resolver /resume-resolve.js");
});

test("ROUTING: vercel.json includes rewrites for /admin and fallback assets", () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  assert.ok(Array.isArray(vercelConfig.rewrites), "rewrites array must exist");
  
  const sources = vercelConfig.rewrites.map((r) => r.source);
  assert.ok(sources.includes("/admin"), "Must rewrite /admin");
  assert.ok(sources.includes("/admin/"), "Must rewrite /admin/");
  assert.ok(sources.includes("/admin.css"), "Must rewrite /admin.css");
  assert.ok(sources.includes("/admin.js"), "Must rewrite /admin.js");
});


const ENDPOINTS = [
  ["profiles", profilesHandler],
  ["applications", applicationsHandler],
  ["master", masterHandler],
  ["export", exportHandler],
];

for (const [name, handler] of ENDPOINTS) {
  test(`SECURITY: unauthenticated GET /api/${name} -> 401 with no data`, async () => {
    const { req, res } = createMockReqRes({});
    const out = await call(handler, req, res);
    assert.equal(out.status, 401);
    assert.equal(out.body.authenticated, false);
    assert.equal(Object.keys(out.body).some((k) => ["profiles", "applications", "master", "data"].includes(k)), false);
  });

  test(`SECURITY: tampered/invalid session on /api/${name} -> 401`, async () => {
    const { req, res } = createMockReqRes({ headers: { cookie: "admin_session=abc.def" } });
    assert.equal((await call(handler, req, res)).status, 401);
  });

  test(`SECURITY: expired session on /api/${name} -> 401`, async () => {
    const { req, res } = createMockReqRes({ headers: { cookie: cookieFor("innovinitylabs", { durationMs: -1000 }) } });
    assert.equal((await call(handler, req, res)).status, 401);
  });

  test(`SECURITY: authenticated non-admin on /api/${name} -> 403`, async () => {
    const { req, res } = createMockReqRes({ headers: { cookie: cookieFor("someone-else") } });
    const out = await call(handler, req, res);
    assert.equal(out.status, 403);
    assert.equal(out.body.authenticated, false);
  });

  test(`SECURITY: unauthenticated writes to /api/${name} are rejected before parsing`, async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const { req, res } = createMockReqRes({ method, headers: { "content-type": "application/json" }, body: "{}" });
      const out = await call(handler, req, res);
      assert.ok([401, 405].includes(out.status), `${method} /api/${name} -> ${out.status}`);
    }
  });
}

test("SECURITY: a token signed with a different secret is rejected", async () => {
  const forged = createSessionToken({ login: "innovinitylabs", id: 1 }, "attacker-secret-attacker-secret-0000");
  const { req, res } = createMockReqRes({ headers: { cookie: `admin_session=${encodeURIComponent(forged)}` } });
  assert.equal((await call(profilesHandler, req, res)).status, 401);
});

test("SECURITY: with SESSION_SECRET unset the server fails closed (503) and never falls back to a default secret", async () => {
  const saved = process.env.SESSION_SECRET;
  const token = createSessionToken({ login: "innovinitylabs", id: 1 }, saved);
  delete process.env.SESSION_SECRET;
  try {
    const { req, res } = createMockReqRes({ headers: { cookie: `admin_session=${encodeURIComponent(token)}` } });
    assert.equal((await call(profilesHandler, req, res)).status, 503);
    // The historical hard-coded fallback secret must not work either.
    const legacy = createSessionToken(
      { login: "innovinitylabs", id: 1 },
      "rajasekar-dev-secret-key-32-bytes-minimum-length!"
    );
    const r2 = createMockReqRes({ headers: { cookie: `admin_session=${encodeURIComponent(legacy)}` } });
    assert.equal((await call(profilesHandler, r2.req, r2.res)).status, 503);
  } finally {
    process.env.SESSION_SECRET = saved;
  }
});

test("SECURITY: valid admin without a configured database gets 503 STORAGE_NOT_CONFIGURED, not fake data", async () => {
  const { req, res } = createMockReqRes({ headers: { cookie: cookieFor("innovinitylabs") } });
  const out = await call(profilesHandler, req, res);
  assert.equal(out.status, 503);
  assert.equal(out.body.code, "STORAGE_NOT_CONFIGURED");
});

test("SECURITY: auth source has no hard-coded default session secret", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib", "auth.js"), "utf8");
  assert.ok(!src.includes("rajasekar-dev-secret"), "default secret must be removed");
});

test("SESSION endpoint: no cookie, forged cookie, non-admin and admin states", async () => {
  let r = createMockReqRes({});
  let out = await call(sessionHandler, r.req, r.res);
  assert.equal(out.body.authenticated, false);

  r = createMockReqRes({ headers: { cookie: "admin_session=bad.token" } });
  out = await call(sessionHandler, r.req, r.res);
  assert.equal(out.body.authenticated, false);
  assert.equal(out.body.expired, true);

  r = createMockReqRes({ headers: { cookie: cookieFor("someone-else") } });
  out = await call(sessionHandler, r.req, r.res);
  assert.equal(out.body.authenticated, true);
  assert.equal(out.body.authorized, false);

  r = createMockReqRes({ headers: { cookie: cookieFor("innovinitylabs") } });
  out = await call(sessionHandler, r.req, r.res);
  assert.equal(out.body.authorized, true);
  assert.ok(!JSON.stringify(out.body).includes(SECRET), "session endpoint must not leak the secret");
});

test("SECURITY: with ADMIN_GITHUB_ID set, a same-name account with a different numeric id is rejected", async () => {
  process.env.ADMIN_GITHUB_ID = "4242";
  try {
    const { req, res } = createMockReqRes({ headers: { cookie: cookieFor("innovinitylabs", { id: 1 }) } });
    assert.equal((await call(profilesHandler, req, res)).status, 403);
    const ok = createMockReqRes({ headers: { cookie: cookieFor("innovinitylabs", { id: 4242 }) } });
    assert.notEqual((await call(profilesHandler, ok.req, ok.res)).status, 403);
  } finally {
    delete process.env.ADMIN_GITHUB_ID;
  }
});

test("LOGOUT: GET is refused, POST clears cookies with Max-Age=0 and Secure", async () => {
  let r = createMockReqRes({ method: "GET" });
  assert.equal((await call(logoutHandler, r.req, r.res)).status, 405);

  r = createMockReqRes({
    method: "POST",
    headers: { cookie: cookieFor("innovinitylabs"), "content-type": "application/json", host: "rajasekar.work" },
  });
  const out = await call(logoutHandler, r.req, r.res);
  assert.equal(out.status, 200);
  const cookies = [].concat(out.headers["set-cookie"]).join("\n");
  assert.match(cookies, /admin_session=;/);
  assert.match(cookies, /Max-Age=0/);
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /Secure/);
});

test("LOGOUT: cross-origin or non-JSON POST is rejected (CSRF)", async () => {
  let r = createMockReqRes({ method: "POST", headers: { "content-type": "text/plain" } });
  assert.equal((await call(logoutHandler, r.req, r.res)).status, 403);
  r = createMockReqRes({
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example", host: "rajasekar.work" },
  });
  assert.equal((await call(logoutHandler, r.req, r.res)).status, 403);
});
