/**
 * Integer money. Amounts stay in minor units (paise for INR, exponent 2).
 * Rate 18% is 1800 basis points. One basis point is one ten-thousandth.
 */

const MAX_DIGITS = 100;

/**
 * @param {string|bigint} input Decimal major units ("1234.50") or minor-unit bigint.
 * @param {number} [exponent]
 * @returns {bigint}
 */
export function parseAmount(input, exponent = 2) {
  assertExponent(exponent);
  if (typeof input === 'bigint') return input;
  if (typeof input !== 'string') {
    throw new TypeError('amount must be a decimal string or a bigint of minor units');
  }
  const s = input.trim();
  if (s.length === 0 || s.length > MAX_DIGITS) {
    throw new Error('amount is empty or too long');
  }
  if (/[eE]/.test(s)) throw new Error('exponent notation is not allowed');
  if (/nan|infinity/i.test(s)) throw new Error('amount is not a finite decimal');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!match) throw new Error('amount must be a plain decimal string');
  const fraction = match[3] ?? '';
  if (fraction.length > exponent) {
    throw new Error(`more than ${exponent} decimal places`);
  }
  const digits = `${match[2]}${fraction}${'0'.repeat(exponent - fraction.length)}`;
  const minor = BigInt(digits.replace(/^0+(?=\d)/, '') || '0');
  if (match[1] === '-' && minor !== 0n) return -minor;
  return minor;
}

/**
 * @param {bigint} minor
 * @param {number} [exponent]
 * @returns {string}
 */
export function formatMinor(minor, exponent = 2) {
  assertExponent(exponent);
  if (typeof minor !== 'bigint') throw new TypeError('minor units must be a bigint');
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, '0');
  if (exponent === 0) return `${negative ? '-' : ''}${digits}`;
  const whole = digits.slice(0, -exponent);
  const fraction = digits.slice(-exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Half-up, away from zero. Negative amounts round symmetrically
 * (a negative half goes to the more negative minor unit).
 * @param {bigint} minor
 * @param {number|bigint} rateBasisPoints
 * @param {string} [mode]
 * @returns {bigint}
 */
export function pct(minor, rateBasisPoints, mode = 'half-up') {
  if (typeof minor !== 'bigint') throw new TypeError('minor units must be a bigint');
  if (mode !== 'half-up') throw new Error('only half-up rounding is supported');
  const rate = asRate(rateBasisPoints);
  return divHalfAwayFromZero(minor * rate, 10000n);
}

function asRate(rate) {
  if (typeof rate === 'bigint') return rate;
  if (typeof rate === 'number' && Number.isInteger(rate)) return BigInt(rate);
  throw new TypeError('rate must be integer basis points');
}

function divHalfAwayFromZero(numerator, denominator) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function assertExponent(exponent) {
  if (typeof exponent !== 'number' || !Number.isInteger(exponent) || exponent < 0 || exponent > 18) {
    throw new TypeError('exponent must be an integer from 0 to 18');
  }
}
