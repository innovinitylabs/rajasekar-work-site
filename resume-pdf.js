(function initializeResumePdf(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ResumePdf = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function createResumePdfApi() {
  const ACCENT = [36, 87, 197];
  const INK = [16, 24, 40];
  const MUTE = [71, 84, 103];

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
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    doc.setProperties({
      title: `${data.name} - ${data.title}`,
      subject: "Data Engineer resume",
      author: data.name,
      keywords: "Data Engineer, ETL, SQL, Python, PostgreSQL, Oracle",
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
      y += 7;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      setColor(ACCENT);
      doc.text(label.toUpperCase(), margin, y);
      y += 5;
      doc.setDrawColor(208, 213, 221);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageWidth - margin, y);
      y += 12;
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
      color: ACCENT,
      gap: 2,
    });

    const contact = data.contact;
    writeContactLine([
      { text: contact.phone.label, url: contact.phone.url },
      { text: stripUrl(contact.email.url), url: contact.email.url },
      { text: contact.linkedin.label, url: contact.linkedin.url },
    ]);
    writeContactLine([
      { text: `GitHub: ${contact.github.label}`, url: contact.github.url },
      {
        text: `Portfolio: ${contact.portfolio.label}`,
        url: contact.portfolio.url,
      },
    ]);

    doc.setDrawColor(208, 213, 221);
    doc.setLineWidth(0.7);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    sectionHeading("Summary", 30);
    writeLines(data.summary, { size: 9.8, color: MUTE, gap: 0 });

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

      role.bullets.forEach((bullet) => {
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
        y += 2;
      });

      y += 8;
    });

    sectionHeading("Education", 26);
    data.education.forEach((education) => {
      writeLines(
        `${education.level} - ${education.place} - ${education.meta}`,
        { size: 9.5, color: INK, gap: 0 }
      );
    });

    return doc;
  };

  const resumeDownloadFilename = (date = new Date()) => {
    const pad = (value) => String(value).padStart(2, "0");
    const stamp =
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `${pad(date.getHours())}${pad(date.getMinutes())}`;
    return `rajasekar-resume-${stamp}.pdf`;
  };

  return { buildResumePdf, resumeDownloadFilename };
});
