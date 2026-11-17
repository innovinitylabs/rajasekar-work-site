"use strict";

const { adminEndpoint, sendJson } = require("../lib/http");
const { defaultStore: store } = require("../lib/store");

/** GET /api/export  full consistent snapshot (master + profiles + applications) as a JSON download. */
module.exports = adminEndpoint(["GET"], async ({ res }) => {
  const snapshot = await store.exportAll();
  const stamp = snapshot.exportedAt.replace(/[-:T]/g, "").slice(0, 12);
  res.setHeader("Content-Disposition", `attachment; filename="rajasekar-resume-backup-${stamp}.json"`);
  return sendJson(res, 200, snapshot);
});
