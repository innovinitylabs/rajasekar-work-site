/*
 * resume-resolve.js
 *
 * Pure (no I/O) logic that turns the master resume plus a profile into the
 * concrete resume that is rendered. It is shared by the Node build, the API
 * and the browser admin console, so every output (public site, ATS resume,
 * admin preview, PDF) goes through exactly the same code path.
 */
(function initializeResumeResolve(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ResumeResolve = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createResumeResolveApi() {
  const slugify = (text) =>
    String(text)
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const clone = (value) => JSON.parse(JSON.stringify(value));

  /**
   * Normalises the stored master document: guarantees stable ids and derives
   * per-bullet ids. Explicit ids in the data always win over derived ones.
   */
  const normalizeMaster = (source) => {
    const experience = (source.experience || []).map((role) => {
      const id = role.id || `exp-${slugify(role.org)}`;
      const bullets = [...(role.bullets || [])];
      return {
        id,
        org: role.org,
        role: role.role,
        period: role.period,
        track: role.track || (id === "exp-independent" ? "independent" : "enterprise"),
        bullets,
        bulletDetails: bullets.map((text, i) => ({ id: `${id}-b${i + 1}`, text })),
      };
    });

    const skills = (source.skills || []).map((group) => ({
      id: group.id || `skill-${slugify(group.group)}`,
      group: group.group,
      items: [...group.items],
    }));

    const education = (source.education || []).map((edu) => ({
      id: edu.id || `edu-${slugify(edu.place)}`,
      level: edu.level,
      place: edu.place,
      meta: edu.meta,
    }));

    const proof = (source.proof || []).map((p, i) => ({
      id: p.id || `proof-${i + 1}`,
      value: p.value,
      text: p.text,
    }));

    const projects = (source.projects || []).map((p) => ({
      id: p.id || `project-${slugify(p.title)}`,
      title: p.title,
      category: p.category || "",
      status: p.status || "Needs review",
      role: p.role || "",
      period: p.period || "",
      description: p.description || "",
      technologies: [...(p.technologies || [])],
      bullets: [...(p.bullets || [])],
      links: clone(p.links || []),
      isPublic: p.isPublic !== false,
      needsReview: p.needsReview === true,
    }));

    return {
      name: source.name,
      title: source.title,
      summary: source.summary,
      contact: clone(source.contact || {}),
      proof,
      experience,
      projects,
      skills,
      education,
    };
  };

  const DEFAULT_VISIBILITY = {
    proof: true,
    summary: true,
    skills: true,
    experience: true,
    projects: false,
    education: true,
    contact: true,
  };

  /**
   * Resolves a profile object against the normalised master.
   * Pure: never reads storage. Callers pass the profile explicitly.
   */
  const resolveProfile = (profile, master) => {
    if (!profile || typeof profile !== "object") {
      throw new TypeError("resolveProfile requires a profile object");
    }

    const visibility = { ...DEFAULT_VISIBILITY, ...(profile.sectionVisibility || {}) };

    const expIds = new Set(
      Array.isArray(profile.selectedExperience) && profile.selectedExperience.length > 0
        ? profile.selectedExperience
        : master.experience.map((e) => e.id)
    );
    const bulletSelection = profile.selectedBullets || {};

    const experience = master.experience
      .filter((role) => expIds.has(role.id))
      .map((role) => {
        const picked = bulletSelection[role.id];
        const bullets =
          Array.isArray(picked) && picked.length > 0
            ? role.bulletDetails.filter((b) => picked.includes(b.id)).map((b) => b.text)
            : [...role.bullets];
        return { org: role.org, role: role.role, period: role.period, bullets };
      });

    const skillIds = new Set(
      Array.isArray(profile.selectedSkills) && profile.selectedSkills.length > 0
        ? profile.selectedSkills
        : master.skills.map((s) => s.id)
    );
    const skills = master.skills
      .filter((g) => skillIds.has(g.id))
      .map((g) => ({ group: g.group, items: [...g.items] }));

    // Projects follow the profile's own order so a profile can prioritise.
    const projectsById = new Map(master.projects.map((p) => [p.id, p]));
    const projects = (profile.selectedProjects || [])
      .map((id) => projectsById.get(id))
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        role: p.role,
        period: p.period,
        description: p.description,
        technologies: [...p.technologies],
        bullets: [...p.bullets],
        links: clone(p.links),
      }));

    return {
      profileId: profile.id,
      profileName: profile.name,
      layout: profile.layout || "ats-classic",
      projectDetail: profile.projectDetail === "compact" ? "compact" : "detailed",
      accentColor: profile.accentColor || "#2457c5",
      sectionVisibility: visibility,
      name: master.name,
      title: profile.targetTitle || master.title,
      summary: visibility.summary ? profile.summaryOverride || master.summary : "",
      contact: visibility.contact ? clone(master.contact) : null,
      proof: visibility.proof ? clone(master.proof) : [],
      experience: visibility.experience ? experience : [],
      skills: visibility.skills ? skills : [],
      projects: visibility.projects ? projects : [],
      education: visibility.education
        ? master.education.map((e) => ({ level: e.level, place: e.place, meta: e.meta }))
        : [],
    };
  };

  return { slugify, normalizeMaster, resolveProfile, DEFAULT_VISIBILITY };
});
