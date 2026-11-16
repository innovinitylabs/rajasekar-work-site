"use strict";

const https = require("https");
const {
  getConfig,
  verifyOAuthState,
  createSessionToken,
  parseCookies,
  serializeCookie,
} = require("../../lib/auth");

const fetchJson = (url, options = {}, postData = null) => {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });

    req.on("error", reject);
    if (postData) {
      req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
    }
    req.end();
  });
};

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const config = getConfig();
  const { code, state, error, error_description } = req.query || {};

  if (error) {
    return res.status(400).send(`OAuth Error: ${error_description || error}`);
  }

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state parameter" });
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieState = cookies.oauth_state;

  if (!cookieState || cookieState !== state || !verifyOAuthState(state, config.sessionSecret)) {
    return res.status(403).json({ error: "Invalid or expired OAuth state parameter (CSRF protection)" });
  }

  try {
    // 1. Exchange code for access token
    const tokenPayload = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    };

    const tokenRes = await fetchJson(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "rajasekar-work-admin",
        },
      },
      tokenPayload
    );

    const accessToken = tokenRes.data && tokenRes.data.access_token;
    if (!accessToken) {
      return res.status(401).json({
        error: "Failed to exchange token with GitHub",
        details: tokenRes.data,
      });
    }

    // 2. Fetch authenticated user profile
    const userRes = await fetchJson("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "rajasekar-work-admin",
      },
    });

    const user = userRes.data;
    if (!user || !user.login) {
      return res.status(401).json({ error: "Unable to retrieve GitHub user profile" });
    }

    // 3. Strict Admin Access Control
    if (user.login.toLowerCase() !== config.adminUsername) {
      return res.status(403).send(
        `Access Forbidden: Account "${user.login}" is not authorized. Access is strictly restricted to administrator "${config.adminUsername}".`
      );
    }

    // 4. Issue Session Cookie
    const sessionToken = createSessionToken(user, config.sessionSecret);
    const sessionCookie = serializeCookie("admin_session", sessionToken, {
      maxAge: 7 * 24 * 60 * 60, // 7 days
      httpOnly: true,
      sameSite: "Lax",
    });

    // Clear state cookie
    const clearStateCookie = serializeCookie("oauth_state", "", {
      maxAge: 0,
      httpOnly: true,
      sameSite: "Lax",
    });

    res.setHeader("Set-Cookie", [sessionCookie, clearStateCookie]);
    res.writeHead(302, { Location: "/admin/" });
    res.end();
  } catch (err) {
    return res.status(500).json({ error: "Internal server error during authentication", message: err.message });
  }
};
