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

test("default Data Engineer PDF: deliberate two-page A4, page 1 = experience, page 2 = all eight projects", async () => {
  const { pages, text } = await extract("data-engineer");
  assert.equal(pages, 2);
  ["Rajasekar C", "Python", "SQL", "PostgreSQL", "Oracle", "ETL", "50M", "Vahan and Health"].forEach((k) =>
    assert.ok(text.includes(k), `Extracted PDF is missing: ${k}`)
  );
  assertOrder(text, [
    "Rajasekar C", "Data Engineer", "Portfolio: https://rajasekar.work",
    "50M records/day", "30 min to under 1 min", "4000+ issues resolved",
    "SUMMARY", "SKILLS", "EXPERIENCE",
    "Independent Software Developer", "Jun 2025 - Present",
    "Digit Insurance", "Nov 2023 - Jun 2025",
    "Appzwork", "Jan 2020 - Nov 2023", "BMO Capital Accounts", "EvoBrix-X",
    "INDEPENDENT DEVELOPMENT | SELECTED WORK",
    "Madras Checks", "OnchainRugs", "Anekaroopam", "Uravu", "Hard COpy", "Rotate the Cow", "Pocket Astro", "Valipokkann",
    "EDUCATION",
  ]);
  const [page1, page2] = text.split(/-- 1 of 2 --/);
  assert.ok(page1.includes("Appzwork") && !page1.includes("INDEPENDENT DEVELOPMENT"), "page 1 ends with employment");
  assert.ok(page2.trimStart().startsWith("INDEPENDENT DEVELOPMENT | SELECTED WORK"), "page 2 starts with the selected-work heading");
  assert.ok(page2.includes("Since June 2025, independently building software products spanning data-driven applications"));
});

test("Data Engineer skills: data-focused groups only, no Currently Learning, no Spark/Databricks, no Swift/Solidity-led groups", async () => {
  const { text } = await extract("data-engineer");
  const skills = text.slice(text.indexOf("SKILLS"), text.indexOf("EXPERIENCE"));
  assert.ok(!/Currently Learning|Databricks|Spark/.test(text.split("EXPERIENCE")[0]), "no learning keywords in header/skills");
  assert.ok(!/Swift|Solidity|React|TypeScript/.test(skills), "unrelated stacks do not dominate the skills section");
  ["Programming Languages", "Data Engineering", "Databases", "Backend Development", "Cloud and Data Platforms", "DevOps"].forEach((g) =>
    assert.ok(skills.includes(`${g}:`), g)
  );
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
