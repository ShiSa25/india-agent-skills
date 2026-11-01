/**
 * Refresh the skills table in README.md between the skills:start / skills:end markers.
 *
 *   node tools/gen-readme.mjs           # write
 *   node tools/gen-readme.mjs --check   # fail if the table drifted
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './frontmatter.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = join(root, 'README.md');
const planned = JSON.parse(readFileSync(join(root, 'tools', 'planned-skills.json'), 'utf8'));
const start = '<!-- skills:start -->';
const end = '<!-- skills:end -->';
const check = process.argv.includes('--check');

const table = renderTable();
const readme = readFileSync(readmePath, 'utf8');
const startAt = readme.indexOf(start);
const endAt = readme.indexOf(end);
if (startAt === -1 || endAt === -1 || endAt < startAt) {
  console.error('README.md is missing <!-- skills:start --> / <!-- skills:end --> markers');
  process.exit(1);
}
const next = `${readme.slice(0, startAt)}${table}${readme.slice(endAt + end.length)}`;
if (check) {
  if (next !== readme) {
    console.error('README skills table is stale. Run: npm run readme');
    process.exit(1);
  }
  console.log('gen-readme: table matches');
} else {
  writeFileSync(readmePath, next);
  console.log('gen-readme: wrote README skills table');
}

function renderTable() {
  const lines = [
    start,
    '| Skill | What it does | Status |',
    '| --- | --- | --- |',
  ];
  for (const item of planned) {
    const skillFile = join(root, 'skills', item.name, 'SKILL.md');
    let description = item.description;
    let status = 'coming in v0.1';
    let label = `\`${item.name}\``;
    if (existsSync(skillFile)) {
      const { data } = parseFrontmatter(readFileSync(skillFile, 'utf8'));
      description = data.description;
      status = data.metadata.version;
      label = `[${item.name}](skills/${item.name}/SKILL.md)`;
    }
    lines.push(`| ${label} | ${cell(description)} | ${status} |`);
  }
  lines.push(end);
  return lines.join('\n');
}

function cell(value) {
  return String(value).replaceAll('\n', ' ').replace(/\s+/g, ' ').replaceAll('|', '\\|').trim();
}
