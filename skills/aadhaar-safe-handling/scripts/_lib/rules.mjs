/**
 * Load versioned rules/*.json (or a skill's scripts/_rules copy).
 * Lookups take a YYYY-MM-DD date and honour effectiveFrom / effectiveTo.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const cache = new Map();

/** Directory of rules JSON next to this module: ../rules or ../_rules. */
export function rulesDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const dir of [join(here, '..', 'rules'), join(here, '..', '_rules')]) {
    if (existsSync(dir)) return dir;
  }
  throw new Error('rules directory not found next to rules.mjs');
}

/** @param {string} domain file name without .json */
export function loadDomain(domain) {
  if (!/^[a-z0-9-]+$/.test(domain)) throw new Error(`invalid rules domain: ${domain}`);
  const file = join(rulesDir(), `${domain}.json`);
  const cached = cache.get(file);
  if (cached) return cached;
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  assertDomain(parsed, domain);
  cache.set(file, parsed);
  return parsed;
}

export function loadAllDomains() {
  return readdirSync(rulesDir())
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => loadDomain(name.slice(0, -'.json'.length)));
}

/** @param {string} domain @param {string} onDate */
export function rulesOn(domain, onDate) {
  assertDate(onDate);
  return loadDomain(domain).rules.filter((rule) => inForce(rule, onDate));
}

/**
 * Latest effectiveFrom wins when more than one row shares an id.
 * @param {string} domain
 * @param {string} id
 * @param {string} onDate
 */
export function ruleById(domain, id, onDate) {
  const matches = rulesOn(domain, onDate).filter((rule) => rule.id === id);
  if (matches.length === 0) {
    throw new Error(`no rule ${id} in ${domain} on ${onDate}`);
  }
  matches.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
  return matches[0];
}

/** @param {object|object[]} rule */
export function needsConfirm(rule) {
  if (Array.isArray(rule)) return rule.some((item) => needsConfirm(item));
  return rule?.verified === false;
}

/**
 * Anchored rule regex. Rejects * and + and groups so a data file cannot
 * smuggle a nested quantifier.
 * @param {string} source
 * @param {string} id
 */
export function compileAnchored(source, id) {
  if (typeof source !== 'string' || !source.startsWith('^') || !source.endsWith('$')) {
    throw new Error(`rule ${id} regex must be anchored`);
  }
  if (source.includes('*') || source.includes('+') || source.includes('(')) {
    throw new Error(`rule ${id} regex is not a flat anchored pattern`);
  }
  return new RegExp(source);
}

function assertDomain(data, domain) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${domain}: rules file must be an object`);
  }
  if (data.schema !== 1) throw new Error(`${domain}: schema must be 1`);
  if (data.domain !== domain) throw new Error(`${domain}: domain field must match the file name`);
  assertDate(data.asOf, `${domain}.asOf`);
  if (!Array.isArray(data.rules)) throw new Error(`${domain}: rules must be an array`);
  const seen = new Set();
  for (const rule of data.rules) assertRule(rule, domain, seen);
}

function assertRule(rule, domain, seen) {
  if (!rule || typeof rule !== 'object') throw new Error(`${domain}: rule must be an object`);
  for (const key of ['id', 'value', 'unit', 'effectiveFrom', 'source', 'verified', 'note']) {
    if (!(key in rule)) throw new Error(`${domain}: rule missing ${key}`);
  }
  if (!('effectiveTo' in rule)) throw new Error(`${domain}: rule ${rule.id} missing effectiveTo`);
  if (typeof rule.id !== 'string' || rule.id.length === 0) {
    throw new Error(`${domain}: rule id must be a string`);
  }
  if (seen.has(rule.id)) throw new Error(`${domain}: duplicate rule id ${rule.id}`);
  seen.add(rule.id);
  if (typeof rule.unit !== 'string' || rule.unit.length === 0) {
    throw new Error(`${domain}: rule ${rule.id} unit must be a string`);
  }
  if (typeof rule.verified !== 'boolean') {
    throw new Error(`${domain}: rule ${rule.id} verified must be boolean`);
  }
  if (typeof rule.note !== 'string') throw new Error(`${domain}: rule ${rule.id} note must be a string`);
  assertDate(rule.effectiveFrom, `${rule.id}.effectiveFrom`);
  if (rule.effectiveTo !== null) assertDate(rule.effectiveTo, `${rule.id}.effectiveTo`);
  if (rule.effectiveTo !== null && rule.effectiveFrom > rule.effectiveTo) {
    throw new Error(`${domain}: rule ${rule.id} effectiveFrom is after effectiveTo`);
  }
  if (typeof rule.source !== 'string' || !rule.source.startsWith('https://') || /\s/.test(rule.source)) {
    throw new Error(`${domain}: rule ${rule.id} source must be an https URL`);
  }
}

function inForce(rule, onDate) {
  if (rule.effectiveFrom > onDate) return false;
  if (rule.effectiveTo !== null && onDate > rule.effectiveTo) return false;
  return true;
}

function assertDate(value, label = 'date') {
  if (typeof value !== 'string' || !DATE.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
}
