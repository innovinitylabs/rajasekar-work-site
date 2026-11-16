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
    res.writeHead(302, {
      Location: `/admin/?error=${encodeURIComponent(error_description || error)}`,
    });
    return res.end();
  }

  if (!code || !state) {
    res.writeHead(302, {
      Location: "/admin/?error=missing_code_or_state",
    });
    return res.end();
  }

  const cookies = parseCookies(req.headers ? req.headers.cookie : "");
  const cookieState = cookies.oauth_state;

  if (!cookieState || cookieState !== state || !verifyOAuthState(state, config.sessionSecret)) {
    res.writeHead(302, {
      Location: "/admin/?error=invalid_csrf_state",
    });
    return res.end();
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
      res.writeHead(302, {
        Location: "/admin/?error=token_exchange_failed",
      });
      return res.end();
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
      res.writeHead(302, {
        Location: "/admin/?error=user_fetch_failed",
      });
      return res.end();
    }

    // 3. Strict Admin Access Control
    if (user.login.toLowerCase() !== config.adminUsername.toLowerCase()) {
      res.writeHead(302, {
        Location: `/admin/?error=forbidden&user=${encodeURIComponent(user.login)}`,
      });
      return res.end();
    }

    // 4. Issue Session Cookie for verified administrator
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
    res.writeHead(302, {
      Location: `/admin/?error=${encodeURIComponent(err.message)}`,
    });
    res.end();
  }
};
