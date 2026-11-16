"use strict";

(function () {
  const root = document.documentElement;

  // State
  let state = {
    master: null,
    profiles: [],
    applications: [],
    activeProfileId: "data-engineer",
    auth: { authenticated: false, adminTarget: "innovinitylabs" },
    activeTab: "profiles", // "profiles" | "applications"
  };

  const JSPDF_CDN_URL =
    "https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js";
  let jsPdfPromise = null;

  const loadJsPdf = () => {
    if (window.jspdf && window.jspdf.jsPDF) {
      return Promise.resolve(window.jspdf.jsPDF);
    }
    if (!jsPdfPromise) {
      jsPdfPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = JSPDF_CDN_URL;
        s.onload = () => resolve(window.jspdf.jsPDF);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return jsPdfPromise;
  };

  // DOM Elements
  const el = {
    authWidget: document.getElementById("admin-auth-widget"),
    profileList: document.getElementById("admin-profile-list"),
    activeProfileName: document.getElementById("active-profile-name"),
    profileForm: document.getElementById("profile-editor-form"),
    inputName: document.getElementById("input-profile-name"),
    inputTitle: document.getElementById("input-target-title"),
    inputSummary: document.getElementById("input-summary-override"),
    inputLayout: document.getElementById("input-layout"),
    inputAccent: document.getElementById("input-accent-color"),
    btnResetSummary: document.getElementById("btn-reset-summary"),
    experienceCheckboxes: document.getElementById("experience-checkboxes"),
    skillsCheckboxes: document.getElementById("skills-checkboxes"),
    visibilityCheckboxes: document.getElementById("visibility-checkboxes"),
    previewPane: document.getElementById("profile-live-preview"),
    btnExportPdf: document.getElementById("btn-export-profile-pdf"),
    btnSaveProfile: document.getElementById("btn-save-profiles"),
    btnDuplicate: document.getElementById("btn-duplicate-profile"),
    btnDelete: document.getElementById("btn-delete-profile"),
    btnNewProfile: document.getElementById("btn-new-profile"),
    modalNewProfile: document.getElementById("modal-new-profile"),
    formNewProfile: document.getElementById("form-new-profile"),
    btnCancelNewProfile: document.getElementById("btn-cancel-new-profile"),
    statusToast: document.getElementById("admin-status-toast"),
    tabs: document.querySelectorAll(".tab-btn"),
    tabPanels: {
      profiles: document.getElementById("tab-panel-profiles"),
      applications: document.getElementById("tab-panel-applications"),
    },
    applicationsList: document.getElementById("applications-list"),
    formNewApp: document.getElementById("form-new-app"),
    appProfileSelect: document.getElementById("app-profile-select"),
  };

  const showToast = (msg, isError = false) => {
    if (!el.statusToast) return;
    el.statusToast.textContent = msg;
    el.statusToast.style.display = "block";
    el.statusToast.style.borderColor = isError ? "#c93b2b" : "var(--accent)";
    setTimeout(() => {
      el.statusToast.style.display = "none";
    }, 3500);
  };

  // Data Loading
  const init = async () => {
    // 1. Check Auth Session
    try {
      const authRes = await fetch("/api/auth/session");
      if (authRes.ok) {
        state.auth = await authRes.json();
      }
    } catch {
      // Local dev / offline
    }
    renderAuth();

    // 2. Fetch Profiles and Master Data
    try {
      const res = await fetch("/api/profiles");
      if (res.ok) {
        const data = await res.json();
        state.master = data.master;
        state.profiles = data.profiles;
        state.applications = data.applications || [];
      } else {
        throw new Error("API unavailable");
      }
    } catch {
      // Fallback: fetch raw resume-data.json
      const rawRes = await fetch("../resume-data.json");
      const raw = await rawRes.json();
      state.master = {
        name: raw.name,
        title: raw.title,
        summary: raw.summary,
        contact: raw.contact,
        proof: (raw.proof || []).map((p, i) => ({ id: `proof-${i + 1}`, ...p })),
        experience: (raw.experience || []).map((e, i) => ({
          id: `exp-${e.org.toLowerCase().replace(/\s+/g, "-")}`,
          ...e,
        })),
        skills: (raw.skills || []).map((s, i) => ({
          id: `skill-${s.group.toLowerCase().replace(/\s+/g, "-")}`,
          ...s,
        })),
        education: (raw.education || []).map((ed, i) => ({
          id: `edu-${i + 1}`,
          ...ed,
        })),
        independentWork: [],
      };

      // Check localStorage for drafted profiles
      const saved = localStorage.getItem("rajasekar_profiles");
      if (saved) {
        try {
          state.profiles = JSON.parse(saved);
        } catch {}
      }
      if (!state.profiles || state.profiles.length === 0) {
        state.profiles = [
          {
            id: "data-engineer",
            name: "Data Engineer",
            isDefault: true,
            targetTitle: "Data Engineer",
            summaryOverride: null,
            selectedExperience: ["exp-digit-insurance", "exp-appzwork"],
            selectedSkills: state.master.skills.map((s) => s.id),
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
          },
        ];
      }
    }

    renderProfileList();
    renderActiveProfile();
    renderApplications();
  };

  const renderAuth = () => {
    if (!el.authWidget) return;
    if (state.auth && state.auth.authenticated) {
      el.authWidget.innerHTML = `
        <div class="admin-user-pill">
          ${
            state.auth.user.avatar
              ? `<img src="${state.auth.user.avatar}" class="admin-user-avatar" alt="Avatar" />`
              : ""
          }
          <span>@${state.auth.user.login}</span>
        </div>
        <a href="/api/auth/logout" class="button button-secondary btn-small">Logout</a>
      `;
    } else {
      el.authWidget.innerHTML = `
        <span class="admin-badge" style="background:rgba(201,59,43,0.1); color:#c93b2b; border-color:rgba(201,59,43,0.3);">
          Local / Unauthenticated
        </span>
        <a href="/api/auth/login" class="button button-primary btn-small">Login with GitHub</a>
      `;
    }
  };

  const getActiveProfile = () => {
    return (
      state.profiles.find((p) => p.id === state.activeProfileId) ||
      state.profiles[0]
    );
  };

  const renderProfileList = () => {
    if (!el.profileList) return;
    el.profileList.innerHTML = "";

    state.profiles.forEach((profile) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `profile-item ${
        profile.id === state.activeProfileId ? "is-active" : ""
      }`;
      btn.innerHTML = `
        <div class="profile-item-title">
          <span>${profile.name}</span>
          ${
            profile.isDefault
              ? `<span class="admin-badge" style="font-size:0.65rem; padding:0.1rem 0.4rem;">Default</span>`
              : ""
          }
        </div>
        <div class="profile-item-meta">
          ${profile.targetTitle || "Untitled"} &bull; ${profile.layout || "ats-classic"}
        </div>
      `;
      btn.addEventListener("click", () => {
        state.activeProfileId = profile.id;
        renderProfileList();
        renderActiveProfile();
      });
      el.profileList.appendChild(btn);
    });

    // Populate app profile dropdown
    if (el.appProfileSelect) {
      el.appProfileSelect.innerHTML = state.profiles
        .map((p) => `<option value="${p.id}">${p.name} (${p.targetTitle})</option>`)
        .join("");
    }
  };

  const renderActiveProfile = () => {
    const profile = getActiveProfile();
    if (!profile) return;

    if (el.activeProfileName) el.activeProfileName.textContent = profile.name;
    if (el.inputName) el.inputName.value = profile.name || "";
    if (el.inputTitle) el.inputTitle.value = profile.targetTitle || "";
    if (el.inputSummary) el.inputSummary.value = profile.summaryOverride || "";
    if (el.inputLayout) el.inputLayout.value = profile.layout || "ats-classic";
    if (el.inputAccent) el.inputAccent.value = profile.accentColor || "#2457c5";

    // Disable delete on default profile
    if (el.btnDelete) {
      el.btnDelete.disabled = Boolean(profile.isDefault);
      el.btnDelete.style.opacity = profile.isDefault ? "0.4" : "1";
    }

    // Experience Checkboxes
    if (el.experienceCheckboxes && state.master) {
      const selectedExp = new Set(profile.selectedExperience || []);
      el.experienceCheckboxes.innerHTML = state.master.experience
        .map((exp) => {
          const checked = selectedExp.has(exp.id) ? "checked" : "";
          return `
            <label class="checkbox-item">
              <input type="checkbox" name="exp" value="${exp.id}" ${checked} />
              <div>
                <strong>${exp.org}</strong> - ${exp.role}
                <div style="font-size:0.75rem; color:var(--muted);">${exp.period}</div>
              </div>
            </label>
          `;
        })
        .join("");
    }

    // Skills Checkboxes
    if (el.skillsCheckboxes && state.master) {
      const selectedSkills = new Set(profile.selectedSkills || []);
      el.skillsCheckboxes.innerHTML = state.master.skills
        .map((group) => {
          const checked = selectedSkills.has(group.id) ? "checked" : "";
          return `
            <label class="checkbox-item">
              <input type="checkbox" name="skill" value="${group.id}" ${checked} />
              <div>
                <strong>${group.group}:</strong>
                <span style="font-size:0.78rem; color:var(--muted);">${group.items.join(", ")}</span>
              </div>
            </label>
          `;
        })
        .join("");
    }

    // Visibility Checkboxes
    if (el.visibilityCheckboxes) {
      const vis = profile.sectionVisibility || {};
      const keys = [
        { k: "proof", label: "Proof Metrics" },
        { k: "summary", label: "Professional Summary" },
        { k: "skills", label: "Skills Section" },
        { k: "experience", label: "Experience Section" },
        { k: "projects", label: "Independent Projects" },
        { k: "education", label: "Education" },
        { k: "contact", label: "Contact Links" },
      ];
      el.visibilityCheckboxes.innerHTML = keys
        .map(({ k, label }) => {
          const checked = vis[k] !== false ? "checked" : "";
          return `
            <label class="checkbox-item">
              <input type="checkbox" name="vis" value="${k}" ${checked} />
              <span>${label}</span>
            </label>
          `;
        })
        .join("");
    }

    renderLivePreview();
  };

  const getResolvedProfileData = () => {
    const profile = getActiveProfile();
    const master = state.master;
    if (!profile || !master) return null;

    const summary = profile.summaryOverride || master.summary;
    const title = profile.targetTitle || master.title;

    const selectedExpIds = new Set(profile.selectedExperience || []);
    const experience = master.experience.filter((e) => selectedExpIds.has(e.id));

    const selectedSkillIds = new Set(profile.selectedSkills || []);
    const skills = master.skills.filter((s) => selectedSkillIds.has(s.id));

    const visibility = profile.sectionVisibility || {};

    return {
      name: master.name,
      title,
      summary: visibility.summary !== false ? summary : "",
      contact: visibility.contact !== false ? master.contact : null,
      proof: visibility.proof !== false ? master.proof : [],
      experience: visibility.experience !== false ? experience : [],
      skills: visibility.skills !== false ? skills : [],
      education: visibility.education !== false ? master.education : [],
      accentColor: profile.accentColor || "#2457c5",
      layout: profile.layout || "ats-classic",
    };
  };

  const renderLivePreview = () => {
    if (!el.previewPane) return;
    const resolved = getResolvedProfileData();
    if (!resolved) return;

    let html = `
      <div class="preview-paper">
        <h1 class="preview-name">${resolved.name}</h1>
        <div class="preview-title" style="color:${resolved.accentColor};">${resolved.title}</div>
        ${
          resolved.summary
            ? `<div class="preview-summary">${resolved.summary}</div>`
            : ""
        }
    `;

    if (resolved.skills && resolved.skills.length > 0) {
      html += `
        <div class="preview-section-title" style="color:${resolved.accentColor};">Skills</div>
        <ul style="padding-left:14px; margin:0 0 0.8rem; font-size:0.8rem;">
          ${resolved.skills
            .map(
              (g) =>
                `<li><strong>${g.group}:</strong> ${g.items.join(", ")}</li>`
            )
            .join("")}
        </ul>
      `;
    }

    if (resolved.experience && resolved.experience.length > 0) {
      html += `
        <div class="preview-section-title" style="color:${resolved.accentColor};">Experience</div>
        ${resolved.experience
          .map(
            (e) => `
          <div style="margin-bottom:0.75rem;">
            <div style="display:flex; justify-content:space-between; font-weight:600; font-size:0.85rem;">
              <span>${e.org} - <span style="font-weight:400;">${e.role}</span></span>
              <span style="font-size:0.75rem; color:var(--muted);">${e.period}</span>
            </div>
            <ul style="padding-left:14px; margin:0.3rem 0; font-size:0.8rem; color:var(--muted);">
              ${(e.bullets || []).map((b) => `<li>${b}</li>`).join("")}
            </ul>
          </div>
        `
          )
          .join("")}
      `;
    }

    if (resolved.education && resolved.education.length > 0) {
      html += `
        <div class="preview-section-title" style="color:${resolved.accentColor};">Education</div>
        <div style="font-size:0.8rem; color:var(--muted);">
          ${resolved.education
            .map((ed) => `${ed.level} - ${ed.place} (${ed.meta})`)
            .join(" | ")}
        </div>
      `;
    }

    html += `</div>`;
    el.previewPane.innerHTML = html;
  };

  // Sync profile form input back into state
  const captureActiveProfileChanges = () => {
    const profile = getActiveProfile();
    if (!profile) return;

    if (el.inputName) profile.name = el.inputName.value.trim() || profile.name;
    if (el.inputTitle) profile.targetTitle = el.inputTitle.value.trim();
    if (el.inputSummary) {
      const val = el.inputSummary.value.trim();
      profile.summaryOverride = val.length > 0 ? val : null;
    }
    if (el.inputLayout) profile.layout = el.inputLayout.value;
    if (el.inputAccent) profile.accentColor = el.inputAccent.value;

    if (el.experienceCheckboxes) {
      const checked = [
        ...el.experienceCheckboxes.querySelectorAll('input[type="checkbox"]:checked'),
      ].map((i) => i.value);
      profile.selectedExperience = checked;
    }

    if (el.skillsCheckboxes) {
      const checked = [
        ...el.skillsCheckboxes.querySelectorAll('input[type="checkbox"]:checked'),
      ].map((i) => i.value);
      profile.selectedSkills = checked;
    }

    if (el.visibilityCheckboxes) {
      const vis = {};
      el.visibilityCheckboxes
        .querySelectorAll('input[type="checkbox"]')
        .forEach((cb) => {
          vis[cb.value] = cb.checked;
        });
      profile.sectionVisibility = vis;
    }

    profile.updatedAt = new Date().toISOString();
  };

  // Event Listeners
  if (el.profileForm) {
    el.profileForm.addEventListener("input", () => {
      captureActiveProfileChanges();
      renderLivePreview();
      renderProfileList();
    });
  }

  if (el.btnResetSummary) {
    el.btnResetSummary.addEventListener("click", () => {
      if (el.inputSummary && state.master) {
        el.inputSummary.value = "";
        captureActiveProfileChanges();
        renderLivePreview();
      }
    });
  }

  if (el.btnDuplicate) {
    el.btnDuplicate.addEventListener("click", () => {
      const current = getActiveProfile();
      const newId = `${current.id}-copy-${Date.now().toString(36)}`;
      const copy = JSON.parse(JSON.stringify(current));
      copy.id = newId;
      copy.name = `${current.name} (Copy)`;
      copy.isDefault = false;
      copy.createdAt = new Date().toISOString();
      copy.updatedAt = new Date().toISOString();

      state.profiles.push(copy);
      state.activeProfileId = newId;
      renderProfileList();
      renderActiveProfile();
      showToast(`Duplicated as "${copy.name}"`);
    });
  }

  if (el.btnDelete) {
    el.btnDelete.addEventListener("click", () => {
      const current = getActiveProfile();
      if (current.isDefault) {
        alert("Cannot delete the default profile.");
        return;
      }
      if (!confirm(`Delete profile "${current.name}"?`)) return;

      state.profiles = state.profiles.filter((p) => p.id !== current.id);
      state.activeProfileId = "data-engineer";
      renderProfileList();
      renderActiveProfile();
      showToast(`Deleted profile`);
    });
  }

  if (el.btnNewProfile && el.modalNewProfile) {
    el.btnNewProfile.addEventListener("click", () => {
      el.modalNewProfile.style.display = "grid";
    });
  }

  if (el.btnCancelNewProfile && el.modalNewProfile) {
    el.btnCancelNewProfile.addEventListener("click", () => {
      el.modalNewProfile.style.display = "none";
    });
  }

  if (el.formNewProfile) {
    el.formNewProfile.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("new-profile-name").value.trim();
      const id =
        document.getElementById("new-profile-id").value.trim() ||
        name.toLowerCase().replace(/[^\w-]+/g, "-");
      const title = document.getElementById("new-profile-title").value.trim();
      const base = document.getElementById("new-profile-base").value;

      const baseProfile =
        state.profiles.find((p) => p.id === base) || state.profiles[0];
      const newProfile = JSON.parse(JSON.stringify(baseProfile));
      newProfile.id = id;
      newProfile.name = name;
      newProfile.targetTitle = title;
      newProfile.isDefault = false;
      newProfile.createdAt = new Date().toISOString();
      newProfile.updatedAt = new Date().toISOString();

      state.profiles.push(newProfile);
      state.activeProfileId = id;
      el.modalNewProfile.style.display = "none";
      el.formNewProfile.reset();
      renderProfileList();
      renderActiveProfile();
      showToast(`Created profile "${name}"`);
    });
  }

  if (el.btnSaveProfile) {
    el.btnSaveProfile.addEventListener("click", async () => {
      captureActiveProfileChanges();
      localStorage.setItem("rajasekar_profiles", JSON.stringify(state.profiles));

      try {
        const res = await fetch("/api/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profiles: state.profiles,
            applications: state.applications,
          }),
        });
        if (res.ok) {
          showToast("Saved profiles to server & local storage!");
        } else {
          showToast("Saved locally (Server requires admin login)");
        }
      } catch {
        showToast("Saved locally (Offline/Draft mode)");
      }
    });
  }

  if (el.btnExportPdf) {
    el.btnExportPdf.addEventListener("click", async () => {
      const resolved = getResolvedProfileData();
      if (!resolved || !window.ResumePdf) return;

      el.btnExportPdf.textContent = "Generating...";
      try {
        const JsPDF = await loadJsPdf();
        const doc = window.ResumePdf.buildResumePdf(JsPDF, resolved, {
          accentColor: resolved.accentColor,
        });
        const filename = window.ResumePdf.resumeDownloadFilename(
          new Date(),
          state.activeProfileId
        );
        doc.save(filename);
        showToast(`Downloaded ${filename}`);
      } catch (err) {
        console.error(err);
        showToast("PDF generation failed", true);
      } finally {
        el.btnExportPdf.textContent = "Export Profile PDF";
      }
    });
  }

  // Applications tab logic
  const renderApplications = () => {
    if (!el.applicationsList) return;
    if (state.applications.length === 0) {
      el.applicationsList.innerHTML = `<p class="proof-text">No job applications logged yet. Track custom applications below.</p>`;
      return;
    }

    el.applicationsList.innerHTML = state.applications
      .map(
        (app) => `
      <div class="admin-card" style="margin-bottom:0.75rem;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <strong>${app.company}</strong> - ${app.jobTitle}
            <div style="font-size:0.78rem; color:var(--muted); margin-top:0.2rem;">
              Profile: <strong>${app.profileId}</strong> &bull; Applied: ${app.applicationDate}
            </div>
          </div>
          <span class="admin-badge">${app.status}</span>
        </div>
        ${
          app.notes
            ? `<div style="font-size:0.8rem; color:var(--muted); margin-top:0.5rem;">${app.notes}</div>`
            : ""
        }
      </div>
    `
      )
      .join("");
  };

  if (el.formNewApp) {
    el.formNewApp.addEventListener("submit", (e) => {
      e.preventDefault();
      const company = document.getElementById("app-company").value.trim();
      const jobTitle = document.getElementById("app-title").value.trim();
      const profileId = el.appProfileSelect.value;
      const status = document.getElementById("app-status").value;
      const notes = document.getElementById("app-notes").value.trim();

      const newApp = {
        id: `app-${Date.now().toString(36)}`,
        company,
        jobTitle,
        applicationDate: new Date().toISOString().split("T")[0],
        profileId,
        status,
        notes,
        createdAt: new Date().toISOString(),
      };

      state.applications.unshift(newApp);
      renderApplications();
      el.formNewApp.reset();
      showToast(`Logged application to ${company}`);
    });
  }

  // Tabs switching
  el.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      el.tabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const target = tab.dataset.tab;
      if (el.tabPanels.profiles)
        el.tabPanels.profiles.style.display =
          target === "profiles" ? "grid" : "none";
      if (el.tabPanels.applications)
        el.tabPanels.applications.style.display =
          target === "applications" ? "block" : "none";
    });
  });

  init();
})();
