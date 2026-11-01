/** Shared input limits for the SMS skill. No network. */

export const MAX_BYTES = 10240;

const BANNED = /[\u0000\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

export function usage(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

/**
 * @param {unknown} value
 * @param {string} label
 */
export function prepareText(value, label) {
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a string.` };
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) return { ok: false, error: `${label} exceeds 10 KB.` };
  if (BANNED.test(value)) {
    return { ok: false, error: `${label} contains a zero-width or bidi control character.` };
  }
  const trimmed = value.trim();
  const text = trimmed.normalize('NFKC');
  return { ok: true, text, changed: text !== value };
}
