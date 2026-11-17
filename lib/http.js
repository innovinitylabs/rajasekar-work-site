"use strict";

const { validateAdminSession } = require("./auth");
const { StoreError } = require("./db");

const MAX_BODY_BYTES = 1_000_000;

const sendJson = (res, status, body) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
};

/**
 * CSRF defence for state-changing requests on top of SameSite=Lax cookies:
 * JSON content type (cross-site forms cannot send it) and, when the browser
 * supplies an Origin header, it must match this host.
 */
const checkCsrf = (req) => {
  const type = String((req.headers && req.headers["content-type"]) || "");
  if (!/^application\/json\b/i.test(type)) {
    return "Content-Type must be application/json";
  }
  const origin = req.headers && req.headers.origin;
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return "Invalid Origin header";
    }
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    if (originHost !== host) return "Cross-origin request rejected";
  }
  return null;
};

const parseBody = (req) => {
  let body = req.body;
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new StoreError("PAYLOAD_TOO_LARGE", 413, "Request body is too large.");
    }
    try {
      body = JSON.parse(body);
    } catch {
      throw new StoreError("VALIDATION", 400, "Request body is not valid JSON.");
    }
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new StoreError("VALIDATION", 400, "Request body must be a JSON object.");
  }
  return body;
};

const sendError = (res, err) => {
  if (err instanceof StoreError) {
    const body = { error: err.message, code: err.code };
    if (err.details !== undefined) body.details = err.details;
    return sendJson(res, err.status, body);
  }
  console.error("Unhandled API error:", err && err.stack ? err.stack : err);
  return sendJson(res, 500, { error: "Internal server error.", code: "INTERNAL" });
};

/**
 * Wraps an admin-only endpoint: method allow-list, authentication,
 * authorisation, CSRF checks, JSON body parsing and error mapping.
 * `fn(ctx)` receives { req, res, session, body, query }.
 */
const adminEndpoint = (allowedMethods, fn) => async (req, res) => {
  try {
    const method = req.method;
    if (!allowedMethods.includes(method)) {
      res.setHeader("Allow", allowedMethods.join(", "));
      return sendJson(res, 405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
    }

    const auth = await validateAdminSession(req.headers ? req.headers.cookie : "");
    if (auth.status !== 200) {
      return sendJson(res, auth.status, {
        error: auth.error,
        code: auth.status === 503 ? "AUTH_UNAVAILABLE" : auth.status === 403 ? "FORBIDDEN" : "UNAUTHENTICATED",
        authenticated: false,
        status: auth.status,
      });
    }

    let body = null;
    if (method !== "GET" && method !== "HEAD") {
      const csrf = checkCsrf(req);
      if (csrf) return sendJson(res, 403, { error: csrf, code: "CSRF" });
      if (method !== "DELETE") body = parseBody(req);
    }

    return await fn({ req, res, session: auth.session, body, query: req.query || {} });
  } catch (err) {
    return sendError(res, err);
  }
};

/** Optional: ask Vercel to rebuild the static public site after master/default-profile changes. */
const triggerRebuild = async () => {
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hook) return { triggered: false, reason: "VERCEL_DEPLOY_HOOK_URL not set" };
  try {
    const res = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(5000) });
    return { triggered: res.ok, reason: res.ok ? "" : `deploy hook returned ${res.status}` };
  } catch {
    return { triggered: false, reason: "deploy hook unreachable" };
  }
};

module.exports = { sendJson, sendError, adminEndpoint, checkCsrf, parseBody, triggerRebuild };
