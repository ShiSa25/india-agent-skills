/**
 * Verhoeff checksum (dihedral D5), the algorithm UIDAI uses for Aadhaar.
 * Tables are the Wikipedia / python-stdnum tables. Permutation row 6 is
 * 2,7,9,3,8,0,6,4,1,5. A commonly copied row (2,6,9,0,...) does not validate
 * the synthetic specimens in SPEC §1.11.
 *
 * Checksum validity is not proof that UIDAI issued the number.
 */

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

const ZERO_WIDTH = new Set([
  0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff,
]);

/** @param {string} digits @returns {number} 0 when the check digit is correct */
export function verhoeffChecksum(digits) {
  if (typeof digits !== 'string' || !isDigits(digits)) {
    throw new TypeError('Verhoeff input must be a digit string');
  }
  let c = 0;
  for (let i = digits.length - 1, pos = 0; i >= 0; i -= 1, pos += 1) {
    c = D[c][P[pos % 8][digits.charCodeAt(i) - 48]];
  }
  return c;
}

/** @param {string} digits */
export function verhoeffValid(digits) {
  if (typeof digits !== 'string' || !isDigits(digits)) return false;
  return verhoeffChecksum(digits) === 0;
}

/** @param {string} body digits without the check digit */
export function verhoeffCheckDigit(body) {
  if (!isDigits(body)) throw new TypeError('body must be digits');
  return String(INV[verhoeffChecksum(`${body}0`)]);
}

/**
 * Trim, NFKC, strip spaces and hyphens. Rejects zero-width characters.
 * @param {string} input
 */
export function normalizeDigits(input) {
  if (typeof input !== 'string') throw new TypeError('expected a string');
  if (Buffer.byteLength(input, 'utf8') > 10 * 1024) throw new TypeError('input exceeds 10 KB');
  if (containsBlocked(input)) throw new TypeError('zero-width or bidi control character rejected');
  const nfkc = input.normalize('NFKC');
  if (containsBlocked(nfkc)) throw new TypeError('zero-width or bidi control character rejected');
  let out = '';
  for (const ch of nfkc.trim()) {
    if (ch === ' ' || ch === '-' || ch === '\t') continue;
    out += ch;
  }
  if (!isDigits(out)) throw new TypeError('not a digit string');
  return out;
}

/**
 * Deterministic 12-digit synthetic number. The first digit is 2-9.
 * Not an issued Aadhaar. Do not use it as if it identified a person.
 * @param {string|number} [seed]
 */
export function generateSynthetic(seed = 'india-agent-skills') {
  const text = String(seed);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0;
  let body = String(2 + (x % 8));
  for (let i = 0; i < 10; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    body += String(x % 10);
  }
  return body + verhoeffCheckDigit(body);
}

/**
 * SPEC §1.11: a leading 0 or 1 is a common check, and UIDAI does not publish it.
 * Warn only. Callers must set confirm:true and must not reject the number for this alone.
 * `999999999999` starts with 9 and does not trip this finding.
 * @param {string} digits
 * @returns {{ warning: string, confirm: true } | null}
 */
export function leadingDigitFinding(digits) {
  if (!isDigits(digits) || digits.length === 0) return null;
  if (digits[0] !== '0' && digits[0] !== '1') return null;
  return {
    warning:
      'Leading digit is 0 or 1. UIDAI does not publish this restriction. Confirm with the official source before relying on this.',
    confirm: true,
  };
}

const DIGIT_BLOCKS = [
  [0x0660, 0x0669],
  [0x06f0, 0x06f9],
  [0x07c0, 0x07c9],
  [0x0966, 0x096f],
  [0x09e6, 0x09ef],
  [0x0a66, 0x0a6f],
  [0x0ae6, 0x0aef],
  [0x0b66, 0x0b6f],
  [0x0be6, 0x0bef],
  [0x0c66, 0x0c6f],
  [0x0ce6, 0x0cef],
  [0x0d66, 0x0d6f],
  [0x0e50, 0x0e59],
  [0x0ed0, 0x0ed9],
  [0x0f20, 0x0f29],
  [0x1040, 0x1049],
  [0x1090, 0x1099],
  [0x17e0, 0x17e9],
  [0x1810, 0x1819],
  [0x1946, 0x194f],
  [0x19d0, 0x19d9],
  [0x1a80, 0x1a89],
  [0x1a90, 0x1a99],
  [0x1b50, 0x1b59],
  [0xa620, 0xa629],
  [0xa8d0, 0xa8d9],
  [0xa900, 0xa909],
  [0xa9d0, 0xa9d9],
  [0xaa50, 0xaa59],
  [0xabf0, 0xabf9],
  [0xff10, 0xff19],
];

/**
 * NFKC, drop zero-width and bidi marks, and map decimal digits to ASCII.
 * Separators stay in place so a scanner can see groups of four.
 * @param {string} line
 */
export function foldAadhaarLine(line) {
  if (typeof line !== 'string') return '';
  let out = '';
  for (const ch of line.normalize('NFKC')) {
    const cp = ch.codePointAt(0);
    if (ZERO_WIDTH.has(cp)) continue;
    if (cp >= 0x202a && cp <= 0x202e) continue;
    if (cp >= 0x2066 && cp <= 0x2069) continue;
    out += asciiDigit(cp) || ch;
  }
  return out;
}

/**
 * 12-digit and 16-digit runs, including groups of four separated by spaces,
 * NBSP, hyphens, dashes, dots, commas, or underscores. Indexes refer to
 * `foldAadhaarLine(line)`. A 16-digit run is not reported as 12 digits.
 * @param {string} line
 * @returns {{ digits: string, start: number, end: number, groups: number }[]}
 */
export function aadhaarCandidates(line) {
  if (typeof line !== 'string') return [];
  return candidatesInFolded(foldAadhaarLine(line));
}

/**
 * Replace Verhoeff-valid 12-digit values and 16-digit shapes with a mask.
 * The returned text is the folded line, so a path cannot echo the original digits.
 * @param {string} text
 */
export function redactVerhoeffNumbers(text) {
  if (typeof text !== 'string') return '';
  const folded = foldAadhaarLine(text);
  const hits = candidatesInFolded(folded).filter(shouldRedact);
  let out = '';
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue;
    out += folded.slice(cursor, hit.start);
    const last4 = hit.digits.slice(-4);
    out += hit.digits.length === 16 ? `XXXX-XXXX-XXXX-${last4}` : `XXXX-XXXX-${last4}`;
    cursor = hit.end;
  }
  out += folded.slice(cursor);
  return out;
}

function shouldRedact(hit) {
  if (hit.digits.length === 12 && (hit.groups === 1 || hit.groups === 3)) return verhoeffValid(hit.digits);
  return hit.digits.length === 16 && (hit.groups === 1 || hit.groups === 4);
}

function candidatesInFolded(folded) {
  const units = [];
  let index = 0;
  while (index < folded.length) {
    const cp = folded.codePointAt(index);
    const width = cp > 0xffff ? 2 : 1;
    let kind = 'o';
    if (cp >= 48 && cp <= 57) kind = 'd';
    else if (isSeparator(cp)) kind = 's';
    units.push({ kind, cp, start: index, end: index + width });
    index += width;
  }
  const found = [];
  let i = 0;
  while (i < units.length) {
    if (units[i].kind !== 'd' || !leftBoundary(units, i)) {
      i += 1;
      continue;
    }
    const seq = readDigitSequence(units, i);
    const rightOk = seq.next >= units.length || !isAsciiWord(units[seq.next].cp);
    if (rightOk) {
      const digits = seq.groups.join('');
      const fours = seq.groups.every((group) => group.length === 4);
      if (seq.groups.length === 1 && (digits.length === 12 || digits.length === 16)) {
        found.push({ digits, start: seq.start, end: seq.end, groups: 1 });
      } else if (fours && (seq.groups.length === 3 || seq.groups.length === 4)) {
        found.push({ digits, start: seq.start, end: seq.end, groups: seq.groups.length });
      }
    }
    i = Math.max(seq.next, i + 1);
  }
  return found;
}

function readDigitSequence(units, index) {
  const start = units[index].start;
  const groups = [];
  let i = index;
  while (i < units.length && units[i].kind === 'd') {
    let run = '';
    while (i < units.length && units[i].kind === 'd') {
      run += String.fromCharCode(units[i].cp);
      i += 1;
    }
    groups.push(run);
    if (i >= units.length || units[i].kind !== 's') break;
    let j = i;
    while (j < units.length && units[j].kind === 's') j += 1;
    if (j >= units.length || units[j].kind !== 'd') break;
    i = j;
  }
  return { groups, start, end: units[i - 1].end, next: i };
}

function leftBoundary(units, index) {
  if (index === 0) return true;
  return !isAsciiWord(units[index - 1].cp);
}

function isAsciiWord(cp) {
  return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
}

function isSeparator(cp) {
  if (cp === 0x09 || cp === 0x20 || cp === 0x2c || cp === 0x2d || cp === 0x2e || cp === 0x2f || cp === 0x5f) {
    return true;
  }
  if (cp === 0xa0 || cp === 0x1680 || cp === 0x202f || cp === 0x205f || cp === 0x3000 || cp === 0x2212) return true;
  if (cp >= 0x2000 && cp <= 0x200a) return true;
  if (cp >= 0x2010 && cp <= 0x2015) return true;
  return false;
}

function asciiDigit(cp) {
  if (cp >= 48 && cp <= 57) return String.fromCharCode(cp);
  if (cp >= 0x1d7ce && cp <= 0x1d7ff) return String.fromCharCode(48 + ((cp - 0x1d7ce) % 10));
  for (const [start, end] of DIGIT_BLOCKS) {
    if (cp >= start && cp <= end) return String.fromCharCode(48 + (cp - start));
  }
  return '';
}

function isDigits(value) {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function containsBlocked(value) {
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (ZERO_WIDTH.has(cp)) return true;
    if (cp >= 0x202a && cp <= 0x202e) return true;
    if (cp >= 0x2066 && cp <= 0x2069) return true;
  }
  return false;
}
