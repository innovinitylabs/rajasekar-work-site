"use strict";

const {
  getConfig,
  parseCookies,
  verifySessionToken,
  serializeCookie,
  cookieOptionsFor,
} = require("../../lib/auth");
const { checkCsrf } = require("../../lib/http");

/**
 * POST /api/auth/logout
 * Clears the cookie AND revokes the session id server-side, so a copied cookie
 * stops working immediately. POST-only so another site cannot sign you out.
 */
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const csrf = checkCsrf(req);
  if (csrf) return res.status(403).json({ error: csrf, code: "CSRF" });

  const config = getConfig();
  const opts = { ...cookieOptionsFor(req), maxAge: 0 };
  res.setHeader("Set-Cookie", [serializeCookie("admin_session", "", opts), serializeCookie("oauth_state", "", opts)]);

  let revoked = false;
  const token = parseCookies(req.headers ? req.headers.cookie : "").admin_session;
  const session = config.hasValidSecret ? verifySessionToken(token, config.sessionSecret) : null;
  if (session && session.jti) {
    try {
      const db = require("../../lib/db");
      if (db.isConfigured()) {
        await require("../../lib/store").defaultStore.revokeSession(session.jti, session.exp);
        revoked = true;
      }
    } catch {
      /* cookie is cleared regardless; report that server-side revocation did not happen */
    }
  }
  return res.status(200).json({ ok: true, revoked });
};
