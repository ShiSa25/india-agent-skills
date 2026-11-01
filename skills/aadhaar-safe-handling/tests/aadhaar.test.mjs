import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIRM_SENTENCE } from '../scripts/_lib/disclaimer.mjs';
import { generateSynthetic, verhoeffCheckDigit, verhoeffValid } from '../scripts/_lib/verhoeff.mjs';
import {
  checkAadhaar,
  generateAadhaar,
  isTimestamp,
  maskAadhaar,
  scanPath,
  scanText,
  storageGuidance,
} from '../scripts/aadhaar.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');
const SPECIMEN = '234123412346';

describe('check and mask', () => {
  test('SPEC specimens: only a leading 0 or 1 warns, and 999999999999 does not', () => {
    const plain = checkAadhaar(SPECIMEN);
    assert.equal(plain.valid, true);
    assert.equal(plain.kind, 'aadhaar');
    assert.equal(plain.masked, 'XXXX XXXX 2346');
    assert.equal(plain.confirm, false);
    assert.equal(JSON.stringify(plain).includes(SPECIMEN), false);
    assert.ok(plain.warnings.some((warning) => warning.includes('does not mean UIDAI issued')));

    const nines = checkAadhaar('999999999999');
    assert.equal(nines.valid, true);
    assert.equal(nines.confirm, false);
    assert.equal(nines.masked, 'XXXX XXXX 9999');
    assert.equal(nines.warnings.some((warning) => warning.includes('Leading digit')), false);

    const leading = checkAadhaar('123456789010');
    assert.equal(leading.valid, true);
    assert.equal(leading.confirm, true);
    assert.equal(leading.masked, 'XXXX XXXX 9010');
    assert.ok(leading.warnings.some((warning) => warning.includes('Leading digit is 0 or 1')));
    assert.ok(leading.warnings.some((warning) => warning.includes(CONFIRM_SENTENCE)));
  });

  test('spaces, dashes, and a computed leading 0 stay valid', () => {
    const spaced = maskAadhaar('2341 2341 2346');
    assert.equal(spaced.valid, true);
    assert.equal(spaced.masked, 'XXXX XXXX 2346');
    assert.ok(spaced.warnings.includes('Spaces or hyphens were removed.'));
    const dashed = checkAadhaar('2341-2341-2346');
    assert.equal(dashed.valid, true);
    const body = `0${'2341234123'}`;
    assert.equal(body.length, 11);
    const full = `${body}${verhoeffCheckDigit(body)}`;
    const result = checkAadhaar(full);
    assert.equal(result.valid, true);
    assert.equal(result.confirm, true);
    assert.match(result.masked, /^XXXX XXXX [0-9]{4}$/);
    assert.equal(JSON.stringify(result).includes(full), false);
  });

  test('flipping any digit fails Verhoeff and the result stays masked', () => {
    for (let i = 0; i < SPECIMEN.length; i += 1) {
      for (let digit = 0; digit <= 9; digit += 1) {
        if (String(digit) === SPECIMEN[i]) continue;
        const flipped = `${SPECIMEN.slice(0, i)}${digit}${SPECIMEN.slice(i + 1)}`;
        const result = checkAadhaar(flipped);
        assert.equal(result.valid, false);
        assert.equal(result.masked, `XXXX XXXX ${flipped.slice(-4)}`);
        assert.equal(JSON.stringify(result).includes(flipped), false);
      }
    }
  });

  test('a 16-digit VID is sensitive and has no checksum', () => {
    const vid = checkAadhaar('1234123412341234');
    assert.equal(vid.valid, true);
    assert.equal(vid.kind, 'vid');
    assert.equal(vid.masked, 'XXXX XXXX XXXX 1234');
    assert.equal(vid.confirm, true);
    assert.ok(vid.warnings.some((warning) => warning.includes('Do not store a Virtual ID')));
    assert.equal(JSON.stringify(vid).includes('1234123412341234'), false);
  });

  test('rejects the wrong length, letters, zero-width characters, and overlong input', () => {
    assert.equal(checkAadhaar('12345').valid, false);
    assert.equal(checkAadhaar('12345').masked, null);
    assert.ok(checkAadhaar('23412341234X').errors.some((error) => error.includes('digits')));
    assert.ok(checkAadhaar(`${SPECIMEN}\u200B`).errors.some((error) => error.includes('Zero-width')));
    assert.ok(checkAadhaar('1'.repeat(10241)).errors.some((error) => error.includes('10 KB')));
    assert.equal(checkAadhaar(234123412346).valid, false);
  });
});

describe('scanner', () => {
  test('flags a Verhoeff-valid number with spaces or dashes and ignores failures and timestamps', () => {
    assert.equal(verhoeffValid('123456789012'), false);
    assert.equal(verhoeffValid('202611011530'), false);
    const text = ['ts=202611011530', 'ref=123456789012', 'aadhaar=2341-2341-2346', 'also 2341 2341 2346'].join('\n');
    const findings = scanText(text);
    assert.equal(findings.length, 2);
    assert.deepEqual(
      findings.map((finding) => finding.masked),
      ['XXXX XXXX 2346', 'XXXX XXXX 2346'],
    );
    assert.deepEqual(
      findings.map((finding) => finding.line),
      [3, 4],
    );
    assert.equal(JSON.stringify(findings).includes(SPECIMEN), false);
  });

  test('a Verhoeff-valid timestamp is ignored, and an embedded token is not', () => {
    let sample = '';
    for (let hour = 0; hour < 24 && sample === ''; hour += 1) {
      for (let minute = 0; minute < 60; minute += 1) {
        const digits = `20261101${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
        if (verhoeffValid(digits) && isTimestamp(digits)) {
          sample = digits;
          break;
        }
      }
    }
    assert.equal(sample.length, 12);
    assert.deepEqual(scanText(`event ${sample}`), []);
    assert.equal(scanText(`id${SPECIMEN}`).length, 0);
    assert.equal(scanText(`id ${SPECIMEN}`).length, 1);
    const hidden = `2341234\u200b12346`;
    assert.equal(scanText(hidden)[0].masked, 'XXXX XXXX 2346');
    const mixed = scanText('2341 2341-2346');
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0].kind, 'aadhaar');
  });

  test('an unlabelled 16-digit number is ignored and a labelled VID is masked', () => {
    assert.deepEqual(scanText('card 1234123412341234'), []);
    const found = scanText('VID 1234-1234-1234-1234');
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, 'vid');
    assert.equal(found[0].masked, 'XXXX XXXX XXXX 1234');
    assert.deepEqual(scanText('model User { aadhaarNumber String }'), []);
  });

  test('scanPath reads a file and keeps the number out of the result', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aadhaar-scan-'));
    writeFileSync(join(dir, 'app.log'), `paid ${SPECIMEN}\n`);
    writeFileSync(join(dir, 'note.txt'), 'no identifier here\n');
    const findings = scanPath(dir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, 'app.log');
    assert.equal(findings[0].masked, 'XXXX XXXX 2346');
    assert.equal(JSON.stringify(findings).includes(SPECIMEN), false);
  });
});

describe('storage guidance and generator', () => {
  test('section 29 and the data vault are printed from the rules', () => {
    const guidance = storageGuidance();
    assert.equal(guidance.valid, true);
    assert.equal(guidance.confirm, false);
    assert.match(guidance.section29, /Section 29/);
    assert.match(guidance.section29, /Core biometric/);
    assert.match(guidance.dataVault, /Aadhaar Data Vault/);
    assert.match(guidance.virtualId, /Do not store a Virtual ID/);
    assert.match(guidance.disclaimer, /not tax, legal or financial advice/);
  });

  test('generateAadhaar matches the shared Verhoeff generator', () => {
    const fromLib = generateSynthetic('phase-0');
    const generated = generateAadhaar('phase-0');
    assert.equal(generated.aadhaar, fromLib);
    assert.equal(generated.synthetic, true);
    assert.equal(generated.valid, true);
    assert.equal(verhoeffValid(generated.aadhaar), true);
    assert.equal(generated.aadhaar[0] === '0' || generated.aadhaar[0] === '1', false);
    assert.match(generated.warnings[0], /Synthetic/);
  });
});

describe('evals and CLI', () => {
  test('evals.json expectations match the scripts', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'aadhaar-safe-handling', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'aadhaar-safe-handling');
    for (const item of evals.evals) {
      if (item.expect.tool === 'scan') {
        const findings = scanText(item.expect.input);
        assert.equal(findings.length, item.expect.count, item.id);
        assert.equal(findings[0].masked, item.expect.masked, item.id);
        assert.equal(findings[0].kind, item.expect.kind, item.id);
        continue;
      }
      const result = checkAadhaar(item.expect.input);
      for (const [key, value] of Object.entries(item.expect)) {
        if (['tool', 'input', 'warningIncludes'].includes(key)) continue;
        assert.deepEqual(result[key], value, item.id);
      }
      if (item.expect.warningIncludes) {
        assert.ok(result.warnings.some((warning) => warning.includes(item.expect.warningIncludes)), item.id);
      }
    }
  });

  test('CLI prints masked JSON and uses exit codes 0, 1, and 2', () => {
    const valid = run('validate-aadhaar.mjs', ['--json', SPECIMEN]);
    assert.equal(valid.status, 0);
    assert.equal(valid.stdout.includes(SPECIMEN), false);
    assert.equal(JSON.parse(valid.stdout).masked, 'XXXX XXXX 2346');

    const masked = run('mask-aadhaar.mjs', ['--json', '{"aadhaar":"2341 2341 2346"}']);
    assert.equal(masked.status, 0);
    assert.equal(JSON.parse(masked.stdout).masked, 'XXXX XXXX 2346');

    const invalid = run('validate-aadhaar.mjs', ['--json', '123456789012']);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout.includes('123456789012'), false);

    const usage = run('scan-aadhaar.mjs', []);
    assert.equal(usage.status, 2);

    const scan = run('scan-aadhaar.mjs', ['--json', '{"text":"aadhaar=2341-2341-2346 ts=202611011530"}']);
    assert.equal(scan.status, 1);
    const body = JSON.parse(scan.stdout);
    assert.equal(body.count, 1);
    assert.equal(body.findings[0].masked, 'XXXX XXXX 2346');
    assert.equal(scan.stdout.includes(SPECIMEN), false);

    const clean = run('scan-aadhaar.mjs', ['--json', '{"text":"ref=123456789012"}']);
    assert.equal(clean.status, 0);
    assert.equal(JSON.parse(clean.stdout).count, 0);

    const storage = run('aadhaar-storage.mjs', ['--json', '{}']);
    assert.equal(storage.status, 0);
    assert.match(JSON.parse(storage.stdout).dataVault, /Aadhaar Data Vault/);

    const generated = run('generate-aadhaar.mjs', ['--json', '{"seed":"phase-0"}']);
    assert.equal(generated.status, 0);
    assert.equal(JSON.parse(generated.stdout).aadhaar, generateSynthetic('phase-0'));
  });

  test('shipped copies match the repo sources', () => {
    for (const name of ['disclaimer.mjs', 'rules.mjs', 'verhoeff.mjs']) {
      assert.equal(
        readFileSync(join(repoRoot, 'lib', name), 'utf8'),
        readFileSync(join(skillRoot, 'scripts', '_lib', name), 'utf8'),
      );
    }
    assert.equal(
      readFileSync(join(repoRoot, 'rules', 'ids.json'), 'utf8'),
      readFileSync(join(skillRoot, 'scripts', '_rules', 'ids.json'), 'utf8'),
    );
  });
});

function run(script, args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', script), ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return result;
}
