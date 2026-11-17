const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getConfig,
  createSessionToken,
  verifySessionToken,
  createOAuthState,
  verifyOAuthState,
  parseCookies,
  serializeCookie,
} = require("../lib/auth");

const SECRET = "test-secret-key-at-least-32-bytes-long!";

test("session token creation and successful verification", () => {
  const user = {
    login: "innovinitylabs",
    name: "Rajasekar C",
    avatar_url: "https://github.com/innovinitylabs.png",
  };

  const token = createSessionToken(user, SECRET);
  assert.ok(typeof token === "string");
  assert.ok(token.includes("."));

  const payload = verifySessionToken(token, SECRET);
  assert.ok(payload);
  assert.equal(payload.user, "innovinitylabs");
  assert.equal(payload.name, "Rajasekar C");
});

test("tampered session token is rejected", () => {
  const user = { login: "innovinitylabs" };
  const token = createSessionToken(user, SECRET);
  const [jsonPart] = token.split(".");

  // Attempt forgery with invalid signature
  const forged = `${jsonPart}.invalid_signature_string`;
  assert.equal(verifySessionToken(forged, SECRET), null);

  // Attempt with different secret
  assert.equal(verifySessionToken(token, "wrong-secret-key"), null);
});

test("expired session token is rejected", () => {
  const user = { login: "innovinitylabs" };
  // Expired duration (-1000ms)
  const expiredToken = createSessionToken(user, SECRET, -1000);
  assert.equal(verifySessionToken(expiredToken, SECRET), null);
});

test("oauth state parameter creation and verification", () => {
  const state = createOAuthState(SECRET);
  assert.ok(typeof state === "string");
  assert.equal(verifyOAuthState(state, SECRET), true);

  // State with wrong secret
  assert.equal(verifyOAuthState(state, "wrong-secret"), false);

  // Tampered state
  const tampered = state.slice(0, -2) + (state.endsWith("z") ? "a" : "z");
  assert.equal(verifyOAuthState(tampered, SECRET), false);
});

test("cookie parsing and serialization", () => {
  const serialized = serializeCookie("test_cookie", "hello_world", {
    maxAge: 3600,
    httpOnly: true,
    sameSite: "Lax",
  });
  assert.ok(serialized.includes("test_cookie=hello_world"));
  assert.ok(serialized.includes("HttpOnly"));
  assert.ok(serialized.includes("SameSite=Lax"));
  assert.ok(serialized.includes("Max-Age=3600"));
  assert.ok(serialized.includes("Secure"), "Secure is the default");
  assert.ok(!serializeCookie("x", "y", { secure: false }).includes("Secure"), "Secure can only be dropped explicitly (localhost)");

  const parsed = parseCookies("test_cookie=hello_world; other=123");
  assert.equal(parsed.test_cookie, "hello_world");
  assert.equal(parsed.other, "123");
});

test("getConfig has no default secret and reports a weak/missing one", () => {
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  assert.equal(getConfig().sessionSecret, "");
  assert.equal(getConfig().hasValidSecret, false);
  process.env.SESSION_SECRET = "short";
  assert.equal(getConfig().hasValidSecret, false);
  process.env.SESSION_SECRET = saved;
  if (saved === undefined) delete process.env.SESSION_SECRET;
});

test("signing refuses a missing or short secret", () => {
  assert.throws(() => createSessionToken({ login: "x" }, ""));
  assert.throws(() => createSessionToken({ login: "x" }, "short"));
  assert.equal(verifySessionToken("a.b", ""), null);
});

test("session token carries a unique id and requires exp", () => {
  const a = verifySessionToken(createSessionToken({ login: "u", id: 7 }, SECRET), SECRET);
  const b = verifySessionToken(createSessionToken({ login: "u", id: 7 }, SECRET), SECRET);
  assert.ok(a.jti && b.jti && a.jti !== b.jti);
  assert.equal(a.uid, "7");

  // A correctly signed token without exp must NOT be accepted as immortal.
  const crypto = require("node:crypto");
  const body = Buffer.from(JSON.stringify({ user: "u" })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  assert.equal(verifySessionToken(`${body}.${sig}`, SECRET), null);
});

test("getBaseUrl only accepts hostname-shaped hosts", () => {
  const { getBaseUrl } = require("../lib/auth");
  delete process.env.SITE_URL;
  assert.equal(getBaseUrl({ headers: { host: "rajasekar.work" } }), "https://rajasekar.work");
  assert.equal(getBaseUrl({ headers: { host: "localhost:3000" } }), "http://localhost:3000");
  assert.equal(getBaseUrl({ headers: { host: "evil.com/path?x=1" } }), null);
  assert.equal(getBaseUrl({ headers: { host: 'a"b' } }), null);
});
