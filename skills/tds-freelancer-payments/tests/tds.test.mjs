import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIRM_SENTENCE } from '../scripts/_lib/disclaimer.mjs';
import { tds } from '../scripts/tds.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');

function pay(overrides = {}) {
  return tds({
    paymentDate: '2026-06-01',
    payerType: 'other',
    payeeType: 'individual',
    category: 'professional',
    amountMinor: '0',
    ytdMinor: '0',
    panAvailable: true,
    ...overrides,
  });
}

describe('SPEC vectors', () => {
  test('professional YTD ₹40,000 plus ₹9,000 is under ₹50,000', () => {
    const result = pay({ amountMinor: '900000', ytdMinor: '4000000' });
    assert.equal(result.valid, true);
    assert.equal(result.thresholdHit, false);
    assert.equal(result.tdsMinor, '0');
    assert.equal(result.tds, '0.00');
    assert.equal(result.rateBp, 1000);
    assert.equal(result.section, '393(1) [Table Sl. No. 6(iii)]');
    assert.equal(result.oldSection, '194J');
    assert.equal(result.confirm, true);
    assert.ok(result.warnings.includes(CONFIRM_SENTENCE));
    assert.match(result.disclaimer, /2026-11-01/);
  });

  test('crossing ₹50,000 taxes the whole ₹51,000 at 10%', () => {
    const result = pay({ amountMinor: '1100000', ytdMinor: '4000000' });
    assert.equal(result.thresholdHit, true);
    assert.equal(result.taxableMinor, '5100000');
    assert.equal(result.rateBp, 1000);
    assert.equal(result.tdsMinor, '510000');
    assert.equal(result.tds, '5100.00');
    assert.equal(result.paymentCode, '1027');
    assert.ok(result.warnings.some((warning) => warning.includes('whole FY aggregate')));
  });

  test('₹50,000 exactly does not exceed the fee threshold', () => {
    const result = pay({ amountMinor: '1000000', ytdMinor: '4000000' });
    assert.equal(result.thresholdHit, false);
    assert.equal(result.tdsMinor, '0');
  });

  test('contractor ₹25,000 is under the single-sum threshold and ₹35,000 is 1%', () => {
    const under = pay({ category: 'contractor', amountMinor: '2500000', ytdMinor: '0' });
    const over = pay({ category: 'contractor', amountMinor: '3500000', ytdMinor: '0' });
    assert.equal(under.thresholdHit, false);
    assert.equal(under.tdsMinor, '0');
    assert.equal(over.thresholdHit, true);
    assert.equal(over.rateBp, 100);
    assert.equal(over.tdsMinor, '35000');
    assert.equal(over.tds, '350.00');
    assert.equal(over.section, '393(1) [Table Sl. No. 6(i)]');
    assert.equal(over.oldSection, '194C');
    assert.equal(over.paymentCode, '1023');
  });

  test('₹30,000 exactly and ₹1,00,000 aggregate exactly do not exceed', () => {
    const single = pay({ category: 'contractor', amountMinor: '3000000', ytdMinor: '0' });
    const aggregate = pay({ category: 'contractor', amountMinor: '3000000', ytdMinor: '7000000' });
    assert.equal(single.thresholdHit, false);
    assert.equal(aggregate.thresholdHit, false);
    assert.equal(aggregate.tdsMinor, '0');
  });

  test('no PAN on a ₹60,000 professional fee is 20%', () => {
    const result = pay({ amountMinor: '6000000', ytdMinor: '0', panAvailable: false });
    assert.equal(result.thresholdHit, true);
    assert.equal(result.rateBp, 2000);
    assert.equal(result.tdsMinor, '1200000');
    assert.equal(result.tds, '12000.00');
    assert.equal(result.paymentCode, '1027');
  });

  test('31 Mar 2026 uses the 1961 labels', () => {
    const result = pay({
      paymentDate: '2026-03-31',
      amountMinor: '6000000',
      ytdMinor: '0',
    });
    assert.equal(result.act, 'Income-tax Act, 1961');
    assert.equal(result.section, '194J');
    assert.equal(result.oldSection, '194J');
    assert.equal(result.paymentCode, null);
    assert.equal(result.rateBp, 1000);
    assert.equal(result.tds, '6000.00');
    assert.equal(result.confirm, true);
    assert.ok(result.warnings.some((warning) => warning.includes('206AB')));
  });
});

describe('rates, thresholds, and who deducts', () => {
  test('a single sum over ₹30,000 does not pull in earlier sums that stay under ₹1,00,000', () => {
    const result = pay({ category: 'contractor', amountMinor: '3500000', ytdMinor: '4000000' });
    assert.equal(result.taxableMinor, '3500000');
    assert.equal(result.tdsMinor, '35000');
  });

  test('once the contractor aggregate exceeds ₹1,00,000 the whole total is taxed', () => {
    const result = pay({ category: 'contractor', amountMinor: '3500000', ytdMinor: '8000000' });
    assert.equal(result.taxableMinor, '11500000');
    assert.equal(result.tds, '1150.00');
  });

  test('below the threshold, the crossing bill, and bills after it each tax a rupee once', () => {
    const below = pay({ amountMinor: '900000', ytdMinor: '4000000', ytdTaxedMinor: '0' });
    assert.equal(below.thresholdHit, false);
    assert.equal(below.tdsMinor, '0');
    assert.equal(below.taxableMinor, '0');

    const crossing = pay({ amountMinor: '1100000', ytdMinor: '4000000' });
    assert.equal(crossing.thresholdHit, true);
    assert.equal(crossing.taxableMinor, '5100000');
    assert.equal(crossing.tdsMinor, '510000');
    assert.equal(crossing.tds, '5100.00');

    const later = pay({
      paymentDate: '2026-07-01',
      amountMinor: '1000000',
      ytdMinor: '0',
      ytdTaxedMinor: '5100000',
    });
    assert.equal(later.thresholdHit, true);
    assert.equal(later.taxableMinor, '1000000');
    assert.equal(later.tdsMinor, '100000');
    assert.equal(later.tds, '1000.00');
    assert.equal(later.rateBp, 1000);

    const again = pay({
      paymentDate: '2026-08-01',
      amountMinor: '250000',
      ytdMinor: '0',
      ytdTaxedMinor: '6100000',
    });
    assert.equal(again.taxableMinor, '250000');
    assert.equal(again.tdsMinor, '25000');

    const taxed = BigInt(crossing.tdsMinor) + BigInt(later.tdsMinor) + BigInt(again.tdsMinor);
    assert.equal(taxed, ((5100000n + 1000000n + 250000n) * 1000n) / 10000n);
  });

  test('issue 17: the July bill is ₹1,000 and the contractor follow-up is ₹700', () => {
    const july = tds({
      paymentDate: '2026-07-01',
      payerType: 'other',
      payeeType: 'individual',
      category: 'professional',
      amountMinor: '1000000',
      ytdMinor: '0',
      ytdTaxedMinor: '5100000',
      panAvailable: true,
    });
    assert.equal(july.valid, true);
    assert.equal(july.thresholdHit, true);
    assert.equal(july.taxableMinor, '1000000');
    assert.equal(july.tdsMinor, '100000');
    assert.equal(july.tds, '1000.00');
    assert.notEqual(july.tdsMinor, '0');
    assert.notEqual(july.tdsMinor, '610000');

    const asRupees = pay({
      paymentDate: '2026-07-01',
      amountMinor: '10000.00',
      ytdMinor: '0.00',
      ytdTaxedMinor: '51000.00',
    });
    assert.equal(asRupees.tds, '1000.00');

    const noPan = pay({
      paymentDate: '2026-07-01',
      amountMinor: '1000000',
      ytdMinor: '0',
      ytdTaxedMinor: '5100000',
      panAvailable: false,
    });
    assert.equal(noPan.rateBp, 2000);
    assert.equal(noPan.taxableMinor, '1000000');
    assert.equal(noPan.tdsMinor, '200000');

    const oldAct = pay({
      paymentDate: '2026-03-31',
      amountMinor: '1000000',
      ytdMinor: '0',
      ytdTaxedMinor: '5100000',
    });
    assert.equal(oldAct.section, '194J');
    assert.equal(oldAct.tdsMinor, '100000');

    const stillExact = pay({ amountMinor: '1000000', ytdMinor: '0', ytdTaxedMinor: '4000000' });
    assert.equal(stillExact.thresholdHit, false);
    assert.equal(stillExact.tdsMinor, '0');

    const onePaiseOver = pay({ amountMinor: '1000001', ytdMinor: '0', ytdTaxedMinor: '4000000' });
    assert.equal(onePaiseOver.thresholdHit, true);
    assert.equal(onePaiseOver.taxableMinor, '1000001');
    assert.equal(onePaiseOver.tdsMinor, '100000');

    const contractor = pay({
      category: 'contractor',
      amountMinor: '3000000',
      ytdMinor: '4000000',
      ytdTaxedMinor: '3500000',
    });
    assert.equal(contractor.thresholdHit, true);
    assert.equal(contractor.taxableMinor, '7000000');
    assert.equal(contractor.rateBp, 100);
    assert.equal(contractor.tdsMinor, '70000');
    assert.equal(contractor.tds, '700.00');
    assert.notEqual(contractor.tdsMinor, '0');
    assert.notEqual(contractor.tdsMinor, '105000');
    assert.ok(contractor.warnings.some((warning) => warning.includes('untaxed FY total')));

    const afterContractor = pay({
      category: 'contractor',
      amountMinor: '1000000',
      ytdMinor: '0',
      ytdTaxedMinor: '10500000',
    });
    assert.equal(afterContractor.taxableMinor, '1000000');
    assert.equal(afterContractor.tdsMinor, '10000');
    assert.equal(afterContractor.tds, '100.00');

    const singleOnly = pay({
      category: 'contractor',
      amountMinor: '3500000',
      ytdMinor: '2000000',
      ytdTaxedMinor: '1000000',
    });
    assert.equal(singleOnly.taxableMinor, '3500000');
    assert.equal(singleOnly.tdsMinor, '35000');

    const director = pay({
      category: 'director',
      amountMinor: '100',
      ytdMinor: '0',
      ytdTaxedMinor: '5000000',
    });
    assert.equal(director.taxableMinor, '100');
    assert.equal(director.tdsMinor, '10');
    assert.ok(director.warnings.some((warning) => warning.includes('this payment only')));

    const residualLater = tds({
      paymentDate: '2026-06-01',
      payerType: 'individual',
      payeeType: 'individual',
      category: 'professional',
      amountMinor: '1000000',
      ytdMinor: '0',
      ytdTaxedMinor: '600000000',
      panAvailable: true,
      auditRequired: false,
    });
    assert.equal(residualLater.section, '393(1) [Table Sl. No. 6(ii)]');
    assert.equal(residualLater.taxableMinor, '1000000');
    assert.equal(residualLater.rateBp, 200);
    assert.equal(residualLater.tdsMinor, '20000');

    assert.throws(() => pay({ ytdTaxedMinor: '-1.00' }), /negative/);
  });

  test('a non-individual contractor is 2% and code 1024', () => {
    const result = pay({ category: 'contractor', payeeType: 'other', amountMinor: '3500000' });
    assert.equal(result.rateBp, 200);
    assert.equal(result.tds, '700.00');
    assert.equal(result.paymentCode, '1024');
    const huf = pay({ category: 'contractor', payeeType: 'huf', amountMinor: '3500000' });
    assert.equal(huf.rateBp, 100);
    assert.equal(huf.paymentCode, '1023');
  });

  test('technical services, call centres, and film royalty are 2%; other royalty is 10%', () => {
    for (const category of ['technical', 'call_centre', 'film_royalty']) {
      const result = pay({ category, amountMinor: '6000000' });
      assert.equal(result.rateBp, 200, category);
      assert.equal(result.tds, '1200.00');
      assert.equal(result.paymentCode, '1026');
      assert.equal(result.oldSection, '194J');
    }
    const royalty = pay({ category: 'royalty', amountMinor: '6000000' });
    assert.equal(royalty.rateBp, 1000);
    assert.equal(royalty.paymentCode, '1027');
  });

  test('director remuneration has no threshold and is not grossed up with earlier sums', () => {
    const result = pay({
      category: 'director',
      amountMinor: '1000000',
      ytdMinor: '10000000',
    });
    assert.equal(result.thresholdHit, true);
    assert.equal(result.taxableMinor, '1000000');
    assert.equal(result.tds, '1000.00');
    assert.equal(result.paymentCode, '1028');
    assert.equal(result.rateBp, 1000);
    const rupee = pay({ category: 'director', amountMinor: '100', ytdMinor: '0' });
    assert.equal(rupee.tdsMinor, '10');
    assert.equal(rupee.tds, '0.10');
  });

  test('an individual who is not on the main rows uses 2% on the whole amount above ₹50 lakh', () => {
    const under = tds({
      paymentDate: '2026-06-01',
      payerType: 'individual',
      payeeType: 'other',
      category: 'professional',
      amountMinor: '500000000',
      ytdMinor: '0',
      panAvailable: true,
      auditRequired: false,
    });
    assert.equal(under.thresholdHit, false);
    assert.equal(under.tdsMinor, '0');
    assert.equal(under.section, '393(1) [Table Sl. No. 6(ii)]');
    assert.equal(under.oldSection, '194M');
    assert.equal(under.paymentCode, null);
    const over = tds({
      paymentDate: '2026-06-01',
      payerType: 'huf',
      payeeType: 'individual',
      category: 'contractor',
      amountMinor: '600000000',
      ytdMinor: '0',
      panAvailable: true,
      auditRequired: false,
    });
    assert.equal(over.thresholdHit, true);
    assert.equal(over.taxableMinor, '600000000');
    assert.equal(over.rateBp, 200);
    assert.equal(over.tds, '120000.00');
    assert.notEqual(over.tds, '20000.00');
  });

  test('technical fees paid by an unaudited individual are outside serial 6(ii)', () => {
    const result = tds({
      paymentDate: '2026-06-01',
      payerType: 'individual',
      payeeType: 'individual',
      category: 'technical',
      amountMinor: '600000000',
      ytdMinor: '0',
      panAvailable: true,
      auditRequired: false,
    });
    assert.equal(result.valid, false);
    assert.equal(result.section, null);
    assert.equal(result.tdsMinor, '0');
    assert.ok(result.confirm);
  });

  test('no PAN raises a 1% contractor deduction to 20%, including on the 1961 path', () => {
    const current = pay({
      category: 'contractor',
      amountMinor: '3500000',
      panAvailable: false,
    });
    assert.equal(current.rateBp, 2000);
    assert.equal(current.tds, '7000.00');
    const old = pay({
      paymentDate: '2026-03-31',
      category: 'contractor',
      amountMinor: '3500000',
      panAvailable: false,
    });
    assert.equal(old.section, '194C');
    assert.equal(old.rateBp, 2000);
    assert.equal(old.tds, '7000.00');
    assert.equal(old.paymentCode, null);
  });

  test('1 Apr 2026 is the 2025 Act; 31 Mar 2025 is rejected', () => {
    const first = pay({ paymentDate: '2026-04-01', amountMinor: '6000000' });
    assert.equal(first.act, 'Income-tax Act, 2025');
    assert.equal(first.section, '393(1) [Table Sl. No. 6(iii)]');
    assert.throws(
      () => pay({ paymentDate: '2025-03-31', amountMinor: '6000000' }),
      /outside/,
    );
  });

  test('rupee strings are accepted and JSON numbers, exponents, and a missing audit flag are not', () => {
    const result = pay({ amountMinor: '11000.00', ytdMinor: '40000.00' });
    assert.equal(result.tds, '5100.00');
    assert.throws(() => pay({ amountMinor: 1100000 }), /string/);
    assert.throws(() => pay({ amountMinor: '1e5' }), /amountMinor/);
    assert.throws(
      () => tds({
        paymentDate: '2026-06-01',
        payerType: 'individual',
        payeeType: 'individual',
        category: 'professional',
        amountMinor: '100',
        ytdMinor: '0',
        panAvailable: true,
      }),
      /auditRequired/,
    );
    assert.throws(() => pay({ category: 'director', payerType: 'individual', auditRequired: true }), /director/);
    assert.throws(() => pay({ payerType: 'other', auditRequired: false }), /auditRequired false/);
  });
});

describe('evals, copies, and CLI', () => {
  test('evals.json expectations match the script', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'tds-freelancer-payments', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'tds-freelancer-payments');
    for (const item of evals.evals) {
      const result = tds(item.expect.input);
      for (const [key, value] of Object.entries(item.expect)) {
        if (key === 'input') continue;
        assert.deepEqual(result[key], value, `${item.id} ${key}`);
      }
    }
  });

  test('synced copies match lib and rules', () => {
    for (const name of ['disclaimer.mjs', 'fy.mjs', 'money.mjs', 'rules.mjs']) {
      assert.equal(
        readFileSync(join(repoRoot, 'lib', name), 'utf8'),
        readFileSync(join(skillRoot, 'scripts', '_lib', name), 'utf8'),
      );
    }
    assert.equal(
      readFileSync(join(repoRoot, 'rules', 'tds.json'), 'utf8'),
      readFileSync(join(skillRoot, 'scripts', '_rules', 'tds.json'), 'utf8'),
    );
  });

  test('exit codes, oversized input, and hidden characters', () => {
    const good = run(['--json', JSON.stringify({
      paymentDate: '2026-06-01',
      payerType: 'other',
      payeeType: 'individual',
      category: 'professional',
      amountMinor: '1100000',
      ytdMinor: '4000000',
      panAvailable: true,
    })]);
    assert.equal(good.status, 0);
    assert.equal(JSON.parse(good.stdout).tds, '5100.00');
    assert.equal(good.stderr, '');

    const july = run(['--json', '{"paymentDate":"2026-07-01","payerType":"other","payeeType":"individual","category":"professional","amountMinor":"1000000","ytdMinor":"0","ytdTaxedMinor":"5100000","panAvailable":true}']);
    assert.equal(july.status, 0);
    assert.equal(JSON.parse(july.stdout).tdsMinor, '100000');
    assert.equal(JSON.parse(july.stdout).tds, '1000.00');
    assert.equal(JSON.parse(july.stdout).taxableMinor, '1000000');

    const uncovered = run(['--json', JSON.stringify({
      paymentDate: '2026-06-01',
      payerType: 'individual',
      payeeType: 'individual',
      category: 'technical',
      amountMinor: '100',
      ytdMinor: '0',
      panAvailable: true,
      auditRequired: false,
    })]);
    assert.equal(uncovered.status, 1);

    const usage = run([]);
    assert.equal(usage.status, 2);

    const huge = run(['--json', `{"paymentDate":"${'y'.repeat(11000)}"}`]);
    assert.equal(huge.status, 2);
    assert.match(JSON.parse(huge.stdout).errors[0], /10 KB/);

    const hidden = run(['--json', `{"paymentDate":"2026-06-01\\u200b","payerType":"other","payeeType":"individual","category":"professional","amountMinor":"1","ytdMinor":"0","panAvailable":true}`]);
    assert.equal(hidden.status, 2);
  });
});

function run(args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', 'tds.mjs'), ...args], {
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  return result;
}
