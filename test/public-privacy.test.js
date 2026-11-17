const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const { buildResumePdf } = require("../resume-pdf");
const { maskPhone, publicContact, normalizeMaster, resolveProfile } = require("../resume-resolve");
const seed = require("../lib/seed-profiles");

const ROOT = path.join(__dirname, "..");
const FULL = "7904348791";
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("maskPhone keeps the country code and last four digits only", () => {
  assert.equal(maskPhone("+91 7904348791"), "+91 xxx xxx 8791");
  assert.equal(maskPhone("+91 79043 48791"), "+91 xxx xxx 8791");
  assert.equal(maskPhone("7904348791"), "xxx xxx 8791");
});

test("publicContact masks the phone and removes its tel: link; other contact items are unchanged", () => {
  const raw = require("../resume-data.json").contact;
  const pub = publicContact(raw);
  assert.equal(pub.phone.label, "+91 xxx xxx 8791");
  assert.equal(pub.phone.url, null);
  assert.equal(pub.email.url, raw.email.url);
  assert.equal(raw.phone.label, "+91 7904348791", "the private master is not modified");
});

test("public build outputs never contain the full phone number or a tel: link", () => {
  for (const f of ["index.html", "resume-source.html", "resume-default.json"]) {
    const t = read(f);
    assert.ok(!t.includes(FULL), `${f} contains the full number`);
    assert.ok(!/tel:\+?91/.test(t), `${f} links the number`);
  }
});

test("the default PDF generated for the public site has the masked number and no phone annotation", async () => {
  const resolved = JSON.parse(read("resume-default.json"));
  const doc = buildResumePdf(jsPDF, resolved, { accentColor: resolved.accentColor });
  const raw = doc.output();
  assert.ok(!raw.includes("tel:"), "no tel: annotation");
  const parser = new PDFParse({ data: Buffer.from(doc.output("arraybuffer")) });
  const text = (await parser.getText()).text;
  await parser.destroy();
  assert.ok(text.includes("+91 xxx xxx 8791"));
  assert.ok(!text.includes(FULL));
});

test("private resolution (admin/API) still has the full number", () => {
  const master = normalizeMaster(require("../resume-data.json"));
  const r = resolveProfile(seed[0], master);
  assert.equal(r.contactLinks.find((c) => c.key === "phone").url, "tel:+917904348791");
});
