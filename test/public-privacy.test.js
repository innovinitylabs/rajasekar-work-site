const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const { buildResumePdf } = require("../resume-pdf");
const { normalizeMaster, resolveProfile } = require("../resume-resolve");
const seed = require("../lib/seed-profiles");

const ROOT = path.join(__dirname, "..");
const PHONE = "7904348791";
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("web pages (portfolio and printable resume) do not show the phone number at all", () => {
  for (const f of ["index.html", "resume-source.html"]) {
    const t = read(f);
    assert.ok(!t.includes(PHONE), `${f} shows the number`);
    assert.ok(!/tel:\+?91/.test(t), `${f} links the number`);
    assert.ok(!t.includes("+91 "), `${f} shows any phone format`);
  }
});

test("the PDF data carries the full number, as a tel: link in the PDF", async () => {
  const resolved = JSON.parse(read("resume-default.json"));
  const phone = resolved.contactLinks.find((c) => c.key === "phone");
  assert.equal(phone.url, "tel:+917904348791");
  const doc = buildResumePdf(jsPDF, resolved, { accentColor: resolved.accentColor });
  assert.ok(doc.output().includes("tel:+917904348791"), "PDF link annotation for the phone");
  const parser = new PDFParse({ data: Buffer.from(doc.output("arraybuffer")) });
  const text = (await parser.getText()).text;
  await parser.destroy();
  assert.ok(text.includes("+91 7904348791"));
});

test("the other profiles' PDFs and the admin resolution keep the full number", () => {
  const master = normalizeMaster(require("../resume-data.json"));
  for (const p of seed) {
    const r = resolveProfile(p, master);
    assert.equal(r.contactLinks.find((c) => c.key === "phone").url, "tel:+917904348791", p.id);
  }
});
