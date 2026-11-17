/** Shared input limits for the SMS skill. No network. */
import { foldDocumented } from './_lib/textprep.mjs';

export const MAX_BYTES = 10240;

const BANNED = /[\u0000\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

export function usage(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

/**
 * Trim. `document` maps fullwidth digits and separator compatibility forms only.
 * `raw` does not fold, so a header cannot turn a look-alike into an ASCII letter.
 * @param {unknown} value
 * @param {string} label
 * @param {'document'|'raw'} [mode]
 */
export function prepareText(value, label, mode = 'document') {
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a string.` };
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) return { ok: false, error: `${label} exceeds 10 KB.` };
  if (BANNED.test(value)) {
    return { ok: false, error: `${label} contains a zero-width or bidi control character.` };
  }
  const trimmed = value.trim();
  if (mode === 'raw') return { ok: true, text: trimmed, changed: trimmed !== value };
  const folded = foldDocumented(trimmed);
  const changed = folded.text !== value || folded.fullwidthDigits || folded.compatibilitySeparators;
  return { ok: true, text: folded.text, changed };
}
