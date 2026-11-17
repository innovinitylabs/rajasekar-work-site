(function initializeResumePdf(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ResumePdf = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createResumePdfApi() {
  const DEFAULT_ACCENT = [36, 87, 197];
  const INK = [16, 24, 40];
  const MUTE = [71, 84, 103];

  const stripUrl = (url) =>
    String(url)
      .replace(/^https?:\/\//, "")
      .replace(/^mailto:/, "")
      .replace(/^tel:/, "")
      .replace(/\/$/, "");

  const hexToRgb = (hex) => {
    if (!hex || typeof hex !== "string") return null;
    const clean = hex.replace(/^#/, "");
    if (clean.length === 6) {
      return [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16),
      ];
    }
    return null;
  };

  const buildResumePdf = (JsPDF, data, options = {}) => {
    const doc = new JsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = options.margin || 36;
    const contentWidth = pageWidth - margin * 2;
    // Wrap a little early: viewers substitute their own Helvetica, whose widths differ slightly.
    const wrapSafety = 4;
    let y = margin;

    const accentColor =
      (options.accentColor && hexToRgb(options.accentColor)) ||
      (data.accentColor && hexToRgb(data.accentColor)) ||
      DEFAULT_ACCENT;

    doc.setProperties({
      title: `${data.name} - ${data.title}`,
      subject: `${data.title} resume`,
      author: data.name,
      keywords: [data.title, "ETL", "SQL", "Python", "PostgreSQL", "Oracle"].filter(Boolean).join(", "),
    });

    const ensureSpace = (needed) => {
      if (y + needed > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
    };

    const setColor = ([r, g, b]) => doc.setTextColor(r, g, b);

    const writeLines = (
      text,
      { size, style = "normal", color = INK, gap = 1.5, indent = 0 }
    ) => {
      doc.setFont("helvetica", style);
      doc.setFontSize(size);
      setColor(color);
      const lines = doc.splitTextToSize(text, contentWidth - indent - wrapSafety);
      const lineHeight = size * 1.3;

      lines.forEach((line) => {
        ensureSpace(lineHeight);
        doc.text(line, margin + indent, y);
        y += lineHeight;
      });

      y += gap;
    };

    const sectionHeading = (label, reserve = 36) => {
      ensureSpace(reserve);
      y += 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      setColor(accentColor);
      doc.text(label.toUpperCase(), margin, y);
      y += 4;
      doc.setDrawColor(208, 213, 221);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
      y += 10;
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    setColor(INK);
    doc.text(data.name, margin, y);
    y += 18;
    writeLines(data.title, {
      size: 10.5,
      style: "bold",
      color: accentColor,
      gap: 2,
    });

    // Explicit URI link annotation with a normalised rectangle (lower-left to upper-right) that
    // covers the visible text: a negative height makes jsPDF emit [llx lly urx ury]. We never
    // rely on a viewer auto-detecting URLs.
    const addLink = (x, baselineY, width, size, url) => {
      const height = size * 1.15;
      doc.link(x, baselineY + size * 0.28, width, -height, { url });
    };

    // Linked items on one or more lines, wrapping between items (never mid-URL).
    const writeLinkLine = (items, { size = 8.8, prefix = "", gap = 11, indent = 0 } = {}) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      setColor(MUTE);
      const sep = "  |  ";
      let x = margin + indent;
      if (prefix) {
        doc.setFont("helvetica", "bold");
        doc.text(prefix, x, y);
        x += doc.getTextWidth(prefix);
        doc.setFont("helvetica", "normal");
      }
      const start = x;
      const right = pageWidth - margin - wrapSafety;
      items.forEach((item, index) => {
        const w = doc.getTextWidth(item.text);
        const sepW = index > 0 ? doc.getTextWidth(sep) : 0;
        if (index > 0 && x + sepW + w > right) {
          y += gap;
          ensureSpace(gap);
          x = start;
        } else if (index > 0) {
          doc.text(sep, x, y);
          x += sepW;
        }
        if (x + w > right) {
          // A single destination longer than a line: wrap it, each segment keeps the link.
          const chunks = doc.splitTextToSize(item.text, right - start);
          chunks.forEach((chunk, ci) => {
            if (ci > 0) {
              y += gap;
              ensureSpace(gap);
            }
            const cw = doc.getTextWidth(chunk);
            doc.text(chunk, ci === 0 ? x : start, y);
            if (item.url) addLink(ci === 0 ? x : start, y, cw, size, item.url);
            x = (ci === 0 ? x : start) + cw;
          });
          return;
        }
        doc.text(item.text, x, y);
        if (item.url) addLink(x, y, w, size, item.url); // display-only items get no link annotation
        x += w;
      });
      y += gap;
    };

    if (data.contactLinks && data.contactLinks.length > 0) {
      writeLinkLine(data.contactLinks);
    }

    doc.setDrawColor(208, 213, 221);
    doc.setLineWidth(0.7);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    if (data.proof && data.proof.length > 0) {
      y += 9;
      data.proof.forEach((item) => {
        ensureSpace(14);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        setColor(accentColor);
        doc.text(item.value, margin, y);
        const vw = doc.getTextWidth(item.value) + 6;
        doc.setFont("helvetica", "normal");
        setColor(MUTE);
        const lines = doc.splitTextToSize(item.text, contentWidth - vw - wrapSafety);
        lines.forEach((line, i) => {
          doc.text(line, margin + vw, y);
          y += i < lines.length - 1 ? 11.5 : 0;
        });
        y += 12;
      });
    }

    if (data.summary) {
      sectionHeading("Summary", 30);
      writeLines(data.summary, { size: 9.8, color: MUTE, gap: 0 });
    }

    if (data.skills && data.skills.length > 0) {
      sectionHeading("Skills", 48);
      data.skills.forEach((group) => {
        const label = `${group.group}: `;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        const labelWidth = doc.getTextWidth(label) + 2;
        doc.setFont("helvetica", "normal");
        const valueLines = doc.splitTextToSize(
          group.items.join(", "),
          contentWidth - labelWidth - wrapSafety
        );
        const lineHeight = 12;

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
        y += 1.5;
      });
    }

    if (data.experience && data.experience.length > 0) {
      sectionHeading("Experience");
      data.experience.forEach((role) => {
        ensureSpace(28);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        setColor(INK);
        doc.text(role.org, margin, y);
        y += 11;
        writeLines(`${role.role} | ${role.period}`, {
          size: 9.2,
          style: "italic",
          color: MUTE,
          gap: 2,
        });
        if (role.context && role.context.length > 0) {
          writeLines(`Client projects: ${role.context.join("; ")}`, {
            size: 9.2,
            style: "italic",
            color: MUTE,
            gap: 2,
          });
        }

        (role.bullets || []).forEach((bullet) => {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          setColor(INK);
          const lines = doc.splitTextToSize(bullet, contentWidth - 12 - wrapSafety);
          const lineHeight = 11.9;
          ensureSpace(lines.length * lineHeight); // never split one bullet across pages

          lines.forEach((line, index) => {
            ensureSpace(lineHeight);
            if (index === 0) {
              doc.text("\u2022", margin + 1, y);
            }
            doc.text(line, margin + 12, y);
            y += lineHeight;
          });
          y += 1.5;
        });

        y += 6;
      });
    }

    const twoPage = data.pageMode === "two-page";
    const drawEducation = () => {
    if (data.education && data.education.length > 0) {
      sectionHeading("Education", 26);
      data.education.forEach((ed) => {
        ensureSpace(26);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        setColor(INK);
        doc.text(ed.title, margin, y);
        if (ed.inline) {
          const tw = doc.getTextWidth(`${ed.title} `);
          doc.setFont("helvetica", "normal");
          setColor(MUTE);
          doc.text(`| ${ed.inline}`, margin + tw, y);
          y += 12;
        } else {
          y += 11.5;
          if (ed.detail) writeLines(ed.detail, { size: 9.5, color: MUTE, gap: 1.5 });
        }
      });
    }
    };
    let educationDrawn = false;
    if (twoPage && data.education && data.education.length > 0 && y + 12 + 24 * data.education.length + 24 <= pageHeight - margin) {
      drawEducation(); // fits naturally at the end of page 1
      educationDrawn = true;
    }

    if (data.projects && data.projects.length > 0) {
      if (twoPage) {
        doc.addPage();
        y = margin;
        sectionHeading((data.showcase && data.showcase.heading) || "Independent Development | Selected Work", 60);
        if (data.showcase && data.showcase.intro) writeLines(data.showcase.intro, { size: 9.5, color: MUTE, gap: 4 });
      } else sectionHeading("Projects", data.projectDetail === "compact" ? 60 : 110);
      const compact = data.projectDetail === "compact";
      data.projects.forEach((proj) => {
        ensureSpace(compact ? 40 : 90);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        setColor(INK);
        doc.text(proj.title, margin, y);
        const projectMeta = [proj.role, proj.period, proj.status].filter(Boolean).join(" | ");
        if (compact || twoPage) {
          // One line: "Title  Sole developer | Deployed"
          const titleWidth = doc.getTextWidth(proj.title);
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9.2);
          setColor(MUTE);
          if (projectMeta) doc.text(`   ${projectMeta}`, margin + titleWidth, y);
          y += 12;
        } else {
          y += 11;
          if (projectMeta) {
            writeLines(projectMeta, { size: 9.2, style: "italic", color: MUTE, gap: 2 });
          }
        }
        if (proj.description && !compact) {
          writeLines(proj.description, { size: 9.5, color: MUTE, gap: 2 });
        }
        const bulletCap = twoPage ? (data.showcase && data.showcase.bulletsPerProject) || 0 : Infinity;
        if (!compact && bulletCap > 0) {
          (proj.bullets || []).slice(0, bulletCap).forEach((bullet) => {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9.5);
            setColor(INK);
            const lines = doc.splitTextToSize(bullet, contentWidth - 12 - wrapSafety);
            const lineHeight = 11.9;
          ensureSpace(lines.length * lineHeight); // never split one bullet across pages
            lines.forEach((line, index) => {
              ensureSpace(lineHeight);
              if (index === 0) doc.text("\u2022", margin + 1, y);
              doc.text(line, margin + 12, y);
              y += lineHeight;
            });
            y += twoPage ? 1.5 : 2; // same bullet rhythm as the experience bullets on page 1
          });
        }
        if (proj.technologies && proj.technologies.length > 0) {
          writeLines(`Technologies: ${proj.technologies.join(", ")}`, {
            size: 9,
            color: MUTE,
            gap: 2,
          });
        }
        if (proj.links && proj.links.length > 0) {
          ensureSpace(12);
          writeLinkLine(
            proj.links.map((l) => ({ text: l.url, url: l.url })),
            { size: 9, prefix: "Links: ", gap: 11.5 }
          );
        }
        y += compact ? 2 : twoPage ? 9 : 6;
      });
    }

    (data.extraSections || []).forEach((sec) => {
      sectionHeading(sec.heading, 60);
      sec.paragraphs.forEach((para) => writeLines(para, { size: 9.5, color: INK, gap: 2 }));
    });

    if (!educationDrawn) drawEducation();
    // Layout diagnostics (used by tests): where the last line ended, and the bottom limit.
    doc.layoutInfo = { endY: y, limitY: pageHeight - margin, pages: doc.getNumberOfPages() };

    return doc;
  };

  const resumeDownloadFilename = (date = new Date(), profileSlug = "") => {
    const pad = (value) => String(value).padStart(2, "0");
    const stamp =
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `${pad(date.getHours())}${pad(date.getMinutes())}`;
    const slugPart = profileSlug && profileSlug !== "data-engineer" ? `-${profileSlug}` : "";
    return `rajasekar-resume${slugPart}-${stamp}.pdf`;
  };

  return { buildResumePdf, resumeDownloadFilename };
});
