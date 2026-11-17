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
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const weekdays = ["", "Mon", "", "Wed", "", "Fri", ""];

  const weeks = data.weeks || [];
  let monthLabelsHtml = "";
  let lastMonth = -1;

  weeks.forEach((week) => {
    const firstDay = week.contributionDays && week.contributionDays[0];
    if (firstDay && firstDay.date) {
      const monthIndex = new Date(firstDay.date).getMonth();
      if (monthIndex !== lastMonth) {
        monthLabelsHtml += `<span class="contributions-month-label">${months[monthIndex]}</span>`;
        lastMonth = monthIndex;
      }
    }
  });

  const weekdaysHtml = weekdays
    .map((d) => `<span>${d}</span>`)
    .join("");

  const weeksHtml = weeks
    .map((week) => {
      const days = week.contributionDays || [];
      const daysHtml = days
        .map(
          (d) =>
            `<div class="contributions-day-cell level-${d.level || 0}" data-date="${d.date}" data-count="${d.count || 0}" tabindex="0" role="gridcell" aria-label="${d.count || 0} contributions on ${d.date}"></div>`
        )
        .join("");
      return `<div class="contributions-week-col">${daysHtml}</div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="contributions-header">
      <div class="contributions-meta">
        <span class="contributions-count">${data.totalContributions.toLocaleString()} contributions</span>
        <span class="contributions-subtext">in the last year on GitHub</span>
      </div>
      <a href="https://github.com/${username}" target="_blank" rel="noreferrer" class="button button-secondary" style="min-height:32px; padding:0.35rem 0.85rem; font-size:0.8rem;">
        @${username} on GitHub
      </a>
    </div>

    <div class="contributions-scroll">
      <div class="contributions-graph-inner">
        <div class="contributions-months-row">${monthLabelsHtml}</div>
        <div class="contributions-body-row">
          <div class="contributions-weekdays-col">${weekdaysHtml}</div>
          <div class="contributions-calendar-grid">${weeksHtml}</div>
        </div>
      </div>
    </div>

    <div class="contributions-footer">
      <span>Contributions activity calendar</span>
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

  // Interactive tooltip
  const tooltip = container.querySelector(".contributions-tooltip");
  const cells = container.querySelectorAll(".contributions-day-cell[data-date]");

  const showTooltip = (cell) => {
    const date = cell.dataset.date;
    const count = parseInt(cell.dataset.count, 10);
    if (!date) return;

    const dateFormatted = new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const countText = count === 1 ? "1 contribution" : `${count} contributions`;
    tooltip.textContent = `${countText} on ${dateFormatted}`;
    tooltip.classList.add("is-active");

    const cellRect = cell.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const left = cellRect.left - containerRect.left + cellRect.width / 2;
    const top = cellRect.top - containerRect.top;

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  const hideTooltip = () => {
    tooltip.classList.remove("is-active");
  };

  cells.forEach((cell) => {
    cell.addEventListener("mouseenter", () => showTooltip(cell));
    cell.addEventListener("mouseleave", hideTooltip);
    cell.addEventListener("focus", () => showTooltip(cell));
    cell.addEventListener("blur", hideTooltip);
  });
};

const initializeContributionGraph = () => {
  const container = document.getElementById("github-contributions-graph");
  if (!container) return;

  const username = container.dataset.username || "innovinitylabs";

  fetch(`/api/github-contributions?username=${encodeURIComponent(username)}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !data.weeks || data.weeks.length === 0) {
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
