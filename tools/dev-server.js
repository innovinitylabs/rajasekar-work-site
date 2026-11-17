#!/usr/bin/env node
"use strict";

/**
 * Minimal local server: serves the static site and mounts api/*.js with the
 * same (req, res) shape Vercel uses. It adds NO authentication shortcuts:
 * protected endpoints still require a valid signed session cookie.
 *
 *   DATABASE_URL=... SESSION_SECRET=... GITHUB_CLIENT_ID=... npm run dev
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
const BLOCKED = /^\/(test|schema|tools|node_modules|lib|db|\.git)(\/|$)/;

const decorate = (res) => {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = (data) => { res.end(typeof data === "string" ? data : JSON.stringify(data)); return res; };
  return res;
};

const readBody = (req) => new Promise((resolve) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

http.createServer(async (req, res) => {
  decorate(res);
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    const file = path.join(ROOT, `${pathname}.js`);
    if (!file.startsWith(path.join(ROOT, "api")) || !fs.existsSync(file)) {
      return res.status(404).json({ error: "Not found" });
    }
    req.query = Object.fromEntries(url.searchParams);
    const raw = await readBody(req);
    req.body = raw || null;
    try {
      return await require(file)(req, res);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (pathname === "/admin" || pathname === "/admin/") pathname = "/admin/index.html";
  if (pathname === "/") pathname = "/index.html";
  if (BLOCKED.test(pathname)) return res.status(404).end("Not found");
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return res.status(404).end("Not found");
  }
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  res.end(fs.readFileSync(file));
}).listen(PORT, "127.0.0.1", () => console.log(`Dev server on http://127.0.0.1:${PORT}`));
