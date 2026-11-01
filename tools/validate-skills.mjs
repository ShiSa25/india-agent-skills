/**
 * Lint every skill: SKILL.md frontmatter, required files, sources.md links
 * and UNVERIFIED tags, evals, and the lib manifest.
 *
 *   node tools/validate-skills.mjs
 *   node tools/validate-frontmatter.mjs   # frontmatter only (SPEC fallback)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './frontmatter.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SECTIONS = ['## When to use', '## Quick start', '## Rules', '## Edge cases', '## Disclaimer'];
const IFSC_LOOKUP = join('skills', 'indian-id-validators', 'scripts', 'ifsc-lookup.mjs');

export function lintFrontmatterOnly() {
  return eachSkill((skill) => lintFrontmatter(skill));
}

export function lintAll() {
  const errors = [];
  errors.push(...lintFrontmatterOnly());
  errors.push(...eachSkill((skill) => lintBundle(skill)));
  errors.push(...lintMarketplace());
  return errors;
}

function eachSkill(fn) {
  const skillsDir = join(root, 'skills');
  if (!existsSync(skillsDir)) return ['skills/ does not exist'];
  const errors = [];
  const names = readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory());
  if (names.length === 0) errors.push('skills/ has no skill directories');
  for (const name of names.sort()) errors.push(...fn(join(skillsDir, name)));
  return errors;
}

function lintFrontmatter(dir) {
  const errors = [];
  const name = dir.split('/').at(-1);
  const skillFile = join(dir, 'SKILL.md');
  if (!existsSync(skillFile)) return [`${name}: missing SKILL.md`];
  let parsed;
  try {
    parsed = parseFrontmatter(readFileSync(skillFile, 'utf8'));
  } catch (error) {
    return [`${name}: ${error.message}`];
  }
  const { data, body } = parsed;
  if (data.name !== name) errors.push(`${name}: frontmatter name must equal the folder name`);
  if (typeof data.name !== 'string' || data.name.length < 1 || data.name.length > 64 || !NAME.test(data.name)) {
    errors.push(`${name}: name must be 1-64 chars of [a-z0-9-] with no leading, trailing, or doubled hyphen`);
  }
  if (typeof data.description !== 'string' || data.description.length < 1 || data.description.length > 1024) {
    errors.push(`${name}: description must be 1-1024 characters`);
  } else if (!data.description.includes('Use when')) {
    errors.push(`${name}: description must say what the skill does and when to use it ("Use when")`);
  }
  if (data.license !== 'MIT') errors.push(`${name}: license must be MIT`);
  if (data.compatibility !== undefined && (typeof data.compatibility !== 'string' || data.compatibility.length > 500)) {
    errors.push(`${name}: compatibility must be a string of at most 500 characters`);
  }
  const metadata = data.metadata;
  if (!metadata || typeof metadata !== 'object') {
    errors.push(`${name}: metadata must be a string map`);
  } else {
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value !== 'string') errors.push(`${name}: metadata.${key} must be a string`);
    }
    if (!VERSION.test(metadata.version ?? '')) errors.push(`${name}: metadata.version must be x.y.z`);
    if (!DATE.test(metadata['rules-as-of'] ?? '')) errors.push(`${name}: metadata.rules-as-of must be YYYY-MM-DD`);
    if (metadata.jurisdiction !== 'IN') errors.push(`${name}: metadata.jurisdiction must be IN`);
  }
  const lines = body.split('\n');
  if (lines.length >= 500) errors.push(`${name}: SKILL.md body must be under 500 lines`);
  let last = -1;
  for (const heading of SECTIONS) {
    const at = body.indexOf(heading);
    if (at === -1) errors.push(`${name}: missing section ${heading}`);
    else if (at < last) errors.push(`${name}: section ${heading} is out of order`);
    else last = at;
  }
  if (!body.includes('node scripts/')) errors.push(`${name}: Quick start must show a node scripts/ command`);
  if (!body.includes('This tool gives general information')) {
    errors.push(`${name}: Disclaimer section must include the shared disclaimer`);
  }
  return errors;
}

function lintBundle(dir) {
  const errors = [];
  const name = dir.split('/').at(-1);
  const scripts = listMjs(join(dir, 'scripts'));
  if (scripts.length === 0) errors.push(`${name}: needs at least one scripts/*.mjs`);
  if (!existsSync(join(dir, 'references', 'sources.md'))) errors.push(`${name}: missing references/sources.md`);
  else errors.push(...lintSources(dir));
  const tests = listTests(join(dir, 'tests'));
  if (tests.length === 0) errors.push(`${name}: needs skills/${name}/tests/*.test.mjs`);
  const evals = join(root, 'evals', name, 'evals.json');
  if (!existsSync(evals)) errors.push(`${name}: missing evals/${name}/evals.json`);
  else errors.push(...lintEvals(name, evals));
  errors.push(...lintNetwork(dir));
  return errors;
}

function lintSources(dir) {
  const errors = [];
  const name = dir.split('/').at(-1);
  const text = readFileSync(join(dir, 'references', 'sources.md'), 'utf8');
  if (text.includes('http://')) errors.push(`${name}: sources.md contains http://`);
  let bullets = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('- ')) continue;
    bullets += 1;
    const linked = /\]\(https:\/\/[^)\s]+\)/.test(line);
    const tagged = line.includes('UNVERIFIED');
    if (!linked && !tagged) {
      errors.push(`${name}: sources.md bullet needs an https link or an UNVERIFIED tag: ${line}`);
    }
  }
  if (bullets === 0) errors.push(`${name}: sources.md needs at least one source bullet`);
  const manifestPath = join(dir, 'scripts', 'lib-manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    let unverified = false;
    for (const file of manifest.rules ?? []) {
      const rules = JSON.parse(readFileSync(join(root, 'rules', file), 'utf8'));
      if (rules.rules.some((rule) => rule.verified === false)) unverified = true;
    }
    if (unverified && !text.includes('UNVERIFIED')) {
      errors.push(`${name}: a bundled rule has verified:false, so sources.md must tag it UNVERIFIED`);
    }
  }
  return errors;
}

function lintEvals(name, file) {
  const errors = [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return [`${name}: evals.json is not JSON (${error.message})`];
  }
  if (parsed.skill !== name) errors.push(`${name}: evals.json skill must equal the folder name`);
  if (!Array.isArray(parsed.evals) || parsed.evals.length === 0) {
    errors.push(`${name}: evals.json needs a non-empty evals array`);
    return errors;
  }
  const ids = new Set();
  for (const item of parsed.evals) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) errors.push(`${name}: eval missing id`);
    else if (ids.has(item.id)) errors.push(`${name}: duplicate eval id ${item.id}`);
    else ids.add(item.id);
    if (typeof item.prompt !== 'string' || item.prompt.length === 0) errors.push(`${name}: eval ${item.id} missing prompt`);
    if (!item.expect || typeof item.expect !== 'object') errors.push(`${name}: eval ${item.id} missing expect`);
  }
  return errors;
}

function lintNetwork(dir) {
  const errors = [];
  const name = dir.split('/').at(-1);
  const files = [];
  collect(join(dir, 'scripts'), files);
  collect(join(dir, 'tests'), files);
  for (const file of files) {
    if (file.endsWith(`${IFSC_LOOKUP}`)) continue;
    const rel = file.slice(root.length + 1);
    if (rel.includes(`${join('scripts', '_lib')}`) || rel.includes(`${join('scripts', '_rules')}`)) continue;
    const text = readFileSync(file, 'utf8');
    if (/\bfetch\s*\(/.test(text) || /node:(?:http|https|net|tls|dgram)['"]/.test(text)) {
      errors.push(`${rel}: network call. The only opt-in exception is indian-id-validators ifsc-lookup.mjs, and tests must not call the network.`);
    }
  }
  const lib = join(root, 'lib');
  for (const file of readdirSync(lib)) {
    const full = join(lib, file);
    if (!file.endsWith('.mjs') || !statSync(full).isFile()) continue;
    const text = readFileSync(full, 'utf8');
    if (/\bfetch\s*\(/.test(text)) errors.push(`lib/${file}: network call`);
  }
  return errors;
}

function lintMarketplace() {
  const errors = [];
  const file = join(root, '.claude-plugin', 'marketplace.json');
  if (!existsSync(file)) return ['missing .claude-plugin/marketplace.json'];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed.name !== 'india-agent-skills') errors.push('marketplace name must be india-agent-skills');
  const skills = parsed.plugins?.[0]?.skills ?? [];
  if (!Array.isArray(skills) || skills.length === 0) errors.push('marketplace plugin must list at least one skill');
  for (const skill of skills) {
    if (typeof skill !== 'string' || !skill.startsWith('./')) {
      errors.push(`marketplace skill path must start with ./ (${skill})`);
      continue;
    }
    if (!existsSync(join(root, skill, 'SKILL.md'))) errors.push(`marketplace lists missing skill ${skill}`);
  }
  return errors;
}

function listMjs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.mjs') && statSync(join(dir, name)).isFile());
}

function listTests(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.test.mjs'));
}

function collect(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.mjs')) out.push(full);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const errors = lintAll();
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log('validate-skills: ok');
}
