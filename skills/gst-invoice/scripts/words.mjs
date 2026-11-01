/**
 * Amount in words for an INR minor-unit bigint.
 * Indian grouping: Thousand, Lakh, Crore. Above 99 crore the same scale
 * continues ("Hundred Crore", "Thousand Crore"). There is no "Arab".
 * inr-formatting is not in this repo, so the invoice skill carries this helper.
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const CRORE = 10000000n;

/**
 * @param {bigint} minor paise
 * @returns {string}
 */
export function toWords(minor) {
  if (typeof minor !== 'bigint') throw new TypeError('toWords expects a bigint of paise');
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const rupees = absolute / 100n;
  const paise = Number(absolute % 100n);
  let words;
  if (rupees === 0n && paise === 0) words = 'Rupees Zero Only';
  else if (rupees === 0n) words = `Rupees Zero and ${twoDigits(paise)} Paise Only`;
  else if (paise === 0) words = `Rupees ${rupeeWords(rupees)} Only`;
  else words = `Rupees ${rupeeWords(rupees)} and ${twoDigits(paise)} Paise Only`;
  return negative ? `Minus ${words}` : words;
}

function rupeeWords(rupees) {
  if (rupees < CRORE) return belowCrore(rupees);
  const crores = rupees / CRORE;
  const rest = rupees % CRORE;
  const head = `${rupeeWords(crores)} Crore`;
  return rest === 0n ? head : `${head} ${rupeeWords(rest)}`;
}

function belowCrore(rupees) {
  const n = Number(rupees);
  const hundreds = n % 1000;
  const thousand = Math.floor(n / 1000) % 100;
  const lakh = Math.floor(n / 100000) % 100;
  const parts = [];
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundreds) parts.push(threeDigits(hundreds));
  return parts.join(' ');
}

function threeDigits(n) {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return one ? `${TENS[ten]}-${ONES[one]}` : TENS[ten];
}
