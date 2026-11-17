"use strict";

const https = require("https");

const FIRST_DATE = "2025-01-01";
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // key: `${username}|${today}`

const fetchHttps = (url, options = {}, postData = null) =>
  new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    if (postData) req.write(postData);
    req.end();
  });

// Tests replace deps.fetchHttps / deps.now so no network or real clock is needed.
const deps = { fetchHttps, now: () => new Date() };

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const isoDay = (d) => d.toISOString().slice(0, 10);

/** Merge per-year results into one sorted, de-duplicated list limited to [from, to]. */
const mergeDays = (lists, from, to) => {
  const byDate = new Map();
  for (const day of lists.flat()) {
    if (day.date >= from && day.date <= to) byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
};

/** GitHub's contributionsCollection spans at most one year, so query one calendar year at a time. */
const fromGraphql = async (username, token, from, to) => {
  const years = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  const fields = `contributionCalendar { weeks { contributionDays { contributionCount date contributionLevel } } }`;
  const aliases = years
    .map((y) => {
      const yFrom = `${y}-01-01T00:00:00Z`;
      const yTo = y === Number(to.slice(0, 4)) ? `${to}T23:59:59Z` : `${y}-12-31T23:59:59Z`;
      return `y${y}: contributionsCollection(from: "${yFrom}", to: "${yTo}") { ${fields} }`;
    })
    .join("\n");
  const query = `query($login: String!) { user(login: $login) { ${aliases} } }`;
  const res = await deps.fetchHttps(
    "https://api.github.com/graphql",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "rajasekar-work-contributions", "Content-Type": "application/json" },
    },
    JSON.stringify({ query, variables: { login: username } })
  );
  const user = JSON.parse(res.body).data && JSON.parse(res.body).data.user;
  if (!user) return null;
  const lists = years.map((y) =>
    ((user[`y${y}`] && user[`y${y}`].contributionCalendar.weeks) || []).flatMap((w) =>
      w.contributionDays.map((d) => ({
        date: d.date,
        count: d.contributionCount,
        level: LEVELS[d.contributionLevel] ?? (d.contributionCount > 0 ? 1 : 0),
      }))
    )
  );
  return mergeDays(lists, from, to);
};

/** Public no-token fallback, one request per year. */
const fromPublicProxy = async (username, from, to) => {
  const years = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  const lists = await Promise.all(
    years.map(async (y) => {
      const res = await deps.fetchHttps(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}?y=${y}`, {
        headers: { "User-Agent": "rajasekar-work-contributions" },
      });
      if (res.statusCode !== 200) throw new Error(`proxy ${res.statusCode}`);
      const parsed = JSON.parse(res.body);
      if (!Array.isArray(parsed.contributions)) throw new Error("proxy shape");
      return parsed.contributions.map((d) => ({ date: d.date, count: d.count, level: d.level }));
    })
  );
  return mergeDays(lists, from, to);
};

const summarise = (username, source, from, to, days) => {
  const years = {};
  for (const d of days) years[d.date.slice(0, 4)] = (years[d.date.slice(0, 4)] || 0) + d.count;
  return {
    username,
    source,
    from,
    to,
    totalContributions: days.reduce((n, d) => n + d.count, 0),
    years,
    days,
  };
};

async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

  const raw = (req.query && req.query.username) || "innovinitylabs";
  const username = /^[A-Za-z0-9-]{1,39}$/.test(raw) ? raw : "innovinitylabs";
  const to = isoDay(deps.now()); // real current date, never a hard-coded end
  const from = FIRST_DATE;

  const key = `${username}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return res.status(200).json(hit.data);

  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_GRAPHQL_TOKEN || "";
  const attempts = [];
  if (token) attempts.push(["github-graphql", () => fromGraphql(username, token, from, to)]);
  attempts.push(["public-sync", () => fromPublicProxy(username, from, to)]);

  for (const [source, load] of attempts) {
    try {
      const days = await load();
      if (days && days.length > 0) {
        const data = summarise(username, source, from, to, days);
        cache.set(key, { at: Date.now(), data });
        return res.status(200).json(data);
      }
    } catch {
      /* try the next source */
    }
  }

  // Never fabricate counts when no source works.
  return res.status(200).json({
    username,
    source: "offline-placeholder",
    from,
    to,
    totalContributions: 0,
    years: {},
    days: [],
    message: "GitHub contribution data is temporarily unavailable.",
  });
}

module.exports = handler;
module.exports.deps = deps;
module.exports.mergeDays = mergeDays;
module.exports.fromGraphql = fromGraphql;
module.exports.fromPublicProxy = fromPublicProxy;
module.exports.clearCache = () => cache.clear();
