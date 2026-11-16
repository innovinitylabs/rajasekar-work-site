"use strict";

(function () {
  const root = document.documentElement;

  // View Containers
  const views = {
    login: document.getElementById("admin-login-view"),
    app: document.getElementById("admin-app-view"),
    loginError: document.getElementById("login-error-banner"),
    loginThemeToggle: document.getElementById("login-theme-toggle"),
  };

  // State
  let state = {
    master: null,
    profiles: [],
    applications: [],
    activeProfileId: "data-engineer",
    user: null,
    activeTab: "profiles",
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

  // DOM Elements in App View
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

  const showLoginError = (message, type = "error") => {
    if (!views.loginError) return;
    views.loginError.className = `login-error-banner ${type}`;
    views.loginError.textContent = message;
    views.loginError.style.display = "block";
  };

  const setupThemeToggle = (btn) => {
    if (!btn) return;
    const isDark = root.dataset.theme === "dark";
    btn.setAttribute("aria-pressed", String(isDark));
    btn.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      localStorage.setItem("theme", next);
      btn.setAttribute("aria-pressed", String(next === "dark"));
    });
  };

  /**
   * Enforces the unauthenticated login gate state.
   */
  const showLoginGate = (errorMessage = null, type = "error") => {
    if (views.app) views.app.style.display = "none";
    if (views.login) views.login.style.display = "flex";
    localStorage.removeItem("rajasekar_profiles");

    if (errorMessage) {
      showLoginError(errorMessage, type);
    }
  };

  /**
   * Primary Initialization Flow.
   * Strictly enforces session verification before revealing dashboard.
   */
  const init = async () => {
    setupThemeToggle(views.loginThemeToggle);

    // 1. Check for URL Error Parameters
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    const loggedOut = params.get("logged_out");
    const unauthorizedUser = params.get("user");

    if (loggedOut) {
      showLoginGate("You have been logged out successfully.", "success");
      return;
    }

    if (urlError) {
      if (urlError === "forbidden") {
        showLoginGate(
          `Access Denied: Account "${unauthorizedUser || "unknown"}" is not authorized. Access is strictly restricted to administrator @innovinitylabs.`
        );
      } else if (urlError === "unconfigured") {
        showLoginGate(
          "GitHub OAuth is not configured on this deployment. Please configure GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in environment settings."
        );
      } else if (urlError === "invalid_csrf_state") {
        showLoginGate("Authentication request timed out or CSRF state mismatch. Please sign in again.");
      } else {
        showLoginGate(`Authentication failed: ${urlError}`);
      }
      return;
    }

    // 2. Query Server-Side Session API
    let sessionData = null;
    try {
      const authRes = await fetch("/api/auth/session", { cache: "no-store" });
      if (authRes.ok) {
        sessionData = await authRes.json();
      } else {
        showLoginGate("Authentication service unavailable. Please try again later.");
        return;
      }
    } catch (err) {
      console.warn("Auth check failed:", err);
      showLoginGate("Could not connect to authentication service.");
      return;
    }

    // 3. Strict Gate: Must be authenticated AND authorized
    if (!sessionData || !sessionData.authenticated || !sessionData.authorized) {
      const msg = sessionData && sessionData.error ? sessionData.error : null;
      showLoginGate(msg);
      return;
    }

    // 4. Authenticated & Authorized -> Reveal Dashboard and Load Private Data
    state.user = sessionData.user;
    if (views.login) views.login.style.display = "none";
    if (views.app) views.app.style.display = "block";

    renderAuthHeader();
    await loadPrivateAdminData();
  };

  /**
   * Loads private profiles and applications from the protected /api/profiles endpoint.
   */
  const loadPrivateAdminData = async () => {
    try {
      const res = await fetch("/api/profiles", { cache: "no-store" });

      if (res.status === 401 || res.status === 403) {
        showLoginGate("Your administrator session has expired. Please sign in again.");
        return;
      }

      if (!res.ok) {
        throw new Error(`API error (${res.status})`);
      }

      const data = await res.json();
      state.master = data.master;
      state.profiles = data.profiles || [];
      state.applications = data.applications || [];

      renderProfileList();
      renderActiveProfile();
      renderApplications();
    } catch (err) {
      console.error("Failed to load profiles:", err);
      showToast("Failed to load profile data from server", true);
    }
  };

  const renderAuthHeader = () => {
    if (!el.authWidget || !state.user) return;
    el.authWidget.innerHTML = `
      <div class="admin-user-pill">
        ${
          state.user.avatar
            ? `<img src="${state.user.avatar}" class="admin-user-avatar" alt="${state.user.login}" />`
            : ""
        }
        <span>@${state.user.login}</span>
      </div>
      <a href="/api/auth/logout" class="button button-secondary btn-small">Logout</a>
    `;
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

    if (el.btnDelete) {
      el.btnDelete.disabled = Boolean(profile.isDefault);
      el.btnDelete.style.opacity = profile.isDefault ? "0.4" : "1";
    }

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

      try {
        const res = await fetch("/api/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profiles: state.profiles,
            applications: state.applications,
          }),
        });

        if (res.status === 401 || res.status === 403) {
          showLoginGate("Session expired. Please sign in again to save changes.");
          return;
        }

        if (res.ok) {
          showToast("Saved profiles to server!");
        } else {
          showToast("Failed to save changes", true);
        }
      } catch {
        showToast("Network error while saving", true);
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
    el.formNewApp.addEventListener("submit", async (e) => {
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

      // Auto-sync applications to server
      try {
        const res = await fetch("/api/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profiles: state.profiles,
            applications: state.applications,
          }),
        });
        if (res.status === 401 || res.status === 403) {
          showLoginGate("Session expired. Please sign in again.");
        }
      } catch {}
    });
  }

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
