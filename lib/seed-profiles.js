"use strict";

/**
 * Initial profiles, inserted into the database exactly once (first
 * initialisation). After that the database is the only source of truth and
 * this file is never read again.
 *
 * Every selection references stable ids from resume-data.json.
 */
const FIRST_FOUR_INDEPENDENT = { "exp-independent": ["exp-independent-b1", "exp-independent-b2", "exp-independent-b3", "exp-independent-b4"] };
const RMK_ONLY = { selectedEducation: ["edu-rmk-engineering-college"] };

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
    selectedBullets: { ...FIRST_FOUR_INDEPENDENT },
    options: { ...RMK_ONLY },
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
    selectedBullets: { ...FIRST_FOUR_INDEPENDENT },
    options: { ...RMK_ONLY },
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
    options: { ...RMK_ONLY },
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
  {
    id: "anthropic-research-residency",
    name: "Anthropic Research Residency",
    isDefault: false,
    targetTitle: "Independent Software Developer | Software & Data Engineer | AI Research Aspirant",
    summaryOverride:
      "Software and data engineer with 5+ years of production experience (Oracle SQL and PL/SQL, then PostgreSQL and Python pipelines at approximately 50M records per day), now independently building products across web, native iOS/macOS and generative systems. Transitioning toward empirical AI research: Uravu (AI-mediated human interaction) and Pocket Astro (an on-device assistant with answer validation) raised questions about when AI should intervene, when it should stay silent, and how to evaluate its influence on human agency. Seeking to build rigorous research skills in AI safety and alignment and, longer term, in ML systems and reinforcement learning.",
    selectedExperience: ["exp-independent", "exp-digit-insurance", "exp-appzwork"],
    // Page 1 keeps the overview, the AI-relevant Pocket Astro bullet and Uravu; OnchainRugs and backend work are covered on page 2.
    selectedBullets: { "exp-independent": ["exp-independent-b1", "exp-independent-b4", "exp-independent-b5"] },
    selectedSkills: [
      "skill-programming-languages",
      "skill-data-engineering",
      "skill-databases",
      "skill-backend-development",
      "skill-application-development",
      "skill-ai-systems",
      "skill-devops",
      "skill-currently-learning",
    ],
    selectedProjects: ["project-uravu", "project-pocket-astro", "project-onchainrugs", "project-madras-checks"],
    projectDetail: "showcase",
    sectionVisibility: { ...ALL_SECTIONS_ON, proof: false },
    layout: "ats-classic",
    accentColor: "#c2593f",
    options: {
      displayName: "Rajasekar Chandrasekar",
      selectedEducation: ["edu-rmk-engineering-college", "edu-datacamp-deep-learning"],
      showcase: {
        heading: "Selected Independent Projects",
        intro:
          "Independently conceived, architected, built and deployed across web, native iOS/macOS and generative systems.",
        bulletsPerProject: 4,
      },
      projectOverrides: {
        "project-uravu": {
          role: "Sole creator and developer: concept, research, architecture, implementation",
          description:
            "Flagship. Pre-launch product and research concept for AI as an atmospheric mediator between people, not a chatbot, therapist, companion or engagement-maximising system.",
          bullets: [
            "Conceived the concept and design philosophy: human agency, AI intervention and restraint, intentional silence, conversational pacing, emotional influence, privacy and emotional dependency.",
            "Research dossier at /research: an independent research and design dossier (a long-form architecture paper and an executive literature synthesis), not peer-reviewed, presented as ongoing thinking and experimentation.",
            "Implemented the site and prototype end to end: Next.js and TypeScript, a markdown research reader with table of contents, a CPU emotional-network simulation (spatial hashing, neighbour warmth, link cooldowns) rendered with React Three Fiber, and a Neon PostgreSQL waitlist. Prototype stage: no AI model is integrated yet.",
          ],
        },
        "project-pocket-astro": {
          description:
            "Independent native iOS and macOS app (Swift, SwiftUI) that computes Vedic astrology charts offline from a C and Swift calculation kit, with an on-device AI chart assistant.",
          bullets: [
            "Built a provider-based AI layer: Apple Foundation Models plus an optional llama.cpp provider that runs user-downloaded Qwen models (pinned revisions, SHA-256 verified), with tool calling for chart data.",
            "Added an answer-validation step that checks assistant answers against the chart data its tool calls returned and grades them validated, partially supported or unsupported.",
            "Checks the native calculation layer against a Python oracle with golden fixtures and numerical parity tests.",
          ],
        },
        "project-onchainrugs": {
          description:
            "Independent full-stack product: Next.js application and Solidity contracts for generative on-chain rug NFTs with blockchain infrastructure.",
        },
        "project-madras-checks": {
          description:
            "Independent Madras Checks project: a Next.js brand site (madraschecks.com) linked to a separate generative pattern platform (art.madraschecks.com), exploring algorithmic textile patterns and cultural memory.",
        },
      },
      extraSections: [
        {
          heading: "Research Interests",
          paragraphs: [
            "AI safety and alignment (primary): scalable oversight, AI safeguards, and the influence of AI systems on human behaviour. A question from Uravu: how can AI interventions in human interactions be evaluated and controlled while preserving human agency, and can a system reliably recognise when to intervene and when to stay silent?",
            "ML systems and reinforcement learning (longer-term ambition): building deep expertise in machine learning, model architectures, training systems and reinforcement learning. This is a learning goal, not existing expertise.",
            "Current learning: deep learning fundamentals, neural network architectures, local LLM integration, machine learning systems and reinforcement learning, AI safety and evaluation.",
          ],
        },
      ],
    },
  },
];
