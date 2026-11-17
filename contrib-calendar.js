/*
 * contrib-calendar.js
 *
 * Pure calendar maths for the contribution graph (browser + Node tests).
 * Everything is derived from real dates in UTC, so there are no pixel offsets
 * or hard-coded month positions: month labels are computed from the same
 * week columns that the day cells are drawn in.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ContribCalendar = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DAY = 86400000;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const FIRST_YEAR = 2025;

  const parse = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new Error(`Invalid date: ${iso}`);
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  };
  const format = (ms) => new Date(ms).toISOString().slice(0, 10);
  const todayIso = (now = new Date()) => format(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  /** Same weekday one year ago + 1 day, i.e. exactly the last 12 months (leap-year safe). */
  const lastYearRange = (today) => {
    const d = new Date(parse(today));
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    // Feb 29 minus a year rolls to Mar 1 in JS; step back so the span never exceeds one year.
    const start = d.getUTCMonth() === 2 && new Date(parse(today)).getUTCDate() === 29 ? d.getTime() : d.getTime() + DAY;
    return { start: format(start), end: today };
  };

  const yearRange = (year, today) => {
    const end = `${year}-12-31`;
    return { start: `${year}-01-01`, end: end < today ? end : today };
  };

  const availableYears = (today) => {
    const last = Number(today.slice(0, 4));
    const years = [];
    for (let y = last; y >= FIRST_YEAR; y--) years.push(y);
    return years;
  };

  const levelFor = (count, max) => {
    if (!count) return 0;
    const q = count / Math.max(max, 1);
    return q > 0.75 ? 4 : q > 0.5 ? 3 : q > 0.25 ? 2 : 1;
  };

  /**
   * @param {Array<{date:string,count:number,level?:number}>} days
   * @returns {{weeks:Array<Array<object|null>>, monthLabels:Array<{col:number,label:string,month:number,year:number}>, total:number}}
   *  weeks[col][row]: row 0 = Sunday ... 6 = Saturday. null = outside the requested range.
   */
  const buildCalendar = (days, start, end) => {
    const s = parse(start);
    const e = parse(end);
    if (e < s) throw new Error("end before start");
    const byDate = new Map(days.map((d) => [d.date, d]));
    const max = days.reduce((m, d) => Math.max(m, d.count || 0), 0);

    const gridStart = s - new Date(s).getUTCDay() * DAY; // Sunday on/before start
    const colCount = Math.floor((e - gridStart) / DAY / 7) + 1;
    const weeks = [];
    let total = 0;
    for (let c = 0; c < colCount; c++) {
      const col = [];
      for (let r = 0; r < 7; r++) {
        const t = gridStart + (c * 7 + r) * DAY;
        if (t < s || t > e) {
          col.push(null);
          continue;
        }
        const date = format(t);
        const src = byDate.get(date);
        const count = src ? src.count || 0 : 0;
        total += count;
        col.push({ date, count, level: src && Number.isInteger(src.level) ? src.level : levelFor(count, max), weekday: r });
      }
      weeks.push(col);
    }

    // One label per month, on the week column that contains the month's first in-range day.
    const labels = [];
    for (let t = s; t <= e; ) {
      const d = new Date(t);
      const firstShown = t === s || d.getUTCDate() === 1;
      if (firstShown) {
        labels.push({
          col: Math.floor((t - gridStart) / DAY / 7),
          label: MONTHS[d.getUTCMonth()],
          month: d.getUTCMonth(),
          year: d.getUTCFullYear(),
        });
        // jump to the 1st of next month
        t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      } else {
        t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      }
    }
    // A short partial first month would collide with the next label: drop it.
    const monthLabels = labels.filter((l, i) => !(i < labels.length - 1 && labels[i + 1].col - l.col < 3));
    return { weeks, monthLabels, total };
  };

  return { MONTHS, FIRST_YEAR, parse, format, todayIso, lastYearRange, yearRange, availableYears, levelFor, buildCalendar };
});
