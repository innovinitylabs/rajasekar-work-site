"use strict";

const crypto = require("crypto");

const getConfig = () => ({
  clientId: process.env.GITHUB_CLIENT_ID || "",
  clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
  adminUsername: (process.env.ADMIN_GITHUB_USERNAME || "innovinitylabs").trim().toLowerCase(),
  sessionSecret: process.env.SESSION_SECRET || "rajasekar-dev-secret-key-32-bytes-minimum-length!",
  isConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
});

/**
 * Creates an HMAC signature for data.
 */
const sign = (data, secret) => {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
};

/**
 * Creates a signed session token.
 * Payload: { user: string, name: string, avatar: string, exp: number }
 */
const createSessionToken = (user, secret, durationMs = 7 * 24 * 60 * 60 * 1000) => {
  const payload = {
    user: user.login,
    name: user.name || user.login,
    avatar: user.avatar_url || "",
    exp: Date.now() + durationMs,
  };
  const jsonStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(jsonStr, secret);
  return `${jsonStr}.${signature}`;
};

/**
 * Verifies a signed session token.
 */
const verifySessionToken = (token, secret) => {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return null;
  }
  const [jsonStr, signature] = token.split(".");
  const expectedSig = sign(jsonStr, secret);

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(jsonStr, "base64url").toString("utf8"));
    if (typeof payload.exp === "number" && Date.now() > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
};

/**
 * Creates a signed CSRF state parameter for OAuth.
 */
const createOAuthState = (secret) => {
  const randomHex = crypto.randomBytes(16).toString("hex");
  const exp = Date.now() + 10 * 60 * 1000; // 10 minutes
  const body = `${randomHex}:${exp}`;
  const sig = sign(body, secret);
  return `${body}:${sig}`;
};

/**
 * Verifies a signed CSRF state parameter.
 */
const verifyOAuthState = (state, secret) => {
  if (!state || typeof state !== "string") return false;
  const parts = state.split(":");
  if (parts.length !== 3) return false;

  const [randomHex, expStr, sig] = parts;
  const body = `${randomHex}:${expStr}`;
  const expectedSig = sign(body, secret);

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  const exp = parseInt(expStr, 10);
  if (isNaN(exp) || Date.now() > exp) {
    return false; // Expired
  }

  return true;
};

/**
 * Parses cookies from Cookie header.
 */
const parseCookies = (cookieHeader) => {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return cookies;

  cookieHeader.split(";").forEach((pair) => {
    const index = pair.indexOf("=");
    if (index > 0) {
      const key = pair.slice(0, index).trim();
      const val = pair.slice(index + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  });

  return cookies;
};

/**
 * Serializes a cookie with secure defaults.
 */
const serializeCookie = (name, val, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(val)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.secure || process.env.NODE_ENV === "production") parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
};

module.exports = {
  getConfig,
  createSessionToken,
  verifySessionToken,
  createOAuthState,
  verifyOAuthState,
  parseCookies,
  serializeCookie,
};
