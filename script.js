const root = document.documentElement;
const themeToggle = document.querySelector(".theme-toggle");
const revealElements = [...document.querySelectorAll(".reveal")];

const setTheme = (theme) => {
  root.dataset.theme = theme;

  if (!themeToggle) {
    return;
  }

  const isDark = theme === "dark";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute(
    "aria-label",
    isDark ? "Switch to light mode" : "Switch to dark mode"
  );
};

if (themeToggle) {
  setTheme(root.dataset.theme || "light");

  themeToggle.addEventListener("click", () => {
    const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    root.classList.remove("theme-intro");
    root.classList.add("theme-ready");
  });
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
