"use strict";

/**
 * Records that existed in the repository before the database migration
 * (formerly data/applications.json). Inserted once on first initialisation so
 * nothing is silently dropped. NOTE: this single record looks like sample data;
 * delete it from the admin console if it is not a real application.
 */
module.exports = [
  {
    id: "app-sample-data-pipeline",
    company: "ScaleData Systems",
    jobTitle: "Lead Data Platform Engineer",
    jobDescription:
      "Seeking senior data engineer with expertise in batch ETL at 50M+ records/day, PostgreSQL schema governance, and Python automation.",
    applicationDate: "2026-11-10",
    profileId: "data-engineer",
    selectedSkills: ["Python", "SQL", "PostgreSQL", "ETL", "Data Modelling", "Databricks", "Docker"],
    selectedExperience: ["exp-digit-insurance", "exp-appzwork"],
    generatedResumeVersion: "rajasekar-resume-202611101200.pdf",
    status: "Applied",
    notes: "Direct application via engineering referral",
  },
];
