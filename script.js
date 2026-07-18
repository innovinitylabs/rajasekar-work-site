const root = document.documentElement;
const themeToggles = [...document.querySelectorAll(".theme-toggle")];
const revealElements = [...document.querySelectorAll(".reveal")];
const downloadResumeButton = document.getElementById("download-resume");

// Generates the PDF at runtime from resume-source.html via the browser's
// print-to-PDF flow, so the download always matches the latest resume content.
// The print document title becomes the default filename: rajasekarc-resume.pdf.
const RESUME_SOURCE_URL = "resume-source.html";
const RESUME_FILENAME = "rajasekarc-resume";

let resumePrintFrame = null;

const printResume = () => {
  if (resumePrintFrame) {
    resumePrintFrame.remove();
  }

  resumePrintFrame = document.createElement("iframe");
  resumePrintFrame.style.position = "fixed";
  resumePrintFrame.style.right = "0";
  resumePrintFrame.style.bottom = "0";
  resumePrintFrame.style.width = "0";
  resumePrintFrame.style.height = "0";
  resumePrintFrame.style.border = "0";
  resumePrintFrame.setAttribute("aria-hidden", "true");
  resumePrintFrame.src = RESUME_SOURCE_URL;

  resumePrintFrame.addEventListener("load", () => {
    const frameWindow = resumePrintFrame.contentWindow;

    if (!frameWindow) {
      window.open(RESUME_SOURCE_URL, "_blank");
      return;
    }

    frameWindow.document.title = RESUME_FILENAME;
    frameWindow.focus();
    frameWindow.print();
  });

  document.body.appendChild(resumePrintFrame);
};

if (downloadResumeButton) {
  downloadResumeButton.addEventListener("click", (event) => {
    event.preventDefault();
    printResume();
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
