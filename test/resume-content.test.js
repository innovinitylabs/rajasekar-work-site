const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "resume-data.json"), "utf8"));
const byOrg = (org) => data.experience.find((r) => r.org === org);

test("master keeps the Data Engineer positioning", () => {
  assert.equal(data.title, "Data Engineer");
  assert.match(data.summary, /Production Data Engineer/);
  assert.match(data.summary, /5\+ years/);
  assert.match(data.summary, /50M records per day/);
  assert.equal(data.education.length, 1);
});

test("Digit Insurance: dates, ownership of BOTH Vahan and Health, and every verified achievement retained", () => {
  const digit = byOrg("Digit Insurance");
  assert.equal(digit.role, "Data Engineer");
  assert.equal(digit.period, "Nov 2023 - Jun 2025");
  const text = digit.bullets.join("\n");

  const ownership = digit.bullets.find((b) => /Vahan/.test(b) && /Health/.test(b));
  assert.ok(ownership, "a bullet must state ownership of the Vahan and Health domains");
  assert.match(ownership, /^Owned the Vahan and Health business domains/);
  // Health must not be diminished or qualified.
  assert.ok(!/recent|shortly|before leaving|partial|handed|assigned|temporar|transition/i.test(ownership));
  assert.ok(!/Health/.test(digit.bullets.filter((b) => b !== ownership).join("\n")),
    "no invented Health-specific achievements");

  [
    /50M records per day/,
    /Flask and Pandas automation tool .* 30 minutes to under 1 minute.*Tech Titan Award/,
    /4000\+ production data issues/,
    /approximately 600 to under 70/,
    /PostgreSQL schema design and Git-versioned DDL/,
    /PII classification and secure credential handling/,
    /MoEngage/,
    /Bima Satrak/,
  ].forEach((re) => assert.match(text, re));
});

test("Appzwork: period and all four verified bullets preserved verbatim", () => {
  const a = byOrg("Appzwork");
  assert.equal(a.role, "Software Engineer");
  assert.equal(a.period, "Jan 2020 - Nov 2023");
  assert.deepEqual(a.bullets, [
    "Built and maintained Oracle SQL and PL/SQL solutions, stored procedures, and production reports for banking and insurance data systems",
    "Owned production support and database incident response, diagnosed root causes, and deployed fixes across client environments",
    "Optimized SQL queries and stored procedures to improve database performance under high-usage production workloads",
    "Managed production database deployments, maintenance, and recovery across client environments",
  ]);
});

test("Independent Software Developer entry is continuous from Jun 2025 and makes no unverifiable claims", () => {
  const ind = byOrg("Independent");
  assert.equal(ind.role, "Independent Software Developer");
  assert.equal(ind.period, "Jun 2025 - Present");
  assert.ok(ind.bullets.length >= 1);
  const text = ind.bullets.join(" ");
  assert.ok(!/\d+\s*(users|customers|%|revenue)|revenue|downloads/i.test(text), "no invented adoption/revenue metrics");
});

test("all eight projects exist in the master project database with required fields", () => {
  const titles = data.projects.map((p) => p.title);
  ["Madras Checks", "OnchainRugs", "Anekaroopam", "Uravu", "Hard COpy", "Rotate the Cow", "Pocket Astro", "Valipokkann"].forEach(
    (t) => assert.ok(titles.includes(t), `missing project: ${t}`)
  );
  assert.equal(data.projects.length, 8);
  const statuses = ["Deployed", "In development", "Prototype", "Experimental", "Needs review"];
  for (const p of data.projects) {
    assert.ok(statuses.includes(p.status), `${p.title}: status`);
    assert.ok(p.id && p.description && p.role && p.technologies.length > 0, `${p.title}: required fields`);
  }
  const pocket = data.projects.find((p) => p.title === "Pocket Astro");
  assert.match(pocket.description, /SwiftUI/);
});

test("Databricks, Apache Spark and PySpark appear only under 'Currently Learning'", () => {
  const learning = data.skills.find((g) => g.group === "Currently Learning");
  assert.deepEqual(learning.items, ["Databricks", "Apache Spark", "PySpark"]);
  for (const g of data.skills.filter((x) => x.group !== "Currently Learning")) {
    ["Databricks", "Apache Spark", "PySpark", "Spark"].forEach((t) => assert.ok(!g.items.includes(t), `${t} leaked into ${g.group}`));
  }
  // and never claimed as experience at Digit or Appzwork
  const exp = JSON.stringify(data.experience);
  assert.ok(!/Databricks|Spark/i.test(exp));
});

test("required skills are present, grouped meaningfully", () => {
  const groups = data.skills.map((g) => g.group);
  [
    "Programming Languages", "Data Engineering", "Databases", "Backend Development",
    "Cloud and Data Platforms", "DevOps and Developer Tools", "Currently Learning",
  ].forEach((g) => assert.ok(groups.includes(g), `missing group ${g}`));

  const all = data.skills.flatMap((g) => g.items);
  [
    "SQL", "PL/SQL", "Python", "PostgreSQL", "Oracle", "DB2", "Pandas", "ETL", "ELT", "Data Pipelines",
    "Data Ingestion", "Data Warehousing", "Data Modelling", "Query Optimization", "Flask", "REST APIs",
    "Docker", "Git", "Linux", "Databricks", "Apache Spark", "PySpark",
    "Cursor", "Claude", "ChatGPT", "GitHub Copilot",
    // previously verified, must not be silently dropped
    "Shell", "Redis", "ClickHouse", "GPT Codex", "GitHub Workflows", "Selenium", "MoEngage", "Stored Procedures", "Database Design", "Batch Processing",
  ].forEach((s) => assert.ok(all.includes(s), `missing skill ${s}`));
});

test("website proof points come from resume-data.json", () => {
  assert.equal(data.proof.length, 3);
  for (const proof of data.proof) {
    assert.ok(proof.value && proof.text);
  }
});

test("master data has unique stable ids", () => {
  for (const key of ["experience", "projects", "skills", "education"]) {
    const ids = data[key].map((x) => x.id);
    assert.ok(ids.every(Boolean), `${key} ids present`);
    assert.equal(new Set(ids).size, ids.length, `${key} ids unique`);
  }
});
