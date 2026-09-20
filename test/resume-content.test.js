const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const data = JSON.parse(
  fs.readFileSync(path.join(ROOT, "resume-data.json"), "utf8")
);

test("resume content follows the focused Data Engineer profile", () => {
  assert.equal(data.title, "Data Engineer");
  assert.match(data.summary, /Production Data Engineer/);
  assert.match(data.summary, /5\+ years/);
  assert.match(data.summary, /50M records per day/);

  const digit = data.experience.find((role) => role.org === "Digit Insurance");
  const appzwork = data.experience.find((role) => role.org === "Appzwork");

  assert.equal(digit.bullets.length, 6);
  assert.ok(appzwork.bullets.length >= 3 && appzwork.bullets.length <= 4);
  assert.ok(!data.awards || data.awards.length === 0);
  assert.equal(data.education.length, 1);
});

test("all required ATS keywords are supported in source data", () => {
  const sourceText = JSON.stringify(data);
  const required = [
    "Data Engineer",
    "ETL",
    "ELT",
    "Data Pipelines",
    "Data Ingestion",
    "Data Modelling",
    "Data Warehousing",
    "Batch Processing",
    "Python",
    "SQL",
    "PL/SQL",
    "PostgreSQL",
    "Oracle",
    "DB2",
    "Redis",
    "Pandas",
    "PySpark",
    "Databricks",
    "ClickHouse",
    "Flask",
    "REST APIs",
    "Stored Procedures",
    "Database Design",
    "Docker",
    "Git",
    "Linux",
  ];

  required.forEach((keyword) => {
    assert.ok(sourceText.includes(keyword), `Missing ATS keyword: ${keyword}`);
  });
});

test("website proof points come from resume-data.json", () => {
  assert.ok(Array.isArray(data.proof));
  assert.equal(data.proof.length, 3);

  for (const proof of data.proof) {
    assert.ok(proof.value);
    assert.ok(proof.text);
  }
});
