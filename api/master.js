"use strict";

const { adminEndpoint, sendJson, triggerRebuild } = require("../lib/http");
const { defaultStore: store } = require("../lib/store");

/**
 * GET /api/master   raw master document + normalised view + version
 * PUT /api/master   { version, data } replace the master resume (optimistic lock)
 */
module.exports = adminEndpoint(["GET", "PUT"], async ({ res, session, body, req }) => {
  if (req.method === "GET") {
    const m = await store.getMaster();
    return sendJson(res, 200, { version: m.version, updatedAt: m.updatedAt, data: m.doc, master: m.master });
  }
  const m = await store.updateMaster(
    Number.isInteger(body.version) ? body.version : undefined,
    body.data,
    session.user
  );
  const rebuild = await triggerRebuild();
  return sendJson(res, 200, {
    ok: true,
    version: m.version,
    updatedAt: m.updatedAt,
    data: m.doc,
    master: m.master,
    rebuild,
  });
});
