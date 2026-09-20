const root = document.documentElement;
const themeToggles = [...document.querySelectorAll(".theme-toggle")];
const revealElements = [...document.querySelectorAll(".reveal")];
const downloadResumeButton = document.getElementById("download-resume");

const RESUME_DATA_URL = "resume-data.json";
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
