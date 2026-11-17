#!/usr/bin/env node

/*
 * build.js
 *
 * Authoritative data -> rendered views.
 *
 * Data source:
 *   - DATABASE_URL set   -> master resume + profiles are read from PostgreSQL
 *                           (the production source of truth). A failure aborts
 *                           the build rather than publishing stale content.
 *   - DATABASE_URL unset -> resume-data.json and the seed profiles are used
 *                           (local/offline builds and CI).
 *
 * Outputs:
 *   - index.html           public portfolio (full master, all public projects)
 *   - resume-source.html   printable ATS resume of the DEFAULT profile
 *   - resume-default.json  resolved default profile, used by the browser PDF button
 *
 * Regions are delimited by matching HTML comments:
 *   <!-- build:KEY -->  ... generated content ...  <!-- /build:KEY -->
 * Everything between the markers is regenerated; the markers themselves stay.
 */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DEFAULT_JSON_PATH = path.join(ROOT, "resume-default.json");
const INDEX_PATH = path.join(ROOT, "index.html");
const SOURCE_PATH = path.join(ROOT, "resume-source.html");

const { normalizeMaster, resolveProfile, visibleLinks, contactLinks, publicContact } = require("./resume-resolve");

// Assigned in main() before any renderer runs.
let data; // normalised master (public portfolio view)
let resume; // resolved default profile (ATS resume view)

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
        edu.place ? `  <p>${escapeHtml(edu.place)}</p>` : "",
        `</article>`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

const webContact = () => {
  const c = data.contact;
  const card = (item, external) => {
    if (!item.url) {
      // display-only item (masked phone)
      return [
        `<div class="contact-card">`,
        `  <span class="contact-label">${escapeHtml(item.labelText)}</span>`,
        `  <span class="contact-value">${escapeHtml(item.label)}</span>`,
        `</div>`,
      ].join("\n");
    }
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

const webProjects = () =>
  data.projects
    .filter((p) => p.isPublic)
    .map((p) => {
      const tech = p.technologies.map((t) => `    <li>${escapeHtml(t)}</li>`).join("\n");
      const bullets = p.bullets.map((b) => `    <li>${escapeHtml(b)}</li>`).join("\n");
      // Primary link is the main destination; the rest are a compact secondary list.
      const [primary, ...secondary] = visibleLinks(p.links);
      const anchor = (l, cls) =>
        `<a class="${cls}" href="${escapeHtml(l.url)}" target="_blank" rel="noreferrer" data-link-type="${escapeHtml(l.type)}" title="${escapeHtml(l.label)}">${escapeHtml(l.url)}</a>`;
      const links = primary
        ? `${anchor(primary, "project-primary-link")}${
            secondary.length
              ? ` <span class="project-secondary-links">${secondary.map((l) => anchor(l, "project-secondary-link")).join(" · ")}</span>`
              : ""
          }`
        : "";
      return [
        `<article class="experience-card project-card">`,
        `  <div class="experience-header">`,
        `    <div>`,
        `      <h3>${escapeHtml(p.title)}</h3>`,
        `      <p>${escapeHtml([p.category, p.role].filter(Boolean).join(" · "))}</p>`,
        `    </div>`,
        `    <span class="timeline">${escapeHtml(p.status)}</span>`,
        `  </div>`,
        p.description ? `  <p class="project-description">${escapeHtml(p.description)}</p>` : "",
        p.bullets.length ? `  <ul>\n${bullets}\n  </ul>` : "",
        tech ? `  <ul class="tag-list">\n${tech}\n  </ul>` : "",
        links ? `  <p class="project-links">${links}</p>` : "",
        `</article>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

/* ------------------------------ print markup ------------------------------ */

const printContact = () => {
  const items = resume.contactLinks && resume.contactLinks.length ? resume.contactLinks : contactLinks(data.contact);
  return `<span class="contact-line">${items
    .map((i) => (i.url ? `<a href="${escapeHtml(i.url)}">${escapeHtml(i.text)}</a>` : escapeHtml(i.text)))
    .join(" | ")}</span>`;
};

const printExperience = () =>
  resume.experience
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
        role.context && role.context.length
          ? `  <p class="role-context">Client projects: ${escapeHtml(role.context.join("; "))}</p>`
          : "",
        `  <ul class="bullets">`,
        bullets,
        `  </ul>`,
        `</div>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

const printProof = () =>
  resume.proof.length
    ? `<section class="proof">\n${resume.proof
        .map((p) => `  <p><strong>${escapeHtml(p.value)}</strong> ${escapeHtml(p.text)}</p>`)
        .join("\n")}\n</section>`
    : "";

const printExtraSections = () =>
  (resume.extraSections || [])
    .map((x) => `<section>\n  <h2>${escapeHtml(x.heading)}</h2>\n${x.paragraphs.map((t) => `  <p>${escapeHtml(t)}</p>`).join("\n")}\n</section>`)
    .join("\n");

const printSkills = () =>
  resume.skills
    .map(
      (group) =>
        `<li><strong>${escapeHtml(group.group)}:</strong> ${escapeHtml(
          group.items.join(", ")
        )}</li>`
    )
    .join("\n");

const printEducation = () =>
  resume.education
    .map((edu) =>
      edu.inline
        ? `<li><strong>${escapeHtml(edu.title)}</strong> | ${escapeHtml(edu.inline)}</li>`
        : `<li><strong>${escapeHtml(edu.title)}</strong>${edu.detail ? `<br />${escapeHtml(edu.detail)}` : ""}</li>`
    )
    .join("\n");

const printProjects = () => {
  if (!resume.projects.length) return "";
  const compact = resume.projectDetail === "compact";
  const showcase = resume.pageMode === "two-page";
  const items = resume.projects
    .map((p) => {
      const cap = showcase ? (resume.showcase && resume.showcase.bulletsPerProject) || 0 : Infinity;
      const bullets = p.bullets.slice(0, cap).map((b) => `    <li>${escapeHtml(b)}</li>`).join("\n");
      const meta = [p.role, p.status].filter(Boolean).join(" | ");
      return [
        `<div class="role">`,
        `  <div class="role-header">`,
        `    <div class="role-title">`,
        `      <h3>${escapeHtml(p.title)}</h3>`,
        `      <p>${escapeHtml(meta)}</p>`,
        `    </div>`,
        `  </div>`,
        p.description && !compact ? `  <p class="project-description">${escapeHtml(p.description)}</p>` : "",
        p.bullets.length && !compact && (!showcase || (resume.showcase && resume.showcase.bulletsPerProject > 0)) ? `  <ul class="bullets">\n${bullets}\n  </ul>` : "",
        p.technologies.length ? `  <p class="project-tech"><strong>Technologies:</strong> ${escapeHtml(p.technologies.join(", "))}</p>` : "",
        p.links.length
          ? `  <p class="project-tech"><strong>Links:</strong> ${p.links
              .map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.url)}</a>`)
              .join(" | ")}</p>`
          : "",
        `</div>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
  if (resume.pageMode === "two-page" && resume.showcase) {
    return `<section class="page-break">\n  <h2>${escapeHtml(resume.showcase.heading)}</h2>\n  <p class="showcase-intro">${escapeHtml(resume.showcase.intro)}</p>\n${indent(items, 2)}\n</section>`;
  }
  return `<section>\n  <h2>Projects</h2>\n${indent(items, 2)}\n</section>`;
};

/* -------------------------------- data load ------------------------------- */

const loadData = async () => {
  const db = require("./lib/db");
  if (db.isConfigured()) {
    const { defaultStore: store } = require("./lib/store");
    try {
      const [masterState, profiles] = await Promise.all([store.getMaster(), store.listProfiles()]);
      const profile = profiles.find((p) => p.isDefault) || profiles[0];
      console.log(`Reading master v${masterState.version} and profile "${profile.id}" from PostgreSQL`);
      return { master: masterState.master, profile };
    } finally {
      await db.closePool();
    }
  }
  console.log("DATABASE_URL not set: building from resume-data.json and seed profiles");
  const seedProfiles = require("./lib/seed-profiles");
  return {
    master: normalizeMaster(JSON.parse(fs.readFileSync(path.join(ROOT, "resume-data.json"), "utf8"))),
    profile: seedProfiles.find((p) => p.isDefault) || seedProfiles[0],
  };
};

/* -------------------------------- assembly -------------------------------- */

const assemble = () => {
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
indexHtml = replaceRegion(indexHtml, "projects", webProjects(), 14);
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
sourceHtml = replaceRegion(sourceHtml, "name", escapeHtml(resume.name), 0);
sourceHtml = replaceRegion(sourceHtml, "title", escapeHtml(resume.title), 0);
sourceHtml = replaceRegion(sourceHtml, "proof", printProof(), 8);
sourceHtml = replaceRegion(sourceHtml, "summary", escapeHtml(resume.summary), 10);
sourceHtml = replaceRegion(sourceHtml, "contact", printContact(), 10);
sourceHtml = replaceRegion(sourceHtml, "experience", printExperience(), 8);
sourceHtml = replaceRegion(sourceHtml, "skills", printSkills(), 10);
sourceHtml = replaceRegion(sourceHtml, "education", printEducation(), 10);
sourceHtml = replaceRegion(sourceHtml, "projects", `${printProjects()}\n${printExtraSections()}`, 8);
fs.writeFileSync(SOURCE_PATH, sourceHtml);

fs.writeFileSync(DEFAULT_JSON_PATH, JSON.stringify(resume, null, 2) + "\n");

console.log(`Built index.html, resume-source.html and resume-default.json (profile "${resume.profileId}")`);
};

loadData()
  .then(({ master, profile }) => {
    // Public outputs only: the phone number is masked and not linked. The admin and the database keep the full number.
    data = { ...master, contact: publicContact(master.contact) };
    resume = resolveProfile(profile, data);
    assemble();
  })
  .catch((err) => {
    console.error("Build failed:", err && err.message ? err.message : err);
    process.exit(1);
  });
