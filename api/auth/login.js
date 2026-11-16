"use strict";

const { getConfig, createOAuthState, serializeCookie } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const config = getConfig();

  if (!config.isConfigured) {
    return res.status(501).json({
      error: "GitHub OAuth not configured",
      message:
        "Please configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables in your deployment.",
      status: "unconfigured",
      adminTarget: config.adminUsername,
    });
  }

  const state = createOAuthState(config.sessionSecret);
  const stateCookie = serializeCookie("oauth_state", state, {
    maxAge: 600, // 10 minutes
    httpOnly: true,
    sameSite: "Lax",
  });

  const redirectUri = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/auth/callback`;
  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", config.clientId);
  githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
  githubAuthUrl.searchParams.set("scope", "read:user");
  githubAuthUrl.searchParams.set("state", state);

  res.setHeader("Set-Cookie", stateCookie);
  res.writeHead(302, { Location: githubAuthUrl.toString() });
  res.end();
};
