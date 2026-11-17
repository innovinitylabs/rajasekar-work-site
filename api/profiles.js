"use strict";

const {
  getMasterResume,
  getProfiles,
  saveProfiles,
  getApplications,
  saveApplications,
} = require("../lib/resume-system");
const { validateAdminSession } = require("../lib/auth");

module.exports = async function handler(req, res) {
  const method = req.method;

  // Strict independent server-side session authorization check
  const auth = validateAdminSession(req.headers ? req.headers.cookie : "");

  if (auth.status !== 200) {
    res.setHeader("Content-Type", "application/json");
    return res.status(auth.status).json({
      error: auth.error,
      authenticated: false,
      status: auth.status,
    });
  }

  if (method === "GET") {
    const master = getMasterResume();
    const profiles = getProfiles();
    const applications = getApplications();

    return res.status(200).json({
      master,
      profiles,
      applications,
      adminUsername: auth.config.adminUsername,
      user: auth.session.user,
    });
  }

  if (method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

      if (body.profiles && Array.isArray(body.profiles)) {
        saveProfiles(body.profiles);
      }

      if (body.applications && Array.isArray(body.applications)) {
        saveApplications(body.applications);
      }

      return res.status(200).json({
        ok: true,
        profiles: getProfiles(),
        applications: getApplications(),
      });
    } catch (err) {
      return res.status(400).json({ error: "Failed to save data", message: err.message });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
};
