"use strict";

const {
  getMasterResume,
  getProfiles,
  saveProfiles,
  getApplications,
  saveApplications,
  resolveProfile,
} = require("../lib/resume-system");
const { getConfig, parseCookies, verifySessionToken } = require("../lib/auth");

module.exports = async function handler(req, res) {
  const method = req.method;
  const config = getConfig();

  // Authentication check helper
  const isAuthenticated = () => {
    // If not configured, allow local dev access
    if (!config.isConfigured) return true;
    const cookies = parseCookies(req.headers.cookie);
    const user = verifySessionToken(cookies.admin_session, config.sessionSecret);
    return Boolean(user && user.user.toLowerCase() === config.adminUsername);
  };

  if (method === "GET") {
    const master = getMasterResume();
    const profiles = getProfiles();
    const applications = getApplications();

    return res.status(200).json({
      master,
      profiles,
      applications,
      adminUsername: config.adminUsername,
    });
  }

  if (method === "POST") {
    if (!isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized: Administrator login required" });
    }

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
