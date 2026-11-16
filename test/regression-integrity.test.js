const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { jsPDF } = require("jspdf");

const { buildResumePdf } = require("../resume-pdf");
const { resolveProfile, getMasterResume } = require("../lib/resume-system");

const ROOT = path.join(__dirname, "..");
const RAW_PATH = path.join(ROOT, "resume-data.json");

// Baseline SHA256 captured at start of Phase 2
const EXPECTED_HASH =
  "e2bd8f26f6b562ab11a0bf91bbd0837455a95e838a74c93e88258a560ecb1441";

test("CRITICAL: resume-data.json SHA-256 hash is byte-for-byte identical", () => {
  const currentContent = fs.readFileSync(RAW_PATH, "utf8");
  const currentHash = crypto
    .createHash("sha256")
    .update(currentContent)
    .digest("hex");

  assert.equal(
    currentHash,
    EXPECTED_HASH,
    "CRITICAL VIOLATION: resume-data.json has been modified!"
  );
});

test("CRITICAL: Employment history, roles, and dates are strictly preserved", () => {
  const data = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
  assert.equal(data.experience.length, 2);

  const digit = data.experience.find((e) => e.org === "Digit Insurance");
  assert.ok(digit, "Digit Insurance entry missing");
  assert.equal(digit.role, "Data Engineer");
  assert.equal(digit.period, "Nov 2023 - Jun 2025");
  assert.equal(digit.bullets.length, 6);

  const appzwork = data.experience.find((e) => e.org === "Appzwork");
  assert.ok(appzwork, "Appzwork entry missing");
  assert.equal(appzwork.role, "Software Engineer");
  assert.equal(appzwork.period, "Jan 2020 - Nov 2023");
  assert.equal(appzwork.bullets.length, 4);
});

test("CRITICAL: Proof metrics and values are strictly preserved", () => {
  const data = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
  assert.equal(data.proof.length, 3);
  assert.equal(data.proof[0].value, "50M records/day");
  assert.equal(data.proof[1].value, "30 min to under 1 min");
  assert.equal(data.proof[2].value, "4000+ issues resolved");
});

test("CRITICAL: Technical skill groups and skill tokens are strictly preserved", () => {
  const data = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
  const expectedGroups = [
    "Languages",
    "Data Engineering",
    "Databases",
    "Backend",
    "Data Platforms",
    "DevOps",
    "Developer Tools",
    "Other",
  ];

  assert.equal(data.skills.length, expectedGroups.length);
  for (let i = 0; i < expectedGroups.length; i++) {
    assert.equal(data.skills[i].group, expectedGroups[i]);
  }

  const allSkills = data.skills.flatMap((s) => s.items);
  const requiredTokens = [
    "Python",
    "SQL",
    "PL/SQL",
    "Shell",
    "ETL",
    "ELT",
    "Pandas",
    "PySpark",
    "PostgreSQL",
    "Oracle",
    "DB2",
    "Redis",
    "Flask",
    "Databricks",
    "ClickHouse",
    "Docker",
    "Git",
    "Linux",
    "Cursor",
    "Claude",
    "GPT Codex",
    "GitHub Copilot",
    "Selenium",
    "MoEngage",
  ];

  requiredTokens.forEach((token) => {
    assert.ok(allSkills.includes(token), `Missing skill token: ${token}`);
  });
});

test("CRITICAL: Education details are strictly preserved", () => {
  const data = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
  assert.equal(data.education.length, 1);
  assert.equal(data.education[0].level, "B.E.");
  assert.equal(data.education[0].place, "RMK Engineering College");
  assert.equal(data.education[0].meta, "CGPA: 7.17");
});

test("PDF generator produces valid output for all defined profiles", () => {
  const master = getMasterResume();
  const profiles = ["data-engineer", "ai-product-engineer", "database-developer"];

  profiles.forEach((profileId) => {
    const resolved = resolveProfile(profileId, master);
    const doc = buildResumePdf(jsPDF, resolved, {
      accentColor: resolved.accentColor,
    });
    const buffer = Buffer.from(doc.output("arraybuffer"));
    assert.ok(buffer.length > 5000, `PDF for profile ${profileId} too small`);
  });
});
