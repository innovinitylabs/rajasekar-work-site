"use strict";

const crypto = require("crypto");

const MIN_SECRET_LENGTH = 32;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Auth configuration comes only from environment variables.
 * There is deliberately NO default secret and NO default credentials: if
 * SESSION_SECRET is missing or weak, signing and verification refuse to work
 * and every protected endpoint fails closed.
 */
const getConfig = () => {
  const sessionSecret = process.env.SESSION_SECRET || "";
  return {
    clientId: process.env.GITHUB_CLIENT_ID || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    adminUsername: (process.env.ADMIN_GITHUB_USERNAME || "innovinitylabs").trim().toLowerCase(),
    // Optional but recommended: pin the immutable numeric GitHub account id, so a
    // renamed/recycled username can never inherit admin access.
    adminId: (process.env.ADMIN_GITHUB_ID || "").trim(),
    sessionSecret,
    hasValidSecret: sessionSecret.length >= MIN_SECRET_LENGTH,
    isConfigured: Boolean(
      process.env.GITHUB_CLIENT_ID &&
        process.env.GITHUB_CLIENT_SECRET &&
        sessionSecret.length >= MIN_SECRET_LENGTH
    ),
  };
};

const sign = (data, secret) => {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters`);
  }
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
};

const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

/**
 * Signed, stateless session token with a unique id (jti) so it can be revoked
 * server-side on logout.
 */
const createSessionToken = (user, secret, durationMs = SESSION_TTL_MS) => {
  const now = Date.now();
  const payload = {
    user: user.login,
    uid: user.id !== undefined && user.id !== null ? String(user.id) : "",
    name: user.name || user.login,
    avatar: user.avatar_url || "",
    jti: crypto.randomBytes(16).toString("hex"),
    iat: now,
    exp: now + durationMs,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
};

/** Returns the payload for a valid, unexpired, correctly signed token; otherwise null. */
const verifySessionToken = (token, secret) => {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  let expected;
  try {
    expected = sign(body, secret);
  } catch {
    return null; // missing/weak secret: nothing verifies
  }
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.user !== "string" || !payload.user) return null;
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
    if (Date.now() >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};

const createOAuthState = (secret) => {
  const nonce = crypto.randomBytes(16).toString("hex");
  const body = `${nonce}:${Date.now() + OAUTH_STATE_TTL_MS}`;
  return `${body}:${sign(body, secret)}`;
};

const verifyOAuthState = (state, secret) => {
  if (!state || typeof state !== "string") return false;
  const parts = state.split(":");
  if (parts.length !== 3) return false;
  const [nonce, expStr, sig] = parts;
  let expected;
  try {
    expected = sign(`${nonce}:${expStr}`, secret);
  } catch {
    return false;
  }
  if (!safeEqual(sig, expected)) return false;
  const exp = parseInt(expStr, 10);
  return Number.isFinite(exp) && Date.now() <= exp;
};

const parseCookies = (cookieHeader) => {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const index = pair.indexOf("=");
    if (index > 0) {
      const key = pair.slice(0, index).trim();
      const raw = pair.slice(index + 1).trim();
      try {
        cookies[key] = decodeURIComponent(raw);
      } catch {
        cookies[key] = raw;
      }
    }
  });
  return cookies;
};

/** HttpOnly + Secure + SameSite=Lax by default. Secure is only dropped for plain-http localhost. */
const serializeCookie = (name, val, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(val)}`];
  parts.push(`Path=${options.path || "/"}`);
  parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.secure !== false) parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
};

const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

const isLocalHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host || "");

/** Cookie attributes appropriate for the request (Secure everywhere except http://localhost). */
const cookieOptionsFor = (req) => ({
  secure: !isLocalHost(req.headers && req.headers.host),
});

/**
 * Public base URL used for the OAuth redirect_uri. SITE_URL wins; otherwise the
 * request host, which must look like a hostname (never reflect arbitrary header text).
 */
const getBaseUrl = (req) => {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const headers = req.headers || {};
  const host = String(headers["x-forwarded-host"] || headers.host || "").split(",")[0].trim();
  if (!HOST_RE.test(host)) return null;
  const proto = isLocalHost(host) ? "http" : "https";
  return `${proto}://${host}`;
};

let revocationLookup = null;
const defaultIsRevoked = async (jti) => {
  const db = require("./db");
  if (!db.isConfigured()) return false;
  if (!revocationLookup) revocationLookup = require("./store").defaultStore;
  return revocationLookup.isSessionRevoked(jti);
};

/**
 * Validates the admin session cookie on every protected request.
 * Status: 200 ok, 401 missing/invalid/expired/revoked, 403 authenticated as someone else,
 * 503 server auth misconfigured or revocation list unreachable (fail closed).
 */
const validateAdminSession = async (cookieHeader, { isRevoked = defaultIsRevoked } = {}) => {
  const config = getConfig();

  if (!config.hasValidSecret) {
    return {
      status: 503,
      error: "Authentication is not configured on this deployment (SESSION_SECRET missing or too short).",
      config,
    };
  }

  const token = parseCookies(cookieHeader).admin_session;
  if (!token) {
    return { status: 401, error: "Unauthorized: administrator session required. Please sign in.", config };
  }

  const session = verifySessionToken(token, config.sessionSecret);
  if (!session) {
    return { status: 401, error: "Unauthorized: invalid or expired administrator session.", config };
  }

  if (session.user.toLowerCase() !== config.adminUsername) {
    return {
      status: 403,
      error: `Forbidden: account "${session.user}" is not the authorised administrator.`,
      user: session.user,
      config,
    };
  }
  if (config.adminId && session.uid !== config.adminId) {
    return { status: 403, error: "Forbidden: GitHub account id does not match the administrator.", user: session.user, config };
  }

  if (session.jti) {
    try {
      if (await isRevoked(session.jti)) {
        return { status: 401, error: "Unauthorized: this session has been signed out.", config };
      }
    } catch {
      return { status: 503, error: "Session store unavailable. Please try again.", config };
    }
  }

  return { status: 200, session, config };
};

module.exports = {
  MIN_SECRET_LENGTH,
  SESSION_TTL_MS,
  getConfig,
  createSessionToken,
  verifySessionToken,
  createOAuthState,
  verifyOAuthState,
  parseCookies,
  serializeCookie,
  cookieOptionsFor,
  getBaseUrl,
  isLocalHost,
  validateAdminSession,
};
