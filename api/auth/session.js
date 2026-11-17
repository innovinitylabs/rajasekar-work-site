"use strict";

const { getConfig, validateAdminSession } = require("../../lib/auth");

/** GET /api/auth/session: reports session state; never returns secrets. */
module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  const config = getConfig();
  const base = {
    adminTarget: config.adminUsername,
    oauthConfigured: config.isConfigured,
  };

  const hasCookie = /(?:^|;\s*)admin_session=/.test((req.headers && req.headers.cookie) || "");
  if (!hasCookie) {
    return res.status(200).json({ authenticated: false, authorized: false, ...base });
  }

  const auth = await validateAdminSession(req.headers.cookie);
  if (auth.status === 200) {
    return res.status(200).json({
      authenticated: true,
      authorized: true,
      error: null,
      user: { login: auth.session.user, name: auth.session.name, avatar: auth.session.avatar },
      expiresAt: auth.session.exp,
      ...base,
    });
  }
  if (auth.status === 403) {
    return res.status(200).json({
      authenticated: true,
      authorized: false,
      error: "This GitHub account is not the authorised administrator.",
      ...base,
    });
  }
  if (auth.status === 503) {
    return res.status(503).json({ authenticated: false, authorized: false, error: auth.error, ...base });
  }
  return res.status(200).json({
    authenticated: false,
    authorized: false,
    expired: true,
    error: "Session has expired or is invalid. Please sign in again.",
    ...base,
  });
};
