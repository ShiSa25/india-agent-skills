/**
 * Trim and fold only the compatibility forms SPEC §0.3 still accepts.
 * Fullwidth digits U+FF10–U+FF19 become ASCII 0-9. A character whose NFKC
 * form is only an ASCII space or hyphen becomes that separator.
 * Letters and digits that become ASCII only through compatibility decomposition
 * or default case folding (long s, Kelvin sign, ligatures, Roman numerals,
 * fullwidth Latin, dotless i, sharp s, capital sharp s, superscript and
 * circled digits) are left unchanged so a later charset or decimal check
 * rejects them.
 * This module does not call String.normalize('NFKC') on a whole value.
 */

const LIMIT = 10 * 1024;

export const FULLWIDTH_DIGIT_WARNING = 'Fullwidth digits were mapped to ASCII.';

const ZERO_WIDTH = new Set([
  0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff,
]);

/**
 * @param {unknown} input
 * @param {{ uppercase?: boolean, label?: string }} [options]
 * @returns {{ error?: string, cleaned: string, warnings: string[] }}
 */
export function prepareId(input, options = {}) {
  const label = options.label ?? 'Input';
  if (typeof input !== 'string') return { error: `${label} must be a string.`, cleaned: '', warnings: [] };
  if (Buffer.byteLength(input, 'utf8') > LIMIT) {
    return { error: 'Input exceeds the 10 KB limit.', cleaned: '', warnings: [] };
  }
  if (containsBlocked(input)) {
    return { error: 'Zero-width or bidi control character rejected.', cleaned: '', warnings: [] };
  }
  const warnings = [];
  const folded = foldDocumented(input.trim());
  if (folded.fullwidthDigits) warnings.push(FULLWIDTH_DIGIT_WARNING);
  if (containsBlocked(folded.text)) {
    return { error: 'Zero-width or bidi control character rejected.', cleaned: '', warnings: [] };
  }
  const cased = options.uppercase ? asciiUpper(folded.text) : { text: folded.text, changed: false };
  if (cased.changed) warnings.push('Lowercase letters were normalised to uppercase.');
  let cleaned = '';
  let separators = folded.compatibilitySeparators;
  for (const ch of cased.text) {
    if (isAsciiSeparator(ch)) {
      separators = true;
      continue;
    }
    cleaned += ch;
  }
  if (separators) warnings.push('Spaces or hyphens were removed.');
  return { cleaned, warnings };
}

/**
 * Map fullwidth digits and separator-only compatibility characters.
 * @param {string} text
 */
export function foldDocumented(text) {
  let out = '';
  let fullwidthDigits = false;
  let compatibilitySeparators = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xff10 && cp <= 0xff19) {
      out += String.fromCharCode(0x30 + (cp - 0xff10));
      fullwidthDigits = true;
      continue;
    }
    const sep = separatorFold(ch);
    if (sep !== null && sep !== ch) {
      out += sep;
      compatibilitySeparators = true;
      continue;
    }
    out += ch;
  }
  return { text: out, fullwidthDigits, compatibilitySeparators };
}

/** @param {string} text */
export function asciiUpper(text) {
  let out = '';
  let changed = false;
  for (const ch of text) {
    if (ch >= 'a' && ch <= 'z') {
      out += ch.toUpperCase();
      changed = true;
    } else out += ch;
  }
  return { text: out, changed };
}

/** @param {string} text */
export function asciiLower(text) {
  let out = '';
  let changed = false;
  for (const ch of text) {
    if (ch >= 'A' && ch <= 'Z') {
      out += ch.toLowerCase();
      changed = true;
    } else out += ch;
  }
  return { text: out, changed };
}

/**
 * A non-ASCII character that becomes an ASCII letter or digit under NFKC
 * or the default Unicode case mapping. Fullwidth digits and separator folds
 * are not look-alikes: callers map those on purpose.
 * Capital sharp s (U+1E9E) lowercases to U+00DF, and only that form's
 * uppercase is the ASCII letters "SS".
 * @param {string} text
 */
export function hasFoldedLookalike(text) {
  for (const ch of text) if (isFoldedLookalike(ch)) return true;
  return false;
}

/** @param {string} value */
export function containsBlocked(value) {
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (ZERO_WIDTH.has(cp)) return true;
    if (cp >= 0x202a && cp <= 0x202e) return true;
    if (cp >= 0x2066 && cp <= 0x2069) return true;
  }
  return false;
}

function isFoldedLookalike(ch) {
  const cp = ch.codePointAt(0);
  if (cp <= 0x7e) return false;
  if (cp >= 0xff10 && cp <= 0xff19) return false;
  if (separatorFold(ch) !== null) return false;
  const nfkc = ch.normalize('NFKC');
  if (nfkc !== ch && /[0-9A-Za-z]/.test(nfkc) && [...nfkc].every((item) => item.codePointAt(0) <= 0x7e)) {
    return true;
  }
  const upper = ch.toUpperCase();
  if (upper !== ch && /[A-Z]/.test(upper)) return true;
  const lower = ch.toLowerCase();
  if (lower !== ch && /[a-z]/.test(lower)) return true;
  const caseFold = lower.toUpperCase();
  if (caseFold !== ch && /^[A-Z]+$/.test(caseFold)) return true;
  return false;
}

function separatorFold(ch) {
  if (isAsciiSeparator(ch)) return ch;
  const nfkc = ch.normalize('NFKC');
  if (nfkc.length === 0) return null;
  for (const item of nfkc) {
    if (!isAsciiSeparator(item)) return null;
  }
  return nfkc;
}

function isAsciiSeparator(ch) {
  return ch === ' ' || ch === '-' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}
