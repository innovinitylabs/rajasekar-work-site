"use strict";

/**
 * Server-side validation for everything the admin API accepts.
 * Each validator returns { value, errors } where `value` is a sanitised copy
 * (unknown keys dropped, strings trimmed) and `errors` is a list of
 * { field, message }. A non-empty `errors` list means "reject with HTTP 400".
 */

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const LAYOUTS = ["ats-classic", "modern-visual", "executive"];
const APPLICATION_STATUSES = [
  "Draft",
  "Applied",
  "Screening",
  "Interviewing",
  "Offered",
  "Rejected",
  "Archived",
];
const PROJECT_STATUSES = [
  "Deployed",
  "In development",
  "Prototype",
  "Experimental",
  "Needs review",
];
const PROJECT_DETAILS = ["detailed", "compact"];
const SECTION_KEYS = [
  "proof",
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
  "contact",
];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

class Collector {
  constructor() {
    this.errors = [];
  }
  add(field, message) {
    this.errors.push({ field, message });
  }
  str(obj, key, { field = key, min = 0, max = 500, required = false, nullable = false } = {}) {
    const raw = obj[key];
    if (raw === undefined || raw === null) {
      if (nullable && raw === null) return null;
      if (required) this.add(field, "is required");
      return nullable ? null : "";
    }
    if (typeof raw !== "string") {
      this.add(field, "must be a string");
      return "";
    }
    const value = raw.trim();
    if (value.length < min || (required && value.length === 0)) {
      this.add(field, min > 1 ? `must be at least ${min} characters` : "must not be empty");
    }
    if (value.length > max) this.add(field, `must be at most ${max} characters`);
    return value;
  }
  strArray(obj, key, { field = key, maxItems = 100, maxLen = 300 } = {}) {
    const raw = obj[key];
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      this.add(field, "must be an array of strings");
      return [];
    }
    if (raw.length > maxItems) this.add(field, `must have at most ${maxItems} items`);
    const out = [];
    raw.forEach((item, i) => {
      if (typeof item !== "string" || !item.trim()) {
        this.add(`${field}[${i}]`, "must be a non-empty string");
      } else if (item.trim().length > maxLen) {
        this.add(`${field}[${i}]`, `must be at most ${maxLen} characters`);
      } else {
        out.push(item.trim());
      }
    });
    return out;
  }
  id(obj, key = "id", { field = key, required = true } = {}) {
    const value = this.str(obj, key, { field, max: 64, required });
    if (value && !ID_RE.test(value)) {
      this.add(field, "must be lowercase letters, digits and hyphens (max 64 chars)");
    }
    return value;
  }
}

const isRealDate = (s) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const LINK_TYPES = ["website", "app", "generator", "github", "documentation", "demo", "other"];

const isHttpUrl = (u) => {
  try {
    const url = new URL(u);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname.includes("."));
  } catch {
    return false;
  }
};

const isSafeUrl = (u) => /^(https?:\/\/|mailto:|tel:)/i.test(u);

const unique = (arr) => [...new Set(arr)];

/* ------------------------------ profiles --------------------------------- */

/**
 * @param {object} input
 * @param {object} [master] normalised master, used for reference checks.
 */
const validateProfile = (input, master = null) => {
  const c = new Collector();
  if (!isPlainObject(input)) {
    return { value: null, errors: [{ field: "body", message: "must be a JSON object" }] };
  }

  const value = {
    id: c.id(input),
    name: c.str(input, "name", { required: true, max: 120 }),
    isDefault: input.isDefault === true,
    targetTitle: c.str(input, "targetTitle", { max: 200 }),
    summaryOverride: null,
    selectedExperience: unique(c.strArray(input, "selectedExperience", { maxLen: 128 })),
    selectedBullets: {},
    selectedSkills: unique(c.strArray(input, "selectedSkills", { maxLen: 128 })),
    selectedProjects: unique(c.strArray(input, "selectedProjects", { maxLen: 128 })),
    sectionVisibility: {},
    layout: LAYOUTS.includes(input.layout) ? input.layout : "ats-classic",
    accentColor: "#2457c5",
    projectDetail: "detailed",
  };

  if (input.projectDetail !== undefined) {
    if (PROJECT_DETAILS.includes(input.projectDetail)) value.projectDetail = input.projectDetail;
    else c.add("projectDetail", `must be one of: ${PROJECT_DETAILS.join(", ")}`);
  }

  if (input.isDefault !== undefined && typeof input.isDefault !== "boolean") {
    c.add("isDefault", "must be a boolean");
  }

  if (input.layout !== undefined && !LAYOUTS.includes(input.layout)) {
    c.add("layout", `must be one of: ${LAYOUTS.join(", ")}`);
  }

  if (input.accentColor !== undefined && input.accentColor !== null && input.accentColor !== "") {
    if (typeof input.accentColor === "string" && HEX_RE.test(input.accentColor)) {
      value.accentColor = input.accentColor;
    } else {
      c.add("accentColor", "must be a #RRGGBB hex colour");
    }
  }

  const summary = c.str(input, "summaryOverride", { max: 2000, nullable: true });
  value.summaryOverride = summary ? summary : null;

  if (input.selectedBullets !== undefined && input.selectedBullets !== null) {
    if (!isPlainObject(input.selectedBullets)) {
      c.add("selectedBullets", "must be an object mapping experience id to bullet ids");
    } else {
      for (const [expId, list] of Object.entries(input.selectedBullets)) {
        if (!Array.isArray(list) || list.some((b) => typeof b !== "string")) {
          c.add(`selectedBullets.${expId}`, "must be an array of bullet ids");
        } else {
          value.selectedBullets[expId] = unique(list);
        }
      }
    }
  }

  if (input.sectionVisibility !== undefined && input.sectionVisibility !== null) {
    if (!isPlainObject(input.sectionVisibility)) {
      c.add("sectionVisibility", "must be an object");
    } else {
      for (const [k, v] of Object.entries(input.sectionVisibility)) {
        if (!SECTION_KEYS.includes(k)) {
          c.add(`sectionVisibility.${k}`, `unknown section (allowed: ${SECTION_KEYS.join(", ")})`);
        } else if (typeof v !== "boolean") {
          c.add(`sectionVisibility.${k}`, "must be a boolean");
        } else {
          value.sectionVisibility[k] = v;
        }
      }
    }
  }

  if (master) {
    const expIds = new Set(master.experience.map((e) => e.id));
    const skillIds = new Set(master.skills.map((s) => s.id));
    const projectIds = new Set((master.projects || []).map((p) => p.id));
    value.selectedExperience.forEach((id) => {
      if (!expIds.has(id)) c.add("selectedExperience", `unknown experience id "${id}"`);
    });
    value.selectedSkills.forEach((id) => {
      if (!skillIds.has(id)) c.add("selectedSkills", `unknown skill group id "${id}"`);
    });
    value.selectedProjects.forEach((id) => {
      if (!projectIds.has(id)) c.add("selectedProjects", `unknown project id "${id}"`);
    });
    for (const [expId, bullets] of Object.entries(value.selectedBullets)) {
      const exp = master.experience.find((e) => e.id === expId);
      if (!exp) {
        c.add(`selectedBullets.${expId}`, "unknown experience id");
        continue;
      }
      const valid = new Set(exp.bulletDetails.map((b) => b.id));
      bullets.forEach((b) => {
        if (!valid.has(b)) c.add(`selectedBullets.${expId}`, `unknown bullet id "${b}"`);
      });
    }
  }

  return { value, errors: c.errors };
};

/* ---------------------------- applications ------------------------------- */

const validateApplication = (input) => {
  const c = new Collector();
  if (!isPlainObject(input)) {
    return { value: null, errors: [{ field: "body", message: "must be a JSON object" }] };
  }

  const value = {
    id: c.id(input),
    company: c.str(input, "company", { required: true, max: 200 }),
    jobTitle: c.str(input, "jobTitle", { required: true, max: 200 }),
    jobDescription: c.str(input, "jobDescription", { max: 20000 }),
    applicationDate: c.str(input, "applicationDate", { required: true, max: 10 }),
    profileId: null,
    status: input.status,
    notes: c.str(input, "notes", { max: 5000 }),
    selectedSkills: unique(c.strArray(input, "selectedSkills", { maxItems: 200 })),
    selectedExperience: unique(c.strArray(input, "selectedExperience", { maxLen: 128 })),
    generatedResumeVersion: c.str(input, "generatedResumeVersion", { max: 200 }),
  };

  if (value.applicationDate && !isRealDate(value.applicationDate)) {
    c.add("applicationDate", "must be a valid YYYY-MM-DD date");
  }
  if (!APPLICATION_STATUSES.includes(value.status)) {
    c.add("status", `must be one of: ${APPLICATION_STATUSES.join(", ")}`);
  }
  if (input.profileId !== undefined && input.profileId !== null && input.profileId !== "") {
    if (typeof input.profileId === "string" && ID_RE.test(input.profileId)) {
      value.profileId = input.profileId;
    } else {
      c.add("profileId", "must be a valid profile id");
    }
  }

  return { value, errors: c.errors };
};

/* -------------------------------- master --------------------------------- */

const validateContactItem = (c, obj, key) => {
  const item = obj[key];
  if (item === undefined) return undefined;
  if (!isPlainObject(item)) {
    c.add(`contact.${key}`, "must be an object with label and url");
    return undefined;
  }
  const label = c.str(item, "label", { field: `contact.${key}.label`, required: true, max: 200 });
  const url = c.str(item, "url", { field: `contact.${key}.url`, required: true, max: 500 });
  if (url && !isSafeUrl(url)) {
    c.add(`contact.${key}.url`, "must start with http://, https://, mailto: or tel:");
  }
  return { label, url };
};

/**
 * Validates and sanitises the master resume document.
 * Requires explicit stable ids on experience, skills, education and projects.
 */
const validateMaster = (input) => {
  const c = new Collector();
  if (!isPlainObject(input)) {
    return { value: null, errors: [{ field: "body", message: "must be a JSON object" }] };
  }

  const value = {
    name: c.str(input, "name", { required: true, max: 120 }),
    title: c.str(input, "title", { required: true, max: 200 }),
    summary: c.str(input, "summary", { required: true, max: 2000 }),
    contact: {},
    proof: [],
    experience: [],
    projects: [],
    skills: [],
    education: [],
  };

  if (!isPlainObject(input.contact)) {
    c.add("contact", "must be an object");
  } else {
    for (const key of Object.keys(input.contact)) {
      const item = validateContactItem(c, input.contact, key);
      if (item) value.contact[key] = item;
    }
  }

  const arr = (key) => {
    if (input[key] === undefined) return [];
    if (!Array.isArray(input[key])) {
      c.add(key, "must be an array");
      return [];
    }
    return input[key];
  };

  arr("proof").forEach((p, i) => {
    if (!isPlainObject(p)) return c.add(`proof[${i}]`, "must be an object");
    value.proof.push({
      value: c.str(p, "value", { field: `proof[${i}].value`, required: true, max: 120 }),
      text: c.str(p, "text", { field: `proof[${i}].text`, required: true, max: 400 }),
    });
  });

  arr("experience").forEach((e, i) => {
    if (!isPlainObject(e)) return c.add(`experience[${i}]`, "must be an object");
    value.experience.push({
      id: c.id(e, "id", { field: `experience[${i}].id` }),
      org: c.str(e, "org", { field: `experience[${i}].org`, required: true, max: 200 }),
      role: c.str(e, "role", { field: `experience[${i}].role`, required: true, max: 200 }),
      period: c.str(e, "period", { field: `experience[${i}].period`, required: true, max: 100 }),
      bullets: c.strArray(e, "bullets", { field: `experience[${i}].bullets`, maxItems: 30, maxLen: 600 }),
    });
  });

  arr("projects").forEach((p, i) => {
    if (!isPlainObject(p)) return c.add(`projects[${i}]`, "must be an object");
    const f = (k) => `projects[${i}].${k}`;
    const project = {
      id: c.id(p, "id", { field: f("id") }),
      title: c.str(p, "title", { field: f("title"), required: true, max: 120 }),
      category: c.str(p, "category", { field: f("category"), max: 120 }),
      status: p.status,
      role: c.str(p, "role", { field: f("role"), max: 200 }),
      period: c.str(p, "period", { field: f("period"), max: 100 }),
      description: c.str(p, "description", { field: f("description"), max: 1200 }),
      technologies: c.strArray(p, "technologies", { field: f("technologies"), maxItems: 40, maxLen: 80 }),
      bullets: c.strArray(p, "bullets", { field: f("bullets"), maxItems: 12, maxLen: 500 }),
      links: [],
      isPublic: p.isPublic !== false,
      needsReview: p.needsReview === true,
    };
    if (!PROJECT_STATUSES.includes(project.status)) {
      c.add(f("status"), `must be one of: ${PROJECT_STATUSES.join(", ")}`);
    }
    if (p.links !== undefined) {
      if (!Array.isArray(p.links)) {
        c.add(f("links"), "must be an array");
      } else {
        if (p.links.length > 12) c.add(f("links"), "must have at most 12 links");
        p.links.forEach((l, j) => {
          const lf = (k) => `${f("links")}[${j}].${k}`;
          if (!isPlainObject(l)) return c.add(`${f("links")}[${j}]`, "must be an object");
          const label = c.str(l, "label", { field: lf("label"), required: true, max: 120 });
          const url = c.str(l, "url", { field: lf("url"), required: true, max: 500 });
          if (url && !isHttpUrl(url)) c.add(lf("url"), "must be a valid http(s) URL such as https://example.com");
          if (l.type !== undefined && l.type !== null && l.type !== "" && !LINK_TYPES.includes(l.type)) {
            c.add(lf("type"), `must be one of: ${LINK_TYPES.join(", ")}`);
          }
          for (const flag of ["primary", "visible"]) {
            if (l[flag] !== undefined && typeof l[flag] !== "boolean") c.add(lf(flag), "must be a boolean");
          }
          project.links.push({
            label,
            url,
            type: LINK_TYPES.includes(l.type) ? l.type : "website",
            primary: l.primary === true,
            visible: l.visible !== false,
          });
        });
        if (project.links.filter((l) => l.primary).length > 1) {
          c.add(f("links"), "only one link can be marked primary");
        }
        if (project.links.some((l) => l.primary && !l.visible)) {
          c.add(f("links"), "the primary link must be visible");
        }
      }
    }
    value.projects.push(project);
  });

  arr("skills").forEach((s, i) => {
    if (!isPlainObject(s)) return c.add(`skills[${i}]`, "must be an object");
    value.skills.push({
      id: c.id(s, "id", { field: `skills[${i}].id` }),
      group: c.str(s, "group", { field: `skills[${i}].group`, required: true, max: 120 }),
      items: c.strArray(s, "items", { field: `skills[${i}].items`, maxItems: 60, maxLen: 80 }),
    });
  });

  arr("education").forEach((e, i) => {
    if (!isPlainObject(e)) return c.add(`education[${i}]`, "must be an object");
    value.education.push({
      id: c.id(e, "id", { field: `education[${i}].id` }),
      level: c.str(e, "level", { field: `education[${i}].level`, required: true, max: 120 }),
      place: c.str(e, "place", { field: `education[${i}].place`, required: true, max: 200 }),
      meta: c.str(e, "meta", { field: `education[${i}].meta`, max: 200 }),
    });
  });

  for (const [key, list] of [
    ["experience", value.experience],
    ["projects", value.projects],
    ["skills", value.skills],
    ["education", value.education],
  ]) {
    const ids = list.map((x) => x.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) c.add(key, "contains duplicate ids");
  }

  return { value, errors: c.errors };
};

module.exports = {
  ID_RE,
  LAYOUTS,
  APPLICATION_STATUSES,
  PROJECT_STATUSES,
  LINK_TYPES,
  PROJECT_DETAILS,
  SECTION_KEYS,
  validateProfile,
  validateApplication,
  validateMaster,
};
