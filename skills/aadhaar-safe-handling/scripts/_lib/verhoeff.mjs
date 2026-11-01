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
