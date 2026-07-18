const root = document.documentElement;
const themeToggles = [...document.querySelectorAll(".theme-toggle")];
const revealElements = [...document.querySelectorAll(".reveal")];
const downloadResumeButton = document.getElementById("download-resume");

// Real PDF download, generated on the client from resume-data.json (the single
// source of truth) so the file always reflects the latest resume. Uses jsPDF's
// text APIs, which produce selectable, ATS-parseable text (not a rasterized
// image) and download immediately with no print dialog.
const RESUME_DATA_URL = "resume-data.json";
const RESUME_FILENAME = "rajasekarc-resume.pdf";
const JSPDF_CDN_URL =
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

const ACCENT = [36, 87, 197];
const INK = [16, 24, 40];
const MUTE = [71, 84, 103];

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

const stripUrl = (url) =>
  String(url)
    .replace(/^https?:\/\//, "")
    .replace(/^mailto:/, "")
    .replace(/^tel:/, "")
    .replace(/\/$/, "");

const buildResumePdf = (JsPDF, data) => {
  const doc = new JsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 44;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const setColor = ([r, g, b]) => doc.setTextColor(r, g, b);

  const writeLines = (text, { size, style = "normal", color = INK, gap = 2, indent = 0 }) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    setColor(color);
    const lines = doc.splitTextToSize(text, contentWidth - indent);
    const lineHeight = size * 1.32;
    lines.forEach((line) => {
      ensureSpace(lineHeight);
      doc.text(line, margin + indent, y);
      y += lineHeight;
    });
    y += gap;
  };

  const sectionHeading = (label) => {
    ensureSpace(26);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setColor(ACCENT);
    doc.text(label.toUpperCase(), margin, y);
    y += 6;
    doc.setDrawColor(208, 213, 221);
    doc.setLineWidth(0.6);
    doc.line(margin, y, pageWidth - margin, y);
    y += 12;
  };

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  setColor(INK);
  doc.text(data.name, margin, y);
  y += 20;
  writeLines(data.title, { size: 11, style: "bold", color: ACCENT, gap: 3 });

  const c = data.contact;
  const contactLine = [
    c.phone.label,
    stripUrl(c.email.url),
    c.linkedin.label,
    c.github.label,
  ].join("   |   ");
  writeLines(contactLine, { size: 9, color: MUTE, gap: 4 });

  doc.setDrawColor(208, 213, 221);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 12;

  // Summary
  writeLines(data.summary, { size: 9.8, color: MUTE, gap: 2 });

  // Experience
  sectionHeading("Experience");
  data.experience.forEach((role) => {
    ensureSpace(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setColor(INK);
    doc.text(role.org, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setColor(ACCENT);
    doc.text(role.period, pageWidth - margin, y, { align: "right" });
    y += 13;
    writeLines(role.role, { size: 9.5, style: "italic", color: MUTE, gap: 4 });
    role.bullets.forEach((bullet) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      setColor(INK);
      const lines = doc.splitTextToSize(bullet, contentWidth - 14);
      const lineHeight = 9.5 * 1.32;
      lines.forEach((line, index) => {
        ensureSpace(lineHeight);
        if (index === 0) {
          doc.text("\u2022", margin + 2, y);
        }
        doc.text(line, margin + 14, y);
        y += lineHeight;
      });
      y += 1.5;
    });
    y += 6;
  });

  // Projects
  sectionHeading("Projects");
  data.projects.forEach((project) => {
    ensureSpace(28);
    writeLines(project.name, { size: 10.5, style: "bold", color: INK, gap: 1 });
    writeLines(project.description, { size: 9.3, color: MUTE, gap: 1 });
    const links = project.links
      .map((link) => `${link.label}: ${stripUrl(link.url)}`)
      .join("   |   ");
    writeLines(links, { size: 8.6, color: ACCENT, gap: 6 });
  });

  // Skills
  sectionHeading("Skills");
  data.skills.forEach((group) => {
    const label = `${group.group}: `;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.4);
    const labelWidth = doc.getTextWidth(label);
    doc.setFont("helvetica", "normal");
    const valueLines = doc.splitTextToSize(
      group.items.join(", "),
      contentWidth - labelWidth
    );
    const lineHeight = 9.4 * 1.34;
    ensureSpace(lineHeight);
    setColor(INK);
    doc.setFont("helvetica", "bold");
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    setColor(MUTE);
    valueLines.forEach((line, index) => {
      if (index > 0) {
        ensureSpace(lineHeight);
      }
      doc.text(line, margin + (index === 0 ? labelWidth : 0), y);
      y += lineHeight;
    });
    y += 2;
  });

  // Education
  sectionHeading("Education");
  data.education.forEach((edu) => {
    writeLines(`${edu.level} - ${edu.place} - ${edu.meta}`, {
      size: 9.4,
      color: INK,
      gap: 1,
    });
  });

  // Footer links
  y += 6;
  const l = data.links;
  writeLines(
    `Portfolio: ${stripUrl(l.portfolio.url)}   |   Creative: ${stripUrl(
      l.creative.url
    )}`,
    { size: 8.6, color: MUTE, gap: 0 }
  );

  return doc;
};

const downloadResume = async () => {
  const response = await fetch(RESUME_DATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load resume data (${response.status})`);
  }
  const data = await response.json();
  const JsPDF = await loadJsPdf();
  const doc = buildResumePdf(JsPDF, data);
  doc.save(RESUME_FILENAME);
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
        // Fall back to the printable HTML source if PDF generation fails.
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
