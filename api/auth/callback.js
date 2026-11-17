"use strict";

const {
  getConfig,
  verifyOAuthState,
  createSessionToken,
  parseCookies,
  serializeCookie,
  cookieOptionsFor,
  SESSION_TTL_MS,
} = require("../../lib/auth");

const REQUEST_TIMEOUT_MS = 8000;

const githubJson = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { status: res.status, data };
};

const redirect = (res, location, cookies) => {
  if (cookies) res.setHeader("Set-Cookie", cookies);
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(302, { Location: location });
  res.end();
};

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const config = getConfig();
  const cookieOpts = cookieOptionsFor(req);
  const clearState = serializeCookie("oauth_state", "", { ...cookieOpts, maxAge: 0 });
  const { code, state, error } = req.query || {};

  if (!config.isConfigured) return redirect(res, "/admin/?error=unconfigured");
  if (error) return redirect(res, "/admin/?error=oauth_denied", clearState);
  if (typeof code !== "string" || typeof state !== "string" || !code || !state) {
    return redirect(res, "/admin/?error=missing_code_or_state", clearState);
  }

  // CSRF: the state we issued must come back both in the URL and in our own cookie, signed and unexpired.
  const cookieState = parseCookies(req.headers ? req.headers.cookie : "").oauth_state;
  if (!cookieState || cookieState !== state || !verifyOAuthState(state, config.sessionSecret)) {
    return redirect(res, "/admin/?error=invalid_csrf_state", clearState);
  }

  try {
    const tokenRes = await githubJson("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "rajasekar-work-admin",
      },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
    });
    const accessToken = tokenRes.data && tokenRes.data.access_token;
    if (!accessToken) return redirect(res, "/admin/?error=token_exchange_failed", clearState);

    const userRes = await githubJson("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "rajasekar-work-admin",
      },
    });
    const user = userRes.data;
    if (!user || typeof user.login !== "string") return redirect(res, "/admin/?error=user_fetch_failed", clearState);

    const isAdmin =
      user.login.toLowerCase() === config.adminUsername &&
      (!config.adminId || String(user.id) === config.adminId);
    if (!isAdmin) return redirect(res, "/admin/?error=forbidden", clearState);

    const sessionToken = createSessionToken(user, config.sessionSecret);
    const sessionCookie = serializeCookie("admin_session", sessionToken, {
      ...cookieOpts,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      sameSite: "Lax",
    });
    return redirect(res, "/admin/", [sessionCookie, clearState]);
  } catch {
    return redirect(res, "/admin/?error=auth_failed", clearState);
  }
};
