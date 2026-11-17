"use strict";

const {
  getConfig,
  createOAuthState,
  serializeCookie,
  cookieOptionsFor,
  getBaseUrl,
} = require("../../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const config = getConfig();

  if (!config.isConfigured) {
    if (req.headers.accept && req.headers.accept.includes("application/json")) {
      return res.status(501).json({
        error: "GitHub OAuth not configured",
        message:
          "Configure GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and a SESSION_SECRET of at least 32 characters in the deployment environment.",
        status: "unconfigured",
        adminTarget: config.adminUsername,
      });
    }
    res.writeHead(302, { Location: "/admin/?error=unconfigured" });
    return res.end();
  }

  const base = getBaseUrl(req);
  if (!base) {
    res.writeHead(302, { Location: "/admin/?error=invalid_host" });
    return res.end();
  }

  const state = createOAuthState(config.sessionSecret);
  const stateCookie = serializeCookie("oauth_state", state, {
    ...cookieOptionsFor(req),
    maxAge: 600,
    sameSite: "Lax",
  });

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", config.clientId);
  githubAuthUrl.searchParams.set("redirect_uri", `${base}/api/auth/callback`);
  githubAuthUrl.searchParams.set("scope", "read:user");
  githubAuthUrl.searchParams.set("state", state);

  res.setHeader("Set-Cookie", stateCookie);
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(302, { Location: githubAuthUrl.toString() });
  res.end();
};
