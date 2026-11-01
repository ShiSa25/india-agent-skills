#!/usr/bin/env node
/**
 *   node scripts/scan-aadhaar.mjs --json '{"text":"Customer 2341 2341 2346"}'
 *   node scripts/scan-aadhaar.mjs --json '{"path":"./src"}'
 * Exit 0 when nothing is found, 1 when a number is found, 2 on usage error.
 * Findings are masked. The full number is not printed.
 */
import { inspectText, scanPath } from './aadhaar.mjs';
import { disclaimer } from './_lib/disclaimer.mjs';
import { loadDomain } from './_lib/rules.mjs';
import { parsePayload, runMain, safeDisclaimer, usage } from './cli.mjs';

await runMain(import.meta.url, {
  usageText: 'Usage: node scripts/scan-aadhaar.mjs --json \'{"text":"..."}\' or \'{"path":"."}\'',
  failure,
  async execute(parsed) {
    const input = coerce(parsePayload(parsed.value));
    if (input.text !== undefined) {
      const inspected = inspectText(input.text);
      return report(inspected.findings, inspected.skippedLines);
    }
    return report(scanPath(input.path), 0);
  },
});

function report(findings, skippedLines) {
  const warnings = [];
  if (findings.length > 0) warnings.push('Findings are masked. Do not log a full Aadhaar number.');
  if (skippedLines > 0) warnings.push(`${skippedLines} line(s) exceeded 10 KB and were skipped.`);
  return {
    valid: findings.length === 0,
    findings,
    count: findings.length,
    errors: [],
    warnings,
    confirm: false,
    disclaimer: disclaimer(loadDomain('ids').asOf),
  };
}

function coerce(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw usage('JSON must be an object with a text string or a path string.');
  }
  const hasText = typeof value.text === 'string';
  const hasPath = typeof value.path === 'string';
  if (hasText === hasPath) throw usage('Provide exactly one of text or path.');
  if (hasText) return { text: value.text };
  return { path: value.path };
}

function failure(message) {
  return {
    valid: false,
    findings: [],
    count: 0,
    errors: [message],
    warnings: [],
    confirm: false,
    disclaimer: safeDisclaimer(),
  };
}
