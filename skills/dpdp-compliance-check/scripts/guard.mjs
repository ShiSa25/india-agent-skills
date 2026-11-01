/** Shared input limits. No network. Dates stay YYYY-MM-DD strings. */

export const MAX_BYTES = 10240;

const BANNED = /[\u0000\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;

export function usage(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

/**
 * Trim and NFKC. Reject zero-width, bidi controls, and inputs over 10 KB.
 * @param {unknown} value
 * @param {string} label
 */
export function prepareText(value, label) {
  if (typeof value !== 'string') {
    return { ok: false, error: `${label} must be a string.` };
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) {
    return { ok: false, error: `${label} exceeds 10 KB.` };
  }
  if (BANNED.test(value)) {
    return { ok: false, error: `${label} contains a zero-width or bidi control character.` };
  }
  const trimmed = value.trim();
  const text = trimmed.normalize('NFKC');
  return {
    ok: true,
    text,
    changed: text !== value,
  };
}

/** @param {number} amount */
export function groupInr(amount) {
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
    throw new TypeError('amount must be a non-negative integer');
  }
  const digits = String(amount);
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  let grouped = '';
  const rem = head.length % 2;
  if (rem !== 0) grouped = head.slice(0, rem);
  for (let i = rem; i < head.length; i += 2) {
    grouped += `${grouped ? ',' : ''}${head.slice(i, i + 2)}`;
  }
  return `${grouped},${tail}`;
}

/**
 * @param {object} rule
 * @returns {string}
 */
export function formatMoney(rule) {
  if (rule.unit === 'crore') return `₹${rule.value.amount ?? rule.value} crore`;
  if (rule.unit === 'inr') return `₹${groupInr(rule.value.amount ?? rule.value)}`;
  return 'up to the penalty that applies to the underlying breach';
}
