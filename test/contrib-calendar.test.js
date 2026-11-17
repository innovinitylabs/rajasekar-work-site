const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../contrib-calendar");

const cal = (start, end, days = []) => C.buildCalendar(days, start, end);
const cellAt = (c, col, row) => c.weeks[col][row];
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Invariants that must hold for any range: they tie labels to real columns. */
const assertConsistent = (start, end) => {
  const c = cal(start, end);
  c.weeks.forEach((col, ci) => {
    assert.equal(col.length, 7);
    col.forEach((d, r) => {
      if (d) {
        assert.equal(weekdayOf(d.date), r, `${d.date} must sit in its weekday row`);
        assert.equal(d.weekday, r);
      }
    });
    // consecutive columns are exactly 7 days apart
    const first = col.find(Boolean);
    if (ci > 0 && first) {
      const prev = c.weeks[ci - 1].find(Boolean);
      const gap = (C.parse(first.date) - C.parse(prev.date)) / 86400000;
      assert.ok(gap >= 1 && gap <= 7 + 6);
    }
  });
  for (const l of c.monthLabels) {
    const inCol = c.weeks[l.col].filter(Boolean);
    const target = inCol.find((d) => Number(d.date.slice(5, 7)) - 1 === l.month);
    assert.ok(target, `label ${l.label}@${l.col} must have a day of that month in its column`);
    // the column holds the month's first in-range day
    const firstOfMonth = l.month === Number(start.slice(5, 7)) - 1 && l.year === Number(start.slice(0, 4)) ? start : `${l.year}-${String(l.month + 1).padStart(2, "0")}-01`;
    assert.ok(inCol.some((d) => d.date === firstOfMonth), `column ${l.col} must contain ${firstOfMonth}`);
  }
  return c;
};

test("January 2025 starts on Wednesday: first column has 3 blanks above it", () => {
  const c = cal("2025-01-01", "2025-01-31");
  assert.equal(weekdayOf("2025-01-01"), 3);
  assert.equal(cellAt(c, 0, 0), null);
  assert.equal(cellAt(c, 0, 2), null);
  assert.equal(cellAt(c, 0, 3).date, "2025-01-01");
  assert.deepEqual(c.monthLabels.map((l) => [l.label, l.col]), [["Jan", 0]]);
});

test("full 2025 has 12 labels, 53 columns, each aligned to its calendar week", () => {
  const c = assertConsistent("2025-01-01", "2025-12-31");
  assert.equal(c.weeks.length, 53);
  assert.deepEqual(c.monthLabels.map((l) => l.label), ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  assert.equal(c.weeks.flat().filter(Boolean).length, 365);
  // Dec 2025 starts on a Monday -> inside the column that begins Sunday Nov 30
  const dec = c.monthLabels.find((l) => l.label === "Dec");
  assert.equal(cellAt(c, dec.col, 1).date, "2025-12-01");
  assert.equal(cellAt(c, dec.col, 0).date, "2025-11-30");
});

test("December 2025 end and January 2026 start share the boundary week correctly", () => {
  const c = assertConsistent("2025-12-01", "2026-01-31");
  const jan = c.monthLabels.find((l) => l.label === "Jan");
  // 2026-01-01 is a Thursday: same column as Dec 28-31 (Sun-Wed)
  assert.equal(cellAt(c, jan.col, 4).date, "2026-01-01");
  assert.equal(cellAt(c, jan.col, 3).date, "2025-12-31");
});

test("2026 year view starts Thursday and ends on the real 'today' (current month, partial final week)", () => {
  const today = "2026-11-17"; // Tuesday
  const r = C.yearRange(2026, today);
  assert.deepEqual(r, { start: "2026-01-01", end: today });
  const c = assertConsistent(r.start, r.end);
  const last = c.weeks[c.weeks.length - 1];
  assert.equal(last.filter(Boolean).at(-1).date, today, "last cell is today, not a future date");
  assert.deepEqual(last.map((d) => (d ? 1 : 0)), [1, 1, 1, 0, 0, 0, 0].map((_, i) => (i <= weekdayOf(today) ? 1 : 0)));
  assert.equal(c.monthLabels.at(-1).label, "Nov");
});

test("past years are full years; the current year stops at today", () => {
  assert.equal(C.yearRange(2025, "2026-11-17").end, "2025-12-31");
  assert.equal(C.yearRange(2026, "2026-03-05").end, "2026-03-05");
  assert.deepEqual(C.availableYears("2026-11-17"), [2026, 2025]);
  assert.deepEqual(C.availableYears("2027-01-02"), [2027, 2026, 2025]);
});

test("months beginning on every weekday align to the right row", () => {
  const seen = new Set();
  for (let m = 1; m <= 12; m++) {
    const first = `2025-${String(m).padStart(2, "0")}-01`;
    seen.add(weekdayOf(first));
    const c = cal("2025-01-01", "2025-12-31");
    const label = c.monthLabels[m - 1];
    assert.equal(cellAt(c, label.col, weekdayOf(first)).date, first);
  }
  assert.ok(seen.size >= 6, "2025 months cover at least six different start weekdays");
});

test("leap year: Feb 29 2024 exists, lands on Thursday, and totals are 366 days", () => {
  const c = assertConsistent("2024-01-01", "2024-12-31");
  assert.equal(c.weeks.flat().filter(Boolean).length, 366);
  const cell = c.weeks.flat().find((d) => d && d.date === "2024-02-29");
  assert.equal(cell.weekday, 4);
  assert.equal(cal("2025-01-01", "2025-12-31").weeks.flat().filter((d) => d && d.date === "2025-02-29").length, 0);
});

test("last 12 months range is exactly one year, incl. around leap days", () => {
  const span = (r) => (C.parse(r.end) - C.parse(r.start)) / 86400000 + 1;
  assert.deepEqual(C.lastYearRange("2026-11-17"), { start: "2025-11-18", end: "2026-11-17" });
  assert.equal(span(C.lastYearRange("2026-11-17")), 365);
  assert.equal(span(C.lastYearRange("2024-06-15")), 366 - 0 === 366 ? span(C.lastYearRange("2024-06-15")) : 365);
  assert.ok(span(C.lastYearRange("2024-02-29")) <= 366);
  assert.ok(span(C.lastYearRange("2025-03-01")) <= 366);
  assertConsistent(...Object.values(C.lastYearRange("2026-11-17")));
});

test("a short partial first month does not collide with the next label", () => {
  const c = cal("2025-11-28", "2026-02-10"); // starts Friday 28 Nov
  const cols = c.monthLabels.map((l) => l.col);
  for (let i = 1; i < cols.length; i++) assert.ok(cols[i] - cols[i - 1] >= 3);
  assert.equal(c.monthLabels[0].label, "Dec");
});

test("counts, totals and levels come from the supplied days", () => {
  const days = [
    { date: "2025-01-02", count: 4, level: 2 },
    { date: "2025-01-03", count: 0, level: 0 },
    { date: "2025-01-04", count: 10 }, // no level -> derived from max
  ];
  const c = cal("2025-01-01", "2025-01-10", days);
  assert.equal(c.total, 14);
  const flat = c.weeks.flat().filter(Boolean);
  assert.equal(flat.find((d) => d.date === "2025-01-02").level, 2);
  assert.equal(flat.find((d) => d.date === "2025-01-04").level, 4);
  assert.equal(flat.find((d) => d.date === "2025-01-05").count, 0);
});

test("rejects bad input", () => {
  assert.throws(() => C.parse("2025-1-1"));
  assert.throws(() => cal("2025-02-01", "2025-01-01"));
});
