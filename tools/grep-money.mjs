/**
 * Fail if money code uses parseFloat or a "* 100" scale (floats and rupee
 * scaling). 10000, the basis-point divisor, is allowed because it is not "* 100".
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const patterns = [
  { name: 'parseFloat(', re: /parseFloat\s*\(/ },
  { name: '* 100', re: /\*\s*100(?!\d)/ },
];
const errors = [];

for (const file of moneyFiles()) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (pattern.re.test(line)) {
        errors.push(`${file}:${index + 1} contains ${pattern.name}`);
      }
    }
  });
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}
console.log('grep-money: clean');

function moneyFiles() {
  const files = [];
  const lib = join(root, 'lib');
  for (const name of readdirSync(lib)) {
    const full = join(lib, name);
    if (name.endsWith('.mjs') && statSync(full).isFile()) files.push(full);
  }
  const skills = join(root, 'skills');
  if (!existsSync(skills)) return files;
  for (const skill of readdirSync(skills)) {
    const scripts = join(skills, skill, 'scripts');
    if (!existsSync(scripts)) continue;
    for (const name of readdirSync(scripts)) {
      const full = join(scripts, name);
      if (name.endsWith('.mjs') && statSync(full).isFile()) files.push(full);
    }
  }
  return files;
}
