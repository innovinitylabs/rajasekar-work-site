const test = require("node:test");
const assert = require("node:assert/strict");
const { jsPDF } = require("jspdf");
const { PDFParse } = require("pdf-parse");
const { buildResumePdf } = require("../resume-pdf");
const { normalizeMaster, resolveProfile } = require("../resume-resolve");
const seed = require("../lib/seed-profiles");

const master = normalizeMaster(require("../resume-data.json"));
const build = (p) => {
  const r = resolveProfile(p, master);
  return { r, doc: buildResumePdf(jsPDF, r, { accentColor: r.accentColor }) };
};
const annots = (doc) =>
  [...doc.output().matchAll(/\/Rect \[([^\]]+)\] \/Border \[0 0 0\] \/A <<\/S \/URI \/URI \(([^)]*)\)/g)].map((m) => ({
    rect: m[1].trim().split(/\s+/).map(Number),
    url: m[2],
  }));
const pages = async (doc) => {
  const parser = new PDFParse({ data: Buffer.from(doc.output("arraybuffer")) });
  const info = await parser.getInfo({ parsePageInfo: true });
  const t = await parser.getText();
  await parser.destroy();
  return { count: info.total, pages: t.pages.map((p) => p.text.split("\n").map((l) => l.trim()).filter((l) => l && !/^-- \d+ of \d+ --$/.test(l))) };
};

test("every profile PDF is A4 portrait", () => {
  for (const p of seed) {
    const { doc } = build(p);
    const size = doc.internal.pageSize;
    assert.ok(Math.abs(size.getWidth() - 595.28) < 0.1 && Math.abs(size.getHeight() - 841.89) < 0.1, `${p.id} is not A4`);
  }
});

test("page counts: Data Engineer is a deliberate two-page A4 resume, Database Developer fits one page, AI profile is a clean two pages", async () => {
  const counts = {};
  for (const p of seed) counts[p.id] = (await pages(build(p).doc)).count;
  assert.deepEqual(counts, { "data-engineer": 2, "ai-product-engineer": 2, "database-developer": 1, "anthropic-research-residency": 2 });
});

test("Portfolio is the first header item, shows the full https URL, and has an explicit URI annotation over the text", () => {
  for (const p of seed) {
    const { doc, r } = build(p);
    assert.equal(r.contactLinks[0].text, "Portfolio: https://rajasekar.work");
    const a = annots(doc)[0];
    assert.equal(a.url, "https://rajasekar.work");
    const [llx, lly, urx, ury] = a.rect;
    assert.ok(llx < urx && lly < ury, "rectangle must be normalised (lower-left to upper-right)");
    assert.ok(llx >= 0 && urx <= 595.28 && lly >= 0 && ury <= 841.89, "inside the page");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    const w = doc.getTextWidth("Portfolio: https://rajasekar.work");
    assert.ok(Math.abs(llx - 36) < 0.5, `starts at the left margin (${llx})`);
    assert.ok(Math.abs(urx - llx - w) < 0.5, `covers the whole text width (${urx - llx} vs ${w})`);
    // header baseline is 842 - y; height must span a 8.8pt text line
    assert.ok(ury - lly >= 8.8 && ury - lly <= 14);
  }
});

test("all header annotations are normalised, in order, with exact URIs", () => {
  const { doc } = build(seed[0]);
  const a = annots(doc).slice(0, 5);
  assert.deepEqual(a.map((x) => x.url), [
    "https://rajasekar.work",
    "mailto:rajasekarc1142@gmail.com",
    "tel:+917904348791",
    "https://linkedin.com/in/rajasekar-c",
    "https://github.com/innovinitylabs/",
  ]);
  // items sharing a line never overlap each other
  for (let i = 1; i < 4; i++) assert.ok(a[i].rect[0] >= a[i - 1].rect[2], "annotations do not overlap");
  assert.ok(a.every((x) => x.rect[0] < x.rect[2] && x.rect[1] < x.rect[3]));
});

test("project link annotations cover their visible labels and stay inside the margins", () => {
  for (const p of seed) {
    const { doc, r } = build(p);
    if (!r.projects.length) continue;
    const found = annots(doc);
    for (const pr of r.projects) {
      for (const l of pr.links) {
        const a = found.find((x) => x.url === l.url);
        assert.ok(a, `${p.id}: no annotation for ${l.url}`);
        assert.ok(a.rect[0] >= 36 - 0.5 && a.rect[2] <= 595.28 - 36 + 0.5, `${l.label} inside margins`);
      }
    }
  }
});

test("no text runs past the right margin (annotation-free check via wrapping safety)", async () => {
  for (const p of seed) {
    const { doc } = build(p);
    const raw = doc.output();
    // every text-show position x must be inside the page
    const xs = [...raw.matchAll(/([\d.]+) [\d.]+ Td/g)].map((m) => Number(m[1]));
    assert.ok(xs.length > 50);
    assert.ok(xs.every((x) => x >= 0 && x < 595.28 - 36), `${p.id}: text starts beyond right margin`);
  }
});

test("no orphaned section headings and no bullet split across a page break", async () => {
  const HEAD = /^(SUMMARY|SKILLS|EXPERIENCE|PROJECTS|EDUCATION)$/;
  for (const p of seed) {
    const { pages: pg } = await pages(build(p).doc);
    pg.forEach((lines, i) => {
      assert.ok(!HEAD.test(lines[lines.length - 1]), `${p.id}: heading "${lines[lines.length - 1]}" is the last line of page ${i + 1}`);
      if (i > 0) {
        const first = lines[0];
        assert.ok(!/^[a-z]/.test(first), `${p.id}: page ${i + 1} starts mid-sentence: "${first}"`);
      }
    });
  }
});

test("consistent formatting: the same section order and headings across profiles", async () => {
  const order = ["SUMMARY", "SKILLS", "EXPERIENCE", "EDUCATION"];
  for (const p of seed) {
    const flat = (await pages(build(p).doc)).pages.flat();
    let at = -1;
    for (const h of order) {
      const i = flat.indexOf(h);
      assert.ok(i > at, `${p.id}: ${h} missing or out of order`);
      at = i;
    }
  }
});
