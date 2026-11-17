"use strict";

const https = require("https");

// In-memory cache for serverless container lifecycle
let cache = {
  timestamp: 0,
  data: null,
};
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const fetchHttps = (url, options = {}, postData = null) => {
  return new Promise((resolve, reject) => {
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
};

/**
 * Normalizes contribution level to 0-4 scale.
 */
const levelMap = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

  const username = (req.query && req.query.username) || "innovinitylabs";

  // Check in-memory cache
  if (cache.data && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return res.status(200).json(cache.data);
  }

  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_GRAPHQL_TOKEN || "";

  // 1. If GitHub Token is available, use official GraphQL API
  if (token) {
    try {
      const query = `
        query($login: String!) {
          user(login: $login) {
            contributionsCollection {
              contributionCalendar {
                totalContributions
                weeks {
                  contributionDays {
                    contributionCount
                    date
                    weekday
                    contributionLevel
                  }
                }
              }
            }
          }
        }
      `;

      const response = await fetchHttps(
        "https://api.github.com/graphql",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "rajasekar-work-contributions",
            "Content-Type": "application/json",
          },
        },
        JSON.stringify({ query, variables: { login: username } })
      );

      const parsed = JSON.parse(response.body);
      const calendar =
        parsed.data &&
        parsed.data.user &&
        parsed.data.user.contributionsCollection &&
        parsed.data.user.contributionsCollection.contributionCalendar;

      if (calendar) {
        const weeks = calendar.weeks.map((week) => ({
          contributionDays: week.contributionDays.map((day) => ({
            date: day.date,
            count: day.contributionCount,
            level: levelMap[day.contributionLevel] ?? (day.contributionCount > 0 ? 1 : 0),
            weekday: day.weekday,
          })),
        }));

        const result = {
          username,
          source: "github-graphql",
          totalContributions: calendar.totalContributions,
          weeks,
        };

        cache = { timestamp: Date.now(), data: result };
        return res.status(200).json(result);
      }
    } catch {
      // Fall through to fallback
    }
  }

  // 2. Fallback: Query public contribution data proxy or return clean graceful structure
  try {
    const fallbackRes = await fetchHttps(
      `https://github-contributions-api.jogruber.de/v4/${username}?y=last`,
      {
        headers: { "User-Agent": "rajasekar-work-contributions" },
      }
    );

    if (fallbackRes.statusCode === 200) {
      const parsed = JSON.parse(fallbackRes.body);
      if (parsed.contributions && Array.isArray(parsed.contributions)) {
        // Group into 7-day weeks
        const weeks = [];
        let currentWeek = [];

        parsed.contributions.forEach((day, index) => {
          const dateObj = new Date(day.date);
          const weekday = dateObj.getDay();

          currentWeek.push({
            date: day.date,
            count: day.count,
            level: day.level,
            weekday,
          });

          if (currentWeek.length === 7 || index === parsed.contributions.length - 1) {
            weeks.push({ contributionDays: currentWeek });
            currentWeek = [];
          }
        });

        const total = typeof parsed.total === "object" ? parsed.total.lastYear || 0 : parsed.total || 0;

        const result = {
          username,
          source: "public-sync",
          totalContributions: total,
          weeks,
        };

        cache = { timestamp: Date.now(), data: result };
        return res.status(200).json(result);
      }
    }
  } catch {
    // Fallback failure
  }

  // 3. Graceful offline fallback: Do not fabricate false counts
  return res.status(200).json({
    username,
    source: "offline-placeholder",
    totalContributions: 0,
    weeks: [],
    message: "GitHub contribution data is temporarily syncing or unavailable without network/token.",
  });
};
