/**
 * Mask, check, and scan for Aadhaar numbers. Scanner output is masked.
 * Checksum validity is not proof that UIDAI issued the number.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { CONFIRM_SENTENCE, disclaimer } from './_lib/disclaimer.mjs';
import { loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';
import {
  generateSynthetic,
  leadingDigitFinding,
  normalizeDigits,
  verhoeffValid,
} from './_lib/verhoeff.mjs';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const LIMIT = 10 * 1024;
const SCAN_LIMIT = 2 * 1024 * 1024;
const ZERO_WIDTH = new Set([
  0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff,
]);
const AADHAAR_RE = /(?<![A-Za-z0-9])(\d{4}(?:[ -]\d{4}){2}|\d{12})(?![A-Za-z0-9])/g;
const VID_RE = /(?<![A-Za-z0-9])(\d{4}(?:[ -]\d{4}){3}|\d{16})(?![A-Za-z0-9])/g;
const VID_LABEL = /\b(?:vid|virtual[\s-]*id)\b/i;
const SKIP_DIR = new Set(['.git', 'node_modules', '.hg']);
const TEXT_EXT = new Set([
  '.md', '.mjs', '.js', '.cjs', '.json', '.yml', '.yaml', '.txt', '.html', '.ts', '.tsx', '.sql',
  '.prisma', '.log', '.csv', '.py', '.java', '.kt', '.go', '.rb', '.php', '.xml', '.env',
]);

export function checkAadhaar(input, options = {}) {
  const { date, text } = context(options);
  const shell = empty(text);
  if (typeof input !== 'string') return { ...shell, errors: ['Aadhaar input must be a string.'] };
  if (Buffer.byteLength(input, 'utf8') > LIMIT) return { ...shell, errors: ['Input exceeds the 10 KB limit.'] };
  if (containsBlocked(input)) return { ...shell, errors: ['Zero-width or bidi control character rejected.'] };
  const nfkc = input.normalize('NFKC');
  if (containsBlocked(nfkc)) return { ...shell, errors: ['Zero-width or bidi control character rejected.'] };
  const warnings = [];
  if (nfkc !== input) warnings.push('Input was NFKC-normalised.');
  if (hasSeparator(nfkc.trim())) warnings.push('Spaces or hyphens were removed.');
  let digits;
  try {
    digits = normalizeDigits(input);
  } catch (error) {
    const message = error instanceof TypeError ? mapType(error.message) : 'Aadhaar input could not be read.';
    return { ...shell, warnings, errors: [message] };
  }
  return classify(digits, date, shell, warnings);
}

export function maskAadhaar(input, options = {}) {
  return checkAadhaar(input, options);
}

export function generateAadhaar(seed = 'india-agent-skills') {
  const number = generateSynthetic(seed);
  const checked = checkAadhaar(number);
  return {
    valid: checked.valid,
    synthetic: true,
    aadhaar: number,
    masked: checked.masked,
    kind: checked.kind,
    errors: [],
    warnings: [
      'Synthetic. Not an issued Aadhaar. Do not use it as a real identifier.',
      ...checked.warnings,
    ],
    confirm: checked.confirm,
    disclaimer: checked.disclaimer,
  };
}

/** @param {string} text @returns {{ line: number, masked: string, kind: 'aadhaar'|'vid' }[]} */
export function scanText(text) {
  return inspectText(text).findings;
}

/**
 * @param {string} text
 * @returns {{ findings: { line: number, masked: string, kind: string }[], skippedLines: number }}
 */
export function inspectText(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (Buffer.byteLength(text, 'utf8') > SCAN_LIMIT) throw new TypeError('Scan text exceeds 2 MB.');
  const pack = maskPack();
  const findings = [];
  let skippedLines = 0;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (Buffer.byteLength(line, 'utf8') > LIMIT) {
      skippedLines += 1;
      continue;
    }
    findings.push(...scanLine(fold(line), index + 1, pack));
  }
  return { findings, skippedLines };
}

/** @param {string} root @returns {{ file: string, line: number, masked: string, kind: string }[]} */
export function scanPath(root) {
  const findings = [];
  walk(root, root, findings);
  return findings;
}

export function storageGuidance(options = {}) {
  const { date, text } = context(options);
  const section = ruleById('ids', 'ids.aadhaar.act.s29', date);
  const vault = ruleById('ids', 'ids.aadhaar.dataVault', date);
  const vid = ruleById('ids', 'ids.aadhaar.vid.storage', date);
  const applied = [section, vault, vid];
  const confirm = needsConfirm(applied);
  const warnings = [];
  if (confirm) warnings.push(CONFIRM_SENTENCE);
  return {
    valid: true,
    section29: section.value,
    dataVault: vault.value,
    virtualId: vid.value,
    errors: [],
    warnings,
    confirm,
    disclaimer: text,
  };
}

export function isTimestamp(digits) {
  if (!/^(?:19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])(?:[01][0-9]|2[0-3])[0-5][0-9]$/.test(digits)) {
    return false;
  }
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const days = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const leap = month === 2 && (year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0));
  const max = month === 2 && leap ? 29 : days[month];
  return day >= 1 && day <= max;
}

function classify(digits, date, shell, warnings) {
  const aadhaarLength = ruleById('ids', 'ids.aadhaar.length', date);
  const vidLength = ruleById('ids', 'ids.aadhaar.vid.length', date);
  const maskRule = ruleById('ids', 'ids.aadhaar.mask', date);
  const vidMask = ruleById('ids', 'ids.aadhaar.vid.mask', date);
  const leadingRule = ruleById('ids', 'ids.aadhaar.leadingDigit', date);
  const caveat = ruleById('ids', 'ids.aadhaar.issuanceCaveat', date);
  const vidStorage = ruleById('ids', 'ids.aadhaar.vid.storage', date);

  if (digits.length === aadhaarLength.value) {
    const masked = `${maskRule.value}${digits.slice(-4)}`;
    if (!verhoeffValid(digits)) {
      return { ...shell, kind: 'aadhaar', masked, length: digits.length, warnings, errors: ['Verhoeff check failed.'] };
    }
    const finding = leadingDigitFinding(digits);
    const next = warnings.slice();
    if (finding && leadingRule.value === 'warn-only') next.push(finding.warning);
    next.push(caveat.value);
    const confirm = Boolean(finding) && needsConfirm(leadingRule);
    return {
      ...shell,
      valid: true,
      kind: 'aadhaar',
      masked,
      length: digits.length,
      warnings: next,
      confirm,
    };
  }

  if (digits.length === vidLength.value) {
    const next = warnings.slice();
    next.push(vidStorage.value);
    next.push('A 16-digit shape matches a Virtual ID. There is no published checksum, so this does not prove UIDAI issued it.');
    const confirm = needsConfirm(vidMask);
    if (confirm && !next.some((warning) => warning.includes(CONFIRM_SENTENCE))) next.push(CONFIRM_SENTENCE);
    return {
      ...shell,
      valid: true,
      kind: 'vid',
      masked: `${vidMask.value}${digits.slice(-4)}`,
      length: digits.length,
      warnings: next,
      confirm,
    };
  }

  return {
    ...shell,
    warnings,
    errors: [`An Aadhaar number is ${aadhaarLength.value} digits. A Virtual ID is ${vidLength.value} digits.`],
  };
}

function scanLine(line, lineNumber, pack) {
  const findings = [];
  const spans = [];
  if (VID_LABEL.test(line)) {
    for (const match of line.matchAll(new RegExp(VID_RE.source, 'g'))) {
      const digits = match[1].replace(/[ -]/g, '');
      if (digits.length !== pack.vidLength) continue;
      findings.push({ line: lineNumber, masked: `${pack.vidMask}${digits.slice(-4)}`, kind: 'vid' });
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  for (const match of line.matchAll(new RegExp(AADHAAR_RE.source, 'g'))) {
    if (spans.some(([start, end]) => match.index < end && match.index + match[0].length > start)) continue;
    const digits = match[1].replace(/[ -]/g, '');
    if (digits.length !== pack.aadhaarLength) continue;
    if (isTimestamp(digits)) continue;
    if (!verhoeffValid(digits)) continue;
    findings.push({ line: lineNumber, masked: `${pack.aadhaarMask}${digits.slice(-4)}`, kind: 'aadhaar' });
  }
  return findings;
}

function maskPack() {
  const date = loadDomain('ids').asOf;
  return {
    aadhaarLength: ruleById('ids', 'ids.aadhaar.length', date).value,
    vidLength: ruleById('ids', 'ids.aadhaar.vid.length', date).value,
    aadhaarMask: ruleById('ids', 'ids.aadhaar.mask', date).value,
    vidMask: ruleById('ids', 'ids.aadhaar.vid.mask', date).value,
  };
}

function walk(root, dir, findings) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, findings);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isTextFile(entry.name)) continue;
    const info = statSync(full);
    if (!info.isFile() || info.size > SCAN_LIMIT) continue;
    const text = readFileSync(full, 'utf8');
    if (text.includes('\0')) continue;
    const relativePath = relative(root, full);
    for (const finding of scanText(text)) findings.push({ file: relativePath, ...finding });
  }
}

function isTextFile(name) {
  if (name === '.env' || name.endsWith('.log')) return true;
  return TEXT_EXT.has(extname(name));
}

function fold(line) {
  let out = '';
  for (const ch of line.normalize('NFKC')) {
    const cp = ch.codePointAt(0);
    if (ZERO_WIDTH.has(cp)) continue;
    if (cp >= 0x202a && cp <= 0x202e) continue;
    if (cp >= 0x2066 && cp <= 0x2069) continue;
    out += ch;
  }
  return out;
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

function hasSeparator(value) {
  for (const ch of value) {
    if (ch === ' ' || ch === '-' || ch === '\t' || ch === '\n' || ch === '\r') return true;
  }
  return false;
}

function mapType(message) {
  if (message.includes('10 KB')) return 'Input exceeds the 10 KB limit.';
  if (message.includes('zero-width') || message.includes('bidi')) {
    return 'Zero-width or bidi control character rejected.';
  }
  if (message.includes('digit')) return 'Aadhaar input must be digits, spaces, or hyphens.';
  return 'Aadhaar input could not be read.';
}

function context(options) {
  const domain = loadDomain('ids');
  const date = typeof options === 'string' ? options : options.onDate ?? domain.asOf;
  if (!DATE.test(date)) throw new TypeError('onDate must be YYYY-MM-DD');
  return { date, text: disclaimer(date) };
}

function empty(text) {
  return {
    valid: false,
    kind: '',
    masked: null,
    length: 0,
    errors: [],
    warnings: [],
    confirm: false,
    disclaimer: text,
  };
}
