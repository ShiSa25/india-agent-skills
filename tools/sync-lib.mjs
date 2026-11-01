/**
 * Copy the lib/ modules and rules/*.json a skill declares into its own folder.
 *
 *   node tools/sync-lib.mjs           # write copies
 *   node tools/sync-lib.mjs --check   # fail if a copy drifted
 *
 * Manifest: skills/<name>/scripts/lib-manifest.json
 *   { "lib": ["gstin.mjs", "rules.mjs"], "rules": ["gst.json"] }
 * Copies land in skills/<name>/scripts/_lib/ and scripts/_rules/.
 * Installers copy the skill folder only, so the copies are what runs.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const skillsDir = join(root, 'skills');
const errors = [];

if (!existsSync(skillsDir)) {
  console.error('skills/ does not exist');
  process.exit(1);
}

for (const name of readdirSync(skillsDir).sort()) {
  const skill = join(skillsDir, name);
  if (!statSync(skill).isDirectory()) continue;
  const manifestPath = join(skill, 'scripts', 'lib-manifest.json');
  if (!existsSync(manifestPath)) {
    errors.push(`${name}: missing scripts/lib-manifest.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const libList = asList(manifest.lib, `${name}: lib`);
  const ruleList = asList(manifest.rules, `${name}: rules`);
  const needed = new Set(libList);
  for (const rel of libList) {
    for (const dep of relativeImports(join(root, 'lib', rel))) needed.add(dep);
  }
  for (const rel of needed) {
    if (!libList.includes(rel)) errors.push(`${name}: ${rel} is imported but not listed in lib-manifest.json`);
  }
  syncTree(libList, join(root, 'lib'), join(skill, 'scripts', '_lib'), `${name} lib`);
  syncTree(ruleList, join(root, 'rules'), join(skill, 'scripts', '_rules'), `${name} rules`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log(check ? 'sync-lib: copies match' : 'sync-lib: copied');

function syncTree(list, sourceRoot, destRoot, label) {
  const expected = new Set(list);
  if (!check) {
    rmSync(destRoot, { recursive: true, force: true });
    mkdirSync(destRoot, { recursive: true });
  }
  for (const rel of list) {
    assertSafe(rel, label);
    const from = join(sourceRoot, rel);
    const to = join(destRoot, rel);
    if (!existsSync(from)) {
      errors.push(`${label}: source missing ${rel}`);
      continue;
    }
    const source = readFileSync(from);
    if (check) {
      if (!existsSync(to)) {
        errors.push(`${label}: missing copy ${rel}`);
        continue;
      }
      const copy = readFileSync(to);
      if (!source.equals(copy)) errors.push(`${label}: ${rel} drifted from the source`);
    } else {
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, source);
    }
  }
  if (check && existsSync(destRoot)) {
    for (const rel of walk(destRoot)) {
      if (!expected.has(rel)) errors.push(`${label}: extra copy ${rel} is not in the manifest`);
    }
  }
}

function relativeImports(file) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const found = [];
  for (const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const dir = dirname(file);
    let target = resolve(dir, match[1]);
    if (!target.endsWith('.mjs')) target += '.mjs';
    found.push(relative(join(root, 'lib'), target).split('\\').join('/'));
  }
  return found;
}

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function asList(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    errors.push(`${label} must be an array of strings`);
    return [];
  }
  return value;
}

function assertSafe(rel, label) {
  if (rel.startsWith('/') || rel.split('/').includes('..') || rel.includes('\\')) {
    errors.push(`${label}: unsafe path ${rel}`);
  }
}
