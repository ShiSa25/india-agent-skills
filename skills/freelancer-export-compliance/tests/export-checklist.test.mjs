import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addMonths } from '../scripts/_lib/fy.mjs';
import { CONFIRM_SENTENCE } from '../scripts/_lib/disclaimer.mjs';
import { exportChecklist } from '../scripts/export-checklist.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');

function invoice(overrides = {}) {
  return exportChecklist({
    invoiceDate: '2026-10-15',
    currency: 'USD',
    clientCountry: 'US',
    supplierInIndia: true,
    recipientOutsideIndia: true,
    placeOfSupplyOutsideIndia: true,
    ownBranch: false,
    intermediary: false,
    forexReceived: true,
    ...overrides,
  });
}

describe('SPEC dates, with the RBI periods that were opened', () => {
  test('15 Mar 2026 is FY 2025-26, one year later, and 15 FEMA months', () => {
    const result = invoice({ invoiceDate: '2026-03-15', lutFiledFY: '2025-26' });
    assert.equal(result.valid, true);
    assert.equal(result.isExport, true);
    assert.equal(result.fy, '2025-26');
    assert.equal(result.lutRequired, false);
    assert.equal(result.gstRealisationDeadline, '2027-03-15');
    assert.equal(result.femaMonths, 15);
    assert.equal(result.femaRealisationDeadline, '2027-06-15');
    assert.equal(result.rule96aReceiptDeadline, '2027-06-15');
    assert.equal(result.rule96aTaxPaymentDeadline, '2027-06-30');
    assert.equal(result.confirm, true);
    assert.ok(result.warnings.includes(CONFIRM_SENTENCE));
    assert.match(result.disclaimer, /2026-11-01/);
    assert.match(result.disclaimer, /not tax, legal or financial advice/);
  });

  test('10 Jan 2026 is 15 FEMA months, deadline 2027-04-10', () => {
    const result = invoice({ invoiceDate: '2026-01-10', forexReceived: true });
    assert.equal(result.femaMonths, 15);
    assert.equal(result.femaRealisationDeadline, '2027-04-10');
    assert.equal(result.gstRealisationDeadline, '2027-01-10');
    assert.equal(result.rule96aReceiptDeadline, '2027-04-10');
    assert.equal(result.confirm, true);
  });

  test('31 Mar and 1 Apr are different financial years and different LUTs', () => {
    const march = invoice({ invoiceDate: '2026-03-31', lutFiledFY: '2025-2026' });
    const april = invoice({ invoiceDate: '2026-04-01', lutFiledFY: '2025-26' });
    const aprilCovered = invoice({ invoiceDate: '2026-04-01', lutFiledFY: '2026-27' });
    assert.equal(march.fy, '2025-26');
    assert.equal(march.lutRequired, false);
    assert.equal(march.lutFiledFY, '2025-26');
    assert.equal(april.fy, '2026-27');
    assert.equal(april.lutRequired, true);
    assert.equal(aprilCovered.lutRequired, false);
    assert.notEqual(march.fy, april.fy);
    assert.notEqual(march.femaRealisationDeadline, april.femaRealisationDeadline);
  });

  test('month-end clamping: 31 May plus 9 months, including a leap February', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2026-05-31', 9), '2027-02-28');
    const ordinary = invoice({ invoiceDate: '2024-05-31' });
    const leap = invoice({ invoiceDate: '2023-05-31' });
    assert.equal(ordinary.femaMonths, 9);
    assert.equal(ordinary.femaRealisationDeadline, '2025-02-28');
    assert.equal(leap.femaRealisationDeadline, '2024-02-29');
  });

  test('31 May 2026 is inside the 15-month window, so FEMA is not 9 months', () => {
    const result = invoice({ invoiceDate: '2026-05-31' });
    assert.equal(result.femaMonths, 15);
    assert.equal(result.femaRealisationDeadline, '2027-08-31');
    assert.equal(result.gstRealisationDeadline, '2027-05-31');
    assert.equal(result.rule96aReceiptDeadline, '2027-08-31');
  });
});

describe('the two clocks', () => {
  test('after 1 Oct 2026, FEMA is 9 months and Rule 96A uses the later one-year date', () => {
    const result = invoice({ invoiceDate: '2026-10-15', lutFiledFY: '2026-27' });
    assert.equal(result.femaMonths, 9);
    assert.equal(result.femaRealisationDeadline, '2027-07-15');
    assert.equal(result.gstRealisationDeadline, '2027-10-15');
    assert.equal(result.rule96aReceiptDeadline, '2027-10-15');
    assert.equal(result.rule96aTaxPaymentDeadline, '2027-10-30');
    assert.equal(result.lutRequired, false);
    const fema = result.items.find((item) => item.id === 'fema');
    const gst = result.items.find((item) => item.id === 'rule96a');
    assert.match(fema.text, /2027-07-15/);
    assert.match(gst.text, /2027-10-15/);
    assert.match(gst.text, /2027-07-15/);
  });

  test('a payment can miss FEMA and still be inside the Rule 96A year', () => {
    const lateFema = invoice({ invoiceDate: '2026-10-15', paymentReceivedDate: '2027-08-01' });
    assert.equal(lateFema.femaRealisationDeadline, '2027-07-15');
    assert.equal(lateFema.rule96aReceiptDeadline, '2027-10-15');
    assert.equal(lateFema.valid, false);
    assert.equal(lateFema.qualifies, true);
    const onFemaDay = invoice({ invoiceDate: '2026-10-15', paymentReceivedDate: '2027-07-15' });
    assert.equal(onFemaDay.valid, true);
    const onOneYearDay = invoice({ invoiceDate: '2026-10-15', paymentReceivedDate: '2027-10-15' });
    assert.equal(onOneYearDay.valid, false);
    assert.match(onOneYearDay.items.find((item) => item.id === 'payment-timing').text, /FEMA/);
    const duringFifteen = invoice({ invoiceDate: '2026-03-15', paymentReceivedDate: '2027-04-01' });
    assert.equal(duringFifteen.gstRealisationDeadline, '2027-03-15');
    assert.equal(duringFifteen.femaRealisationDeadline, '2027-06-15');
    assert.equal(duringFifteen.rule96aReceiptDeadline, '2027-06-15');
    assert.equal(duringFifteen.valid, true);
    const afterReceipt = invoice({ invoiceDate: '2026-03-15', paymentReceivedDate: '2027-06-16' });
    assert.equal(afterReceipt.valid, false);
  });

  test('paying IGST drops the Rule 96A bond clock and keeps FEMA', () => {
    const result = invoice({
      invoiceDate: '2026-03-15',
      withPaymentOfTax: true,
      paymentReceivedDate: '2027-05-01',
    });
    assert.equal(result.lutRequired, false);
    assert.equal(result.rule96aReceiptDeadline, null);
    assert.equal(result.femaRealisationDeadline, '2027-06-15');
    assert.equal(result.valid, true);
    const missedFema = invoice({
      invoiceDate: '2026-03-15',
      withPaymentOfTax: true,
      paymentReceivedDate: '2027-06-16',
    });
    assert.equal(missedFema.valid, false);
  });

  test('13 and 14 Nov 2025 show both the 9-month and 15-month deadlines', () => {
    const thirteenth = invoice({ invoiceDate: '2025-11-13' });
    const fourteenth = invoice({ invoiceDate: '2025-11-14' });
    assert.equal(thirteenth.femaMonths, 9);
    assert.equal(thirteenth.femaRealisationDeadline, '2026-08-13');
    assert.deepEqual(thirteenth.femaAlso, [
      {
        months: 15,
        deadline: '2027-02-13',
        instrument: 'gazette-day uncertainty around FEMA 23(R)/(7)/2025-RB',
      },
    ]);
    assert.equal(fourteenth.femaMonths, 15);
    assert.equal(fourteenth.femaRealisationDeadline, '2027-02-14');
    assert.equal(fourteenth.femaAlso[0].months, 9);
    assert.equal(fourteenth.femaAlso[0].deadline, '2026-08-14');
    assert.equal(thirteenth.confirm, true);
    assert.ok(thirteenth.confirmReasons.some((reason) => reason.includes('UNVERIFIED')));
  });

  test('from 1 Oct 2026 an INR invoice uses 12 months, and earlier INR uses the forex period', () => {
    const later = invoice({
      invoiceDate: '2026-11-01',
      currency: 'INR',
      inrPermittedByRbi: true,
    });
    assert.equal(later.isExport, true);
    assert.equal(later.femaMonths, 12);
    assert.equal(later.femaRealisationDeadline, '2027-11-01');
    assert.ok(later.warnings.includes('check whether RBI permits; may fail s.2(6)(iv)'));
    const earlier = invoice({ invoiceDate: '2026-06-01', currency: 'inr' });
    assert.equal(earlier.isExport, false);
    assert.equal(earlier.femaRealisationDeadline, null);
    assert.ok(earlier.warnings.includes('check whether RBI permits; may fail s.2(6)(iv)'));
    const permittedEarly = invoice({
      invoiceDate: '2026-06-01',
      currency: 'INR',
      inrPermittedByRbi: true,
    });
    assert.equal(permittedEarly.femaMonths, 15);
    assert.ok(permittedEarly.warnings.some((warning) => warning.includes('No separate INR realisation period')));
  });
});

describe('five export conditions, intermediary, branch, SEZ', () => {
  test('each s.2(6) no answer means it is not an export', () => {
    const nos = [
      { supplierInIndia: false },
      { recipientOutsideIndia: false },
      { placeOfSupplyOutsideIndia: false },
      { forexReceived: false },
      { ownBranch: true },
    ];
    for (const flip of nos) {
      const result = invoice({ invoiceDate: '2026-06-01', ...flip });
      assert.equal(result.isExport, false, JSON.stringify(flip));
      assert.equal(result.valid, false);
      assert.equal(result.lutRequired, false);
      assert.equal(result.femaRealisationDeadline, null);
    }
  });

  test('own foreign branch is not an export', () => {
    const result = invoice({ invoiceDate: '2026-06-01', ownBranch: true });
    const limb = result.items.find((item) => item.id === 's2-6-v');
    assert.equal(limb.status, 'fail');
    assert.match(limb.text, /not an export/);
  });

  test('intermediary place of supply flips on 30 Mar 2026', () => {
    const before = invoice({
      invoiceDate: '2026-03-29',
      intermediary: true,
      placeOfSupplyOutsideIndia: true,
    });
    assert.equal(before.isExport, false);
    assert.ok(before.warnings.includes('intermediary services may not qualify'));
    assert.equal(before.items.find((item) => item.id === 'intermediary').status, 'fail');
    assert.equal(before.items.find((item) => item.id === 's2-6-iii').status, 'fail');

    const onDay = invoice({
      invoiceDate: '2026-03-30',
      intermediary: true,
      placeOfSupplyOutsideIndia: true,
    });
    assert.equal(onDay.isExport, true);
    assert.ok(onDay.warnings.includes('intermediary services may not qualify'));
    assert.equal(onDay.items.find((item) => item.id === 'intermediary').status, 'info');
    assert.match(onDay.items.find((item) => item.id === 'intermediary').text, /s\.13\(2\)/);
  });

  test('India as the client country fails the outside-India limb unless it is an SEZ', () => {
    const local = invoice({ invoiceDate: '2026-06-01', clientCountry: 'India', recipientOutsideIndia: true });
    assert.equal(local.isExport, false);
    const sez = invoice({
      invoiceDate: '2026-06-01',
      clientCountry: 'IN',
      recipientOutsideIndia: false,
      placeOfSupplyOutsideIndia: false,
      sez: true,
      lutFiledFY: '2026-27',
    });
    assert.equal(sez.isExport, false);
    assert.equal(sez.qualifies, true);
    assert.equal(sez.valid, true);
    assert.equal(sez.lutRequired, false);
    assert.equal(sez.femaMonths, 15);
    assert.ok(sez.confirm);
    assert.ok(sez.items.some((item) => item.id === 'sez' && item.status === 'pass'));
  });

  test('a missing LUT does not stop the supply being an export', () => {
    const result = invoice({ invoiceDate: '2026-06-01' });
    assert.equal(result.isExport, true);
    assert.equal(result.valid, true);
    assert.equal(result.lutRequired, true);
    assert.match(result.items.find((item) => item.id === 'lut').text, /GST RFD-11/);
    assert.match(result.items.find((item) => item.id === 'ebrc').text, /e-BRC/);
    assert.match(result.items.find((item) => item.id === 'fira').text, /FIRA/);
  });
});

describe('usage and evals', () => {
  test('rejects a bad date, an unknown field, and a bad LUT year', () => {
    assert.throws(() => invoice({ invoiceDate: '2026-02-31' }), /invoiceDate/);
    assert.throws(() => invoice({ extra: true }), /Unknown field/);
    assert.throws(() => invoice({ lutFiledFY: '2025-27' }), /lutFiledFY/);
    assert.throws(() => invoice({ supplierInIndia: 'yes' }), /supplierInIndia/);
  });

  test('evals.json expectations match the script', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'freelancer-export-compliance', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'freelancer-export-compliance');
    for (const item of evals.evals) {
      const result = exportChecklist(item.expect.input);
      for (const [key, value] of Object.entries(item.expect)) {
        if (key === 'input') continue;
        assert.deepEqual(result[key], value, item.id);
      }
    }
  });

  test('synced copies match lib and rules', () => {
    for (const name of ['disclaimer.mjs', 'fy.mjs', 'rules.mjs']) {
      assert.equal(
        readFileSync(join(repoRoot, 'lib', name), 'utf8'),
        readFileSync(join(skillRoot, 'scripts', '_lib', name), 'utf8'),
      );
    }
    for (const name of ['gst.json', 'fema.json']) {
      assert.equal(
        readFileSync(join(repoRoot, 'rules', name), 'utf8'),
        readFileSync(join(skillRoot, 'scripts', '_rules', name), 'utf8'),
      );
    }
  });
});

describe('CLI', () => {
  test('exit 0, 1, and 2', () => {
    const good = run(['--json', JSON.stringify({
      invoiceDate: '2026-10-15',
      currency: 'USD',
      clientCountry: 'US',
      supplierInIndia: true,
      recipientOutsideIndia: true,
      placeOfSupplyOutsideIndia: true,
      ownBranch: false,
      intermediary: false,
      forexReceived: true,
    })]);
    assert.equal(good.status, 0);
    assert.equal(JSON.parse(good.stdout).fy, '2026-27');
    assert.equal(good.stderr, '');

    const branch = run(['--json', JSON.stringify({
      invoiceDate: '2026-10-15',
      currency: 'USD',
      clientCountry: 'US',
      supplierInIndia: true,
      recipientOutsideIndia: true,
      placeOfSupplyOutsideIndia: true,
      ownBranch: true,
      intermediary: false,
      forexReceived: true,
    })]);
    assert.equal(branch.status, 1);
    assert.equal(JSON.parse(branch.stdout).isExport, false);

    const usage = run([]);
    assert.equal(usage.status, 2);
    assert.equal(JSON.parse(usage.stdout).valid, false);

    const huge = run(['--json', `{"invoiceDate":"${'x'.repeat(11000)}"}`]);
    assert.equal(huge.status, 2);
    assert.match(JSON.parse(huge.stdout).errors[0], /10 KB/);

    const hidden = run(['--json', '{"invoiceDate":"2026-10-15\\u200b"}']);
    assert.equal(hidden.status, 2);
    assert.match(JSON.parse(hidden.stdout).errors[0], /zero-width|bidi/);

    const bidi = run(['--json', '{"clientCountry":"US\\u202e"}']);
    assert.equal(bidi.status, 2);
  });
});

function run(args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', 'export-checklist.mjs'), ...args], {
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined);
  return result;
}
