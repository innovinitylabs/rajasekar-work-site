"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RESUME_DATA_PATH = path.join(ROOT, "resume-data.json");
const PROFILES_DATA_PATH = path.join(ROOT, "data", "profiles.json");
const APPLICATIONS_DATA_PATH = path.join(ROOT, "data", "applications.json");

/**
 * Generates a URL-friendly stable slug ID.
 * @param {string} text
 * @returns {string}
 */
const slugify = (text) =>
  String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Loads the raw resume-data.json file without modifying it.
 * @returns {object}
 */
const loadRawResumeData = () => {
  return JSON.parse(fs.readFileSync(RESUME_DATA_PATH, "utf8"));
};

/**
 * Converts raw resume data into the Master Resume Data Architecture with stable IDs.
 * The original raw data remains 100% untouched.
 * @param {object} [raw] Optional raw resume data object.
 * @returns {object} Normalized master resume.
 */
const getMasterResume = (raw = null) => {
  const source = raw || loadRawResumeData();

  const experience = (source.experience || []).map((role, rIndex) => {
    const orgSlug = slugify(role.org);
    const id = `exp-${orgSlug}`;
    const bulletDetails = (role.bullets || []).map((bullet, bIndex) => ({
      id: `${id}-b${bIndex + 1}`,
      text: bullet,
    }));

    return {
      id,
      org: role.org,
      role: role.role,
      period: role.period,
      track: "enterprise",
      bullets: [...role.bullets],
      bulletDetails,
    };
  });

  const skills = (source.skills || []).map((group, sIndex) => {
    const groupSlug = slugify(group.group);
    const id = `skill-${groupSlug}`;
    return {
      id,
      group: group.group,
      items: [...group.items],
    };
  });

  const education = (source.education || []).map((edu, eIndex) => {
    const placeSlug = slugify(edu.place);
    const id = `edu-${placeSlug}`;
    return {
      id,
      level: edu.level,
      place: edu.place,
      meta: edu.meta,
    };
  });

  const proof = (source.proof || []).map((p, pIndex) => ({
    id: `proof-${pIndex + 1}`,
    value: p.value,
    text: p.text,
  }));

  return {
    name: source.name,
    title: source.title,
    summary: source.summary,
    contact: JSON.parse(JSON.stringify(source.contact)),
    proof,
    experience,
    independentWork: [], // Extensible foundation for independent development
    skills,
    education,
  };
};

/**
 * Default initial profiles supported by the system.
 */
const DEFAULT_PROFILES = [
  {
    id: "data-engineer",
    name: "Data Engineer",
    isDefault: true,
    targetTitle: "Data Engineer",
    summaryOverride: null, // Uses master summary
    selectedExperience: ["exp-digit-insurance", "exp-appzwork"],
    selectedSkills: [
      "skill-languages",
      "skill-data-engineering",
      "skill-databases",
      "skill-backend",
      "skill-data-platforms",
      "skill-devops",
      "skill-developer-tools",
      "skill-other",
    ],
    selectedProjects: [],
    sectionVisibility: {
      proof: true,
      summary: true,
      skills: true,
      experience: true,
      projects: false,
      education: true,
      contact: true,
    },
    layout: "ats-classic",
    accentColor: "#2457c5",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
  },
  {
    id: "ai-product-engineer",
    name: "AI / Product Engineer",
    isDefault: false,
    targetTitle: "AI & Product Engineer",
    summaryOverride:
      "Production Data & Software Engineer with 5+ years of experience designing high-scale data workflows, building automation tooling with Python & Flask, and integrating modern AI developer tools (Claude, Cursor, GPT Codex, Copilot). Strong background in full-lifecycle data pipelines, backend architecture, and rapid product automation.",
    selectedExperience: ["exp-digit-insurance", "exp-appzwork"],
    selectedSkills: [
      "skill-languages",
      "skill-developer-tools",
      "skill-backend",
      "skill-devops",
      "skill-data-engineering",
      "skill-databases",
      "skill-data-platforms",
      "skill-other",
    ],
    selectedProjects: [],
    sectionVisibility: {
      proof: true,
      summary: true,
      skills: true,
      experience: true,
      projects: true,
      education: true,
      contact: true,
    },
    layout: "modern-visual",
    accentColor: "#c2593f",
    createdAt: "2026-11-16T00:00:00.000Z",
    updatedAt: "2026-11-16T00:00:00.000Z",
  },
  {
    id: "database-developer",
    name: "Database Developer",
    isDefault: false,
    targetTitle: "Database Developer / SQL Specialist",
    summaryOverride:
      "Database Engineer and SQL/PL-SQL Specialist with 5+ years of experience in PostgreSQL, Oracle, DB2, and Redis. Proven expertise in complex stored procedures, query performance tuning, Git-versioned DDL schemas, PII compliance, and production data reliability under high-load batch workloads.",
    selectedExperience: ["exp-digit-insurance", "exp-appzwork"],
    selectedSkills: [
      "skill-languages",
      "skill-databases",
      "skill-backend",
      "skill-data-engineering",
      "skill-devops",
      "skill-data-platforms",
    ],
    selectedProjects: [],
    sectionVisibility: {
      proof: true,
      summary: true,
      skills: true,
      experience: true,
      projects: false,
      education: true,
      contact: true,
    },
    layout: "ats-classic",
    accentColor: "#1e6091",
    createdAt: "2026-11-16T00:00:00.000Z",
    updatedAt: "2026-11-16T00:00:00.000Z",
  },
];

/**
 * Loads all resume profiles from storage or returns defaults.
 * @returns {Array<object>}
 */
const getProfiles = () => {
  if (fs.existsSync(PROFILES_DATA_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(PROFILES_DATA_PATH, "utf8"));
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch {
      // Fallback to defaults if file read or parse error
    }
  }
  return JSON.parse(JSON.stringify(DEFAULT_PROFILES));
};

/**
 * Saves profiles array to data/profiles.json.
 * @param {Array<object>} profiles
 */
const saveProfiles = (profiles) => {
  if (!Array.isArray(profiles)) {
    throw new TypeError("Profiles must be an array");
  }
  const dir = path.dirname(PROFILES_DATA_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PROFILES_DATA_PATH, JSON.stringify(profiles, null, 2), "utf8");
};

/**
 * Loads all job applications.
 * @returns {Array<object>}
 */
const getApplications = () => {
  if (fs.existsSync(APPLICATIONS_DATA_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(APPLICATIONS_DATA_PATH, "utf8"));
      if (Array.isArray(data)) {
        return data;
      }
    } catch {
      // Return empty array on error
    }
  }
  return [];
};

/**
 * Saves applications array to data/applications.json.
 * @param {Array<object>} applications
 */
const saveApplications = (applications) => {
  if (!Array.isArray(applications)) {
    throw new TypeError("Applications must be an array");
  }
  const dir = path.dirname(APPLICATIONS_DATA_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    APPLICATIONS_DATA_PATH,
    JSON.stringify(applications, null, 2),
    "utf8"
  );
};

/**
 * Resolves a profile against master resume data into a concrete resume data object.
 * When called with the default 'data-engineer' profile, output structure matches resume-data.json.
 *
 * @param {string|object} profileOrId Profile object or profile ID
 * @param {object} [masterData] Optional master resume data object
 * @returns {object} Fully resolved resume object
 */
const resolveProfile = (profileOrId, masterData = null) => {
  const master = masterData || getMasterResume();
  const profiles = getProfiles();

  let profile = null;
  if (typeof profileOrId === "string") {
    profile = profiles.find((p) => p.id === profileOrId);
    if (!profile) {
      throw new Error(`Profile with ID "${profileOrId}" not found`);
    }
  } else if (profileOrId && typeof profileOrId === "object") {
    profile = profileOrId;
  } else {
    profile = profiles.find((p) => p.isDefault) || profiles[0];
  }

  // Selected experience
  const selectedExpIds = new Set(
    Array.isArray(profile.selectedExperience) && profile.selectedExperience.length > 0
      ? profile.selectedExperience
      : master.experience.map((e) => e.id)
  );

  const resolvedExperience = master.experience
    .filter((role) => selectedExpIds.has(role.id))
    .map((role) => ({
      org: role.org,
      role: role.role,
      period: role.period,
      bullets: [...role.bullets],
    }));

  // Selected skills
  const selectedSkillIds = new Set(
    Array.isArray(profile.selectedSkills) && profile.selectedSkills.length > 0
      ? profile.selectedSkills
      : master.skills.map((s) => s.id)
  );

  const resolvedSkills = master.skills
    .filter((g) => selectedSkillIds.has(g.id) || selectedSkillIds.has(g.group))
    .map((g) => ({
      group: g.group,
      items: [...g.items],
    }));

  // Selected independent projects
  const selectedProjectIds = new Set(profile.selectedProjects || []);
  const resolvedProjects = (master.independentWork || [])
    .filter((p) => selectedProjectIds.has(p.id))
    .map((p) => ({
      title: p.title,
      role: p.role,
      period: p.period,
      description: p.description,
      technologies: [...p.technologies],
      bullets: [...(p.bullets || [])],
      links: [...(p.links || [])],
    }));

  const visibility = {
    proof: true,
    summary: true,
    skills: true,
    experience: true,
    projects: false,
    education: true,
    contact: true,
    ...(profile.sectionVisibility || {}),
  };

  return {
    profileId: profile.id,
    profileName: profile.name,
    layout: profile.layout || "ats-classic",
    accentColor: profile.accentColor || "#2457c5",
    sectionVisibility: visibility,
    name: master.name,
    title: profile.targetTitle || master.title,
    summary: profile.summaryOverride || master.summary,
    contact: JSON.parse(JSON.stringify(master.contact)),
    proof: visibility.proof ? JSON.parse(JSON.stringify(master.proof)) : [],
    experience: visibility.experience ? resolvedExperience : [],
    skills: visibility.skills ? resolvedSkills : [],
    projects: visibility.projects ? resolvedProjects : [],
    education: visibility.education
      ? master.education.map((e) => ({
          level: e.level,
          place: e.place,
          meta: e.meta,
        }))
      : [],
  };
};

module.exports = {
  slugify,
  loadRawResumeData,
  getMasterResume,
  getProfiles,
  saveProfiles,
  getApplications,
  saveApplications,
  resolveProfile,
  DEFAULT_PROFILES,
};
