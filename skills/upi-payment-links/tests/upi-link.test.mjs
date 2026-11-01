import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIRM_SENTENCE } from '../scripts/_lib/disclaimer.mjs';
import { qrcodegen } from '../scripts/_lib/vendor/qrcodegen.mjs';
import { buildUpiLink, parseUpiLink, upiQrSvg } from '../scripts/upi-link.mjs';
import { decodeQrModules, decodeQrSvg } from './qr-decode.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');
const UNSIGNED = 'Unsigned links are for P2P or personal use. Merchants should use their PSP or payment gateway. A link or QR is not proof of payment; reconcile from the bank statement or the payment-gateway webhook.';
const BANK = 'Banks and UPI apps may set a lower limit than the published ceiling.';

describe('SPEC vectors', () => {
  test('round-trip encodes Shiv & Co with %20 and %26', () => {
    const built = buildUpiLink({ pa: 'merchant@upi', pn: 'Shiv & Co', am: '499.00' });
    assert.equal(built.valid, true);
    assert.equal(
      built.link,
      'upi://pay?pa=merchant%40upi&pn=Shiv%20%26%20Co&am=499.00&cu=INR&mode=00',
    );
    assert.equal(built.link.includes('+'), false);
    assert.equal(built.params.pn, 'Shiv & Co');
    assert.equal(built.amountPaise, '49900');
    assert.equal(built.channel, 'p2p');
    assert.equal(built.amountEditable, false);
    assert.equal(built.confirm, true);
    assert.equal(built.warnings[0], UNSIGNED);
    assert.ok(built.warnings.includes(BANK));
    assert.ok(built.warnings.includes(CONFIRM_SENTENCE));
    assert.match(built.disclaimer, /2026-11-01/);
    const parsed = parseUpiLink(built.link);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.link, built.link);
    assert.equal(parsed.params.pn, 'Shiv & Co');
    assert.equal(parsed.params.pa, 'merchant@upi');
  });

  test('am 10.999, cu USD, and a missing pa are rejected', () => {
    const decimals = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', am: '10.999' });
    assert.equal(decimals.valid, false);
    assert.ok(decimals.errors.some((error) => error.includes('decimal')));

    const usd = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', am: '10', cu: 'USD' });
    assert.equal(usd.valid, false);
    assert.ok(usd.errors.some((error) => error.includes('INR')));

    const missing = buildUpiLink({ pn: 'Shop' });
    assert.equal(missing.valid, false);
    assert.ok(missing.errors.some((error) => error.includes('pa is required')));
    assert.equal(missing.link, '');
  });

  test('a Unicode payee name round-trips', () => {
    const built = buildUpiLink({ pa: 'cafe@okbank', pn: 'Café श्री', am: '2' });
    assert.equal(built.valid, true);
    assert.equal(built.params.pn, 'Café श्री');
    assert.equal(built.params.am, '2.00');
    assert.equal(parseUpiLink(built.link).params.pn, 'Café श्री');
  });

  test('QR SVG is deterministic, ECC M, and decodes to the same link', () => {
    const built = buildUpiLink({ pa: 'shop@okbank', pn: 'Cafe', am: '10.50', tn: 'Order 1' });
    assert.equal(built.valid, true);
    const first = upiQrSvg(built.link);
    const second = upiQrSvg(built.link);
    assert.equal(first, second);
    assert.match(first, /data-ecc="M"/);
    assert.equal(decodeQrSvg(first), built.link);
    const hash = createHash('sha256').update(first).digest('hex');
    assert.equal(hash, createHash('sha256').update(second).digest('hex'));
    assert.equal(hash, '6b38e652c71d4b04d6446cf6ae06104a0ff90fd5fd45c6e431b81a99dd97854f');
  });
});

describe('limits and modes', () => {
  test('P2P warns only above ₹1,00,000 and still builds', () => {
    const atCap = buildUpiLink({ pa: 'friend@okbank', pn: 'Friend', am: '100000.00' });
    assert.equal(atCap.valid, true);
    assert.equal(atCap.limits.exceedsPerTransaction, false);
    assert.equal(atCap.limits.perTransactionPaise, '10000000');
    assert.equal(atCap.warnings.some((warning) => warning.includes('P2P per-transaction cap')), false);

    const over = buildUpiLink({ pa: 'friend@okbank', pn: 'Friend', am: '100000.01' });
    assert.equal(over.valid, true);
    assert.equal(over.limits.exceedsPerTransaction, true);
    assert.ok(over.warnings.some((warning) => warning.includes('P2P per-transaction cap')));
    assert.equal(over.link.includes('am=100000.01'), true);
  });

  test('jewellery uses ₹2,00,000 from 15 Sep 2025 and ₹1,00,000 the day before', () => {
    const fields = { pa: 'shop@okbank', pn: 'Jewel', mc: '5944', tr: 'B1', am: '150000.00' };
    const before = buildUpiLink({ ...fields, onDate: '2025-09-14' });
    const onDay = buildUpiLink({ ...fields, onDate: '2025-09-15' });
    assert.equal(before.valid, true);
    assert.equal(before.limits.exceedsPerTransaction, true);
    assert.equal(before.limits.perTransactionPaise, '10000000');
    assert.equal(onDay.valid, true);
    assert.equal(onDay.limits.name, 'Jewellery');
    assert.equal(onDay.limits.exceedsPerTransaction, false);
    assert.equal(onDay.limits.perDayPaise, '60000000');

    const above = buildUpiLink({ ...fields, am: '200000.01', onDate: '2025-09-15' });
    assert.equal(above.valid, true);
    assert.equal(above.limits.exceedsPerTransaction, true);
    assert.ok(above.warnings.some((warning) => warning.includes('Jewellery')));
  });

  test('a purpose-qualified MCC stays on the P2M default', () => {
    const built = buildUpiLink({
      pa: 'fx@okbank',
      pn: 'FX Desk',
      mc: '6012',
      tr: 'FX1',
      am: '100000.01',
      onDate: '2025-09-15',
    });
    assert.equal(built.valid, true);
    assert.equal(built.limits.name, 'P2M');
    assert.equal(built.limits.exceedsPerTransaction, true);
    assert.ok(built.warnings.some((warning) => warning.includes('purpose BF')));
  });

  test('merchant and dynamic links require tr, and dynamic links require am', () => {
    const merchant = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', mc: '5413' });
    assert.equal(merchant.valid, false);
    assert.ok(merchant.errors.some((error) => error.includes('tr is required')));

    const dynamic = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', dynamic: true, tr: 'T1' });
    assert.equal(dynamic.valid, false);
    assert.ok(dynamic.errors.some((error) => error.includes('am is required')));

    const ok = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', mc: '4722', tr: 'T1', am: '10', mode: '01' });
    assert.equal(ok.valid, true);
    assert.equal(ok.params.mode, '01');
    assert.equal(ok.channel, 'p2m');
    assert.equal(ok.amountEditable, false);
  });

  test('mode 00 is the default, 03 is rejected, and 16 warns', () => {
    const omitted = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop' });
    assert.equal(omitted.params.mode, '00');
    assert.equal(omitted.amountEditable, true);
    assert.equal(omitted.limits, null);

    const bad = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', mode: '03' });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.some((error) => error.includes('mode')));

    const future = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', mode: '16' });
    assert.equal(future.valid, true);
    assert.ok(future.warnings.some((warning) => warning.includes('future use')));
  });
});

describe('parsing and edge cases', () => {
  test('a literal @ is accepted and a plus is not a space', () => {
    const parsed = parseUpiLink('upi://pay?pa=shop@okbank&pn=Shiv+Co&cu=inr&mode=01');
    assert.equal(parsed.valid, true);
    assert.equal(parsed.params.pa, 'shop@okbank');
    assert.equal(parsed.params.pn, 'Shiv+Co');
    assert.equal(parsed.params.cu, 'INR');
    assert.equal(parsed.link.includes('pa=shop%40okbank'), true);
    assert.ok(parsed.warnings.some((warning) => warning.includes('plus')));
    assert.ok(parsed.warnings.some((warning) => warning.includes('uppercased')));
  });

  test('omitted cu and mode are filled and reported', () => {
    const parsed = parseUpiLink('upi://pay?pn=Shop&pa=shop@okbank');
    assert.equal(parsed.valid, true);
    assert.equal(parsed.params.cu, 'INR');
    assert.equal(parsed.params.mode, '00');
    assert.ok(parsed.warnings.some((warning) => warning.includes('cu was omitted')));
    assert.ok(parsed.warnings.some((warning) => warning.includes('mode was omitted')));
  });

  test('sign and orgid are not verified, and purpose is rejected', () => {
    const signed = parseUpiLink('upi://pay?pa=shop@okbank&pn=Shop&cu=INR&mode=00&orgid=000000&sign=abc');
    assert.equal(signed.valid, true);
    assert.equal(signed.signed, true);
    assert.equal(signed.link.includes('sign='), false);
    assert.equal(signed.link.includes('orgid='), false);
    assert.ok(signed.warnings.some((warning) => warning.includes('sign is present')));

    const purpose = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', purpose: '00' });
    assert.equal(purpose.valid, false);
    assert.ok(purpose.errors.some((error) => error.includes('purpose')));

    const sign = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', sign: 'abc' });
    assert.equal(sign.valid, false);
    assert.ok(sign.errors.some((error) => error.includes('out of scope')));
  });

  test('amount edges, url, mam, and VPA shape', () => {
    assert.equal(buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', am: '0' }).valid, false);
    assert.equal(buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', am: '-1.00' }).valid, false);
    assert.equal(buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', am: '1e5' }).valid, false);
    assert.equal(buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', am: '1,000.50' }).params.am, '1000.50');

    const mam = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', am: '10', mam: '15' });
    assert.equal(mam.valid, false);
    assert.ok(mam.errors.some((error) => error.includes('mam')));

    const editable = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', mam: '5' });
    assert.equal(editable.valid, true);
    assert.equal(editable.amountEditable, true);
    assert.equal(editable.params.mam, '5.00');

    const url = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', url: 'ftp://example.com/x' });
    assert.equal(url.valid, false);
    const https = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop', url: 'https://example.com/a?x=1' });
    assert.equal(https.valid, true);
    assert.equal(parseUpiLink(https.link).params.url, 'https://example.com/a?x=1');

    assert.equal(buildUpiLink({ pa: 'a@ab', pn: 'A' }).valid, false);
    assert.equal(buildUpiLink({ pa: 'ab@cd', pn: 'A' }).valid, true);
    assert.equal(buildUpiLink({ pa: 'ab@1cd', pn: 'A' }).valid, false);
  });

  test('hidden characters, whitespace, and the 10 KB cap', () => {
    const zw = buildUpiLink({ pa: 'shop@okbank', pn: 'Shop\u200B' });
    assert.equal(zw.valid, false);
    assert.ok(zw.errors.some((error) => error.includes('Zero-width') || error.includes('control')));

    const trimmed = parseUpiLink('  upi://pay?pa=shop@okbank&pn=Shop  ');
    assert.equal(trimmed.valid, true);
    const space = parseUpiLink('upi://pay?pa=shop @okbank&pn=Shop');
    assert.equal(space.valid, false);
    assert.ok(space.errors.some((error) => error.includes('whitespace')));

    const huge = buildUpiLink({ pa: 'shop@okbank', pn: 'A'.repeat(10241) });
    assert.equal(huge.valid, false);
    assert.ok(huge.errors.some((error) => error.includes('10 KB')));
  });

  test('person mc 0000 is P2P and does not require tr', () => {
    const built = buildUpiLink({ pa: 'friend@okbank', pn: 'Friend', mc: '0000', am: '10' });
    assert.equal(built.valid, true);
    assert.equal(built.channel, 'p2p');
  });
});

describe('decoder covers numeric, alphanumeric, and a long byte symbol', () => {
  test('module matrices decode to the encoded text', () => {
    const samples = ['42', 'HELLO WORLD', `${'upi://pay?pa=shop%40okbank&pn='}${'N'.repeat(240)}`];
    for (const text of samples) {
      const { modules, version } = matrix(text);
      if (text.length > 200) assert.ok(version >= 7, `version ${version}`);
      assert.equal(decodeQrModules(modules), text);
    }
  });
});

describe('shipped copy and evals', () => {
  test('skill copies match the repo sources', () => {
    for (const name of ['disclaimer.mjs', 'money.mjs', 'rules.mjs', 'vendor/qrcodegen.mjs']) {
      assert.equal(
        readFileSync(join(repoRoot, 'lib', name), 'utf8'),
        readFileSync(join(skillRoot, 'scripts', '_lib', name), 'utf8'),
      );
    }
    assert.equal(
      readFileSync(join(repoRoot, 'rules', 'upi.json'), 'utf8'),
      readFileSync(join(skillRoot, 'scripts', '_rules', 'upi.json'), 'utf8'),
    );
  });

  test('evals.json expectations match the script', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'upi-payment-links', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'upi-payment-links');
    for (const item of evals.evals) {
      const result = item.expect.op === 'qr'
        ? run('upi-link.mjs', ['--json', JSON.stringify(item.expect.input)]).json
        : buildUpiLink(item.expect.input);
      assert.equal(result.valid, item.expect.valid, item.id);
      if (item.expect.confirm !== undefined) assert.equal(result.confirm, item.expect.confirm, item.id);
      if (item.expect.channel) assert.equal(result.channel, item.expect.channel, item.id);
      if (item.expect.amountPaise) assert.equal(result.amountPaise, item.expect.amountPaise, item.id);
      if (item.expect.ecc) assert.equal(result.qr.ecc, item.expect.ecc, item.id);
      for (const key of ['pa', 'pn', 'am', 'cu']) {
        if (item.expect[key] !== undefined) assert.equal(result.params[key], item.expect[key], item.id);
      }
      if (item.expect.linkIncludes) assert.equal(result.link.includes(item.expect.linkIncludes), true, item.id);
      if (item.expect.errorIncludes) {
        assert.ok(result.errors.some((error) => error.includes(item.expect.errorIncludes)), item.id);
      }
      if (item.expect.warningIncludes) {
        assert.ok(result.warnings.some((warning) => warning.includes(item.expect.warningIncludes)), item.id);
      }
      if (item.expect.op === 'qr' && result.valid) assert.equal(decodeQrSvg(result.qr.svg), result.link, item.id);
    }
  });
});

describe('CLI', () => {
  test('valid, invalid, and usage exit codes', () => {
    const valid = run('upi-link.mjs', ['--json', '{"pa":"shop@okbank","pn":"Shop","am":"10"}']);
    assert.equal(valid.status, 0);
    assert.equal(valid.json.valid, true);
    assert.equal(valid.json.params.am, '10.00');

    const invalid = run('upi-link.mjs', ['--json', '{"pn":"Shop"}']);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.json.valid, false);

    const usage = run('upi-link.mjs', []);
    assert.equal(usage.status, 2);

    const number = run('upi-link.mjs', ['--json', '{"pa":"shop@okbank","pn":"Shop","am":10}']);
    assert.equal(number.status, 1);
    assert.ok(number.json.errors.some((error) => error.includes('string')));
  });
});

function matrix(text) {
  const segments = qrcodegen.QrSegment.makeSegments(text);
  const qr = qrcodegen.QrCode.encodeSegments(segments, qrcodegen.QrCode.Ecc.MEDIUM, 1, 40, -1, false);
  const modules = [];
  for (let y = 0; y < qr.size; y += 1) {
    const row = [];
    for (let x = 0; x < qr.size; x += 1) row.push(qr.getModule(x, y));
    modules.push(row);
  }
  return { modules, version: qr.version };
}

function run(script, args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', script), ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  let json = null;
  if (result.stdout) json = JSON.parse(result.stdout);
  return { ...result, json };
}
