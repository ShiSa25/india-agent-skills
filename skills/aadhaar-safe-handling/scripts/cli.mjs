/** Shared CLI plumbing. One JSON object on stdout. Exit 0, 1, or 2. */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { disclaimer } from './_lib/disclaimer.mjs';
import { loadDomain } from './_lib/rules.mjs';

export function invokedDirectly(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

export function readArg(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw usage('Pass the value with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw usage('--json needs a value.');
  const unknown = argv.some((arg, i) => i !== index && i !== index + 1);
  if (unknown) throw usage('Unexpected argument.');
  return { value };
}

export function parsePayload(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('"') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw usage('--json value is not valid JSON.');
    }
  }
  return value;
}

export function safeDisclaimer() {
  try {
    return disclaimer(loadDomain('ids').asOf);
  } catch {
    return disclaimer('2026-11-01');
  }
}

export function usage(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

export function finish(code, payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
    process.exit(code);
  });
}

export async function runMain(moduleUrl, hooks) {
  if (!invokedDirectly(moduleUrl)) return;
  try {
    const parsed = readArg(process.argv.slice(2));
    if (parsed.help) finish(2, hooks.failure(hooks.usageText));
    else {
      const result = await hooks.execute(parsed);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, hooks.failure(error.message));
  }
}
