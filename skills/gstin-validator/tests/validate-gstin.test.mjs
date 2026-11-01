import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateGstin as validateFromLib } from '../../../lib/gstin.mjs';
import { checkChar, generateSyntheticGstin, validateGstin } from '../scripts/_lib/gstin.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');
const CAVEAT = 'Checksum valid ≠ registered/active; check services.gst.gov.in/services/searchtp';
const CONFIRM = 'Confirm with the official source before relying on this.';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const PUBLIC = [
  ['27AAACR5055K1Z7', 'regular', '27', 'Maharashtra', 'AAACR5055K'],
  ['27AAPFU0939F1ZV', 'regular', '27', 'Maharashtra', 'AAPFU0939F'],
  ['9923USA29044OSE', 'nrtp_oidar', '99', 'Centre Jurisdiction', null],
  ['9924ISR29001OSH', 'nrtp_oidar', '99', 'Centre Jurisdiction', null],
  ['9917USA29016OS6', 'nrtp_oidar', '99', 'Centre Jurisdiction', null],
  ['2717USA00046UNV', 'uin', '27', 'Maharashtra', null],
  ['2317UNO00001UND', 'uin', '23', 'Madhya Pradesh', null],
];

describe('public GSTINs (checksum only)', () => {
  for (const [gstin, type, stateCode, stateName, pan] of PUBLIC) {
    test(gstin, () => {
      const result = validateGstin(gstin);
      assert.equal(result.valid, true);
      assert.equal(result.type, type);
      assert.equal(result.stateCode, stateCode);
      assert.equal(result.stateName, stateName);
      assert.equal(result.pan, pan);
      assert.equal(result.tan, null);
      assert.equal(result.confirm, false);
      assert.deepEqual(result.errors, []);
      assert.ok(result.warnings.includes(CAVEAT));
      assert.match(result.disclaimer, /not tax, legal or financial advice/);
      assert.match(result.disclaimer, /2026-11-01/);
    });
  }
});

describe('SPEC invalid and synthetic vectors', () => {
  test('blog example 9917USA00013OS5 expects check character P', () => {
    assert.equal(checkChar('9917USA00013OS'), 'P');
    const result = validateGstin('9917USA00013OS5');
    assert.equal(result.valid, false);
    assert.equal(result.type, 'nrtp_oidar');
    assert.equal(result.stateCode, '99');
    assert.ok(result.errors.some((error) => error.includes('expected P')));
    assert.equal(result.warnings.includes(CAVEAT), false);
  });

  test('Reliance off-by-one check character', () => {
    const result = validateGstin('27AAACR5055K1Z8');
    assert.equal(result.valid, false);
    assert.equal(result.type, 'regular');
    assert.ok(result.errors.some((error) => error.includes('expected 7')));
  });

  test('length 14 and length 16', () => {
    for (const gstin of ['27AAACR5055K1Z', '27AAACR5055K1Z77']) {
      const result = validateGstin(gstin);
      assert.equal(result.valid, false);
      assert.equal(result.type, 'unknown');
      assert.ok(result.errors.some((error) => error.includes('15 characters')));
    }
  });

  test('lowercase normalises and warns', () => {
    const result = validateGstin('27aaacr5055k1z7');
    assert.equal(result.valid, true);
    assert.equal(result.normalized, '27AAACR5055K1Z7');
    assert.ok(result.warnings.includes('Lowercase letters were normalised to uppercase.'));
    assert.ok(result.warnings.includes(CAVEAT));
  });

  test('spaces and hyphens are removed', () => {
    const spaced = validateGstin('27 AAACR5055K1Z7');
    const hyphen = validateGstin('27-AAACR5055K1Z7');
    assert.equal(spaced.valid, true);
    assert.equal(hyphen.valid, true);
    assert.equal(spaced.normalized, '27AAACR5055K1Z7');
    assert.ok(spaced.warnings.includes('Spaces or hyphens were removed.'));
  });

  test('invalid state prefixes 00, 98, and 96', () => {
    const pan = 'AABCC1234A';
    const code00 = generateSyntheticGstin('00', { pan });
    const code98 = generateSyntheticGstin('98', { pan });
    const code96 = generateSyntheticGstin('96', { pan });
    const invalid00 = validateGstin(code00);
    const invalid98 = validateGstin(code98);
    const invalid96 = validateGstin(code96);
    assert.equal(invalid00.valid, false);
    assert.equal(invalid98.valid, false);
    assert.equal(invalid96.valid, false);
    assert.ok(invalid00.errors.some((error) => error.includes('Invalid state code 00')));
    assert.ok(invalid98.errors.some((error) => error.includes('Invalid state code 98')));
    assert.ok(invalid96.errors.some((error) => error.includes('place-of-supply')));
    assert.equal(invalid96.stateName, 'Other Countries');
  });

  test('29ABCDE1234F1ZW matches checksum and fails the PAN holder type', () => {
    assert.equal(checkChar('29ABCDE1234F1Z'), 'W');
    const result = validateGstin('29ABCDE1234F1ZW');
    assert.equal(result.valid, false);
    assert.equal(result.type, 'regular');
    assert.equal(result.pan, 'ABCDE1234F');
    assert.equal(result.stateName, 'Karnataka');
    assert.ok(result.errors.some((error) => error.includes('PAN')));
    assert.ok(result.warnings.includes(CAVEAT));
  });

  test('27AAACX0000A1DK is TDS type and not a TAN', () => {
    assert.equal(checkChar('27AAACX0000A1D'), 'K');
    const result = validateGstin('27AAACX0000A1DK');
    assert.equal(result.valid, false);
    assert.equal(result.type, 'tds');
    assert.equal(result.tan, 'AAACX0000A');
    assert.equal(result.pan, null);
    assert.ok(result.errors.some((error) => error.includes('TAN')));
    assert.ok(result.warnings.includes(CAVEAT));
  });

  test('25AAACX0000A1ZF is valid with a legacy state warning', () => {
    const result = validateGstin('25AAACX0000A1ZF');
    assert.equal(result.valid, true);
    assert.equal(result.type, 'regular');
    assert.equal(result.stateName, 'Daman and Diu');
    assert.equal(result.pan, 'AAACX0000A');
    assert.deepEqual(result.warnings, ['legacy state code', CAVEAT]);
    assert.equal(result.confirm, false);
  });
});

describe('edge cases', () => {
  test('13th character 0 is invalid', () => {
    assert.equal(checkChar('27AAACR5055K0Z'), '8');
    const result = validateGstin('27AAACR5055K0Z8');
    assert.equal(result.valid, false);
    assert.equal(result.type, 'regular');
    assert.ok(result.errors.some((error) => error.includes('not 0')));
  });

  test('UIN and NRTP do not need a PAN', () => {
    assert.equal(validateGstin('2717USA00046UNV').pan, null);
    assert.equal(validateGstin('2317UNO00001UND').valid, true);
    assert.equal(validateGstin('9923USA29044OSE').pan, null);
  });

  test('a synthetic TAN validates as TDS', () => {
    const gstin = generateSyntheticGstin('27', { type: 'tds', tan: 'AAAA00000A' });
    const result = validateGstin(gstin);
    assert.equal(result.valid, true);
    assert.equal(result.type, 'tds');
    assert.equal(result.tan, 'AAAA00000A');
    assert.equal(result.confirm, false);
    assert.equal(result.pan, null);
  });

  test('TCS sets confirm because the marker is unverified', () => {
    const gstin = generateSyntheticGstin('27', { type: 'tcs' });
    const result = validateGstin(gstin);
    assert.equal(result.valid, true);
    assert.equal(result.type, 'tcs');
    assert.equal(result.confirm, true);
    assert.ok(result.warnings.some((warning) => warning.includes(CONFIRM)));
    assert.ok(result.warnings.some((warning) => warning.includes('UNVERIFIED')));
  });

  test('Cyrillic look-alike is rejected and not stripped', () => {
    const result = validateGstin('27\u0410AACR5055K1Z7');
    assert.equal(result.valid, false);
    assert.equal(result.normalized, '');
    assert.notEqual(result.normalized, '27AAACR5055K1Z7');
    assert.ok(result.errors.some((error) => error.includes('look-alike')));
  });

  test('zero-width character is rejected', () => {
    const result = validateGstin('27AAACR5055K1Z7\u200B');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes('Zero-width')));
  });

  test('NFKC normalises fullwidth digits', () => {
    const result = validateGstin('\uFF12\uFF17AAACR5055K1Z7');
    assert.equal(result.valid, true);
    assert.equal(result.normalized, '27AAACR5055K1Z7');
    assert.ok(result.warnings.includes('Input was NFKC-normalised.'));
  });

  test('empty, non-string, and overlong input', () => {
    assert.equal(validateGstin('   ').valid, false);
    assert.equal(validateGstin(27).valid, false);
    assert.ok(validateGstin('A'.repeat(10241)).errors.some((error) => error.includes('10 KB')));
  });

  test('state names the spec calls out', () => {
    assert.equal(validateGstin(generateSyntheticGstin('36')).stateName, 'Telangana');
    assert.equal(validateGstin(generateSyntheticGstin('37')).stateName, 'Andhra Pradesh');
    assert.equal(validateGstin(generateSyntheticGstin('38')).stateName, 'Ladakh');
    assert.equal(validateGstin(generateSyntheticGstin('26')).stateName, 'Dadra and Nagar Haveli');
    const undivided = validateGstin(generateSyntheticGstin('28'));
    assert.equal(undivided.valid, true);
    assert.equal(undivided.stateName, 'Andhra Pradesh (undivided)');
    assert.ok(undivided.warnings.includes('legacy state code'));
  });

  test('generator rebuilds the published NRTP and UIN examples', () => {
    assert.equal(
      generateSyntheticGstin('99', { type: 'nrtp_oidar', year: '23', country: 'USA', serial: '29044' }),
      '9923USA29044OSE',
    );
    assert.equal(
      generateSyntheticGstin('27', { type: 'uin', year: '17', country: 'USA', serial: '00046', marker: 'UN' }),
      '2717USA00046UNV',
    );
    assert.equal(
      generateSyntheticGstin('23', { type: 'uin', year: '17', country: 'UNO', serial: '00001', marker: 'UN' }),
      '2317UNO00001UND',
    );
  });

  test('every single-character substitution in the alphabet fails', () => {
    const samples = [
      '27AAACR5055K1Z7',
      '9923USA29044OSE',
      '2717USA00046UNV',
      generateSyntheticGstin('27', { type: 'tds', tan: 'AAAA00000A' }),
    ];
    for (const gstin of samples) {
      assert.equal(validateGstin(gstin).valid, true);
      for (let i = 0; i < gstin.length; i += 1) {
        for (const replacement of ALPHABET) {
          if (replacement === gstin[i]) continue;
          const flipped = `${gstin.slice(0, i)}${replacement}${gstin.slice(i + 1)}`;
          assert.equal(validateGstin(flipped).valid, false, flipped);
        }
      }
    }
  });
});

describe('shipped copy and evals', () => {
  test('skill _lib and _rules match the repo sources', () => {
    for (const name of ['disclaimer.mjs', 'gstin.mjs', 'rules.mjs']) {
      assert.equal(
        readFileSync(join(repoRoot, 'lib', name), 'utf8'),
        readFileSync(join(skillRoot, 'scripts', '_lib', name), 'utf8'),
      );
    }
    for (const name of ['gst.json', 'ids.json']) {
      assert.equal(
        readFileSync(join(repoRoot, 'rules', name), 'utf8'),
        readFileSync(join(skillRoot, 'scripts', '_rules', name), 'utf8'),
      );
    }
  });

  test('lib/ and the skill copy agree on a GSTIN', () => {
    assert.deepEqual(validateFromLib('27AAACR5055K1Z7'), validateGstin('27AAACR5055K1Z7'));
  });

  test('evals.json expectations match the script', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'gstin-validator', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'gstin-validator');
    for (const item of evals.evals) {
      const result = validateGstin(item.expect.gstin);
      for (const [key, value] of Object.entries(item.expect)) {
        if (key === 'gstin' || key === 'errorIncludes' || key === 'warningIncludes') continue;
        assert.deepEqual(result[key], value, item.id);
      }
      if (item.expect.errorIncludes) {
        assert.ok(result.errors.some((error) => error.includes(item.expect.errorIncludes)), item.id);
      }
      if (item.expect.warningIncludes) {
        assert.ok(result.warnings.some((warning) => warning.includes(item.expect.warningIncludes)), item.id);
      }
    }
  });
});

describe('CLI', () => {
  test('valid, invalid, and usage exit codes', () => {
    const valid = run('validate-gstin.mjs', ['--json', '27AAACR5055K1Z7']);
    assert.equal(valid.status, 0);
    assert.deepEqual(JSON.parse(valid.stdout), validateGstin('27AAACR5055K1Z7'));
    assert.equal(valid.stderr, '');

    const invalid = run('validate-gstin.mjs', ['--json', '9917USA00013OS5']);
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).valid, false);

    const objectInput = run('validate-gstin.mjs', ['--json', '{"gstin":"27AAPFU0939F1ZV"}']);
    assert.equal(objectInput.status, 0);
    assert.equal(JSON.parse(objectInput.stdout).normalized, '27AAPFU0939F1ZV');

    const usage = run('validate-gstin.mjs', []);
    assert.equal(usage.status, 2);
    assert.equal(JSON.parse(usage.stdout).valid, false);

    const generated = run('generate-gstin.mjs', ['--json', '{"stateCode":"29"}']);
    assert.equal(generated.status, 0);
    const body = JSON.parse(generated.stdout);
    assert.equal(body.valid, true);
    assert.equal(body.stateName, 'Karnataka');
    assert.equal(body.normalized, validateGstin(body.normalized).normalized);
  });
});

function run(script, args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', script), ...args], {
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  return result;
}
