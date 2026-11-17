const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  getMasterResume,
  getProfiles,
  getApplications,
  resolveProfile,
  slugify,
} = require("../lib/resume-system");

const ROOT = path.join(__dirname, "..");
const RAW_PATH = path.join(ROOT, "resume-data.json");
const ORIGINAL_DATA = JSON.parse(fs.readFileSync(RAW_PATH, "utf8"));
const ORIGINAL_HASH = crypto
  .createHash("sha256")
  .update(fs.readFileSync(RAW_PATH, "utf8"))
  .digest("hex");

test("resume-data.json integrity baseline", () => {
  const currentHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(RAW_PATH, "utf8"))
    .digest("hex");
  assert.equal(currentHash, ORIGINAL_HASH, "resume-data.json must never be altered");
});

test("slugify produces consistent url-safe slugs", () => {
  assert.equal(slugify("Digit Insurance"), "digit-insurance");
  assert.equal(slugify("Data Engineering & ETL"), "data-engineering-etl");
  assert.equal(slugify("AI / Product Engineer"), "ai-product-engineer");
});

test("getMasterResume attaches stable IDs while preserving original content", () => {
  const master = getMasterResume();

  assert.equal(master.name, ORIGINAL_DATA.name);
  assert.equal(master.title, ORIGINAL_DATA.title);
  assert.equal(master.summary, ORIGINAL_DATA.summary);
  assert.equal(master.experience.length, ORIGINAL_DATA.experience.length);

  assert.equal(master.experience[0].id, "exp-digit-insurance");
  assert.equal(master.experience[0].org, "Digit Insurance");
  assert.equal(master.experience[0].track, "enterprise");
  assert.equal(master.experience[0].bulletDetails.length, 6);
  assert.equal(master.experience[0].bulletDetails[0].id, "exp-digit-insurance-b1");
  assert.equal(
    master.experience[0].bulletDetails[0].text,
    ORIGINAL_DATA.experience[0].bullets[0]
  );

  assert.equal(master.experience[1].id, "exp-appzwork");
  assert.equal(master.skills.length, ORIGINAL_DATA.skills.length);
  assert.equal(master.skills[0].id, "skill-languages");
  assert.deepEqual(master.skills[0].items, ORIGINAL_DATA.skills[0].items);

  assert.equal(master.education[0].id, "edu-rmk-engineering-college");
  assert.equal(master.education[0].place, "RMK Engineering College");
  assert.equal(master.education[0].level, "B.E.");
  assert.equal(master.education[0].meta, "CGPA: 7.17");
});

test("default profile matches current resume-data.json exactly", () => {
  const resolved = resolveProfile("data-engineer");

  assert.equal(resolved.name, ORIGINAL_DATA.name);
  assert.equal(resolved.title, ORIGINAL_DATA.title);
  assert.equal(resolved.summary, ORIGINAL_DATA.summary);
  assert.equal(resolved.experience.length, ORIGINAL_DATA.experience.length);

  for (let i = 0; i < ORIGINAL_DATA.experience.length; i++) {
    assert.equal(resolved.experience[i].org, ORIGINAL_DATA.experience[i].org);
    assert.equal(resolved.experience[i].role, ORIGINAL_DATA.experience[i].role);
    assert.equal(resolved.experience[i].period, ORIGINAL_DATA.experience[i].period);
    assert.deepEqual(resolved.experience[i].bullets, ORIGINAL_DATA.experience[i].bullets);
  }

  assert.equal(resolved.skills.length, ORIGINAL_DATA.skills.length);
  for (let i = 0; i < ORIGINAL_DATA.skills.length; i++) {
    assert.equal(resolved.skills[i].group, ORIGINAL_DATA.skills[i].group);
    assert.deepEqual(resolved.skills[i].items, ORIGINAL_DATA.skills[i].items);
  }
});

test("custom profile supports summary overrides and section filtering", () => {
  const customProfile = {
    id: "test-profile",
    name: "Test Profile",
    targetTitle: "Lead Data Architect",
    summaryOverride: "Custom architect summary statement.",
    selectedExperience: ["exp-digit-insurance"],
    selectedSkills: ["skill-languages", "skill-databases"],
    selectedProjects: [],
    sectionVisibility: {
      proof: false,
      summary: true,
      skills: true,
      experience: true,
      projects: false,
      education: true,
      contact: true,
    },
    layout: "ats-classic",
  };

  const resolved = resolveProfile(customProfile);

  assert.equal(resolved.title, "Lead Data Architect");
  assert.equal(resolved.summary, "Custom architect summary statement.");
  assert.equal(resolved.experience.length, 1);
  assert.equal(resolved.experience[0].org, "Digit Insurance");
  assert.equal(resolved.skills.length, 2);
  assert.equal(resolved.proof.length, 0); // Proof hidden by sectionVisibility
  assert.equal(resolved.education.length, 1);
});

test("job applications data structure conforms to schema", () => {
  const apps = getApplications();
  assert.ok(Array.isArray(apps));
  if (apps.length > 0) {
    const app = apps[0];
    assert.ok(app.id);
    assert.ok(app.company);
    assert.ok(app.jobTitle);
    assert.ok(app.applicationDate);
    assert.ok(app.profileId);
    assert.ok(app.status);
  }
});
