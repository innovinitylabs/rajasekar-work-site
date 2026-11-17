"use strict";

const { createSessionToken } = require("../lib/auth");

const SECRET = "unit-test-session-secret-0123456789-abcdef";

const createMockReqRes = ({ method = "GET", headers = {}, body = null, query = {} } = {}) => {
  let statusCode = 200;
  let responseData = null;
  const sent = {};
  const req = { method, headers: { host: "localhost:3000", ...headers }, body, query };
  const res = {
    setHeader(name, val) {
      sent[name.toLowerCase()] = val;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
    send(data) {
      responseData = data;
      return this;
    },
    writeHead(code, h = {}) {
      statusCode = code;
      for (const [k, v] of Object.entries(h)) sent[k.toLowerCase()] = v;
      return this;
    },
    end() {
      return this;
    },
    get statusCode() {
      return statusCode;
    },
    get data() {
      return responseData;
    },
    get headers() {
      return sent;
    },
  };
  return { req, res };
};

const cookieFor = (login, { id = 1, durationMs } = {}) =>
  `admin_session=${encodeURIComponent(createSessionToken({ login, id }, SECRET, durationMs))}`;

/** JSON write request carrying a valid admin session. */
const adminRequest = (method, { body, query, cookie = cookieFor("innovinitylabs"), origin } = {}) =>
  createMockReqRes({
    method,
    headers: {
      cookie,
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
    query: query || {},
  });

const call = async (handler, req, res) => {
  await handler(req, res);
  return { status: res.statusCode, body: res.data, headers: res.headers };
};

module.exports = { SECRET, createMockReqRes, cookieFor, adminRequest, call };
