const test = require("node:test");
const assert = require("node:assert/strict");

const { getMasterResume, slugify, resolveProfile, SEED_PROFILES } = require("../lib/resume-system");
const RAW = require("../resume-data.json");

test("slugify produces consistent url-safe slugs", () => {
  assert.equal(slugify("Digit Insurance"), "digit-insurance");
  assert.equal(slugify("Data Engineering & ETL"), "data-engineering-etl");
  assert.equal(slugify("AI / Product Engineer"), "ai-product-engineer");
});

test("getMasterResume keeps explicit ids and derives per-bullet ids", () => {
  const master = getMasterResume();
  const digit = master.experience.find((e) => e.id === "exp-digit-insurance");
  assert.equal(digit.bulletDetails.length, 7);
  assert.equal(digit.bulletDetails[0].id, "exp-digit-insurance-b1");
  assert.equal(digit.bulletDetails[0].text, RAW.experience[1].bullets[0]);
  assert.equal(master.experience[0].track, "independent");
  assert.equal(master.skills[0].id, "skill-programming-languages");
  assert.equal(master.projects.length, 8);
  assert.ok(master.projects.every((p) => p.isPublic === true));
});

test("getMasterResume derives ids when the source has none (legacy documents)", () => {
  const legacy = {
    name: "X", title: "T", summary: "S", contact: {},
    experience: [{ org: "Some Org", role: "R", period: "P", bullets: ["a"] }],
    skills: [{ group: "Group One", items: ["i"] }],
    education: [{ level: "L", place: "Some Place", meta: "m" }],
  };
  const m = getMasterResume(legacy);
  assert.equal(m.experience[0].id, "exp-some-org");
  assert.equal(m.skills[0].id, "skill-group-one");
  assert.equal(m.education[0].id, "edu-some-place");
});

test("custom profile supports summary overrides and section filtering", () => {
  const resolved = resolveProfile(
    {
      id: "test-profile", name: "Test", targetTitle: "Lead Data Architect",
      summaryOverride: "Custom architect summary statement.",
      selectedExperience: ["exp-digit-insurance"],
      selectedSkills: ["skill-programming-languages", "skill-databases"],
      selectedProjects: [],
      sectionVisibility: { proof: false },
    },
    getMasterResume()
  );
  assert.equal(resolved.title, "Lead Data Architect");
  assert.equal(resolved.summary, "Custom architect summary statement.");
  assert.equal(resolved.experience.length, 1);
  assert.equal(resolved.skills.length, 2);
  assert.equal(resolved.proof.length, 0);
});

test("resolveProfile requires a profile object (no hidden file reads)", () => {
  assert.throws(() => resolveProfile("data-engineer", getMasterResume()), TypeError);
  assert.equal(SEED_PROFILES.length, 5);
});
