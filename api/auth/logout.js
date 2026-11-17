"use strict";

const { serializeCookie } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  const clearSessionCookie = serializeCookie("admin_session", "", {
    maxAge: 0,
    httpOnly: true,
    sameSite: "Lax",
  });

  const clearStateCookie = serializeCookie("oauth_state", "", {
    maxAge: 0,
    httpOnly: true,
    sameSite: "Lax",
  });

  res.setHeader("Set-Cookie", [clearSessionCookie, clearStateCookie]);

  if (req.headers.accept && req.headers.accept.includes("application/json")) {
    return res.status(200).json({ ok: true, message: "Logged out successfully" });
  }

  res.writeHead(302, { Location: "/admin/?logged_out=1" });
  res.end();
};
