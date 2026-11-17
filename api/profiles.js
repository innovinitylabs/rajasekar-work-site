"use strict";

const { adminEndpoint, sendJson, triggerRebuild } = require("../lib/http");
const { defaultStore: store } = require("../lib/store");
const { StoreError } = require("../lib/db");

const versionOf = (body) => (Number.isInteger(body.version) ? body.version : undefined);

/**
 * GET    /api/profiles           bootstrap: master + profiles + applications + storage status
 * POST   /api/profiles           create a profile
 * PUT    /api/profiles           update a profile (body.id + body.version required)
 * DELETE /api/profiles?id=&version=
 *
 * Every write returns the row as stored in PostgreSQL (re-read inside the same
 * transaction), so a success response means the data is durably committed.
 */
module.exports = adminEndpoint(["GET", "POST", "PUT", "DELETE"], async ({ res, session, body, query, req }) => {
  if (req.method === "GET") {
    const [masterState, profiles, applications, storage] = await Promise.all([
      store.getMaster(),
      store.listProfiles(),
      store.listApplications(),
      store.status(),
    ]);
    return sendJson(res, 200, {
      master: masterState.master,
      masterVersion: masterState.version,
      masterUpdatedAt: masterState.updatedAt,
      profiles,
      applications,
      storage,
      adminUsername: session.user,
      user: { login: session.user, name: session.name, avatar: session.avatar },
    });
  }

  if (req.method === "POST") {
    const profile = await store.createProfile(body);
    const rebuild = profile.isDefault ? await triggerRebuild() : undefined;
    return sendJson(res, 201, { ok: true, profile, rebuild });
  }

  if (req.method === "PUT") {
    if (typeof body.id !== "string") {
      throw new StoreError("VALIDATION", 400, "Profile id is required.", [{ field: "id", message: "is required" }]);
    }
    const profile = await store.updateProfile(body.id, versionOf(body), body);
    const rebuild = profile.isDefault ? await triggerRebuild() : undefined;
    return sendJson(res, 200, { ok: true, profile, rebuild });
  }

  // DELETE
  const version = Number.parseInt(query.version, 10);
  const result = await store.deleteProfile(String(query.id || ""), Number.isNaN(version) ? undefined : version);
  return sendJson(res, 200, { ok: true, ...result });
});
