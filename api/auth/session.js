"use strict";

const { getConfig, validateAdminSession, parseCookies, verifySessionToken } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const config = getConfig();
  const cookies = parseCookies(req.headers ? req.headers.cookie : "");
  const sessionToken = cookies.admin_session;

  if (!sessionToken) {
    return res.status(200).json({
      authenticated: false,
      authorized: false,
      adminTarget: config.adminUsername,
      oauthConfigured: config.isConfigured,
    });
  }

  const session = verifySessionToken(sessionToken, config.sessionSecret);

  if (!session) {
    return res.status(200).json({
      authenticated: false,
      authorized: false,
      expired: true,
      error: "Session has expired or is invalid.",
      adminTarget: config.adminUsername,
      oauthConfigured: config.isConfigured,
    });
  }

  const isAuthorized = session.user.toLowerCase() === config.adminUsername.toLowerCase();

  return res.status(200).json({
    authenticated: true,
    authorized: isAuthorized,
    error: isAuthorized ? null : `Account "${session.user}" is not the authorized administrator.`,
    user: {
      login: session.user,
      name: session.name,
      avatar: session.avatar,
    },
    adminTarget: config.adminUsername,
    oauthConfigured: config.isConfigured,
  });
};
