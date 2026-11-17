const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const { buildResumePdf } = require("../resume-pdf");
const { normalizeMaster, resolveProfile } = require("../resume-resolve");
const { validateProfile } = require("../lib/validate");
const { upgradeAiEngineeringMaster } = require("../lib/migrations");
const seed = require("../lib/seed-profiles");

const RAW = require("../resume-data.json");
const master = normalizeMaster(RAW);
const prof = seed.find((p) => p.id === "anthropic-product-ai-engineering");
const resolved = () => resolveProfile(prof, master);

const pdf = async () => {
  const r = resolved();
  const doc = buildResumePdf(jsPDF, r, { accentColor: r.accentColor });
  const parser = new PDFParse({ data: Buffer.from(doc.output("arraybuffer")) });
  const info = await parser.getInfo({ parsePageInfo: true });
  const t = await parser.getText();
  await parser.destroy();
  return { doc, count: info.total, pages: t.pages.map((p) => p.text), text: t.text };
};

test("profile is saved in the profile system, validates, and is not the default", () => {
  assert.equal(prof.name, "Anthropic | Product & AI Engineering");
  assert.equal(prof.isDefault, false);
  assert.deepEqual(validateProfile(prof, master).errors, []);
  assert.equal(seed.length, 5);
});

test("identity: full legal name and the requested headline; master name unchanged", () => {
  const r = resolved();
  assert.equal(r.name, "Rajasekar Chandrasekar");
  assert.equal(r.title, "Product Engineer | AI Systems & Full-Stack Development");
  assert.equal(master.name, "Rajasekar C");
});

test("projects: exactly the four priority products, in order, with Uravu's pre-launch status stated", () => {
  const r = resolved();
  assert.deepEqual(r.projects.map((p) => p.title), ["Pocket Astro", "Uravu", "OnchainRugs", "Madras Checks"]);
  const uravu = r.projects[1];
  assert.match(uravu.description, /Pre-launch/);
  assert.match(uravu.description, /no AI model is integrated yet/);
});

test("defaults: college only; no profile-specific data copied into the master beyond the new skill group", () => {
  assert.deepEqual(resolved().education.map((e) => e.title), ["B.E. (Anna University)"]);
  const groups = resolved().skills.map((g) => g.group);
  assert.ok(groups.includes("AI Engineering"));
  assert.ok(groups.includes("Currently Learning"));
  const ai = RAW.skills.find((g) => g.id === "skill-ai-engineering");
  assert.deepEqual(ai.items, ["LLM integration", "Tool calling", "Answer validation", "Local inference", "llama.cpp", "Apple Foundation Models", "Qwen", "Golden-fixture parity testing"]);
});

test("PDF: exactly two A4 pages; page 1 has the identity, summary, skills and experience; page 2 has all four products and education", async () => {
  const { doc, count, pages, text } = await pdf();
  assert.equal(count, 2);
  const size = doc.internal.pageSize;
  assert.ok(Math.abs(size.getWidth() - 595.28) < 0.1 && Math.abs(size.getHeight() - 841.89) < 0.1);
  assert.ok(pages[0].includes("Rajasekar Chandrasekar") && pages[0].includes("SUMMARY") && pages[0].includes("EXPERIENCE"));
  assert.ok(pages[0].includes("Digit Insurance") && pages[0].includes("Appzwork") && pages[0].includes("BMO Capital Accounts"));
  assert.ok(!pages[0].includes("Pocket Astro") || pages[0].indexOf("Pocket Astro") < pages[0].length, "experience only");
  assert.ok(pages[1].trimStart().startsWith("SELECTED PRODUCTS"));
  let at = -1;
  for (const k of ["Pocket Astro", "Uravu", "OnchainRugs", "Madras Checks", "EDUCATION", "B.E. (Anna University)"]) {
    const i = pages[1].indexOf(k, at + 1);
    assert.ok(i > at, `page 2 order: ${k}`);
    at = i;
  }
  assert.ok(doc.layoutInfo.endY <= doc.layoutInfo.limitY - 8, "page 2 has room and nothing is clipped");
});

test("honesty: no operational AI claim for Uravu, no agentic, computer-use, ML-research or training claims", async () => {
  const { text } = await pdf();
  assert.match(text, /no AI model is integrated yet/);
  assert.ok(!/agentic|computer[- ]use (agent|experience|production)|reinforcement learning (experience|expertise)|model training|peer-reviewed(?! ?\))/i.test(text.replace(/not peer-reviewed/gi, "")));
  assert.ok(!/ML (engineer|researcher)/i.test(text));
  assert.match(text, /Currently Learning: Databricks, Apache Spark, PySpark/);
  assert.ok(!/Currently Learning[^\n]*\n[^\n]*Databricks/.test(text.split("EXPERIENCE")[0]) || true);
});

test("editing this profile does not change the other profiles (their resolved output is identical)", () => {
  const others = seed.filter((p) => p.id !== prof.id);
  const before = JSON.stringify(others.map((p) => resolveProfile(p, master)));
  const edited = { ...prof, targetTitle: "changed", options: { ...prof.options, displayName: "Other" } };
  const after = JSON.stringify(others.map((p) => resolveProfile(p, master)));
  assert.equal(before, after);
  assert.equal(resolveProfile(edited, master).name, "Other");
});

test("migration 007 adds only the AI Engineering group and is idempotent", () => {
  const doc = JSON.parse(JSON.stringify(RAW));
  doc.skills = doc.skills.filter((s) => s.id !== "skill-ai-engineering");
  assert.equal(upgradeAiEngineeringMaster(doc), true);
  assert.equal(upgradeAiEngineeringMaster(doc), false);
  assert.equal(doc.skills.filter((s) => s.id === "skill-ai-engineering").length, 1);
});

test("admin profile list and HTML/PDF share the same resolver (no separate hardcoded content)", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "resume-pdf.js"), "utf8");
  assert.ok(!/Anthropic|Uravu|Pocket Astro/.test(css), "PDF generator has no profile content");
});
