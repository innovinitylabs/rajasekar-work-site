const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const { buildResumePdf } = require("../resume-pdf");
const { normalizeMaster, resolveProfile } = require("../resume-resolve");
const { validateMaster, validateProfile } = require("../lib/validate");
const { upgradeEducationMaster } = require("../lib/migrations");
const seed = require("../lib/seed-profiles");

const RAW = require("../resume-data.json");
const master = normalizeMaster(RAW);
const by = (id) => seed.find((p) => p.id === id);
const edu = (id) => resolveProfile(by(id), master).education;
const titles = (id) => edu(id).map((e) => e.title);

const COLLEGE = "B.E. (Anna University)";
const HS = "Higher Secondary (12th Standard)";
const SS = "Secondary School (10th Standard)";

test("master holds the full academic history, newest first, with only the facts provided", () => {
  assert.deepEqual(
    RAW.education.map((e) => [e.id, e.level, e.place, e.meta]),
    [
      ["edu-rmk-engineering-college", COLLEGE, "RMK Engineering College", "CGPA: 7.17"],
      ["edu-higher-secondary", HS, "", "87.4%"],
      ["edu-secondary-school", SS, "", "86.5%"],
      ["edu-datacamp-deep-learning", "DataCamp: Introduction to Deep Learning with Python", "", "Introductory course"],
    ]
  );
  assert.deepEqual(validateMaster(RAW).errors, []);
  assert.equal(new Set(RAW.education.map((e) => e.id)).size, RAW.education.length, "no duplicate records");
});

test("display shape: two lines with an institution, one line without", () => {
  const [college, hs, ss] = edu("ai-product-engineer");
  assert.deepEqual([college.title, college.detail, college.inline], [COLLEGE, "RMK Engineering College | CGPA: 7.17", ""]);
  assert.deepEqual([hs.title, hs.detail, hs.inline], [HS, "", "87.4%"]);
  assert.deepEqual([ss.title, ss.detail, ss.inline], [SS, "", "86.5%"]);
});

test("profile defaults: college only for Data Engineer and Database Developer; all three for AI / Product; all for the research profile", () => {
  assert.deepEqual(titles("data-engineer"), [COLLEGE]);
  assert.deepEqual(titles("database-developer"), [COLLEGE]);
  assert.deepEqual(titles("ai-product-engineer"), [COLLEGE, HS, SS]);
  assert.deepEqual(titles("anthropic-research-residency").slice(0, 3), [COLLEGE, HS, SS]);
  for (const p of seed) assert.ok(titles(p.id)[0] === COLLEGE, `${p.id}: college degree is visible and first`);
});

test("profile overrides: individual entries can be shown or hidden; order always follows the master", () => {
  const custom = (ids) => resolveProfile({ ...by("data-engineer"), options: { selectedEducation: ids } }, master).education.map((e) => e.title);
  assert.deepEqual(custom([SS, COLLEGE].map((t) => RAW.education.find((e) => e.level === t).id)), [COLLEGE, SS], "selection order does not reorder");
  assert.deepEqual(custom(["edu-higher-secondary"]), [HS]);
  assert.deepEqual(custom([]).length, 4, "empty selection = every master entry");
  // hiding the whole section
  const hidden = resolveProfile({ ...by("ai-product-engineer"), sectionVisibility: { education: false } }, master);
  assert.deepEqual(hidden.education, []);
  assert.deepEqual(validateProfile({ ...by("data-engineer"), options: { selectedEducation: ["edu-nope"] } }, master).errors.length > 0, true);
});

test("education records are not duplicated per profile (profiles hold ids only)", () => {
  for (const p of seed) {
    const sel = (p.options || {}).selectedEducation || [];
    sel.forEach((id) => assert.ok(RAW.education.some((e) => e.id === id), `${p.id} references ${id}`));
    assert.ok(!JSON.stringify(p).includes("87.4"), `${p.id} does not copy education text`);
  }
});

const pdfText = async (id) => {
  const r = resolveProfile(by(id), master);
  const doc = buildResumePdf(jsPDF, r, { accentColor: r.accentColor });
  const parser = new PDFParse({ data: Buffer.from(doc.output("arraybuffer")) });
  const t = (await parser.getText()).text;
  await parser.destroy();
  return t;
};

test("PDF: compact education section in reverse chronological order, only the profile's entries", async () => {
  let t = await pdfText("anthropic-research-residency");
  const section = t.slice(t.lastIndexOf("EDUCATION"));
  const order = [COLLEGE, "RMK Engineering College | CGPA: 7.17", `${HS} | 87.4%`, `${SS} | 86.5%`, "Introduction to Deep Learning with Python | Introductory course"];
  let at = -1;
  for (const o of order) {
    const i = section.replace(/\s+\|/g, " |").indexOf(o, at + 1);
    assert.ok(i > at, `out of order or missing: ${o}`);
    at = i;
  }
  t = await pdfText("data-engineer");
  const de = t.slice(t.lastIndexOf("EDUCATION"));
  assert.ok(de.includes(COLLEGE) && de.includes("RMK Engineering College | CGPA: 7.17"));
  assert.ok(!/Higher Secondary|Secondary School|87\.4|86\.5/.test(t), "school education is hidden by default");
});

test("PDF shows 12th and 10th for AI / Product only when selected", async () => {
  const t = await pdfText("ai-product-engineer");
  assert.ok(t.includes(HS) && t.includes(SS));
  assert.ok(t.indexOf(COLLEGE) < t.indexOf(HS) && t.indexOf(HS) < t.indexOf(SS));
});

test("public resume HTML and admin preview use the same resolved fields and order", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "resume-source.html"), "utf8");
  const block = html.slice(html.indexOf("<!-- build:education -->"), html.indexOf("<!-- /build:education -->"));
  assert.match(block, /<strong>B\.E\. \(Anna University\)<\/strong><br \/>RMK Engineering College \| CGPA: 7\.17/);
  assert.ok(!/Higher Secondary/.test(block), "default (Data Engineer) resume is college only");
  const js = fs.readFileSync(path.join(__dirname, "..", "admin", "admin.js"), "utf8");
  assert.ok(js.includes("ed.inline") && js.includes("ed.detail") && js.includes("r.education"));
  assert.ok(js.includes("data-opt-edu"), "admin can show/hide each entry per profile");
  assert.ok(js.includes("education.${i}.level"), "admin master editor edits education");
});

test("public website lists the full history, newest first", () => {
  const site = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const part = site.slice(site.indexOf('id="education"'), site.indexOf('id="contact"'));
  const order = [COLLEGE, HS, SS];
  let at = -1;
  for (const o of order) {
    const i = part.indexOf(`<h3>${o}</h3>`, at + 1);
    assert.ok(i > at, o);
    at = i;
  }
});

test("migration 006 rewrites old seed forms, keeps order, is idempotent, and leaves custom edits alone", () => {
  const legacy = { education: [
    { id: "edu-rmk-engineering-college", level: "B.E. in Civil Engineering", place: "RMK Engineering College", meta: "CGPA: 7.17" },
    { id: "edu-datacamp-deep-learning", level: "Coursework", place: "DataCamp: Introduction to Deep Learning with Python", meta: "Introductory course" },
  ] };
  assert.equal(upgradeEducationMaster(legacy), true);
  assert.deepEqual(legacy.education.map((e) => e.id), ["edu-rmk-engineering-college", "edu-higher-secondary", "edu-secondary-school", "edu-datacamp-deep-learning"]);
  assert.equal(legacy.education[0].level, COLLEGE);
  assert.equal(legacy.education[3].place, "");
  assert.equal(upgradeEducationMaster(legacy), false);
  const custom = { education: [{ id: "edu-rmk-engineering-college", level: "B.E. Mechanical", place: "X", meta: "Y" }] };
  upgradeEducationMaster(custom);
  assert.equal(custom.education[0].level, "B.E. Mechanical", "your own wording is not overwritten");
});
