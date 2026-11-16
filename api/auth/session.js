"use strict";

const { getConfig, parseCookies, verifySessionToken } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  const config = getConfig();
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies.admin_session;

  const user = verifySessionToken(sessionToken, config.sessionSecret);

  if (!user) {
    return res.status(200).json({
      authenticated: false,
      adminTarget: config.adminUsername,
      oauthConfigured: config.isConfigured,
    });
  }

  return res.status(200).json({
    authenticated: true,
    user: {
      login: user.user,
      name: user.name,
      avatar: user.avatar,
    },
    adminTarget: config.adminUsername,
    oauthConfigured: config.isConfigured,
  });
};
