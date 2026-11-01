/** Trim, NFKC, and strip spaces and hyphens. Reject zero-width and bidi controls. */

const LIMIT = 10 * 1024;
const ZERO_WIDTH = new Set([
  0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff,
]);

/**
 * @param {unknown} input
 * @param {{ uppercase?: boolean }} [options]
 * @returns {{ error?: string, cleaned: string, warnings: string[] }}
 */
export function prepare(input, options = {}) {
  if (typeof input !== 'string') return { error: 'Input must be a string.', cleaned: '', warnings: [] };
  if (Buffer.byteLength(input, 'utf8') > LIMIT) {
    return { error: 'Input exceeds the 10 KB limit.', cleaned: '', warnings: [] };
  }
  if (containsBlocked(input)) {
    return { error: 'Zero-width or bidi control character rejected.', cleaned: '', warnings: [] };
  }
  const nfkc = input.normalize('NFKC');
  if (containsBlocked(nfkc)) {
    return { error: 'Zero-width or bidi control character rejected.', cleaned: '', warnings: [] };
  }
  const warnings = [];
  if (nfkc !== input) warnings.push('Input was NFKC-normalised.');
  const trimmed = nfkc.trim();
  if (options.uppercase && /[a-z]/.test(trimmed)) {
    warnings.push('Lowercase letters were normalised to uppercase.');
  }
  if (hasSeparator(trimmed)) warnings.push('Spaces or hyphens were removed.');
  let cleaned = '';
  for (const ch of trimmed) {
    if (isSeparator(ch)) continue;
    cleaned += options.uppercase ? ch.toUpperCase() : ch;
  }
  return { cleaned, warnings };
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

function isSeparator(ch) {
  return ch === ' ' || ch === '-' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function hasSeparator(value) {
  for (const ch of value) if (isSeparator(ch)) return true;
  return false;
}
