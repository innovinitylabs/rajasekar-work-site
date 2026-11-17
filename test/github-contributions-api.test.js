const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/github-contributions");

const mkRes = () => {
  const r = { headers: {}, code: 200, body: null };
  r.setHeader = (k, v) => (r.headers[k] = v);
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const run = async (query = {}) => {
  const res = mkRes();
  await handler({ query }, res);
  return res;
};

const realDeps = { ...handler.deps };
const reset = () => {
  Object.assign(handler.deps, realDeps);
  handler.clearCache();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_GRAPHQL_TOKEN;
};
const fixedNow = (iso) => (handler.deps.now = () => new Date(`${iso}T10:00:00Z`));

const graphqlCalendar = (days) => ({
  contributionCalendar: { weeks: [{ contributionDays: days.map(([date, n]) => ({ date, contributionCount: n, contributionLevel: n ? "FIRST_QUARTILE" : "NONE" })) }] },
});

test("with a token: one GraphQL alias per calendar year, 2025-01-01 through today", async () => {
  reset();
  process.env.GITHUB_TOKEN = "test-token";
  fixedNow("2026-11-17");
  let sent;
  handler.deps.fetchHttps = async (url, opts, body) => {
    sent = JSON.parse(body);
    return {
      statusCode: 200,
      body: JSON.stringify({ data: { user: {
        y2025: graphqlCalendar([["2024-12-31", 9], ["2025-01-01", 2], ["2025-12-31", 3]]),
        y2026: graphqlCalendar([["2026-01-01", 1], ["2026-11-17", 5], ["2026-11-18", 7]]),
      } } }),
    };
  };
  const res = await run();
  assert.match(sent.query, /y2025: contributionsCollection\(from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z"\)/);
  assert.match(sent.query, /y2026: contributionsCollection\(from: "2026-01-01T00:00:00Z", to: "2026-11-17T23:59:59Z"\)/);
  assert.equal(res.body.source, "github-graphql");
  assert.equal(res.body.from, "2025-01-01");
  assert.equal(res.body.to, "2026-11-17");
  const dates = res.body.days.map((d) => d.date);
  assert.deepEqual(dates, ["2025-01-01", "2025-12-31", "2026-01-01", "2026-11-17"], "2024 and future days are excluded");
  assert.deepEqual(res.body.years, { 2025: 5, 2026: 6 });
  assert.equal(res.body.totalContributions, 11);
  reset();
});

test("the end date follows the real clock (no hard-coded future end)", async () => {
  reset();
  fixedNow("2027-02-03");
  const urls = [];
  handler.deps.fetchHttps = async (url) => {
    urls.push(url);
    const y = /y=(\d{4})/.exec(url)[1];
    return { statusCode: 200, body: JSON.stringify({ contributions: [{ date: `${y}-01-15`, count: 1, level: 1 }, { date: `${y}-12-31`, count: 1, level: 1 }] }) };
  };
  const res = await run();
  assert.equal(res.body.to, "2027-02-03");
  assert.equal(urls.length, 3, "2025, 2026 and 2027 are requested");
  assert.ok(res.body.days.every((d) => d.date <= "2027-02-03"));
  assert.ok(!res.body.days.some((d) => d.date === "2027-12-31"));
  reset();
});

test("without a token the public fallback is used and still spans 2025-2026", async () => {
  reset();
  fixedNow("2026-11-17");
  handler.deps.fetchHttps = async (url) => {
    const y = /y=(\d{4})/.exec(url)[1];
    return { statusCode: 200, body: JSON.stringify({ contributions: [{ date: `${y}-03-01`, count: 2, level: 1 }] }) };
  };
  const res = await run();
  assert.equal(res.body.source, "public-sync");
  assert.deepEqual(res.body.days.map((d) => d.date), ["2025-03-01", "2026-03-01"]);
  reset();
});

test("token failure falls back to the public source", async () => {
  reset();
  process.env.GITHUB_TOKEN = "bad";
  fixedNow("2026-11-17");
  handler.deps.fetchHttps = async (url) => {
    if (url.includes("api.github.com")) return { statusCode: 401, body: JSON.stringify({ message: "Bad credentials" }) };
    return { statusCode: 200, body: JSON.stringify({ contributions: [{ date: "2026-01-02", count: 1, level: 1 }] }) };
  };
  assert.equal((await run()).body.source, "public-sync");
  reset();
});

test("all sources failing returns an honest empty placeholder, never invented counts", async () => {
  reset();
  fixedNow("2026-11-17");
  handler.deps.fetchHttps = async () => { throw new Error("offline"); };
  const res = await run();
  assert.equal(res.code, 200);
  assert.equal(res.body.source, "offline-placeholder");
  assert.deepEqual(res.body.days, []);
  assert.equal(res.body.totalContributions, 0);
  reset();
});

test("cache is per username and per day; invalid usernames are replaced", async () => {
  reset();
  fixedNow("2026-11-17");
  let calls = 0;
  handler.deps.fetchHttps = async (url) => {
    calls++;
    return { statusCode: 200, body: JSON.stringify({ contributions: [{ date: "2026-01-02", count: 1, level: 1 }] }) };
  };
  await run({ username: "alice" });
  const afterFirst = calls;
  await run({ username: "alice" });
  assert.equal(calls, afterFirst, "second identical request is served from cache");
  await run({ username: "bob" });
  assert.ok(calls > afterFirst, "a different user is not served alice's data");
  const bad = await run({ username: "x/../../y?z" });
  assert.equal(bad.body.username, "innovinitylabs");
  reset();
});
