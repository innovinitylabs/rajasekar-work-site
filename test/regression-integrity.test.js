const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeMaster, resolveProfile } = require("../resume-resolve");
const seedProfiles = require("../lib/seed-profiles");
const { validateMaster, validateProfile } = require("../lib/validate");

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "resume-data.json"), "utf8"));

// The previous phase froze resume-data.json with a SHA-256 hash. That guard is
// intentionally replaced: the master resume is now edited on purpose, so the
// protection is structural (validation + exact preservation of verified facts).

test("seed master passes server-side validation unchanged", () => {
  const { errors } = validateMaster(RAW);
  assert.deepEqual(errors, []);
});

test("contact links, proof metrics and education are preserved exactly", () => {
  assert.equal(RAW.contact.email.url, "mailto:rajasekarc1142@gmail.com");
  assert.equal(RAW.contact.phone.url, "tel:+917904348791");
  assert.equal(RAW.contact.linkedin.url, "https://linkedin.com/in/rajasekar-c");
  assert.equal(RAW.contact.github.url, "https://github.com/innovinitylabs/");
  assert.equal(RAW.contact.portfolio.url, "https://rajasekar.work");
  assert.deepEqual(RAW.proof.map((p) => p.value), ["50M records/day", "30 min to under 1 min", "4000+ issues resolved"]);
  assert.deepEqual(RAW.education, [
    { id: "edu-rmk-engineering-college", level: "B.E. in Civil Engineering", meta: "CGPA: 7.17", place: "RMK Engineering College" },
    { id: "edu-datacamp-deep-learning", level: "Coursework", meta: "Introductory course", place: "DataCamp: Introduction to Deep Learning with Python" },
  ]);
});

test("experience is exactly Independent, Digit Insurance, Appzwork - no duplicated or corrupted entries", () => {
  assert.deepEqual(RAW.experience.map((e) => e.id), ["exp-independent", "exp-digit-insurance", "exp-appzwork"]);
  const allBullets = RAW.experience.flatMap((e) => e.bullets);
  assert.equal(new Set(allBullets).size, allBullets.length, "no duplicated bullet text");
  assert.equal(RAW.projects.length, new Set(RAW.projects.map((p) => p.title)).size);
});

test("every seed profile validates against the master and references only real ids", () => {
  const master = normalizeMaster(RAW);
  for (const p of seedProfiles) {
    const { errors } = validateProfile(p, master);
    assert.deepEqual(errors, [], `${p.id}: ${JSON.stringify(errors)}`);
  }
  assert.equal(seedProfiles.filter((p) => p.isDefault).length, 1);
  assert.deepEqual(seedProfiles.map((p) => p.id), ["data-engineer", "ai-product-engineer", "database-developer", "anthropic-research-residency"]);
});

test("every master project is selected by at least one profile or remains available in the master", () => {
  const master = normalizeMaster(RAW);
  const selected = new Set(seedProfiles.flatMap((p) => p.selectedProjects));
  assert.ok(selected.has("project-pocket-astro"), "Pocket Astro must appear in a profile");
  assert.equal(master.projects.length, 8, "all eight remain in the master regardless of profile selection");
});

test("resolveProfile is pure: it does not mutate the master and honours bullet selection", () => {
  const master = normalizeMaster(RAW);
  const before = JSON.stringify(master);
  const de = resolveProfile(seedProfiles[0], master);
  assert.equal(JSON.stringify(master), before);
  const ind = de.experience.find((e) => e.org === "Independent");
  assert.equal(ind.bullets.length, 4);
  assert.equal(de.experience.find((e) => e.org === "Digit Insurance").bullets.length, 7);
});

test("projects follow the profile's own priority order", () => {
  const master = normalizeMaster(RAW);
  const ai = resolveProfile(seedProfiles.find((p) => p.id === "ai-product-engineer"), master);
  assert.deepEqual(ai.projects.map((p) => p.title), ["Pocket Astro", "Uravu", "OnchainRugs", "Anekaroopam", "Rotate the Cow"]);
});

test("hidden sections are removed from the resolved resume", () => {
  const master = normalizeMaster(RAW);
  const r = resolveProfile({ ...seedProfiles[0], sectionVisibility: { projects: false, proof: false, contact: false } }, master);
  assert.equal(r.projects.length, 0);
  assert.equal(r.proof.length, 0);
  assert.equal(r.contact, null);
});
