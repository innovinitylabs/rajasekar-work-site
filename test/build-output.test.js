const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

test("build generates website and ATS resume from source data", () => {
  execFileSync(process.execPath, ["build.js"], { cwd: ROOT, stdio: "pipe" });

  const data = JSON.parse(
    fs.readFileSync(path.join(ROOT, "resume-data.json"), "utf8")
  );
  const defaultResume = JSON.parse(
    fs.readFileSync(path.join(ROOT, "resume-default.json"), "utf8")
  );
  const website = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const resume = fs.readFileSync(path.join(ROOT, "resume-source.html"), "utf8");

  assert.ok(website.includes("<!-- build:name -->"));
  assert.ok(website.includes("<!-- build:meta-description -->"));
  assert.ok(website.includes("<!-- build:proof -->"));
  assert.ok(website.includes("<!-- build:hero-actions -->"));
  assert.ok(resume.includes("<!-- build:name -->"));
  assert.ok(website.includes(data.contact.github.url));

  data.proof.forEach(({ value, text }) => {
    assert.ok(website.includes(value));
    assert.ok(website.includes(text));
  });

  assert.ok(!website.includes('id="awards"'));
  assert.ok(!resume.includes("<h2>Awards</h2>"));
  assert.ok(!resume.includes("valipokkann.in"));
  assert.ok(resume.includes("rajasekar.work"));
  assert.equal((resume.match(/class="contact-line"/g) || []).length, 2);
  assert.ok(resume.includes("<strong>Programming Languages:</strong>"));

  // Public portfolio shows every public master project; the ATS resume shows the default profile's selection.
  data.projects.filter((p) => p.isPublic !== false).forEach((p) => {
    assert.ok(website.includes(`<h3>${p.title}</h3>`), `portfolio missing project ${p.title}`);
  });
  assert.ok(website.includes('id="projects"'));
  assert.equal(defaultResume.profileId, "data-engineer");
  assert.ok(resume.includes("<h2>Projects</h2>"));
  assert.ok(resume.includes("<h3>OnchainRugs</h3>") && resume.includes("<h3>Uravu</h3>"));
  assert.ok(!resume.includes("<h3>Hard COpy</h3>"), "ATS resume must not force all eight projects");
});

test("ATS resume uses conventional sections in parser-friendly order", () => {
  const resume = fs.readFileSync(path.join(ROOT, "resume-source.html"), "utf8");
  const expectedOrder = [
    "<h1",
    "Data Engineer",
    "build:contact",
    "<h2>Summary</h2>",
    "<h2>Skills</h2>",
    "<h2>Experience</h2>",
    "Independent Software Developer",
    "Jun 2025 - Present",
    "Digit Insurance",
    "Data Engineer",
    "Nov 2023 - Jun 2025",
    "Appzwork",
    "Software Engineer",
    "Jan 2020 - Nov 2023",
    "<h2>Projects</h2>",
    "<h2>Education</h2>",
  ];

  let previous = -1;
  expectedOrder.forEach((token) => {
    const position = resume.indexOf(token, previous + 1);
    assert.ok(position > previous, `Missing or out-of-order token: ${token}`);
    previous = position;
  });
});
