const test = require("node:test");
const assert = require("node:assert/strict");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const { buildResumePdf } = require("../resume-pdf");
const { normalizeMaster, resolveProfile } = require("../resume-resolve");
const seedProfiles = require("../lib/seed-profiles");

const master = normalizeMaster(require("../resume-data.json"));
const profile = (id) => seedProfiles.find((p) => p.id === id);

const extract = async (id) => {
  const resolved = resolveProfile(profile(id), master);
  const doc = buildResumePdf(jsPDF, resolved, { accentColor: resolved.accentColor });
  const parser = new PDFParse({ data: Buffer.from(doc.output("arraybuffer")) });
  const info = await parser.getInfo({ parsePageInfo: true });
  const { text } = await parser.getText();
  await parser.destroy();
  return { pages: info.total, text };
};

const assertOrder = (text, tokens) => {
  let previous = -1;
  tokens.forEach((token) => {
    const position = text.indexOf(token, previous + 1);
    assert.ok(position > previous, `PDF text is missing or out of order: ${token}`);
    previous = position;
  });
};

test("default Data Engineer PDF: one page, selectable text, ATS reading order", async () => {
  const { pages, text } = await extract("data-engineer");
  assert.equal(pages, 1);
  ["Rajasekar C", "Python", "SQL", "PostgreSQL", "Oracle", "ETL", "50M", "Vahan and Health"].forEach((k) =>
    assert.ok(text.includes(k), `Extracted PDF is missing: ${k}`)
  );
  assertOrder(text, [
    "Rajasekar C", "Data Engineer", "SUMMARY", "SKILLS", "EXPERIENCE",
    "Independent Software Developer", "Jun 2025 - Present",
    "Digit Insurance", "Nov 2023 - Jun 2025",
    "Appzwork", "Jan 2020 - Nov 2023",
    "PROJECTS", "OnchainRugs", "Uravu", "EDUCATION",
  ]);
});

test("Databricks / Spark are labelled as Currently Learning in the PDF skills", async () => {
  const { text } = await extract("data-engineer");
  assert.match(text, /Currently Learning: Databricks, Apache Spark, PySpark/);
  const experience = text.slice(text.indexOf("EXPERIENCE"));
  assert.ok(!/Databricks|Spark/.test(experience), "must not appear in experience text");
});

test("every profile exports a readable multi-section PDF", async () => {
  for (const p of seedProfiles) {
    const { pages, text } = await extract(p.id);
    assert.ok(pages >= 1 && pages <= 3, `${p.id}: ${pages} pages`);
    assertOrder(text, ["Rajasekar C", "SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION"]);
    assert.ok(text.includes("Digit Insurance") && text.includes("Appzwork"));
    assert.ok(text.includes("rajasekar.work"), `${p.id}: contact links text present`);
  }
});

test("AI / Product profile is the longer, project-focused resume and includes Pocket Astro", async () => {
  const { pages, text } = await extract("ai-product-engineer");
  assert.ok(pages >= 2);
  assertOrder(text, ["PROJECTS", "Pocket Astro", "Uravu", "OnchainRugs", "Anekaroopam", "Rotate the Cow", "EDUCATION"]);
  assert.match(text, /Technologies: Swift, SwiftUI/);
});

test("PDF keeps working contact links", () => {
  const resolved = resolveProfile(profile("data-engineer"), master);
  const doc = buildResumePdf(jsPDF, resolved);
  const raw = doc.output();
  ["mailto:rajasekarc1142@gmail.com", "https://linkedin.com/in/rajasekar-c", "https://rajasekar.work"].forEach((u) =>
    assert.ok(raw.includes(u), `missing link ${u}`)
  );
});
