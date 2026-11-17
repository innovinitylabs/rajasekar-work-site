"use strict";

const { adminEndpoint, sendJson } = require("../lib/http");
const { defaultStore: store } = require("../lib/store");
const { StoreError } = require("../lib/db");

/**
 * GET    /api/applications
 * POST   /api/applications            create
 * PUT    /api/applications            update (body.id + body.version required)
 * DELETE /api/applications?id=&version=
 */
module.exports = adminEndpoint(["GET", "POST", "PUT", "DELETE"], async ({ res, body, query, req }) => {
  if (req.method === "GET") {
    return sendJson(res, 200, { applications: await store.listApplications() });
  }
  if (req.method === "POST") {
    const application = await store.createApplication(body);
    return sendJson(res, 201, { ok: true, application });
  }
  if (req.method === "PUT") {
    if (typeof body.id !== "string") {
      throw new StoreError("VALIDATION", 400, "Application id is required.", [{ field: "id", message: "is required" }]);
    }
    const application = await store.updateApplication(
      body.id,
      Number.isInteger(body.version) ? body.version : undefined,
      body
    );
    return sendJson(res, 200, { ok: true, application });
  }
  const version = Number.parseInt(query.version, 10);
  const result = await store.deleteApplication(String(query.id || ""), Number.isNaN(version) ? undefined : version);
  return sendJson(res, 200, { ok: true, ...result });
});
