const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  getConfig,
  createSessionToken,
  validateAdminSession,
  serializeCookie,
} = require("../lib/auth");

const profilesHandler = require("../api/profiles");
const sessionHandler = require("../api/auth/session");
const logoutHandler = require("../api/auth/logout");

const ROOT = path.join(__dirname, "..");
const config = getConfig();

const createMockReqRes = ({ method = "GET", headers = {}, body = null, query = {} } = {}) => {
  const req = {
    method,
    headers,
    body,
    query,
  };

  let statusCode = 200;
  let responseData = null;
  const headersSent = {};

  const res = {
    setHeader(name, val) {
      headersSent[name.toLowerCase()] = val;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    writeHead(code, headers = {}) {
      statusCode = code;
      for (const [k, v] of Object.entries(headers)) {
        headersSent[k.toLowerCase()] = v;
      }
      return this;
    },
    end() {
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get data() {
      return responseData;
    },
    get headers() {
      return headersSent;
    },
  };

  return { req, res };
};

test("SECURITY 1: Visiting admin HTML starts in a gated, non-revealing state", () => {
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
});

test("SECURITY 2: Unauthenticated GET /api/profiles receives HTTP 401 with zero data exposed", async () => {
  const { req, res } = createMockReqRes({ method: "GET", headers: {} });
  await profilesHandler(req, res);

  assert.equal(res.statusCode, 401, "Expected 401 Unauthorized");
  assert.equal(res.data.authenticated, false);
  assert.equal(res.data.master, undefined, "Must NOT leak master resume");
  assert.equal(res.data.profiles, undefined, "Must NOT leak profiles");
  assert.equal(res.data.applications, undefined, "Must NOT leak applications");
});

test("SECURITY 3: Invalid or tampered session receives HTTP 401", async () => {
  const forgedCookie = "admin_session=eyJhbGciOiJIUzI1NiJ9.invalid_signature_part";
  const { req, res } = createMockReqRes({
    method: "GET",
    headers: { cookie: forgedCookie },
  });

  await profilesHandler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.data.master, undefined);

  // Check /api/auth/session status
  const sessionCheck = createMockReqRes({
    method: "GET",
    headers: { cookie: forgedCookie },
  });
  await sessionHandler(sessionCheck.req, sessionCheck.res);
  assert.equal(sessionCheck.res.data.authenticated, false);
  assert.equal(sessionCheck.res.data.authorized, false);
});

test("SECURITY 4: Expired session receives HTTP 401", async () => {
  // Generate token expired 5 seconds ago
  const user = { login: config.adminUsername, name: "Admin" };
  const expiredToken = createSessionToken(user, config.sessionSecret, -5000);
  const cookieHeader = `admin_session=${expiredToken}`;

  const { req, res } = createMockReqRes({
    method: "GET",
    headers: { cookie: cookieHeader },
  });

  await profilesHandler(req, res);
  assert.equal(res.statusCode, 401);

  // Check /api/auth/session
  const sessionCheck = createMockReqRes({
    method: "GET",
    headers: { cookie: cookieHeader },
  });
  await sessionHandler(sessionCheck.req, sessionCheck.res);
  assert.equal(sessionCheck.res.data.authenticated, false);
  assert.equal(sessionCheck.res.data.authorized, false);
  assert.equal(sessionCheck.res.data.expired, true);
});

test("SECURITY 5: Valid authorized session allows GET /api/profiles", async () => {
  const adminUser = {
    login: config.adminUsername,
    name: "Rajasekar C",
    avatar_url: "https://github.com/innovinitylabs.png",
  };
  const validToken = createSessionToken(adminUser, config.sessionSecret);
  const cookieHeader = `admin_session=${validToken}`;

  const { req, res } = createMockReqRes({
    method: "GET",
    headers: { cookie: cookieHeader },
  });

  await profilesHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.data.profiles), "Must return profiles to authorized admin");
  assert.ok(Array.isArray(res.data.applications), "Must return applications to authorized admin");
  assert.ok(res.data.master, "Must return master resume to authorized admin");
  assert.equal(res.data.user, config.adminUsername);
});

test("SECURITY 6: Authenticated but unauthorized GitHub account receives HTTP 403 Forbidden", async () => {
  const hackerUser = {
    login: "some-other-github-account",
    name: "Not Rajasekar",
    avatar_url: "https://github.com/other.png",
  };
  const hackerToken = createSessionToken(hackerUser, config.sessionSecret);
  const cookieHeader = `admin_session=${hackerToken}`;

  // 1. GET /api/profiles
  const getCall = createMockReqRes({
    method: "GET",
    headers: { cookie: cookieHeader },
  });
  await profilesHandler(getCall.req, getCall.res);
  assert.equal(getCall.res.statusCode, 403, "Must return 403 Forbidden for non-admin");
  assert.equal(getCall.res.data.master, undefined, "Must NOT leak data to unauthorized user");

  // 2. /api/auth/session
  const sessionCheck = createMockReqRes({
    method: "GET",
    headers: { cookie: cookieHeader },
  });
  await sessionHandler(sessionCheck.req, sessionCheck.res);
  assert.equal(sessionCheck.res.data.authenticated, true);
  assert.equal(sessionCheck.res.data.authorized, false, "Must flag user as unauthorized");
});

test("SECURITY 7: Unauthorized write operations (POST) are strictly blocked", async () => {
  // 1. Unauthenticated write
  const unauthPost = createMockReqRes({
    method: "POST",
    headers: {},
    body: { profiles: [] },
  });
  await profilesHandler(unauthPost.req, unauthPost.res);
  assert.equal(unauthPost.res.statusCode, 401);

  // 2. Unauthorized account write
  const hackerToken = createSessionToken({ login: "malicious-actor" }, config.sessionSecret);
  const hackerPost = createMockReqRes({
    method: "POST",
    headers: { cookie: `admin_session=${hackerToken}` },
    body: { profiles: [] },
  });
  await profilesHandler(hackerPost.req, hackerPost.res);
  assert.equal(hackerPost.res.statusCode, 403);
});

test("SECURITY 8: Logout clears session cookie with Max-Age=0", async () => {
  const { req, res } = createMockReqRes({
    method: "GET",
    headers: { accept: "application/json" },
  });

  await logoutHandler(req, res);
  assert.equal(res.statusCode, 200);

  const setCookie = res.headers["set-cookie"];
  assert.ok(setCookie, "Must set clearance cookie");

  const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
  assert.ok(cookieStr.includes("admin_session="));
  assert.ok(cookieStr.includes("Max-Age=0"));
  assert.ok(cookieStr.includes("HttpOnly"));
});
