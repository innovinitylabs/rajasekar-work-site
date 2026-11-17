const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const { buildResumePdf } = require("../resume-pdf");
const { normalizeMaster, resolveProfile } = require("../resume-resolve");
const { validateProfile } = require("../lib/validate");
const seed = require("../lib/seed-profiles");

const RAW = require("../resume-data.json");
const master = normalizeMaster(RAW);
const prof = seed.find((p) => p.id === "anthropic-research-residency");
const resolved = () => resolveProfile(prof, master);

const read = async () => {
  const doc = buildResumePdf(jsPDF, resolved(), { accentColor: prof.accentColor });
  const parser = new PDFParse({ data: Buffer.from(doc.output("arraybuffer")) });
  const info = await parser.getInfo({ parsePageInfo: true });
  const t = await parser.getText();
  await parser.destroy();
  return { doc, count: info.total, pages: t.pages.map((p) => p.text), text: t.text };
};

test("profile exists, validates against the master, and is not the default", () => {
  assert.ok(prof);
  assert.equal(prof.name, "Anthropic Research Residency");
  assert.equal(prof.isDefault, false);
  assert.deepEqual(validateProfile(prof, master).errors, []);
  assert.equal(seed.filter((p) => p.isDefault).length, 1);
});

test("legal name and positioning headline come from the profile, master name is untouched", () => {
  const r = resolved();
  assert.equal(r.name, "Rajasekar Chandrasekar");
  assert.equal(r.title, "Independent Software Developer | Software & Data Engineer | AI Research Aspirant");
  assert.equal(master.name, "Rajasekar C");
  assert.equal(resolveProfile(seed.find((p) => p.id === "data-engineer"), master).name, "Rajasekar C");
});

test("PDF: two A4 pages; page 1 = summary, skills, three jobs; page 2 = projects (Uravu first), research interests, education", async () => {
  const { doc, count, pages } = await read();
  assert.equal(count, 2);
  const size = doc.internal.pageSize;
  assert.ok(Math.abs(size.getWidth() - 595.28) < 0.1 && Math.abs(size.getHeight() - 841.89) < 0.1);
  const [p1, p2] = pages;
  ["Rajasekar Chandrasekar", "Portfolio: https://rajasekar.work", "SUMMARY", "SKILLS", "EXPERIENCE", "Independent", "Digit Insurance", "Appzwork", "BMO Capital Accounts", "EvoBrix-X"].forEach((k) =>
    assert.ok(p1.includes(k), `page 1 missing ${k}`)
  );
  assert.ok(!p1.includes("EDUCATION") && !p1.includes("SELECTED INDEPENDENT PROJECTS"));
  assert.ok(p2.trimStart().startsWith("SELECTED INDEPENDENT PROJECTS"));
  let at = -1;
  for (const k of ["Uravu", "Pocket Astro", "OnchainRugs", "Madras Checks", "RESEARCH INTERESTS", "EDUCATION"]) {
    const i = p2.indexOf(k, at + 1);
    assert.ok(i > at, `page 2 order: ${k}`);
    at = i;
  }
  assert.ok(p2.includes("B.E. (Anna University)") && p2.includes("DataCamp: Introduction to Deep Learning with Python"));
  assert.ok(!p1.includes("Vahan and Health business domains") === false, "Digit achievements retained");
});

test("preview/PDF/HTML all use the same resolved data (extra sections, overrides, education)", () => {
  const r = resolved();
  assert.equal(r.pageMode, "two-page");
  assert.equal(r.showcase.heading, "Selected Independent Projects");
  assert.equal(r.showcase.bulletsPerProject, 4);
  assert.deepEqual(r.projects.map((p) => p.title), ["Uravu", "Pocket Astro", "OnchainRugs", "Madras Checks"]);
  assert.equal(r.extraSections[0].heading, "Research Interests");
  assert.equal(r.education.length, 4);
  const js = fs.readFileSync(path.join(__dirname, "..", "admin", "admin.js"), "utf8");
  assert.ok(js.includes("r.extraSections") && js.includes("bulletsPerProject"), "admin preview renders the same fields");
  assert.ok(!/anthropic/i.test(fs.readFileSync(path.join(__dirname, "..", "resume-pdf.js"), "utf8")), "nothing profile-specific in the PDF generator");
});

test("project overrides replace wording only; master project records are not duplicated", () => {
  const before = JSON.stringify(RAW.projects);
  const r = resolved();
  assert.match(r.projects[0].description, /atmospheric mediator/);
  assert.equal(JSON.stringify(RAW.projects), before);
  assert.equal(RAW.projects.filter((p) => p.title === "Uravu").length, 1);
  assert.equal(RAW.projects.length, 8);
});

test("links: Uravu site + research page, Pocket Astro none, OnchainRugs, exactly two for Madras Checks", () => {
  const by = Object.fromEntries(resolved().projects.map((p) => [p.title, p.links.map((l) => l.url)]));
  assert.deepEqual(by["Uravu"], ["https://www.uravu.social", "https://www.uravu.social/research"]);
  assert.deepEqual(by["OnchainRugs"], ["https://onchainrugs.art"]);
  assert.deepEqual(by["Madras Checks"], ["https://madraschecks.com", "https://art.madraschecks.com"]);
  assert.deepEqual(by["Pocket Astro"], []);
});

test("honesty: no overclaims about research, agentic AI, ML experience or peer review", async () => {
  const { text } = await read();
  assert.ok(!/agentic/i.test(text));
  assert.ok(!/peer-reviewed/i.test(text.replace(/not peer-reviewed/gi, "")), "dossier is only ever described as not peer-reviewed");
  assert.match(text, /not peer-reviewed/);
  assert.match(text, /no AI model is integrated yet/);
  assert.match(text, /learning goal, not existing expertise/);
  assert.ok(!/(model training|mechanistic interpretability|reinforcement learning (experience|engineer)|ML (engineer|researcher)|published (paper|research))/i.test(text));
  assert.ok(!/AI safety research(er)?\b/i.test(text.replace(/AI safety and alignment/gi, "")), "no AI-safety-researcher claim");
  assert.match(text, /Introductory course/);
  assert.match(text, /Currently Learning: Databricks, Apache Spark, PySpark/);
});

test("existing profiles are unchanged in output: no coursework, AI Systems group or research sections leak in", () => {
  for (const id of ["data-engineer", "ai-product-engineer", "database-developer"]) {
    const r = resolveProfile(seed.find((p) => p.id === id), master);
    assert.ok(!r.education.some((e) => /DataCamp/.test(e.place)), `${id} education`);
    assert.ok(!r.skills.some((g) => g.group === "AI Systems" || g.group === "Currently Learning"), `${id} skills`);
    assert.deepEqual(r.extraSections, []);
    const ind = r.experience.find((e) => e.org === "Independent");
    assert.ok(ind.bullets.length <= 4 && !ind.bullets.some((b) => /Uravu, a pre-launch concept/.test(b)), `${id} independent bullets`);
  }
});

test("master facts: coursework is introductory and the degree is stated", () => {
  const dc = RAW.education.find((e) => e.id === "edu-datacamp-deep-learning");
  assert.equal(dc.meta, "Introductory course");
  assert.equal(RAW.education[0].level, "B.E. (Anna University)");
  const ai = RAW.skills.find((g) => g.id === "skill-ai-systems");
  assert.deepEqual(ai.items, ["Local LLM integration", "On-device AI assistants", "AI-assisted development"]);
});

test("options validation rejects unknown ids and oversize text", () => {
  const bad = (opts) => validateProfile({ ...prof, options: opts }, master).errors;
  assert.ok(bad({ selectedEducation: ["edu-nope"] }).length);
  assert.ok(bad({ projectOverrides: { "project-nope": { description: "x" } } }).length);
  assert.ok(bad({ projectOverrides: { "project-uravu": { description: "x".repeat(1300) } } }).length);
  assert.ok(bad({ showcase: { bulletsPerProject: 9 } }).length);
  assert.ok(bad({ extraSections: [{ heading: "", paragraphs: ["x"] }] }).length);
  assert.ok(bad("nope").length);
});

test("layout: exactly two A4 pages with room to spare; all four education entries together on page 2, in order", async () => {
  const { doc, count, pages } = await read();
  assert.equal(count, 2);
  assert.equal(doc.layoutInfo.pages, 2);
  assert.ok(doc.layoutInfo.endY <= doc.layoutInfo.limitY - 8, `last line ends at ${doc.layoutInfo.endY}, limit ${doc.layoutInfo.limitY}`);
  const p2 = pages[1];
  const section = p2.slice(p2.indexOf("EDUCATION"));
  const order = ["B.E. (Anna University)", "RMK Engineering College", "Higher Secondary (12th Standard)", "Secondary School (10th Standard)", "DataCamp: Introduction to Deep Learning with Python"];
  let at = -1;
  for (const o of order) {
    const i = section.indexOf(o, at + 1);
    assert.ok(i > at, `education order/missing on page 2: ${o}`);
    at = i;
  }
  assert.ok(section.includes("87.4%") && section.includes("86.5%") && section.includes("Introductory course"), "no education detail dropped");
  assert.ok(!pages[0].includes("EDUCATION"));
});

test("layout: nothing is dropped to fit: all Uravu and Pocket Astro bullets and every project link are present", async () => {
  const { text, doc } = await read();
  [
    "Conceived the concept and design philosophy", "Research dossier at /research", "Implemented the site and prototype end to end",
    "Built a provider-based AI layer", "Added an answer-validation step", "Checks the native calculation layer against a Python oracle",
    "Developed the Solidity contracts", "Generated dynamic social-preview images",
  ].forEach((k) => assert.ok(text.includes(k), `missing: ${k}`));
  const uris = [...doc.output().matchAll(/\/URI \(([^)]*)\)/g)].map((m) => m[1]);
  ["https://www.uravu.social", "https://www.uravu.social/research", "https://onchainrugs.art", "https://madraschecks.com", "https://art.madraschecks.com"].forEach((u) => assert.ok(uris.includes(u), u));
});

test("layout: the PDF has no clipped or overlapping text (every line starts inside the margins)", async () => {
  const { doc } = await read();
  const xs = [...doc.output().matchAll(/([\d.]+) [\d.]+ Td/g)].map((m) => Number(m[1]));
  assert.ok(xs.length > 100 && xs.every((x) => x >= 35 && x < 595.28 - 36));
});

test("layout: admin preview carries the same page-2 spacing rules as the PDF", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "admin", "admin.css"), "utf8");
  assert.match(css, /\[data-page="2"\] \.rp-role \{ margin-bottom: 12px; \}/);
});
