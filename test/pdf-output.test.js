const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const { buildResumePdf } = require("../resume-pdf");

const ROOT = path.join(__dirname, "..");
const data = JSON.parse(
  fs.readFileSync(path.join(ROOT, "resume-data.json"), "utf8")
);

test("generated PDF is one page with selectable ATS text in order", async () => {
  const doc = buildResumePdf(jsPDF, data);
  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  const parser = new PDFParse({ data: pdfBuffer });

  const info = await parser.getInfo({ parsePageInfo: true });
  const extracted = await parser.getText();
  await parser.destroy();

  assert.equal(info.total, 1);

  const text = extracted.text;
  const required = [
    "Rajasekar C",
    "Data Engineer",
    "Python",
    "SQL",
    "PostgreSQL",
    "Oracle",
    "ETL",
    "50M",
  ];
  required.forEach((keyword) => {
    assert.ok(text.includes(keyword), `Extracted PDF is missing: ${keyword}`);
  });

  const expectedOrder = [
    "Rajasekar C",
    "Data Engineer",
    "SUMMARY",
    "SKILLS",
    "EXPERIENCE",
    "Digit Insurance",
    "Data Engineer",
    "Nov 2023 - Jun 2025",
    "Appzwork",
    "Software Engineer",
    "Jan 2020 - Nov 2023",
    "EDUCATION",
  ];

  let previous = -1;
  expectedOrder.forEach((token) => {
    const position = text.indexOf(token, previous + 1);
    assert.ok(position > previous, `PDF text is missing or out of order: ${token}`);
    previous = position;
  });
});
