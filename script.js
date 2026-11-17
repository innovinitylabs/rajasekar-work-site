const root = document.documentElement;
const themeToggles = [...document.querySelectorAll(".theme-toggle")];
const revealElements = [...document.querySelectorAll(".reveal")];
const downloadResumeButton = document.getElementById("download-resume");

const RESUME_DATA_URL = "resume-default.json";
const JSPDF_CDN_URL =
  "https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js";

let jsPdfLoader = null;

const loadJsPdf = () => {
  if (window.jspdf && window.jspdf.jsPDF) {
    return Promise.resolve(window.jspdf.jsPDF);
  }

  if (!jsPdfLoader) {
    jsPdfLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = JSPDF_CDN_URL;
      script.onload = () =>
        window.jspdf && window.jspdf.jsPDF
          ? resolve(window.jspdf.jsPDF)
          : reject(new Error("jsPDF unavailable after load"));
      script.onerror = () => reject(new Error("Failed to load jsPDF"));
      document.head.appendChild(script);
    });
  }

  return jsPdfLoader;
};

const downloadResume = async () => {
  if (!window.ResumePdf) {
    throw new Error("Resume PDF renderer is unavailable");
  }

  const response = await fetch(RESUME_DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load resume data (${response.status})`);
  }

  const data = await response.json();
  const JsPDF = await loadJsPdf();
  const doc = window.ResumePdf.buildResumePdf(JsPDF, data);
  doc.save(window.ResumePdf.resumeDownloadFilename());
};

if (downloadResumeButton) {
  downloadResumeButton.addEventListener("click", (event) => {
    event.preventDefault();
    const originalText = downloadResumeButton.textContent;
    downloadResumeButton.setAttribute("aria-busy", "true");
    downloadResumeButton.textContent = "Generating...";

    downloadResume()
      .catch((error) => {
        console.error(error);
        window.open(downloadResumeButton.getAttribute("href"), "_blank");
      })
      .finally(() => {
        downloadResumeButton.removeAttribute("aria-busy");
        downloadResumeButton.textContent = originalText;
      });
  });
}

const setTheme = (theme) => {
  root.dataset.theme = theme;

  if (!themeToggles.length) {
    return;
  }

  const isDark = theme === "dark";
  themeToggles.forEach((themeToggle) => {
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode"
    );
  });
};

if (themeToggles.length) {
  setTheme(root.dataset.theme || "light");

  themeToggles.forEach((themeToggle) =>
    themeToggle.addEventListener("click", () => {
      const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
      setTheme(nextTheme);
      localStorage.setItem("theme", nextTheme);
      root.classList.remove("theme-intro");
      root.classList.add("theme-ready");
    })
  );
}

window.addEventListener(
  "load",
  () => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReducedMotion) {
      root.classList.remove("theme-intro");
      root.classList.add("theme-ready");
      return;
    }

    window.setTimeout(() => {
      root.classList.add("theme-ready");

      if (root.classList.contains("theme-intro")) {
        window.setTimeout(() => root.classList.remove("theme-intro"), 950);
      }
    }, 120);
  },
  { once: true }
);

const revealIfInView = (element) => {
  const rect = element.getBoundingClientRect();
  const revealPoint = window.innerHeight * 0.92;

  if (rect.top <= revealPoint) {
    element.classList.add("is-visible");
    return true;
  }

  return false;
};

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      });
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -40px 0px",
    }
  );

  revealElements.forEach((element) => {
    if (revealIfInView(element)) {
      return;
    }

    observer.observe(element);
  });

  window.addEventListener(
    "load",
    () => {
      revealElements.forEach((element) => {
        if (element.classList.contains("is-visible")) {
          return;
        }

        if (revealIfInView(element)) {
          observer.unobserve(element);
        }
      });
    },
    { once: true }
  );
} else {
  revealElements.forEach((element) => element.classList.add("is-visible"));
}

/* -------------------------------------------------------------------------- */
/* GitHub Contribution Graph                                                  */
/* -------------------------------------------------------------------------- */

const renderContributionCalendar = (container, data, username) => {
  const C = window.ContribCalendar;
  const today = data.to || C.todayIso();
  const years = C.availableYears(today);
  const views = [
    { id: "last", label: "Last 12 months", range: C.lastYearRange(today), caption: "in the last 12 months" },
    ...years.map((y) => ({ id: String(y), label: String(y), range: C.yearRange(y, today), caption: `in ${y}` })),
  ];
  const weekdayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  const draw = (viewId) => {
    const view = views.find((v) => v.id === viewId) || views[0];
    const cal = C.buildCalendar(data.days, view.range.start, view.range.end);

    // One CSS grid: row 1 = month labels, rows 2-8 = Sun..Sat, col 1 = weekday labels.
    // Every item is placed by its computed column, so labels cannot drift from the tiles.
    const monthsHtml = cal.monthLabels
      .map((m) => `<span class="contributions-month-label" style="grid-column:${m.col + 2} / span 3">${m.label}</span>`)
      .join("");
    const weekdaysHtml = weekdayLabels
      .map((d, r) => (d ? `<span class="contributions-weekday-label" style="grid-row:${r + 2}">${d}</span>` : ""))
      .join("");
    const cellsHtml = cal.weeks
      .map((week, c) =>
        week
          .map((d, r) =>
            d
              ? `<div class="contributions-day-cell level-${d.level}" style="grid-column:${c + 2};grid-row:${r + 2}" data-date="${d.date}" data-count="${d.count}" tabindex="0" role="gridcell" aria-label="${d.count} contributions on ${d.date}"></div>`
              : ""
          )
          .join("")
      )
      .join("");

    const tabs = views
      .map(
        (v) =>
          `<button type="button" class="contributions-tab${v.id === view.id ? " is-active" : ""}" data-view="${esc(v.id)}" aria-pressed="${v.id === view.id}">${esc(v.label)}</button>`
      )
      .join("");

    container.innerHTML = `
      <div class="contributions-header">
        <div class="contributions-meta">
          <span class="contributions-count">${cal.total.toLocaleString()} contributions</span>
          <span class="contributions-subtext">${view.caption} on GitHub</span>
        </div>
        <a href="https://github.com/${username}" target="_blank" rel="noreferrer" class="button button-secondary" style="min-height:32px; padding:0.35rem 0.85rem; font-size:0.8rem;">
          @${username} on GitHub
        </a>
      </div>
      <div class="contributions-tabs" role="group" aria-label="Contribution period">${tabs}</div>
      <div class="contributions-scroll">
        <div class="contributions-grid" style="--weeks:${cal.weeks.length}" role="grid" aria-label="Contribution calendar">
          ${monthsHtml}${weekdaysHtml}${cellsHtml}
        </div>
      </div>
      <div class="contributions-footer">
        <span>${view.range.start} to ${view.range.end}</span>
        <div class="contributions-legend">
          <span>Less</span>
          <span class="contributions-day-cell level-0"></span>
          <span class="contributions-day-cell level-1"></span>
          <span class="contributions-day-cell level-2"></span>
          <span class="contributions-day-cell level-3"></span>
          <span class="contributions-day-cell level-4"></span>
          <span>More</span>
        </div>
      </div>
      <div class="contributions-tooltip" role="tooltip" aria-hidden="true"></div>
    `;

    container.querySelectorAll(".contributions-tab").forEach((btn) =>
      btn.addEventListener("click", () => draw(btn.dataset.view))
    );

    const tooltip = container.querySelector(".contributions-tooltip");
    const showTooltip = (cell) => {
      const date = cell.dataset.date;
      const count = parseInt(cell.dataset.count, 10);
      const dateFormatted = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
      });
      tooltip.textContent = `${count === 1 ? "1 contribution" : `${count} contributions`} on ${dateFormatted}`;
      tooltip.classList.add("is-active");
      const cellRect = cell.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      tooltip.style.left = `${cellRect.left - containerRect.left + cellRect.width / 2}px`;
      tooltip.style.top = `${cellRect.top - containerRect.top}px`;
    };
    const hideTooltip = () => tooltip.classList.remove("is-active");
    container.querySelectorAll(".contributions-grid .contributions-day-cell").forEach((cell) => {
      cell.addEventListener("mouseenter", () => showTooltip(cell));
      cell.addEventListener("mouseleave", hideTooltip);
      cell.addEventListener("focus", () => showTooltip(cell));
      cell.addEventListener("blur", hideTooltip);
    });
  };

  draw("last");
};

const initializeContributionGraph = () => {
  const container = document.getElementById("github-contributions-graph");
  if (!container) return;

  const username = container.dataset.username || "innovinitylabs";

  fetch(`/api/github-contributions?username=${encodeURIComponent(username)}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !Array.isArray(data.days) || data.days.length === 0 || !window.ContribCalendar) {
        container.innerHTML = `
          <div class="contributions-header">
            <div class="contributions-meta">
              <span class="contributions-count">GitHub Activity</span>
              <span class="contributions-subtext">Open Source Proof of Work</span>
            </div>
            <a href="https://github.com/${username}" target="_blank" rel="noreferrer" class="button button-secondary" style="min-height:32px; padding:0.35rem 0.85rem; font-size:0.8rem;">
              @${username}
            </a>
          </div>
          <p class="proof-text" style="margin-top:0.5rem;">
            Explore open source repositories, commits, and workflows at
            <a href="https://github.com/${username}" target="_blank" rel="noreferrer" style="color:var(--accent); font-weight:600;">github.com/${username}</a>.
          </p>
        `;
        return;
      }
      renderContributionCalendar(container, data, username);
    })
    .catch(() => {
      container.innerHTML = `
        <div class="contributions-header">
          <div class="contributions-meta">
            <span class="contributions-count">GitHub Activity</span>
          </div>
          <a href="https://github.com/${username}" target="_blank" rel="noreferrer" class="button button-secondary" style="min-height:32px; padding:0.35rem 0.85rem; font-size:0.8rem;">
            @${username}
          </a>
        </div>
        <p class="proof-text">View active repositories and code at <a href="https://github.com/${username}" target="_blank" rel="noreferrer" style="color:var(--accent);">github.com/${username}</a>.</p>
      `;
    });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeContributionGraph);
} else {
  initializeContributionGraph();
}
