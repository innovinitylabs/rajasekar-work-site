#!/usr/bin/env node

/*
 * build.js
 *
 * Single source of truth -> two rendered views.
 *
 * Reads resume-data.json and injects generated HTML into the marked regions
 * of index.html (website) and resume-source.html (print/PDF source).
 * Edit resume-data.json, then run `node build.js` to update both files.
 *
 * Regions are delimited by matching HTML comments:
 *   <!-- build:KEY -->  ... generated content ...  <!-- /build:KEY -->
 * Everything between the markers is regenerated; the markers themselves stay.
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DATA_PATH = path.join(ROOT, "resume-data.json");
const INDEX_PATH = path.join(ROOT, "index.html");
const SOURCE_PATH = path.join(ROOT, "resume-source.html");

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const indent = (block, spaces) => {
  const pad = " ".repeat(spaces);
  return block
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
};

const replaceRegion = (html, key, inner, padSpaces) => {
  const open = `<!-- build:${key} -->`;
  const close = `<!-- /build:${key} -->`;
  const pattern = new RegExp(
    `${open}[\\s\\S]*?${close}`,
    "m"
  );

  if (!pattern.test(html)) {
    throw new Error(`Missing build markers for "${key}"`);
  }

  const body = inner.trim().length
    ? `\n${indent(inner.trim(), padSpaces)}\n${" ".repeat(Math.max(padSpaces - 2, 0))}`
    : "";

  return html.replace(pattern, `${open}${body}${close}`);
};

/* ----------------------------- website markup ---------------------------- */

const webExperience = () =>
  data.experience
    .map((role) => {
      const bullets = role.bullets
        .map((b) => `  <li>${escapeHtml(b)}</li>`)
        .join("\n");
      return [
        `<article class="experience-card">`,
        `  <div class="experience-header">`,
        `    <div>`,
        `      <h3>${escapeHtml(role.org)}</h3>`,
        `      <p>${escapeHtml(role.role)}</p>`,
        `    </div>`,
        `    <span class="timeline">${escapeHtml(role.period)}</span>`,
        `  </div>`,
        `  <ul>`,
        bullets,
        `  </ul>`,
        `</article>`,
      ].join("\n");
    })
    .join("\n\n");

const webProof = () =>
  data.proof
    .map(
      (proof) =>
        [
          `<article class="proof-card">`,
          `  <span class="proof-value">${escapeHtml(proof.value)}</span>`,
          `  <p class="proof-text">${escapeHtml(proof.text)}</p>`,
          `</article>`,
        ].join("\n")
    )
    .join("\n\n");

const webHeroActions = () =>
  [
    `<a class="button button-primary" href="#experience">View Experience</a>`,
    `<a class="button button-secondary" href="${escapeHtml(
      data.contact.github.url
    )}" target="_blank" rel="noreferrer">GitHub</a>`,
    `<a class="button button-secondary" href="resume-source.html" id="download-resume">Download Resume</a>`,
  ].join("\n");

const webSkills = () =>
  data.skills
    .map((group) => {
      const items = group.items
        .map((item) => `  <li>${escapeHtml(item)}</li>`)
        .join("\n");
      return [
        `<article class="skill-group">`,
        `  <h3>${escapeHtml(group.group)}</h3>`,
        `  <ul class="tag-list">`,
        items,
        `  </ul>`,
        `</article>`,
      ].join("\n");
    })
    .join("\n\n");

const webEducation = () =>
  data.education
    .map((edu) =>
      [
        `<article class="education-card">`,
        `  <div class="education-top">`,
        `    <h3>${escapeHtml(edu.level)}</h3>`,
        `    <span class="education-meta">${escapeHtml(edu.meta)}</span>`,
        `  </div>`,
        `  <p>${escapeHtml(edu.place)}</p>`,
        `</article>`,
      ].join("\n")
    )
    .join("\n\n");

const webContact = () => {
  const c = data.contact;
  const card = (item, external) => {
    const attrs = external ? ` target="_blank" rel="noreferrer"` : "";
    return [
      `<a class="contact-card" href="${escapeHtml(item.url)}"${attrs}>`,
      `  <span class="contact-label">${escapeHtml(item.labelText)}</span>`,
      `  <span class="contact-value">${escapeHtml(item.label)}</span>`,
      `</a>`,
    ].join("\n");
  };
  return [
    card({ ...c.phone, labelText: "Phone" }, false),
    card({ ...c.email, labelText: "Email" }, false),
    card({ ...c.linkedin, labelText: "LinkedIn" }, true),
    card({ ...c.github, labelText: "GitHub" }, true),
  ].join("\n");
};

const webFooterLinks = () => {
  const c = data.contact;
  return [
    `<a href="${escapeHtml(c.portfolio.url)}" target="_blank" rel="noreferrer">Portfolio</a>`,
    `<a href="${escapeHtml(c.creative.url)}" target="_blank" rel="noreferrer">Creative</a>`,
  ].join("\n");
};

/* ------------------------------ print markup ------------------------------ */

const printContact = () => {
  const c = data.contact;
  const link = (item, prefix = "") =>
    `<a href="${escapeHtml(item.url)}">${prefix}${escapeHtml(
      item.label
    )}</a>`;
  const primary = [
    link(c.phone),
    link(c.email),
    link(c.linkedin, "LinkedIn: "),
  ].join(" | ");
  const secondary = [
    link(c.github, "GitHub: "),
    link(c.portfolio, "Portfolio: "),
  ].join(" | ");

  return [
    `<span class="contact-line">${primary}</span>`,
    `<span class="contact-line">${secondary}</span>`,
  ].join("\n");
};

const printExperience = () =>
  data.experience
    .map((role) => {
      const bullets = role.bullets
        .map((b) => `  <li>${escapeHtml(b)}</li>`)
        .join("\n");
      return [
        `<div class="role">`,
        `  <div class="role-header">`,
        `    <div class="role-title">`,
        `      <h3>${escapeHtml(role.org)}</h3>`,
        `      <p>${escapeHtml(role.role)}</p>`,
        `    </div>`,
        `    <div class="role-time">${escapeHtml(role.period)}</div>`,
        `  </div>`,
        `  <ul class="bullets">`,
        bullets,
        `  </ul>`,
        `</div>`,
      ].join("\n");
    })
    .join("\n\n");

const printSkills = () =>
  data.skills
    .map(
      (group) =>
        `<li><strong>${escapeHtml(group.group)}:</strong> ${escapeHtml(
          group.items.join(", ")
        )}</li>`
    )
    .join("\n");

const printEducation = () =>
  data.education
    .map(
      (edu) =>
        `<li>${escapeHtml(edu.level)} - ${escapeHtml(edu.place)} - ${escapeHtml(
          edu.meta
        )}</li>`
    )
    .join("\n");

/* -------------------------------- assembly -------------------------------- */

let indexHtml = fs.readFileSync(INDEX_PATH, "utf8");
indexHtml = replaceRegion(
  indexHtml,
  "meta-description",
  `<meta name="description" content="${escapeHtml(data.summary)}" />`,
  4
);
indexHtml = replaceRegion(
  indexHtml,
  "page-title",
  `<title>${escapeHtml(data.name)} | ${escapeHtml(data.title)}</title>`,
  4
);
indexHtml = replaceRegion(indexHtml, "brand-name", escapeHtml(data.name), 0);
indexHtml = replaceRegion(indexHtml, "name", escapeHtml(data.name), 0);
indexHtml = replaceRegion(indexHtml, "eyebrow", escapeHtml(data.title), 0);
indexHtml = replaceRegion(indexHtml, "summary", escapeHtml(data.summary), 16);
indexHtml = replaceRegion(indexHtml, "hero-actions", webHeroActions(), 16);
indexHtml = replaceRegion(indexHtml, "proof", webProof(), 14);
indexHtml = replaceRegion(indexHtml, "experience", webExperience(), 14);
indexHtml = replaceRegion(indexHtml, "skills", webSkills(), 14);
indexHtml = replaceRegion(indexHtml, "education", webEducation(), 14);
indexHtml = replaceRegion(indexHtml, "contact", webContact(), 14);
indexHtml = replaceRegion(indexHtml, "footer-links", webFooterLinks(), 12);
fs.writeFileSync(INDEX_PATH, indexHtml);

let sourceHtml = fs.readFileSync(SOURCE_PATH, "utf8");
sourceHtml = replaceRegion(
  sourceHtml,
  "page-title",
  `<title>${escapeHtml(data.name)} Resume</title>`,
  4
);
sourceHtml = replaceRegion(sourceHtml, "name", escapeHtml(data.name), 0);
sourceHtml = replaceRegion(sourceHtml, "title", escapeHtml(data.title), 0);
sourceHtml = replaceRegion(sourceHtml, "summary", escapeHtml(data.summary), 10);
sourceHtml = replaceRegion(sourceHtml, "contact", printContact(), 10);
sourceHtml = replaceRegion(sourceHtml, "experience", printExperience(), 8);
sourceHtml = replaceRegion(sourceHtml, "skills", printSkills(), 10);
sourceHtml = replaceRegion(sourceHtml, "education", printEducation(), 10);
fs.writeFileSync(SOURCE_PATH, sourceHtml);

console.log("Built index.html and resume-source.html from resume-data.json");
