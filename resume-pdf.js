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
    const margin = options.margin || 40;
    const contentWidth = pageWidth - margin * 2;
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
      const lines = doc.splitTextToSize(text, contentWidth - indent);
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

    const writeContactLine = (items) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.8);
      setColor(MUTE);
      let x = margin;
      const separator = "  |  ";

      items.forEach((item, index) => {
        if (index > 0) {
          doc.text(separator, x, y);
          x += doc.getTextWidth(separator);
        }

        doc.textWithLink(item.text, x, y, { url: item.url });
        x += doc.getTextWidth(item.text);
      });

      y += 11;
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

    const contact = data.contact;
    if (contact) {
      const line1 = [];
      if (contact.phone) line1.push({ text: contact.phone.label, url: contact.phone.url });
      if (contact.email) line1.push({ text: stripUrl(contact.email.url), url: contact.email.url });
      if (contact.linkedin) line1.push({ text: contact.linkedin.label, url: contact.linkedin.url });
      if (line1.length > 0) writeContactLine(line1);

      const line2 = [];
      if (contact.github) line2.push({ text: `GitHub: ${contact.github.label}`, url: contact.github.url });
      if (contact.portfolio) line2.push({ text: `Portfolio: ${contact.portfolio.label}`, url: contact.portfolio.url });
      if (line2.length > 0) writeContactLine(line2);
    }

    doc.setDrawColor(208, 213, 221);
    doc.setLineWidth(0.7);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

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
        const labelWidth = doc.getTextWidth(label);
        doc.setFont("helvetica", "normal");
        const valueLines = doc.splitTextToSize(
          group.items.join(", "),
          contentWidth - labelWidth
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

        (role.bullets || []).forEach((bullet) => {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          setColor(INK);
          const lines = doc.splitTextToSize(bullet, contentWidth - 12);
          const lineHeight = 12.2;

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

    if (data.projects && data.projects.length > 0) {
      sectionHeading("Projects");
      const compact = data.projectDetail === "compact";
      data.projects.forEach((proj) => {
        ensureSpace(28);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10.5);
        setColor(INK);
        doc.text(proj.title, margin, y);
        const projectMeta = [proj.role, proj.period, proj.status].filter(Boolean).join(" | ");
        if (compact) {
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
        if (!compact) {
          (proj.bullets || []).forEach((bullet) => {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9.5);
            setColor(INK);
            const lines = doc.splitTextToSize(bullet, contentWidth - 12);
            const lineHeight = 12.2;
            lines.forEach((line, index) => {
              ensureSpace(lineHeight);
              if (index === 0) doc.text("\u2022", margin + 1, y);
              doc.text(line, margin + 12, y);
              y += lineHeight;
            });
            y += 2;
          });
        }
        if (proj.technologies && proj.technologies.length > 0) {
          writeLines(`Technologies: ${proj.technologies.join(", ")}`, {
            size: 9,
            color: MUTE,
            gap: 2,
          });
        }
        y += compact ? 2 : 6;
      });
    }

    if (data.education && data.education.length > 0) {
      sectionHeading("Education", 26);
      data.education.forEach((education) => {
        writeLines(
          `${education.level} - ${education.place} - ${education.meta}`,
          { size: 9.5, color: INK, gap: 0 }
        );
      });
    }

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
