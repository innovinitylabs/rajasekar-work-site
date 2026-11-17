const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const { buildResumePdf } = require("../resume-pdf");
const { normalizeMaster, resolveProfile, contactLinks } = require("../resume-resolve");
const seed = require("../lib/seed-profiles");

const RAW = require("../resume-data.json");
const master = normalizeMaster(RAW);
const profile = (id) => seed.find((p) => p.id === id);
const resolved = (id) => resolveProfile(profile(id), master);

const EXPECTED = [
  ["Portfolio: https://rajasekar.work", "https://rajasekar.work"],
  ["rajasekarc1142@gmail.com", "mailto:rajasekarc1142@gmail.com"],
  ["+91 7904348791", "tel:+917904348791"],
  ["LinkedIn: linkedin.com/in/rajasekar-c", "https://linkedin.com/in/rajasekar-c"],
  ["GitHub: github.com/innovinitylabs", "https://github.com/innovinitylabs/"],
];

const pdf = (data) => buildResumePdf(jsPDF, data, { accentColor: data.accentColor });
const uris = (doc) => [...doc.output().matchAll(/\/URI \(([^)]*)\)/g)].map((m) => m[1]);
const text = async (doc) => {
  const parser = new PDFParse({ data: Buffer.from(doc.output("arraybuffer")) });
  const t = (await parser.getText()).text;
  await parser.destroy();
  return t;
};

test("header contact order and destinations: Portfolio, Email, Phone, LinkedIn, GitHub", () => {
  const links = contactLinks(master.contact);
  assert.deepEqual(links.map((l) => [l.text, l.url]), EXPECTED);
  assert.ok(links[0].url === "https://rajasekar.work");
  assert.ok(links[1].url.startsWith("mailto:") && links[2].url.startsWith("tel:"));
  assert.ok(links.slice(3).every((l) => l.url.startsWith("https://")));
});

test("portfolio href is fixed even if the stored contact says otherwise", () => {
  const c = JSON.parse(JSON.stringify(master.contact));
  c.portfolio = { label: "evil.example", url: "http://evil.example" };
  assert.equal(contactLinks(c)[0].url, "https://rajasekar.work");
  c.linkedin.url = "http://linkedin.com/in/x";
  assert.equal(contactLinks(c)[3].url, "https://linkedin.com/in/x");
});

test("public resume HTML: same order; the phone is omitted from web views", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "resume-source.html"), "utf8");
  const header = html.slice(html.indexOf("<!-- build:contact -->"), html.indexOf("<!-- /build:contact -->"));
  const anchors = [...header.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(anchors, EXPECTED.filter((x) => !x[1].startsWith("tel:")));
  assert.ok(!header.includes("7904348791"), "web header omits the phone number");
});

test("PDF: header link annotations exist in the same order and text is extractable in order", async () => {
  for (const p of seed) {
    const doc = pdf(resolved(p.id));
    const found = uris(doc);
    EXPECTED.forEach(([, url], i) => assert.equal(found[i], url, `${p.id}: annotation ${i}`));
    const t = await text(doc);
    let at = -1;
    for (const [label] of EXPECTED) {
      const pos = t.indexOf(label, at + 1);
      assert.ok(pos > at, `${p.id}: header label out of order or missing: ${label}`);
      at = pos;
    }
  }
});

test("admin preview source uses the shared contact order (no private ordering)", () => {
  const js = fs.readFileSync(path.join(__dirname, "..", "admin", "admin.js"), "utf8");
  assert.ok(js.includes("r.contactLinks"));
  assert.ok(!js.includes("CONTACT_ORDER"));
});

/* ----------------------------- project links ----------------------------- */

const proj = (links) => ({ ...resolved("ai-product-engineer"), projects: [{ id: "p", title: "Demo Project", status: "Deployed", role: "Sole developer", period: "", description: "d", technologies: ["Next.js"], bullets: [], links }] });

test("resolved projects carry only visible links, primary first, with existing labels", () => {
  const madras = resolveProfile({ ...profile("ai-product-engineer"), selectedProjects: ["project-madras-checks"] }, master).projects[0];
  assert.deepEqual(madras.links.map((l) => [l.label, l.url]), [["Official Website", "https://madraschecks.com"], ["Art Platform", "https://art.madraschecks.com"]]);
  assert.ok(!madras.links.some((l) => /vercel\.app/.test(l.url)), "no raw deployment URLs");
  const anek = resolveProfile({ ...profile("ai-product-engineer"), selectedProjects: ["project-anekaroopam"] }, master).projects[0];
  assert.ok(anek.links.some((l) => l.label === "GitHub" && l.url.startsWith("https://github.com/")));
  const noLinks = resolveProfile({ ...profile("ai-product-engineer"), selectedProjects: ["project-hard-copy"] }, master).projects[0];
  assert.deepEqual(noLinks.links, []);
});

test("hidden links never reach the resume; a project with only hidden links has none", () => {
  const raw = JSON.parse(JSON.stringify(RAW));
  const rugs = raw.projects.find((p) => p.id === "project-onchainrugs");
  rugs.links = [{ label: "Vercel deployment", url: "https://onchain-rugs.vercel.app", type: "demo", primary: false, visible: false }];
  const m = normalizeMaster(raw);
  const r = resolveProfile({ ...profile("ai-product-engineer"), selectedProjects: ["project-onchainrugs"] }, m).projects[0];
  assert.deepEqual(r.links, []);
});

test("PDF: project with several links shows 'Links:' with the full URLs, each clickable", async () => {
  const data = proj([
    { label: "Official Website", url: "https://madraschecks.com" },
    { label: "Art Platform", url: "https://art.madraschecks.com" },
    { label: "Generator", url: "https://art.madraschecks.com/generator" },
    { label: "GitHub", url: "https://github.com/innovinitylabs/x" },
  ]);
  const doc = pdf(data);
  const t = await text(doc);
  assert.match(t, /Links: https:\/\/madraschecks\.com \| https:\/\/art\.madraschecks\.com \| https:\/\/art\.madraschecks\.com\/generator(?: \|)?\s+https:\/\/github\.com\/innovinitylabs\/x/);
  const found = uris(doc);
  ["https://madraschecks.com", "https://art.madraschecks.com", "https://art.madraschecks.com/generator", "https://github.com/innovinitylabs/x"].forEach((u) =>
    assert.ok(found.includes(u), `missing annotation ${u}`)
  );
  assert.ok(!/Official Website|Art Platform/.test(t), "full URLs are shown, not labels");
});

test("PDF: single link, and no links, render compactly without a Links line", async () => {
  let t = await text(pdf(proj([{ label: "Official Website", url: "https://uravu.example.org" }])));
  assert.match(t, /Links: https:\/\/uravu\.example\.org/);
  assert.ok(!/Links: https:\/\/uravu\.example\.org \|/.test(t));
  t = await text(pdf(proj([])));
  assert.ok(!/Links:/.test(t));
});

test("PDF: long link lists and a single over-long URL wrap inside the margins and stay clickable", async () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ label: `Destination ${i + 1}`, url: `https://example.com/section-${i + 1}/path` }));
  let doc = pdf(proj(many));
  let t = await text(doc);
  for (let i = 1; i <= 6; i++) assert.ok(t.includes(`https://example.com/section-${i}/path`));
  assert.equal(uris(doc).filter((u) => u.startsWith("https://example.com/section-")).length, 6);

  const longUrl = `https://example.com/${"segment/".repeat(40)}end`;
  doc = pdf(proj([{ label: "Long", url: longUrl }]));
  assert.ok(uris(doc).includes(longUrl), "annotation carries the complete URL");
  const rects = [...doc.output().matchAll(/\/Rect \[([^\]]+)\][^>]*\/URI \(https:\/\/example\.com\/segment/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
  assert.ok(rects.length >= 2, "wrapped URL has one link rectangle per line");
  assert.ok(rects.every((r) => r[0] >= 35.5 && r[2] <= 595.28 - 36 + 0.5));
});

test("profile-specific PDFs: every selected project's visible links are clickable", () => {
  for (const p of seed) {
    const r = resolved(p.id);
    const doc = pdf(r);
    const found = uris(doc);
    if (!r.sectionVisibility.projects) continue;
    for (const pr of r.projects) for (const l of pr.links) assert.ok(found.includes(l.url), `${p.id}/${pr.title}: ${l.url}`);
  }
});

test("public resume HTML lists project links as full URLs with matching hrefs, no vercel URLs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "resume-source.html"), "utf8");
  const block = html.slice(html.indexOf("<h2>Independent Development | Selected Work</h2>"), html.indexOf("<h2>Education</h2>"));
  assert.match(block, /<strong>Links:<\/strong> <a href="https:\/\/onchainrugs\.art">https:\/\/onchainrugs\.art<\/a>/);
  assert.match(block, /<a href="https:\/\/www\.uravu\.social">https:\/\/www\.uravu\.social<\/a>/);
  assert.ok(!/vercel\.app/.test(block));
});
