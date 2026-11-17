const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { validateMaster } = require("../lib/validate");
const { normalizeLinks, visibleLinks, normalizeMaster } = require("../resume-resolve");
const { upgradeProjectLinks } = require("../lib/migrations");
const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "resume-data.json"), "utf8"));

const withLinks = (links) => {
  const d = JSON.parse(JSON.stringify(RAW));
  d.projects[0].links = links;
  return validateMaster(d);
};
const L = (label, url, extra = {}) => ({ label, url, type: "website", primary: false, visible: true, ...extra });

test("legacy {label,url} links gain defaults; the first becomes primary", () => {
  const n = normalizeLinks([{ label: "A", url: "https://a.com" }, { label: "B", url: "https://b.com" }]);
  assert.deepEqual(n.map((l) => [l.type, l.primary, l.visible]), [["website", true, true], ["website", false, true]]);
});

test("visibleLinks hides invisible links and puts the primary first", () => {
  const v = visibleLinks([L("Two", "https://b.com"), L("One", "https://a.com", { primary: true }), L("Hidden", "https://c.com", { visible: false })]);
  assert.deepEqual(v.map((l) => l.label), ["One", "Two"]);
});

test("validation accepts multiple links with types, primary and visibility", () => {
  const { errors, value } = withLinks([
    L("Official Website", "https://madraschecks.com", { primary: true }),
    L("Generator", "https://art.madraschecks.com", { type: "generator" }),
    L("Docs", "https://example.com/docs", { type: "documentation", visible: false }),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(value.projects[0].links.length, 3);
  assert.equal(value.projects[0].links[1].type, "generator");
});

test("validation rejects invalid URLs, types, two primaries, hidden primary", () => {
  const bad = (links, re) => {
    const { errors } = withLinks(links);
    assert.ok(errors.some((e) => re.test(`${e.field} ${e.message}`)), JSON.stringify(errors));
  };
  bad([L("x", "not a url")], /url.*valid http/);
  bad([L("x", "javascript:alert(1)")], /url/);
  bad([L("x", "ftp://example.com")], /url/);
  bad([L("x", "https://localhost")], /url/);
  bad([L("", "https://a.com")], /label/);
  bad([L("x", "https://a.com", { type: "teleporter" })], /type/);
  bad([L("a", "https://a.com", { primary: true }), L("b", "https://b.com", { primary: true })], /only one link can be marked primary/);
  bad([L("a", "https://a.com", { primary: true, visible: false })], /primary link must be visible/);
  bad([L("a", "https://a.com", { visible: "yes" })], /visible/);
});

test("seed data: verified custom domains, no visible vercel.app links, one primary per project", () => {
  const m = normalizeMaster(RAW);
  for (const p of m.projects) {
    assert.ok(p.links.filter((l) => l.primary).length <= 1, p.title);
    for (const l of visibleLinks(p.links)) assert.ok(!/vercel\.app/.test(l.url), `${p.title} shows ${l.url}`);
  }
  const by = (id) => m.projects.find((p) => p.id === id);
  const urls = (id) => visibleLinks(by(id).links).map((l) => l.url);
  assert.deepEqual(urls("project-madras-checks"), ["https://madraschecks.com", "https://madraschecks.com/art/", "https://art.madraschecks.com"]);
  assert.equal(urls("project-onchainrugs")[0], "https://onchainrugs.art");
  assert.equal(urls("project-uravu")[0], "https://www.uravu.social");
  assert.ok(urls("project-anekaroopam").includes("https://github.com/innovinitylabs/anekaroopam-site"));
  assert.equal(urls("project-valipokkann")[0], "https://valipokkann.in");
  // deployment URLs are preserved, just hidden
  assert.ok(by("project-onchainrugs").links.some((l) => l.url === "https://onchain-rugs.vercel.app" && !l.visible));
});

test("migration 003 upgrades legacy links, keeps user-edited links, and is idempotent", () => {
  const legacy = {
    projects: [
      { id: "project-onchainrugs", links: [{ label: "onchain-rugs.vercel.app", url: "https://onchain-rugs.vercel.app" }] },
      { id: "project-uravu", links: [{ label: "my custom", url: "https://uravu.example.org" }] },
      { id: "project-madras-checks", links: [{ label: "madraschecks-site.vercel.app", url: "https://madraschecks-site.vercel.app" }] },
      { id: "project-hard-copy", links: [] },
    ],
  };
  assert.equal(upgradeProjectLinks(legacy), true);
  const [rugs, uravu, madras, hc] = legacy.projects;
  assert.equal(rugs.links[0].url, "https://onchainrugs.art");
  assert.equal(rugs.links[0].primary, true);
  assert.ok(rugs.links.some((l) => l.url === "https://onchain-rugs.vercel.app" && l.visible === false));
  assert.equal(uravu.links.length, 1);
  assert.equal(uravu.links[0].url, "https://uravu.example.org", "user-edited URL untouched");
  assert.deepEqual(madras.links.filter((l) => l.visible).map((l) => l.url), ["https://madraschecks.com", "https://madraschecks.com/art/", "https://art.madraschecks.com"]);
  assert.deepEqual(hc.links, []);
  assert.equal(upgradeProjectLinks(legacy), false, "second run changes nothing");
});

test("public build renders labels, primary first, secondary compact, no raw vercel URLs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const card = html.slice(html.indexOf("<h3>Madras Checks</h3>"));
  const block = card.slice(0, card.indexOf("</article>"));
  assert.match(block, /project-primary-link[^>]*>Official Website</);
  assert.match(block, /project-secondary-link[^>]*>Art Page</);
  assert.match(block, /href="https:\/\/art\.madraschecks\.com"[^>]*>Art Platform &amp; Generator</);
  assert.ok(block.indexOf("Official Website") < block.indexOf("Art Page"));
  assert.ok(!/vercel\.app/.test(html.slice(html.indexOf('id="projects"'), html.indexOf('id="skills"'))));
});

test("admin page: full-width preview sits below the editor inside the main column", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "admin", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "admin", "admin.css"), "utf8");
  const editor = html.indexOf('id="profile-editor-form"');
  const preview = html.indexOf('id="preview-card"');
  assert.ok(editor > 0 && preview > editor, "preview comes after the editor");
  assert.ok(html.indexOf('class="admin-main-col"') < editor);
  assert.ok(!html.includes("admin-preview-col"), "narrow third column is gone");
  assert.match(css, /grid-template-columns: 280px minmax\(0, 1fr\)/);
  assert.match(css, /\.resume-page\s*\{[^}]*width: 794px/s, "A4 width");
  assert.match(css, /min-height: 1123px/);
  assert.ok(html.includes('data-preview-mode="saved"') && html.includes('data-preview-mode="draft"'));
  assert.ok(html.includes('id="btn-export-profile-pdf"'));
});
