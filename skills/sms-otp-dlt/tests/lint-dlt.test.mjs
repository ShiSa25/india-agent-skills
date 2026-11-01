import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIRM_SENTENCE } from '../scripts/_lib/disclaimer.mjs';
import { lintDlt } from '../scripts/dlt.mjs';
import { buildOtpRequest, reviewOtp } from '../scripts/otp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');

function good(overrides = {}) {
  return {
    asOf: '2026-11-01',
    template: 'Your OTP is {#var#}. Do not share it. - Acme',
    message: 'Your OTP is 482913. Do not share it. - Acme',
    variables: ['482913'],
    header: 'ACMEIN-T',
    category: 'transactional',
    brandName: 'Acme',
    whitelist: [],
    chainRegistered: true,
    templateRegistered: true,
    sentAtIst: '16:30',
    ...overrides,
  };
}

function codes(result, bucket) {
  return result[bucket].map((item) => item.code);
}

describe('SPEC vectors', () => {
  test('a matching transactional template is valid', () => {
    const result = lintDlt(good());
    assert.equal(result.valid, true);
    assert.equal(result.confirm, true);
    assert.ok(result.warnings.some((warning) => warning.message === CONFIRM_SENTENCE));
    assert.match(result.disclaimer, /not tax, legal or financial advice/);
    assert.deepEqual(codes(result, 'errors'), []);
    assert.equal(result.warnings.some((warning) => warning.code === 'variable-last'), false);
    assert.equal(result.warnings.some((warning) => warning.code === 'variable-length'), false);
  });

  test('a URL that is not whitelisted is an error from 1 Oct 2024', () => {
    const input = good({
      template: 'Pay Acme at {#var#} today',
      message: 'Pay Acme at https://pay.example/x today',
      variables: ['https://pay.example/x'],
    });
    const blocked = lintDlt(input);
    assert.equal(blocked.valid, false);
    const error = blocked.errors.find((item) => item.code === 'url-not-whitelisted');
    assert.ok(error);
    assert.equal(error.source, 'trai');
    assert.match(error.message, /not in the whitelist/);

    const allowed = lintDlt({ ...input, whitelist: ['https://pay.example/x'] });
    assert.equal(allowed.valid, true);
    assert.equal(codes(allowed, 'errors').includes('url-not-whitelisted'), false);

    const early = lintDlt({ ...input, asOf: '2024-09-30' });
    assert.equal(early.errors.some((item) => item.code === 'url-not-whitelisted'), false);
    assert.equal(early.warnings.some((item) => item.code === 'url-not-whitelisted'), true);

    const onDay = lintDlt({ ...input, asOf: '2024-10-01' });
    assert.equal(onDay.errors.some((item) => item.code === 'url-not-whitelisted'), true);
  });

  test('{#var#} as the last word is an operator warning', () => {
    const result = lintDlt(good({
      template: 'Acme code is {#var#}',
      message: 'Acme code is 482913',
    }));
    assert.equal(result.valid, true);
    const warning = result.warnings.find((item) => item.code === 'variable-last');
    assert.ok(warning);
    assert.equal(warning.source, 'operator');
  });

  test('a 31-character variable warns and 30 does not', () => {
    const long = 'a'.repeat(31);
    const warned = lintDlt(good({
      template: 'Acme code {#var#} ends',
      message: `Acme code ${long} ends`,
      variables: [long],
    }));
    assert.equal(warned.valid, true);
    const warning = warned.warnings.find((item) => item.code === 'variable-length');
    assert.ok(warning);
    assert.equal(warning.source, 'operator');
    assert.match(warning.message, /31/);

    const ok = 'b'.repeat(30);
    const quiet = lintDlt(good({
      template: 'Acme code {#var#} ends',
      message: `Acme code ${ok} ends`,
      variables: [ok],
    }));
    assert.equal(quiet.warnings.some((item) => item.code === 'variable-length'), false);
  });

  test('promotional SMS at 22:00 IST warns about 10:00–21:00', () => {
    const night = lintDlt(good({
      template: 'Acme sale {#var#}. Reply STOP',
      message: 'Acme sale 10. Reply STOP',
      variables: ['10'],
      header: 'ACMEIN-P',
      category: 'promotional',
      sentAtIst: '22:00',
    }));
    assert.equal(night.valid, true);
    const warning = night.warnings.find((item) => item.code === 'promotional-hours');
    assert.ok(warning);
    assert.match(warning.message, /10:00/);
    assert.match(warning.message, /21:00/);
    assert.match(warning.message, /restricted/);
    assert.equal(night.confirm, true);

    const day = lintDlt(good({
      template: 'Acme sale {#var#}. Reply STOP',
      message: 'Acme sale 10. Reply STOP',
      variables: ['10'],
      header: 'ACMEIN-P',
      category: 'promotional',
      sentAtIst: '10:00',
    }));
    assert.equal(day.warnings.some((item) => item.code === 'promotional-hours'), false);

    const close = lintDlt(good({
      template: 'Acme sale {#var#}. Reply STOP',
      message: 'Acme sale 10. Reply STOP',
      variables: ['10'],
      header: 'ACMEIN-P',
      category: 'promotional',
      sentAtIst: '21:00',
    }));
    assert.equal(close.warnings.some((item) => item.code === 'promotional-hours'), true);

    const otpAtNight = lintDlt(good({ sentAtIst: '22:00' }));
    assert.equal(otpAtNight.warnings.some((item) => item.code === 'promotional-hours'), false);
  });
});

describe('headers, chains, and categories', () => {
  test('suffix, length, and the 13 April 2025 date', () => {
    const wrong = lintDlt(good({ header: 'ACMEIN-P' }));
    assert.equal(wrong.errors.some((item) => item.code === 'header-suffix'), true);

    const service = lintDlt(good({ header: 'ACME-S', category: 'service-explicit' }));
    assert.equal(service.valid, true);
    const implicit = lintDlt(good({ header: 'ACME-S', category: 'service-implicit' }));
    assert.equal(implicit.valid, true);
    const badService = lintDlt(good({ header: 'ACME-T', category: 'service-explicit' }));
    assert.equal(badService.errors.some((item) => item.code === 'header-suffix'), true);

    const government = lintDlt(good({ header: 'ACME-G', category: 'government' }));
    assert.equal(government.valid, true);

    const huge = lintDlt(good({ header: 'ABCDEFGHIJ-T' }));
    assert.equal(huge.errors.some((item) => item.code === 'header-length'), true);

    const before = lintDlt(good({ header: 'ACMEIN', asOf: '2025-04-12' }));
    assert.equal(before.errors.some((item) => item.code === 'header-suffix'), false);
    assert.equal(before.warnings.some((item) => item.code === 'header-suffix'), true);
    const onDay = lintDlt(good({ header: 'ACMEIN', asOf: '2025-04-13' }));
    assert.equal(onDay.errors.some((item) => item.code === 'header-suffix'), true);
  });

  test('unregistered PE-TM chain is rejected from 11 Dec 2024', () => {
    const rejected = lintDlt(good({ chainRegistered: false, asOf: '2024-12-11' }));
    assert.equal(rejected.errors.some((item) => item.code === 'chain-unregistered'), true);
    const before = lintDlt(good({ chainRegistered: false, asOf: '2024-12-10' }));
    assert.equal(before.errors.some((item) => item.code === 'chain-unregistered'), false);
    assert.equal(before.warnings.some((item) => item.code === 'chain-unregistered'), true);
  });

  test('template mismatch, three variables, brand, and a callback warning', () => {
    const mismatch = lintDlt(good({ message: 'Your OTP is 482914. Do not share it. - Acme' }));
    assert.equal(mismatch.errors.some((item) => item.code === 'template-mismatch'), true);

    const three = lintDlt(good({
      template: 'Acme {#var#} and {#var#} then {#var#} thanks',
      message: 'Acme a and b then c thanks',
      variables: ['a', 'b', 'c'],
    }));
    assert.equal(three.valid, true);
    assert.equal(three.warnings.some((item) => item.code === 'variable-count' && item.source === 'operator'), true);

    const two = lintDlt(good({
      template: 'Acme {#var#} and {#var#} thanks',
      message: 'Acme a and b thanks',
      variables: ['a', 'b'],
    }));
    assert.equal(two.warnings.some((item) => item.code === 'variable-count'), false);

    const brand = lintDlt(good({ template: 'Your OTP is {#var#}. Do not share it.', message: 'Your OTP is 482913. Do not share it.' }));
    assert.equal(brand.errors.some((item) => item.code === 'brand'), true);

    const callback = lintDlt(good({
      template: 'Call Acme on {#var#} today',
      message: 'Call Acme on 9800000000 today',
      variables: ['9800000000'],
    }));
    assert.equal(callback.errors.some((item) => item.code === 'callback-not-whitelisted'), false);
    assert.equal(callback.warnings.some((item) => item.code === 'callback-not-whitelisted'), true);
    const listed = lintDlt(good({
      template: 'Call Acme on {#var#} today',
      message: 'Call Acme on 9800000000 today',
      variables: ['9800000000'],
      callbackWhitelist: ['9800000000'],
    }));
    assert.equal(listed.warnings.some((item) => item.code === 'callback-not-whitelisted'), false);
  });

  test('a late transactional notice and a zero-width template', () => {
    const late = lintDlt(good({ minutesSinceTransaction: 31 }));
    assert.equal(late.warnings.some((item) => item.code === 'transactional-window'), true);
    const soon = lintDlt(good({ minutesSinceTransaction: 30 }));
    assert.equal(soon.warnings.some((item) => item.code === 'transactional-window'), false);

    const bidi = lintDlt(good({ template: `Acme {#var#}\u200B` }));
    assert.equal(bidi.valid, false);
    assert.ok(bidi.errors.some((item) => item.message.includes('bidi') || item.message.includes('Zero-width')));

    const long = lintDlt(good({ template: 'A'.repeat(10241) }));
    assert.equal(long.valid, false);
    assert.ok(long.errors.some((item) => item.message.includes('10 KB')));
  });
});

describe('MSG91 OTP request and review', () => {
  test('builds a v5 request and redacts the authkey', () => {
    const secret = 'super-secret-auth-key';
    const result = buildOtpRequest({
      asOf: '2026-11-01',
      templateId: 'tpl_otp_01',
      mobile: '91 9800000000',
      otpLength: 6,
      otpExpiryMinutes: 10,
      template: 'Your OTP is ##OTP##. - Acme',
      params: { Param1: 'Acme' },
      authkey: secret,
      otp: '482913',
    });
    assert.equal(result.valid, true);
    assert.equal(result.confirm, true);
    assert.equal(result.method, 'POST');
    assert.equal(result.url, 'https://control.msg91.com/api/v5/otp');
    assert.deepEqual(result.query, {
      template_id: 'tpl_otp_01',
      mobile: '919800000000',
      otp_length: '6',
      otp_expiry: '10',
    });
    assert.equal(result.headers.authkey, '<redacted>');
    assert.equal(result.body.Param1, 'Acme');
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(result).includes('482913'), false);
    assert.ok(result.warnings.some((warning) => warning.includes(CONFIRM_SENTENCE)));
    assert.match(result.disclaimer, /2026-11-01/);
  });

  test('rejects a national mobile, a missing OTP token, and a 3-digit length', () => {
    const national = buildOtpRequest({ asOf: '2026-11-01', templateId: 'tpl', mobile: '9800000000' });
    assert.equal(national.valid, false);
    assert.ok(national.errors.some((error) => error.includes('country code')));

    const token = buildOtpRequest({
      asOf: '2026-11-01',
      templateId: 'tpl',
      mobile: '919800000000',
      template: 'Your OTP is {#var#}',
    });
    assert.equal(token.valid, false);
    assert.ok(token.errors.some((error) => error.includes('##OTP##')));

    const short = buildOtpRequest({
      asOf: '2026-11-01',
      templateId: 'tpl',
      mobile: '919800000000',
      otpLength: 3,
    });
    assert.equal(short.valid, false);
  });

  test('reviews generation, logging, TTL, and attempt limits', () => {
    const ok = reviewOtp({
      asOf: '2026-11-01',
      code: `import { randomInt } from 'node:crypto';
const n = randomInt(0, 1000000);
const otp = String(n).padStart(6, '0');
const ttlMinutes = 10;
const maxAttempts = 5;
let attempts = 0;
if (attempts >= maxAttempts) throw new Error('locked');`,
    });
    assert.equal(ok.valid, true);
    assert.equal(ok.errors.length, 0);
    assert.ok(ok.warnings.includes(CONFIRM_SENTENCE));

    const bad = reviewOtp({
      asOf: '2026-11-01',
      code: `const otp = Math.random().toString().slice(2, 8);
console.log(otp);`,
    });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.some((error) => error.includes('randomInt')));
    assert.ok(bad.errors.some((error) => error.includes('never be logged')));

    const renamed = reviewOtp({
      asOf: '2026-11-01',
      code: 'console.log(theOtp);\nres.json({ otpCode });\nif (otp === stored) {}\n',
    });
    assert.equal(renamed.valid, false);
    assert.ok(renamed.errors.some((error) => error.includes('never be logged')));
    assert.ok(renamed.errors.some((error) => error.includes('response')));
    assert.ok(renamed.errors.some((error) => error.includes('timingSafeEqual')));

    const secret = 'say "hello" key-99';
    assert.throws(
      () => buildOtpRequest({
        asOf: '2026-11-01',
        templateId: 'tpl_otp_01',
        mobile: '919800000000',
        template: 'Your OTP is ##OTP##. - Acme',
        params: { Param1: secret },
        authkey: secret,
      }),
      /authkey/,
    );
  });
});

describe('evals and CLI', () => {
  test('evals.json expectations match the scripts', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'sms-otp-dlt', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'sms-otp-dlt');
    for (const item of evals.evals) {
      const result = item.expect.script === 'otp' ? buildOtpRequest(item.expect.input) : lintDlt(item.expect.input);
      if (item.expect.valid !== undefined) assert.equal(result.valid, item.expect.valid, item.id);
      if (item.expect.errorIncludes) {
        const blob = JSON.stringify(result.errors);
        assert.ok(blob.includes(item.expect.errorIncludes), item.id);
      }
      if (item.expect.warningIncludes) {
        const blob = JSON.stringify(result.warnings);
        assert.ok(blob.includes(item.expect.warningIncludes), item.id);
      }
      if (item.expect.query) assert.equal(result.query.otp_length, item.expect.query.otp_length, item.id);
    }
  });

  test('CLI exit codes', () => {
    const ok = run('lint-dlt.mjs', ['--json', JSON.stringify(good())]);
    assert.equal(ok.status, 0);
    const bad = run('lint-dlt.mjs', ['--json', JSON.stringify(good({
      template: 'Pay Acme at {#var#} today',
      message: 'Pay Acme at https://pay.example/x today',
      variables: ['https://pay.example/x'],
    }))]);
    assert.equal(bad.status, 1);
    const usage = run('lint-dlt.mjs', []);
    assert.equal(usage.status, 2);

    const otp = run('msg91-otp.mjs', ['--json', JSON.stringify({
      asOf: '2026-11-01',
      templateId: 'tpl_otp_01',
      mobile: '919800000000',
      otpLength: 6,
      otpExpiryMinutes: 10,
    })]);
    assert.equal(otp.status, 0);
    const body = JSON.parse(otp.stdout);
    assert.equal(body.query.otp_length, '6');
    assert.equal(body.headers.authkey, '<missing>');
  });
});

function run(script, args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', script), ...args], {
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  return result;
}
