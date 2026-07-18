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

const displayUrl = (url) =>
  String(url)
    .replace(/^https?:\/\//, "")
    .replace(/^mailto:/, "")
    .replace(/^tel:/, "")
    .replace(/\/$/, "");

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

const webProjects = () =>
  data.projects
    .map((project) => {
      const links = project.links
        .map(
          (link) =>
            `  <a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(
              link.label
            )}</a>`
        )
        .join("\n");
      return [
        `<article class="project-card">`,
        `  <div class="project-top">`,
        `    <h3>${escapeHtml(project.name)}</h3>`,
        `  </div>`,
        `  <ul>`,
        `    <li>${escapeHtml(project.description)}</li>`,
        `  </ul>`,
        `  <div class="project-links project-links-bottom">`,
        links,
        `  </div>`,
        `</article>`,
      ].join("\n");
    })
    .join("\n\n");

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
  const l = data.links;
  return [
    `<a href="${escapeHtml(l.portfolio.url)}" target="_blank" rel="noreferrer">Portfolio</a>`,
    `<a href="${escapeHtml(l.creative.url)}" target="_blank" rel="noreferrer">Creative</a>`,
  ].join("\n");
};

const webAwards = () =>
  data.awards
    .map((award) =>
      [
        `<article class="experience-card">`,
        `  <div class="experience-header">`,
        `    <div>`,
        `      <h3>${escapeHtml(award.title)}</h3>`,
        `      <p>${escapeHtml(award.org)}</p>`,
        `    </div>`,
        `  </div>`,
        `  <ul>`,
        `    <li>${escapeHtml(award.description)}</li>`,
        `  </ul>`,
        `</article>`,
      ].join("\n")
    )
    .join("\n\n");

/* ------------------------------ print markup ------------------------------ */

const printContact = () => {
  const c = data.contact;
  return [
    escapeHtml(c.phone.label),
    `Email: ${escapeHtml(displayUrl(c.email.url))}`,
    `LinkedIn: ${escapeHtml(c.linkedin.label)}`,
    `GitHub: ${escapeHtml(c.github.label)}`,
  ].join(" | ");
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

const printProjects = () =>
  data.projects
    .map((project) => {
      const links = project.links
        .map((link) => `${link.label}: ${displayUrl(link.url)}`)
        .join(" | ");
      return [
        `<div class="project">`,
        `  <h3>${escapeHtml(project.name)}</h3>`,
        `  <p>${escapeHtml(project.description)} ${escapeHtml(links)}</p>`,
        `</div>`,
      ].join("\n");
    })
    .join("\n\n");

const printAwards = () =>
  data.awards
    .map((award) =>
      [
        `<div class="project">`,
        `  <h3>${escapeHtml(award.title)} - ${escapeHtml(award.org)}</h3>`,
        `  <p>${escapeHtml(award.description)}</p>`,
        `</div>`,
      ].join("\n")
    )
    .join("\n\n");

const printSkills = () =>
  data.skills
    .map(
      (group) =>
        `<li>${escapeHtml(group.group)}: ${escapeHtml(group.items.join(", "))}</li>`
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

const printFooter = () => {
  const l = data.links;
  return `Portfolio: ${escapeHtml(displayUrl(l.portfolio.url))} | Creative: ${escapeHtml(
    displayUrl(l.creative.url)
  )}`;
};

/* -------------------------------- assembly -------------------------------- */

let indexHtml = fs.readFileSync(INDEX_PATH, "utf8");
indexHtml = replaceRegion(indexHtml, "eyebrow", escapeHtml(data.title), 0);
indexHtml = replaceRegion(indexHtml, "summary", escapeHtml(data.summary), 16);
indexHtml = replaceRegion(indexHtml, "experience", webExperience(), 14);
indexHtml = replaceRegion(indexHtml, "projects", webProjects(), 14);
indexHtml = replaceRegion(indexHtml, "awards", webAwards(), 14);
indexHtml = replaceRegion(indexHtml, "skills", webSkills(), 14);
indexHtml = replaceRegion(indexHtml, "education", webEducation(), 14);
indexHtml = replaceRegion(indexHtml, "contact", webContact(), 14);
indexHtml = replaceRegion(indexHtml, "footer-links", webFooterLinks(), 12);
fs.writeFileSync(INDEX_PATH, indexHtml);

let sourceHtml = fs.readFileSync(SOURCE_PATH, "utf8");
sourceHtml = replaceRegion(sourceHtml, "title", escapeHtml(data.title), 0);
sourceHtml = replaceRegion(sourceHtml, "summary", escapeHtml(data.summary), 10);
sourceHtml = replaceRegion(sourceHtml, "contact", printContact(), 10);
sourceHtml = replaceRegion(sourceHtml, "experience", printExperience(), 8);
sourceHtml = replaceRegion(sourceHtml, "projects", printProjects(), 8);
sourceHtml = replaceRegion(sourceHtml, "awards", printAwards(), 8);
sourceHtml = replaceRegion(sourceHtml, "skills", printSkills(), 10);
sourceHtml = replaceRegion(sourceHtml, "education", printEducation(), 10);
sourceHtml = replaceRegion(sourceHtml, "footer", printFooter(), 10);
fs.writeFileSync(SOURCE_PATH, sourceHtml);

console.log("Built index.html and resume-source.html from resume-data.json");
