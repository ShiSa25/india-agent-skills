/**
 * Indian financial year and civil dates in IST (Asia/Kolkata, UTC+05:30, no DST).
 * Date-only values are YYYY-MM-DD strings. This module never parses them with Date.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DIM = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * @param {string} iso
 * @returns {{ y: number, m: number, d: number }}
 */
export function parseIsoDate(iso) {
  if (typeof iso !== 'string') throw new TypeError('date must be a YYYY-MM-DD string');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error('date must be YYYY-MM-DD');
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new Error('date is not a real calendar day');
  }
  return { y, m, d };
}

/**
 * @param {{ y: number, m: number, d: number }} parts
 * @returns {string}
 */
export function formatIsoDate(parts) {
  if (parts.y < 1000 || parts.y > 9999) throw new Error('year is out of range');
  return `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}`;
}

/** @param {string} iso @returns {"YYYY-YY"} such as "2025-26" */
export function fyOf(iso) {
  const { y, m } = parseIsoDate(iso);
  const startYear = m >= 4 ? y : y - 1;
  return displayFy(startYear);
}

/**
 * Accepts "2025-26" and "2025-2026".
 * @param {string} input
 */
export function parseFy(input) {
  if (typeof input !== 'string') throw new TypeError('FY must be a string');
  const s = input.trim();
  const short = /^(\d{4})-(\d{2})$/.exec(s);
  const long = /^(\d{4})-(\d{4})$/.exec(s);
  let start;
  let end;
  if (short) {
    start = Number(short[1]);
    end = start + 1;
    if (Number(short[2]) !== end % 100) {
      throw new Error('FY end year does not follow the start year');
    }
  } else if (long) {
    start = Number(long[1]);
    end = Number(long[2]);
    if (end !== start + 1) throw new Error('FY end year does not follow the start year');
  } else {
    throw new Error('FY must be YYYY-YY or YYYY-YYYY');
  }
  if (start < 1000 || end > 9999) throw new Error('FY year is out of range');
  return {
    startYear: start,
    endYear: end,
    display: displayFy(start),
    portal: `${start}-${end}`,
  };
}

/** @param {string} fy */
export function fyBounds(fy) {
  const { startYear, endYear } = parseFy(fy);
  return { start: `${startYear}-04-01`, end: `${endYear}-03-31` };
}

/**
 * Add calendar months. The day clamps to the last day of the target month
 * (31 Jan + 1 month in a non-leap year is 28 Feb).
 * @param {string} iso
 * @param {number} months
 */
export function addMonths(iso, months) {
  if (typeof months !== 'number' || !Number.isInteger(months)) {
    throw new TypeError('months must be an integer');
  }
  const { y, m, d } = parseIsoDate(iso);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = index - ny * 12 + 1;
  const day = Math.min(d, daysInMonth(ny, nm));
  return formatIsoDate({ y: ny, m: nm, d: day });
}

/** @param {string} iso @param {number} years */
export function addYears(iso, years) {
  if (typeof years !== 'number' || !Number.isInteger(years)) {
    throw new TypeError('years must be an integer');
  }
  return addMonths(iso, years * 12);
}

/** @param {string} a @param {string} b @returns {-1|0|1} */
export function compareIso(a, b) {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (da.y !== db.y) return da.y < db.y ? -1 : 1;
  if (da.m !== db.m) return da.m < db.m ? -1 : 1;
  if (da.d !== db.d) return da.d < db.d ? -1 : 1;
  return 0;
}

/**
 * Civil date in IST for an instant. Pass an explicit Date in tests.
 * @param {Date} [instant]
 * @returns {string}
 */
export function istDate(instant = new Date()) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new TypeError('instant must be a valid Date');
  }
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  return formatIsoDate({
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  });
}

/** @param {Date} [instant] */
export function fyOfInstant(instant = new Date()) {
  return fyOf(istDate(instant));
}

function displayFy(startYear) {
  return `${startYear}-${pad2((startYear + 1) % 100)}`;
}

function daysInMonth(year, month) {
  if (month === 2 && isLeap(year)) return 29;
  return DIM[month];
}

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
