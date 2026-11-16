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

  const parsed = parseCookies("test_cookie=hello_world; other=123");
  assert.equal(parsed.test_cookie, "hello_world");
  assert.equal(parsed.other, "123");
});
