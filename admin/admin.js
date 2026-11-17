"use strict";

/*
 * Admin console.
 *
 * Source of truth is PostgreSQL behind /api/*. This script keeps only an
 * in-memory working copy for editing; nothing is persisted in the browser
 * (localStorage is used for the colour theme only). A "saved" message is
 * shown ONLY after the server confirms the row was written, and every write
 * carries the version it was based on so a stale tab cannot overwrite newer data.
 */
(function () {
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);

  const views = {
    login: $("admin-login-view"),
    app: $("admin-app-view"),
    loginError: $("login-error-banner"),
    loginThemeToggle: $("login-theme-toggle"),
  };

  const STATUSES = ["Draft", "Applied", "Screening", "Interviewing", "Offered", "Rejected", "Archived"];
  const PROJECT_STATUSES = ["Deployed", "In development", "Prototype", "Experimental", "Needs review"];
  const SECTION_LABELS = [
    ["proof", "Proof Metrics"],
    ["summary", "Professional Summary"],
    ["skills", "Skills Section"],
    ["experience", "Experience Section"],
    ["projects", "Projects"],
    ["education", "Education"],
    ["contact", "Contact Links"],
  ];

  const state = {
    user: null,
    master: null, // normalised view (with bulletDetails) as stored on the server
    masterVersion: 0,
    masterDraft: null, // editable raw document
    masterSavedJson: "",
    profiles: [], // working copies, each with the server `version`
    savedJson: {}, // id -> JSON of last server-confirmed state
    savedProfiles: {}, // id -> deep copy of the last server-confirmed profile
    previewMode: "draft", // "draft" = working copy, "saved" = last saved version
    applications: [],
    storage: null,
    activeProfileId: null,
    activeTab: "profiles",
    busy: false,
    lastError: null,
    loaded: false,
  };

  /* ------------------------------ utilities ------------------------------ */

  const esc = (v) =>
    String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const slug = (t) =>
    String(t).toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

  // Normalised so that merely opening a profile (which materialises defaults) is not "dirty".
  const normVisibility = (vis) => {
    const v = vis || {};
    return SECTION_LABELS.map(([k]) => (k === "projects" ? v[k] === true : v[k] !== false));
  };
  const sorted = (a) => [...(a || [])].sort();
  const profileSnapshot = (p) => JSON.stringify({
    name: p.name, isDefault: Boolean(p.isDefault), targetTitle: p.targetTitle || "", summaryOverride: p.summaryOverride || null,
    selectedExperience: sorted(p.selectedExperience),
    selectedBullets: Object.keys(p.selectedBullets || {}).sort().map((k) => [k, sorted(p.selectedBullets[k])]),
    selectedSkills: sorted(p.selectedSkills),
    selectedProjects: p.selectedProjects || [],
    sectionVisibility: normVisibility(p.sectionVisibility),
    layout: p.layout, accentColor: p.accentColor, projectDetail: p.projectDetail || "detailed",
  });

  const isProfileDirty = (p) => state.savedJson[p.id] !== profileSnapshot(p);
  const isMasterDirty = () => Boolean(state.masterDraft) && JSON.stringify(state.masterDraft) !== state.masterSavedJson;
  const dirtyCount = () => state.profiles.filter(isProfileDirty).length + (isMasterDirty() ? 1 : 0);

  const getActiveProfile = () => state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0];

  /* --------------------------- status and messages ------------------------- */

  const statusEl = $("save-status");
  const bannerEl = $("admin-banner");

  const setStatus = (kind, text) => {
    if (!statusEl) return;
    statusEl.className = `save-status is-${kind}`;
    statusEl.textContent = text;
  };

  const refreshStatus = () => {
    if (!state.loaded) return;
    if (state.busy) return setStatus("saving", "Saving…");
    if (state.lastError) return setStatus("error", `Save failed: ${state.lastError}`);
    const n = dirtyCount();
    if (n > 0) return setStatus("dirty", `Unsaved changes (${n})`);
    setStatus("saved", `All changes saved${state.storage ? ` · master v${state.masterVersion}` : ""}`);
  };

  const showToast = (msg, isError = false) => {
    const el = $("admin-status-toast");
    if (!el) return;
    el.textContent = msg;
    el.style.display = "block";
    el.style.borderColor = isError ? "#c93b2b" : "var(--accent)";
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => (el.style.display = "none"), 4000);
  };

  const showBanner = (html) => {
    if (!bannerEl) return;
    bannerEl.innerHTML = html;
    bannerEl.style.display = "block";
  };
  const hideBanner = () => bannerEl && (bannerEl.style.display = "none");

  const showLoginError = (message, type = "error") => {
    if (!views.loginError) return;
    views.loginError.className = `login-error-banner ${type}`;
    views.loginError.textContent = message;
    views.loginError.style.display = "block";
  };

  const showLoginGate = (msg = null, type = "error") => {
    state.loaded = false;
    if (views.app) views.app.style.display = "none";
    if (views.login) views.login.style.display = "flex";
    // drop everything held in memory once the session is gone
    state.master = null; state.masterDraft = null; state.profiles = []; state.applications = [];
    try { localStorage.removeItem("rajasekar_profiles"); } catch (_) { /* ignore */ }
    if (msg) showLoginError(msg, type);
  };

  const sessionExpired = () => {
    setStatus("expired", "Session expired");
    showLoginGate("Your administrator session has expired or was signed out. Nothing further was saved. Please sign in again.");
  };

  /* --------------------------------- API ---------------------------------- */

  class ApiError extends Error {
    constructor(status, body) {
      super((body && body.error) || `Request failed (${status})`);
      this.status = status;
      this.body = body || {};
    }
  }

  const api = async (method, url, body) => {
    let res;
    try {
      res = await fetch(url, {
        method,
        cache: "no-store",
        credentials: "same-origin",
        headers: method === "GET" ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_) {
      throw new ApiError(0, { error: "Network error: could not reach the server. Nothing was saved." });
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* non-JSON */ }
    if (res.status === 401 || (res.status === 403 && data && data.authenticated === false)) {
      sessionExpired();
      throw new ApiError(res.status, { ...(data || {}), error: "Session expired", handled: true });
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  };

  /** Runs a write; manages the busy flag, error state and conflict messaging. */
  const guarded = async (fn) => {
    state.busy = true; state.lastError = null; hideBanner(); refreshStatus();
    try {
      return await fn();
    } catch (err) {
      if (err.body && err.body.handled) return null;
      state.lastError = err.message;
      if (err.status === 409 && err.body.code === "VERSION_CONFLICT") {
        showBanner(`<strong>Conflict.</strong> ${esc(err.message)} <button class="button button-secondary mini-btn" id="btn-reload-latest">Reload latest data</button>`);
        const b = $("btn-reload-latest");
        if (b) b.addEventListener("click", () => loadAll());
      } else if (err.status === 409 && err.body.code === "REFERENCES_BROKEN") {
        const lines = (err.body.details.broken || []).map((b) => `<li><code>${esc(b.profileId)}</code>: ${esc(b.problems.join("; "))}</li>`).join("");
        showBanner(`<strong>Not saved.</strong> ${esc(err.message)}<ul>${lines}</ul>`);
      } else if (err.status === 400 && Array.isArray(err.body.details)) {
        showBanner(`<strong>Not saved: invalid data.</strong><ul>${err.body.details.map((d) => `<li><code>${esc(d.field)}</code> ${esc(d.message)}</li>`).join("")}</ul>`);
      }
      showToast(`Save failed: ${err.message}`, true);
      return null;
    } finally {
      state.busy = false;
      refreshStatus();
    }
  };

  /* ------------------------------- bootstrap ------------------------------ */

  const setupThemeToggle = (btn) => {
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(root.dataset.theme === "dark"));
    btn.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (_) { /* ignore */ }
      btn.setAttribute("aria-pressed", String(next === "dark"));
    });
  };

  const LOGIN_ERRORS = {
    forbidden: "Access denied: this GitHub account is not the authorised administrator.",
    unconfigured: "Sign-in is not configured on this deployment (GitHub OAuth credentials or SESSION_SECRET missing).",
    invalid_csrf_state: "The sign-in request expired or did not match. Please try again.",
    oauth_denied: "GitHub sign-in was cancelled or denied.",
    token_exchange_failed: "GitHub did not accept the sign-in. Please try again.",
    user_fetch_failed: "Could not read your GitHub profile. Please try again.",
    missing_code_or_state: "The sign-in response was incomplete. Please try again.",
    invalid_host: "Sign-in is not available on this host name.",
    auth_failed: "Sign-in failed. Please try again.",
  };

  const init = async () => {
    setupThemeToggle(views.loginThemeToggle);
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");

    if (urlError) {
      showLoginGate(LOGIN_ERRORS[urlError] || "Sign-in failed. Please try again.");
      return;
    }

    let sessionData;
    try {
      const r = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
      sessionData = await r.json();
      if (r.status === 503) return showLoginGate(sessionData.error || "Authentication is unavailable on this deployment.");
      if (!r.ok) return showLoginGate("Authentication service unavailable. Please try again later.");
    } catch (_) {
      return showLoginGate("Could not connect to the authentication service.");
    }

    if (!sessionData.authenticated || !sessionData.authorized) {
      return showLoginGate(sessionData.error || null);
    }

    state.user = sessionData.user;
    if (views.login) views.login.style.display = "none";
    if (views.app) views.app.style.display = "block";
    renderAuthHeader();
    setStatus("loading", "Loading…");
    await loadAll();
  };

  const renderAuthHeader = () => {
    const w = $("admin-auth-widget");
    if (!w || !state.user) return;
    w.innerHTML = `
      <div class="admin-user-pill">
        ${state.user.avatar ? `<img src="${esc(state.user.avatar)}" class="admin-user-avatar" alt="" />` : ""}
        <span>@${esc(state.user.login)}</span>
      </div>
      <button type="button" class="button button-secondary btn-small" id="btn-logout">Logout</button>`;
    $("btn-logout").addEventListener("click", logout);
  };

  const logout = async () => {
    if (dirtyCount() > 0 && !confirm("You have unsaved changes that will be lost. Sign out anyway?")) return;
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch (_) { /* cookie may still be cleared */ }
    showLoginGate("You have been signed out.", "success");
  };

  /** (Re)loads everything from the server, replacing all local working copies. */
  const loadAll = async () => {
    state.loaded = false; state.lastError = null; hideBanner();
    setStatus("loading", "Loading…");
    try {
      const data = await api("GET", "/api/profiles");
      state.master = data.master;
      state.masterVersion = data.masterVersion;
      state.masterDraft = null;
      state.profiles = data.profiles.map(clone);
      state.savedJson = {};
      state.savedProfiles = {};
      state.profiles.forEach((p) => { state.savedJson[p.id] = profileSnapshot(p); state.savedProfiles[p.id] = clone(p); });
      state.applications = data.applications;
      state.storage = data.storage;
      if (!state.profiles.some((p) => p.id === state.activeProfileId)) {
        state.activeProfileId = (state.profiles.find((p) => p.isDefault) || state.profiles[0] || {}).id;
      }
      state.loaded = true;
      const m = await api("GET", "/api/master");
      state.masterDraft = clone(m.data);
      state.masterSavedJson = JSON.stringify(m.data);
      renderAll();
      refreshStatus();
    } catch (err) {
      if (err.body && err.body.handled) return;
      const code = err.body && err.body.code;
      const msg = code === "STORAGE_NOT_CONFIGURED"
        ? "No database is configured on this deployment (DATABASE_URL). The admin console is read-only until storage is set up; nothing can be saved."
        : err.message;
      setStatus("error", "Could not load data");
      showBanner(`<strong>Could not load data from the server.</strong> ${esc(msg)} <button class="button button-secondary mini-btn" id="btn-retry-load">Retry</button>`);
      const b = $("btn-retry-load");
      if (b) b.addEventListener("click", loadAll);
    }
  };

  window.addEventListener("beforeunload", (e) => {
    if (state.loaded && dirtyCount() > 0) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /* ------------------------------- rendering ------------------------------ */

  const renderAll = () => {
    renderProfileList();
    renderActiveProfile();
    renderMasterEditor();
    renderApplications();
    renderStorage();
  };

  const renderProfileList = () => {
    const list = $("admin-profile-list");
    if (!list) return;
    list.innerHTML = state.profiles
      .map((p) => `
        <button type="button" class="profile-item ${p.id === state.activeProfileId ? "is-active" : ""}" data-id="${esc(p.id)}">
          <div class="profile-item-title">
            <span>${esc(p.name)}${isProfileDirty(p) ? " •" : ""}</span>
            ${p.isDefault ? `<span class="admin-badge" style="font-size:0.65rem; padding:0.1rem 0.4rem;">Default</span>` : ""}
          </div>
          <div class="profile-item-meta">${esc(p.targetTitle || "Untitled")} &bull; v${esc(p.version)}</div>
        </button>`)
      .join("");
    list.querySelectorAll(".profile-item").forEach((btn) =>
      btn.addEventListener("click", () => {
        captureActiveProfile();
        state.activeProfileId = btn.dataset.id;
        renderProfileList();
        renderActiveProfile();
      })
    );

    const options = state.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.targetTitle)})</option>`).join("");
    const sel = $("app-profile-select");
    if (sel) sel.innerHTML = options;
    const base = $("new-profile-base");
    if (base) base.innerHTML = state.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    const st = $("app-status");
    if (st && !st.options.length) st.innerHTML = STATUSES.map((s) => `<option ${s === "Applied" ? "selected" : ""}>${s}</option>`).join("");
  };

  const renderActiveProfile = () => {
    const profile = getActiveProfile();
    if (!profile || !state.master) return;
    $("active-profile-name").textContent = profile.name;
    $("input-profile-name").value = profile.name || "";
    $("input-target-title").value = profile.targetTitle || "";
    $("input-summary-override").value = profile.summaryOverride || "";
    $("input-layout").value = profile.layout || "ats-classic";
    $("input-accent-color").value = profile.accentColor || "#2457c5";
    $("input-project-detail").value = profile.projectDetail || "detailed";
    $("input-is-default").checked = Boolean(profile.isDefault);
    $("input-is-default").disabled = Boolean(profile.isDefault); // demote by promoting another profile
    $("btn-delete-profile").disabled = Boolean(profile.isDefault);
    $("btn-delete-profile").style.opacity = profile.isDefault ? "0.4" : "1";

    const selExp = new Set(profile.selectedExperience || []);
    const bulletSel = profile.selectedBullets || {};
    $("experience-checkboxes").innerHTML = state.master.experience
      .map((exp) => {
        const picked = bulletSel[exp.id];
        const bullets = exp.bulletDetails
          .map((b) => {
            const on = !Array.isArray(picked) || picked.length === 0 || picked.includes(b.id);
            return `<label class="checkbox-item" style="margin-left:1.4rem;">
              <input type="checkbox" data-bullet="${esc(b.id)}" data-exp="${esc(exp.id)}" ${on ? "checked" : ""} ${selExp.has(exp.id) ? "" : "disabled"} />
              <span style="font-size:0.78rem;">${esc(b.text)}</span></label>`;
          })
          .join("");
        return `<div>
          <label class="checkbox-item">
            <input type="checkbox" name="exp" value="${esc(exp.id)}" ${selExp.has(exp.id) ? "checked" : ""} />
            <div><strong>${esc(exp.org)}</strong> - ${esc(exp.role)}
              <div style="font-size:0.75rem; color:var(--muted);">${esc(exp.period)}</div></div>
          </label>${bullets}</div>`;
      })
      .join("");

    const selSkills = new Set(profile.selectedSkills || []);
    $("skills-checkboxes").innerHTML = state.master.skills
      .map((g) => `<label class="checkbox-item">
        <input type="checkbox" name="skill" value="${esc(g.id)}" ${selSkills.has(g.id) ? "checked" : ""} />
        <div><strong>${esc(g.group)}:</strong> <span style="font-size:0.78rem; color:var(--muted);">${esc(g.items.join(", "))}</span></div>
      </label>`)
      .join("");

    renderProjectPicker(profile);

    const vis = profile.sectionVisibility || {};
    $("visibility-checkboxes").innerHTML = SECTION_LABELS
      .map(([k, label]) => {
        // projects are opt-in; every other section is on unless explicitly switched off
        const on = k === "projects" ? vis.projects === true : vis[k] !== false;
        return `<label class="checkbox-item"><input type="checkbox" name="vis" value="${k}" ${on ? "checked" : ""} /><span>${label}</span></label>`;
      })
      .join("");

    renderLivePreview();
  };

  /** Selected projects first (in priority order), then the remaining master projects. */
  const renderProjectPicker = (profile) => {
    const byId = new Map(state.master.projects.map((p) => [p.id, p]));
    const sel = (profile.selectedProjects || []).filter((id) => byId.has(id));
    const rest = state.master.projects.filter((p) => !sel.includes(p.id)).map((p) => p.id);
    const row = (id, on, idx) => {
      const p = byId.get(id);
      return `<div class="project-order-row" data-id="${esc(id)}">
        <label class="checkbox-item">
          <input type="checkbox" name="project" value="${esc(id)}" ${on ? "checked" : ""} />
          <div><strong>${esc(p.title)}</strong> <span class="admin-badge" style="font-size:0.62rem; padding:0.05rem 0.35rem;">${esc(p.status)}</span>
            ${p.isPublic ? "" : `<span class="admin-badge" style="font-size:0.62rem; padding:0.05rem 0.35rem;">hidden on site</span>`}
            ${p.needsReview ? `<span class="admin-badge" style="font-size:0.62rem; padding:0.05rem 0.35rem;">needs review</span>` : ""}
          </div>
        </label>
        ${on ? `<button type="button" class="button button-secondary mini-btn" data-move="up" ${idx === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
        <button type="button" class="button button-secondary mini-btn" data-move="down" ${idx === sel.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>` : ""}
      </div>`;
    };
    $("projects-checkboxes").innerHTML = sel.map((id, i) => row(id, true, i)).join("") + rest.map((id) => row(id, false, -1)).join("");
  };

  /** Profile shown in the preview/PDF: the working copy, or the last server-saved version. */
  const previewProfile = () => {
    const p = getActiveProfile();
    if (!p) return null;
    return state.previewMode === "saved" && state.savedProfiles[p.id] ? state.savedProfiles[p.id] : p;
  };

  const resolved = () => {
    const profile = previewProfile();
    if (!profile || !state.master || !window.ResumeResolve) return null;
    return window.ResumeResolve.resolveProfile(profile, state.master);
  };

  const CONTACT_ORDER = [["phone", ""], ["email", ""], ["linkedin", "LinkedIn: "], ["github", "GitHub: "], ["portfolio", "Portfolio: "]];

  const resumePageHtml = (r, unsaved) => {
    const c = /^#[0-9a-fA-F]{6}$/.test(r.accentColor) ? r.accentColor : "#2457c5";
    const compact = r.projectDetail === "compact";
    const contact = r.contact
      ? CONTACT_ORDER.filter(([k]) => r.contact[k]).map(([k, pre]) => esc(pre + r.contact[k].label)).join(" &nbsp;|&nbsp; ")
      : "";
    const heading = (t) => `<div class="rp-h" style="color:${c};">${t}</div>`;
    let html = `<div class="resume-page layout-${esc(r.layout)}${unsaved ? " is-unsaved" : ""}" style="--accent-c:${c};">
      <h1>${esc(r.name)}</h1>
      <div class="rp-title" style="color:${c};">${esc(r.title)}</div>
      ${contact ? `<div class="rp-contact">${contact}</div>` : ""}`;
    if (r.proof.length) {
      html += `<div class="rp-proof">${r.proof.map((p) => `<div style="border-color:${c};"><strong>${esc(p.value)}</strong>${esc(p.text)}</div>`).join("")}</div>`;
    }
    if (r.summary) html += `${heading("Summary")}<div class="rp-summary">${esc(r.summary)}</div>`;
    if (r.skills.length) {
      html += heading("Skills") + r.skills.map((g) => `<div class="rp-skill"><b>${esc(g.group)}:</b> ${esc(g.items.join(", "))}</div>`).join("");
    }
    if (r.experience.length) {
      html += heading("Experience") + r.experience.map((e) => `
        <div class="rp-role"><div class="rp-role-top"><span>${esc(e.org)}</span><span>${esc(e.period)}</span></div>
          <div class="rp-sub">${esc(e.role)}</div>
          <ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>`).join("");
    }
    if (r.projects.length) {
      html += heading("Projects") + r.projects.map((p) => `
        <div class="rp-role"><div class="rp-role-top"><span>${esc(p.title)}</span><span>${esc(p.status)}</span></div>
          <div class="rp-sub">${esc([p.role, p.period].filter(Boolean).join(" | "))}</div>
          ${compact ? "" : `<div class="rp-summary">${esc(p.description)}</div>${p.bullets.length ? `<ul>${p.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}`}
          ${p.technologies.length ? `<div class="rp-tech">Technologies: ${esc(p.technologies.join(", "))}</div>` : ""}</div>`).join("");
    }
    if (r.education.length) {
      html += heading("Education") + r.education.map((ed) => `<div>${esc(ed.level)} - ${esc(ed.place)} - ${esc(ed.meta)}</div>`).join("");
    }
    return html + "</div>";
  };

  /** Scales the fixed-width A4 page to the available width: whole page visible, no horizontal scroll. */
  const fitPreview = () => {
    const stage = $("preview-stage");
    const scaler = $("preview-scaler");
    if (!stage || !scaler) return;
    const avail = stage.clientWidth - 32;
    const scale = Math.min(1, avail / 794);
    scaler.style.transform = scale < 1 ? `scale(${scale})` : "";
    const page = scaler.firstElementChild && scaler.firstElementChild.firstElementChild;
    scaler.style.marginLeft = scale < 1 ? "0" : "auto";
    stage.style.height = page ? `${page.offsetHeight * scale + 32}px` : "auto";
  };

  const renderLivePreview = () => {
    const pane = $("profile-live-preview");
    const r = resolved();
    const profile = getActiveProfile();
    if (!pane || !r || !profile) return;
    const dirty = isProfileDirty(profile);
    const showingDraft = state.previewMode === "draft";
    const unsavedShown = dirty && showingDraft;
    const badge = $("preview-state");
    badge.textContent = unsavedShown ? "Unsaved edits" : "Saved";
    badge.classList.toggle("is-unsaved", unsavedShown);
    $("preview-note").textContent = unsavedShown
      ? "This preview (and the PDF) shows your unsaved edits. Switch to \u201cSaved version\u201d to see what is stored in the database."
      : dirty
        ? "Showing the last saved version; you have newer unsaved edits in the editor."
        : "Matches the version saved in the database.";
    document.querySelectorAll("[data-preview-mode]").forEach((b) => b.classList.toggle("is-active", b.dataset.previewMode === state.previewMode));
    pane.innerHTML = resumePageHtml(r, unsavedShown);
    fitPreview();
  };

  /* --------------------------- profile editing --------------------------- */

  /** Copies form values into the active working profile (in memory only). */
  const captureActiveProfile = () => {
    const p = getActiveProfile();
    if (!p || !$("input-profile-name")) return;
    p.name = $("input-profile-name").value.trim() || p.name;
    p.targetTitle = $("input-target-title").value.trim();
    const summary = $("input-summary-override").value.trim();
    p.summaryOverride = summary || null;
    p.layout = $("input-layout").value;
    p.accentColor = $("input-accent-color").value.trim() || p.accentColor;
    p.projectDetail = $("input-project-detail").value;
    if (!$("input-is-default").disabled) p.isDefault = $("input-is-default").checked;

    p.selectedExperience = [...$("experience-checkboxes").querySelectorAll('input[name="exp"]:checked')].map((i) => i.value);
    p.selectedSkills = [...$("skills-checkboxes").querySelectorAll('input[name="skill"]:checked')].map((i) => i.value);

    const bullets = {};
    state.master.experience.forEach((exp) => {
      if (!p.selectedExperience.includes(exp.id)) return;
      const boxes = [...$("experience-checkboxes").querySelectorAll(`input[data-exp="${exp.id}"]`)];
      const on = boxes.filter((b) => b.checked).map((b) => b.dataset.bullet);
      if (on.length > 0 && on.length < boxes.length) bullets[exp.id] = on; // absent = all bullets
    });
    p.selectedBullets = bullets;

    // projects: keep the current priority order, add newly ticked at the end
    const ticked = new Set([...$("projects-checkboxes").querySelectorAll('input[name="project"]:checked')].map((i) => i.value));
    const ordered = (p.selectedProjects || []).filter((id) => ticked.has(id));
    ticked.forEach((id) => { if (!ordered.includes(id)) ordered.push(id); });
    p.selectedProjects = ordered;

    const vis = {};
    $("visibility-checkboxes").querySelectorAll('input[name="vis"]').forEach((cb) => (vis[cb.value] = cb.checked));
    p.sectionVisibility = vis;
  };

  const onProfileInput = (e) => {
    const target = e && e.target;
    state.lastError = null;
    captureActiveProfile();
    const p = getActiveProfile();
    // enabling/disabling bullet boxes depends on the experience checkbox
    if (target && target.name === "exp") renderActiveProfile();
    else if (target && target.name === "project") { renderProjectPicker(p); renderLivePreview(); }
    else renderLivePreview();
    renderProfileList();
    refreshStatus();
  };

  const wire = () => {
    const form = $("profile-editor-form");
    form.addEventListener("input", onProfileInput);
    form.addEventListener("change", onProfileInput);

    $("projects-checkboxes").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-move]");
      if (!btn) return;
      const p = getActiveProfile();
      const id = btn.closest("[data-id]").dataset.id;
      const i = p.selectedProjects.indexOf(id);
      const j = btn.dataset.move === "up" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= p.selectedProjects.length) return;
      [p.selectedProjects[i], p.selectedProjects[j]] = [p.selectedProjects[j], p.selectedProjects[i]];
      renderProjectPicker(p); renderLivePreview(); refreshStatus();
    });

    $("btn-reset-summary").addEventListener("click", () => {
      $("input-summary-override").value = "";
      onProfileInput();
    });

    document.querySelectorAll("[data-preview-mode]").forEach((b) =>
      b.addEventListener("click", () => { state.previewMode = b.dataset.previewMode; renderLivePreview(); })
    );
    window.addEventListener("resize", fitPreview);
    if (window.ResizeObserver) new ResizeObserver(fitPreview).observe($("preview-stage"));
    $("btn-save-profiles").addEventListener("click", saveActiveProfile);
    $("btn-duplicate-profile").addEventListener("click", duplicateProfile);
    $("btn-delete-profile").addEventListener("click", deleteProfile);
    $("btn-export-profile-pdf").addEventListener("click", exportPdf);
    $("btn-save-master").addEventListener("click", saveMaster);
    $("btn-export-backup").addEventListener("click", downloadBackup);

    $("btn-new-profile").addEventListener("click", () => ($("modal-new-profile").style.display = "grid"));
    $("btn-cancel-new-profile").addEventListener("click", () => ($("modal-new-profile").style.display = "none"));
    $("form-new-profile").addEventListener("submit", createProfile);
    $("form-new-app").addEventListener("submit", createApplication);

    document.querySelectorAll(".tab-btn").forEach((tab) =>
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        state.activeTab = tab.dataset.tab;
        ["profiles", "master", "applications", "backup"].forEach((name) => {
          const panel = $(`tab-panel-${name}`);
          if (panel) panel.style.display = name === state.activeTab ? (name === "profiles" ? "grid" : "block") : "none";
        });
      })
    );
  };

  const applyServerProfile = (saved) => {
    const i = state.profiles.findIndex((p) => p.id === saved.id);
    const copy = clone(saved);
    if (i >= 0) state.profiles[i] = copy; else state.profiles.push(copy);
    state.savedJson[saved.id] = profileSnapshot(copy);
    state.savedProfiles[saved.id] = clone(copy);
  };

  const saveActiveProfile = async () => {
    captureActiveProfile();
    const p = getActiveProfile();
    const out = await guarded(() => api("PUT", "/api/profiles", { ...p, version: p.version }));
    if (!out) return;
    // Any other profile that lost default status was changed in the DB too; reload to stay in sync.
    if (p.isDefault && state.profiles.some((x) => x.id !== p.id && x.isDefault)) {
      const keep = out.profile.id;
      await loadAll();
      state.activeProfileId = keep;
      renderAll();
    } else {
      applyServerProfile(out.profile);
      renderProfileList(); renderActiveProfile();
    }
    showToast(`Saved "${out.profile.name}" (confirmed by server, v${out.profile.version})`);
    if (out.rebuild && out.rebuild.triggered) showToast("Saved. Public site rebuild triggered.");
    refreshStatus();
  };

  const createProfileOnServer = async (profile) => {
    const out = await guarded(() => api("POST", "/api/profiles", profile));
    if (!out) return null;
    applyServerProfile(out.profile);
    state.activeProfileId = out.profile.id;
    renderProfileList(); renderActiveProfile();
    return out.profile;
  };

  const createProfile = async (e) => {
    e.preventDefault();
    captureActiveProfile();
    const name = $("new-profile-name").value.trim();
    const id = slug($("new-profile-id").value.trim() || name);
    const base = state.profiles.find((p) => p.id === $("new-profile-base").value) || state.profiles[0];
    const profile = { ...clone(base), id, name, targetTitle: $("new-profile-title").value.trim(), isDefault: false };
    delete profile.version;
    const made = await createProfileOnServer(profile);
    if (made) {
      $("modal-new-profile").style.display = "none";
      $("form-new-profile").reset();
      showToast(`Created "${made.name}" (confirmed by server)`);
    }
  };

  const duplicateProfile = async () => {
    captureActiveProfile();
    const cur = getActiveProfile();
    const profile = { ...clone(cur), id: slug(`${cur.id}-copy-${Date.now().toString(36)}`), name: `${cur.name} (Copy)`, isDefault: false };
    delete profile.version;
    const made = await createProfileOnServer(profile);
    if (made) showToast(`Duplicated as "${made.name}" (confirmed by server)`);
  };

  const deleteProfile = async () => {
    const cur = getActiveProfile();
    if (cur.isDefault) return;
    if (!confirm(`Permanently delete profile "${cur.name}"? Applications that used it are kept but detached.`)) return;
    const out = await guarded(() => api("DELETE", `/api/profiles?id=${encodeURIComponent(cur.id)}&version=${cur.version}`));
    if (!out) return;
    state.profiles = state.profiles.filter((p) => p.id !== cur.id);
    delete state.savedJson[cur.id];
    delete state.savedProfiles[cur.id];
    state.activeProfileId = (state.profiles.find((p) => p.isDefault) || state.profiles[0]).id;
    renderProfileList(); renderActiveProfile();
    showToast(`Deleted "${cur.name}"`);
    const apps = await api("GET", "/api/applications").catch(() => null);
    if (apps) { state.applications = apps.applications; renderApplications(); }
  };

  const exportPdf = async () => {
    captureActiveProfile();
    const r = resolved();
    if (!r || !window.ResumePdf) return;
    const btn = $("btn-export-profile-pdf");
    btn.textContent = "Generating...";
    try {
      const JsPDF = await loadJsPdf();
      const doc = window.ResumePdf.buildResumePdf(JsPDF, r, { accentColor: r.accentColor });
      const filename = window.ResumePdf.resumeDownloadFilename(new Date(), r.profileId);
      doc.save(filename);
      showToast(`Downloaded ${filename}`);
    } catch (err) {
      console.error(err);
      showToast("PDF generation failed", true);
    } finally {
      btn.textContent = "Export Profile PDF";
    }
  };

  const JSPDF_CDN_URL = "https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js";
  let jsPdfPromise = null;
  const loadJsPdf = () => {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
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

  /* ---------------------------- master resume ---------------------------- */

  const setPath = (obj, path, value) => {
    const keys = path.split(".");
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  };

  const field = (label, path, value, { kind = "text", rows = 3, max } = {}) => {
    const v = kind === "lines" ? (value || []).join("\n") : kind === "csv" ? (value || []).join(", ") : value || "";
    const id = `m-${path.replace(/\./g, "-")}`;
    const input = kind === "text" && !max
      ? `<input class="form-input" id="${id}" data-path="${esc(path)}" data-kind="text" value="${esc(v)}" />`
      : kind === "text"
        ? `<input class="form-input" id="${id}" data-path="${esc(path)}" data-kind="text" value="${esc(v)}" maxlength="${max}" />`
        : `<textarea class="form-textarea" id="${id}" data-path="${esc(path)}" data-kind="${kind}" rows="${rows}">${esc(v)}</textarea>`;
    const hint = kind === "lines" ? " (one per line)" : kind === "csv" ? " (comma separated)" : "";
    return `<div class="form-group"><label class="form-label" for="${id}">${esc(label)}${hint}</label>${input}</div>`;
  };

  const LINK_TYPES = ["website", "app", "generator", "github", "documentation", "demo", "other"];

  const isHttpUrl = (u) => {
    try {
      const x = new URL(u);
      return (x.protocol === "https:" || x.protocol === "http:") && x.hostname.includes(".");
    } catch (_) { return false; }
  };

  const linksEditor = (p, i) => {
    const links = p.links || [];
    const rows = links.map((l, j) => {
      const base = `projects.${i}.links.${j}`;
      const bad = l.url && !isHttpUrl(l.url);
      return `<div class="link-row" data-project="${i}" data-link="${j}">
        <input class="form-input" aria-label="Link label" placeholder="Label (e.g. Official Website)" data-path="${base}.label" data-kind="text" value="${esc(l.label)}" maxlength="120" />
        <input class="form-input ${bad ? "is-invalid" : ""}" aria-label="Link URL" placeholder="https://example.com" data-path="${base}.url" data-kind="text" data-url="1" value="${esc(l.url)}" maxlength="500" />
        <select class="form-select" aria-label="Link type" data-path="${base}.type" data-kind="text">
          ${LINK_TYPES.map((t) => `<option ${t === (l.type || "website") ? "selected" : ""}>${t}</option>`).join("")}</select>
        <div class="link-actions">
          <button type="button" class="button button-secondary mini-btn" data-link-move="up" ${j === 0 ? "disabled" : ""} aria-label="Move link up">↑</button>
          <button type="button" class="button button-secondary mini-btn" data-link-move="down" ${j === links.length - 1 ? "disabled" : ""} aria-label="Move link down">↓</button>
          <button type="button" class="button btn-danger mini-btn" data-link-remove="1" aria-label="Remove link">✕</button>
        </div>
        <div class="link-flags">
          <label><input type="radio" name="primary-${i}" data-link-primary="1" ${l.primary ? "checked" : ""} /> Primary</label>
          <label><input type="checkbox" data-path="${base}.visible" data-kind="bool" ${l.visible !== false ? "checked" : ""} /> Visible on public site</label>
        </div>
        ${bad ? `<div class="link-error">Enter a full URL starting with https://</div>` : ""}
      </div>`;
    }).join("");
    return `<div class="form-group"><label class="form-label">Project links</label>
      ${rows || `<p class="proof-text" style="font-size:0.78rem; margin:0 0 0.4rem;">No links yet.</p>`}
      <button type="button" class="button button-secondary mini-btn" data-link-add="${i}">+ Add link</button></div>`;
  };

  /** Returns a list of problems with project links, checked before anything is sent to the server. */
  const linkProblems = () => {
    const out = [];
    (state.masterDraft.projects || []).forEach((p) => {
      const links = p.links || [];
      links.forEach((l, j) => {
        if (!String(l.label || "").trim()) out.push(`${p.title}: link ${j + 1} needs a label`);
        if (!isHttpUrl(l.url || "")) out.push(`${p.title}: "${l.label || "link " + (j + 1)}" has an invalid URL`);
      });
      if (links.filter((l) => l.primary).length > 1) out.push(`${p.title}: only one primary link is allowed`);
      if (links.some((l) => l.primary && l.visible === false)) out.push(`${p.title}: the primary link must be visible`);
    });
    return out;
  };

  const renderMasterEditor = () => {
    const host = $("master-editor");
    const d = state.masterDraft;
    if (!host || !d) return;
    $("master-version").textContent = `v${state.masterVersion}`;

    const projectBlocks = d.projects.map((p, i) => `
      <div class="master-block" data-project-index="${i}">
        <h4>${esc(p.title || "New project")} <span class="admin-badge" style="font-size:0.65rem;">${esc(p.id)}</span></h4>
        <div class="master-grid-2">
          ${field("Title", `projects.${i}.title`, p.title)}
          ${field("Category", `projects.${i}.category`, p.category)}
          <div class="form-group"><label class="form-label" for="m-projects-${i}-status">Status</label>
            <select class="form-select" id="m-projects-${i}-status" data-path="projects.${i}.status" data-kind="text">
              ${PROJECT_STATUSES.map((s) => `<option ${s === p.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
          ${field("Role", `projects.${i}.role`, p.role)}
          ${field("Period (leave blank if unverified)", `projects.${i}.period`, p.period)}
        </div>
        ${field("Description", `projects.${i}.description`, p.description, { kind: "area", rows: 2 })}
        ${field("Technologies", `projects.${i}.technologies`, p.technologies, { kind: "csv", rows: 2 })}
        ${field("Highlights", `projects.${i}.bullets`, p.bullets, { kind: "lines", rows: 3 })}
        ${linksEditor(p, i)}
        <div style="display:flex; gap:1.2rem; align-items:center; flex-wrap:wrap;">
          <label class="checkbox-item" style="margin:0;"><input type="checkbox" data-path="projects.${i}.isPublic" data-kind="bool" ${p.isPublic !== false ? "checked" : ""} /><span>Show on public portfolio</span></label>
          <label class="checkbox-item" style="margin:0;"><input type="checkbox" data-path="projects.${i}.needsReview" data-kind="bool" ${p.needsReview ? "checked" : ""} /><span>Needs my review</span></label>
          <button type="button" class="button btn-danger mini-btn" data-remove-project="${i}">Remove project</button>
        </div>
      </div>`).join("");

    host.innerHTML = `
      <div class="master-block"><h4>Basics</h4>
        <div class="master-grid-2">${field("Name", "name", d.name)}${field("Default headline", "title", d.title)}</div>
        ${field("Summary", "summary", d.summary, { kind: "area", rows: 4 })}
      </div>
      <div class="master-block"><h4>Experience</h4>
        ${d.experience.map((e, i) => `
          <div class="master-block">
            <h4>${esc(e.org)} <span class="admin-badge" style="font-size:0.65rem;">${esc(e.id)}</span></h4>
            <div class="master-grid-2">${field("Organisation", `experience.${i}.org`, e.org)}${field("Role", `experience.${i}.role`, e.role)}${field("Period", `experience.${i}.period`, e.period)}</div>
            ${field("Bullets", `experience.${i}.bullets`, e.bullets, { kind: "lines", rows: 6 })}
          </div>`).join("")}
      </div>
      <div class="master-block"><h4>Skills</h4>
        ${d.skills.map((s, i) => `<div class="master-grid-2">${field("Group", `skills.${i}.group`, s.group)}${field("Items", `skills.${i}.items`, s.items, { kind: "csv", rows: 2 })}</div>`).join("")}
      </div>
      <div class="master-block"><h4>Projects (${d.projects.length})</h4>
        ${projectBlocks}
        <button type="button" class="button button-secondary btn-small" id="btn-add-project">+ Add project</button>
      </div>`;
  };

  const onMasterInput = (e) => {
    const t = e.target;
    const path = t.dataset && t.dataset.path;
    if (t.dataset && t.dataset.linkPrimary && state.masterDraft) {
      const row = t.closest(".link-row");
      const links = state.masterDraft.projects[Number(row.dataset.project)].links;
      links.forEach((l, k) => (l.primary = k === Number(row.dataset.link)));
      links[Number(row.dataset.link)].visible = true; // a primary link is always public
      renderMasterEditor(); refreshStatus();
      return;
    }
    if (!path || !state.masterDraft) return;
    state.lastError = null;
    const kind = t.dataset.kind;
    let value;
    if (kind === "bool") value = t.checked;
    else if (kind === "lines") value = t.value.split("\n").map((s) => s.trim()).filter(Boolean);
    else if (kind === "csv") value = t.value.split(",").map((s) => s.trim()).filter(Boolean);
    else value = t.value;
    setPath(state.masterDraft, path, value);
    if (t.dataset.url) t.classList.toggle("is-invalid", Boolean(value) && !isHttpUrl(value));
    // hiding the primary link would orphan it: hand "primary" to nothing and let the server rule apply
    if (/\.visible$/.test(path) && !value) {
      const m = /^projects\.(\d+)\.links\.(\d+)\.visible$/.exec(path);
      if (m) { const l = state.masterDraft.projects[+m[1]].links[+m[2]]; if (l.primary) { l.primary = false; renderMasterEditor(); } }
    }
    refreshStatus();
  };

  const saveMaster = async () => {
    if (!isMasterDirty()) return showToast("Master resume has no unsaved changes.");
    const problems = linkProblems();
    if (problems.length) {
      showBanner(`<strong>Not saved: fix the project links first.</strong><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
      return showToast("Not saved: invalid project links", true);
    }
    const out = await guarded(() => api("PUT", "/api/master", { version: state.masterVersion, data: state.masterDraft }));
    if (!out) return;
    state.master = out.master;
    state.masterVersion = out.version;
    state.masterDraft = clone(out.data);
    state.masterSavedJson = JSON.stringify(out.data);
    if (state.storage) state.storage.masterVersion = out.version;
    renderAll();
    refreshStatus();
    showToast(`Master resume saved (confirmed by server, v${out.version})`);
    if (out.rebuild && !out.rebuild.triggered) {
      showToast(`Saved. Public site will update on next build (${out.rebuild.reason}).`);
    }
  };

  /* ----------------------------- applications ----------------------------- */

  const renderApplications = () => {
    const list = $("applications-list");
    if (!list) return;
    if (state.applications.length === 0) {
      list.innerHTML = `<p class="proof-text">No job applications logged yet.</p>`;
      return;
    }
    const names = Object.fromEntries(state.profiles.map((p) => [p.id, p.name]));
    list.innerHTML = state.applications.map((a) => `
      <div class="admin-card" style="margin-bottom:0.75rem;" data-app="${esc(a.id)}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.75rem;">
          <div>
            <strong>${esc(a.company)}</strong> - ${esc(a.jobTitle)}
            <div style="font-size:0.78rem; color:var(--muted); margin-top:0.2rem;">
              Profile: <strong>${esc(a.profileId ? names[a.profileId] || a.profileId : "(deleted profile)")}</strong> &bull; Applied: ${esc(a.applicationDate)}
            </div>
          </div>
          <select class="form-select status-select" data-status-for="${esc(a.id)}" aria-label="Status for ${esc(a.company)}">
            ${STATUSES.map((s) => `<option ${s === a.status ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
        ${a.notes ? `<div style="font-size:0.8rem; color:var(--muted); margin-top:0.5rem; white-space:pre-wrap;">${esc(a.notes)}</div>` : ""}
        <div style="margin-top:0.5rem; text-align:right;">
          <button type="button" class="button btn-danger mini-btn" data-delete-app="${esc(a.id)}">Delete</button>
        </div>
      </div>`).join("");
  };

  const applyServerApplication = (saved) => {
    const i = state.applications.findIndex((a) => a.id === saved.id);
    if (i >= 0) state.applications[i] = saved; else state.applications.unshift(saved);
  };

  const onApplicationsChange = async (e) => {
    const sel = e.target.closest("[data-status-for]");
    if (!sel) return;
    const app = state.applications.find((a) => a.id === sel.dataset.statusFor);
    const out = await guarded(() => api("PUT", "/api/applications", { ...app, status: sel.value, version: app.version }));
    if (out) { applyServerApplication(out.application); showToast(`Status saved: ${out.application.status} (confirmed by server)`); }
    renderApplications();
  };

  const onApplicationsClick = async (e) => {
    const del = e.target.closest("[data-delete-app]");
    if (!del) return;
    const app = state.applications.find((a) => a.id === del.dataset.deleteApp);
    if (!confirm(`Permanently delete the application to ${app.company}?`)) return;
    const out = await guarded(() => api("DELETE", `/api/applications?id=${encodeURIComponent(app.id)}&version=${app.version}`));
    if (out) { state.applications = state.applications.filter((a) => a.id !== app.id); renderApplications(); showToast("Application deleted"); }
  };

  const createApplication = async (e) => {
    e.preventDefault();
    const company = $("app-company").value.trim();
    const payload = {
      id: slug(`app-${company}-${Date.now().toString(36)}`),
      company,
      jobTitle: $("app-title").value.trim(),
      profileId: $("app-profile-select").value,
      status: $("app-status").value,
      notes: $("app-notes").value.trim(),
      applicationDate: new Date().toISOString().slice(0, 10),
    };
    const out = await guarded(() => api("POST", "/api/applications", payload));
    if (!out) return; // form keeps its values so nothing typed is lost
    applyServerApplication(out.application);
    renderApplications();
    $("form-new-app").reset();
    showToast(`Logged application to ${company} (confirmed by server)`);
  };

  /* ------------------------------ backup/storage -------------------------- */

  const renderStorage = () => {
    const el = $("storage-info");
    if (!el || !state.storage) return;
    const s = state.storage;
    el.innerHTML = `Backend: <strong>${esc(s.backend)}</strong> &bull; schema <code>${esc(s.schemaVersion)}</code><br />
      Master resume v${esc(s.masterVersion)} &bull; ${esc(s.profiles)} profiles &bull; ${esc(s.applications)} applications`;
  };

  const downloadBackup = async () => {
    const btn = $("btn-export-backup");
    btn.disabled = true;
    try {
      const res = await fetch("/api/export", { cache: "no-store", credentials: "same-origin" });
      if (res.status === 401 || res.status === 403) return sessionExpired();
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const m = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m ? m[1] : "rajasekar-resume-backup.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      showToast(`Backup downloaded: ${a.download}`);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  };

  /* --------------------------------- start -------------------------------- */

  const start = () => {
    wire();
    const master = $("master-editor");
    master.addEventListener("input", onMasterInput);
    master.addEventListener("change", onMasterInput);
    master.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove-project]");
      if (rm) {
        const i = Number(rm.dataset.removeProject);
        if (confirm(`Remove project "${state.masterDraft.projects[i].title}" from the master resume? (Takes effect when you save.)`)) {
          state.masterDraft.projects.splice(i, 1);
          renderMasterEditor(); refreshStatus();
        }
      }
      const addLink = e.target.closest("[data-link-add]");
      if (addLink) {
        const proj = state.masterDraft.projects[Number(addLink.dataset.linkAdd)];
        proj.links = proj.links || [];
        proj.links.push({ label: "", url: "", type: "website", primary: proj.links.length === 0, visible: true });
        renderMasterEditor(); refreshStatus();
        return;
      }
      const row = e.target.closest(".link-row");
      if (row && (e.target.closest("[data-link-remove]") || e.target.closest("[data-link-move]"))) {
        const links = state.masterDraft.projects[Number(row.dataset.project)].links;
        const j = Number(row.dataset.link);
        if (e.target.closest("[data-link-remove]")) {
          const [gone] = links.splice(j, 1);
          if (gone.primary && links.length) links[0].primary = true;
        } else {
          const k = e.target.closest("[data-link-move]").dataset.linkMove === "up" ? j - 1 : j + 1;
          if (k >= 0 && k < links.length) [links[j], links[k]] = [links[k], links[j]];
        }
        renderMasterEditor(); refreshStatus();
        return;
      }
      if (e.target.id === "btn-add-project") {
        const title = prompt("Project title?");
        if (!title) return;
        let id = `project-${slug(title)}`;
        while (state.masterDraft.projects.some((p) => p.id === id)) id += "-2";
        state.masterDraft.projects.push({
          id, title: title.trim(), category: "", status: "Needs review", role: "", period: "", description: "",
          technologies: [], bullets: [], links: [], isPublic: false, needsReview: true,
        });
        renderMasterEditor(); refreshStatus();
      }
    });
    $("applications-list").addEventListener("change", onApplicationsChange);
    $("applications-list").addEventListener("click", onApplicationsClick);
    init();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
