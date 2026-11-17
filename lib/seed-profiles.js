"use strict";

/**
 * Initial profiles, inserted into the database exactly once (first
 * initialisation). After that the database is the only source of truth and
 * this file is never read again.
 *
 * Every selection references stable ids from resume-data.json.
 */
const ALL_SECTIONS_ON = {
  proof: true,
  summary: true,
  skills: true,
  experience: true,
  projects: true,
  education: true,
  contact: true,
};

module.exports = [
  {
    id: "data-engineer",
    name: "Data Engineer",
    isDefault: true,
    targetTitle: "Data Engineer",
    summaryOverride: null,
    selectedExperience: ["exp-independent", "exp-digit-insurance", "exp-appzwork"],
    // Keep Digit and Appzwork in full; show only the headline Independent bullet.
    selectedBullets: {},
    // Data Engineering focus: Swift/Solidity/React-style groups stay in the master for other profiles.
    selectedSkills: [
      "skill-programming-languages",
      "skill-data-engineering",
      "skill-databases",
      "skill-backend-development",
      "skill-cloud-data-platforms",
      "skill-devops",
    ],
    // Deliberate two-page A4: experience on page 1, all eight projects on page 2.
    selectedProjects: [
      "project-madras-checks",
      "project-onchainrugs",
      "project-anekaroopam",
      "project-uravu",
      "project-hard-copy",
      "project-rotate-the-cow",
      "project-pocket-astro",
      "project-valipokkann",
    ],
    projectDetail: "showcase",
    sectionVisibility: { ...ALL_SECTIONS_ON },
    layout: "ats-classic",
    accentColor: "#2457c5",
  },
  {
    id: "ai-product-engineer",
    name: "AI / Product Engineer",
    isDefault: false,
    targetTitle: "AI & Product Engineer",
    summaryOverride:
      "Software and Data Engineer with 5+ years of experience in production data systems and Python/SQL automation, now independently building web, iOS, and macOS products. Works daily with AI developer tools (Claude, Cursor, ChatGPT, GitHub Copilot) across design, implementation, and testing.",
    selectedExperience: ["exp-independent", "exp-digit-insurance", "exp-appzwork"],
    selectedBullets: {},
    selectedSkills: [
      "skill-programming-languages",
      "skill-application-development",
      "skill-devops",
      "skill-developer-tools",
      "skill-backend-development",
      "skill-data-engineering",
      "skill-databases",
      "skill-cloud-data-platforms",
    ],
    selectedProjects: [
      "project-pocket-astro",
      "project-uravu",
      "project-onchainrugs",
      "project-anekaroopam",
      "project-rotate-the-cow",
    ],
    sectionVisibility: { ...ALL_SECTIONS_ON },
    layout: "modern-visual",
    accentColor: "#c2593f",
  },
  {
    id: "database-developer",
    name: "Database Developer",
    isDefault: false,
    targetTitle: "Database Developer / SQL Specialist",
    summaryOverride:
      "Database Engineer and SQL/PL-SQL Specialist with 5+ years of experience in PostgreSQL, Oracle, DB2, and Redis. Proven expertise in complex stored procedures, query performance tuning, Git-versioned DDL schemas, PII compliance, and production data reliability under high-load batch workloads.",
    selectedExperience: ["exp-independent", "exp-digit-insurance", "exp-appzwork"],
    selectedBullets: { "exp-independent": ["exp-independent-b1"] },
    selectedSkills: [
      "skill-programming-languages",
      "skill-databases",
      "skill-backend-development",
      "skill-data-engineering",
      "skill-devops",
      "skill-developer-tools",
    ],
    selectedProjects: ["project-uravu"],
    projectDetail: "compact",
    sectionVisibility: { ...ALL_SECTIONS_ON },
    layout: "ats-classic",
    accentColor: "#1e6091",
  },
];
