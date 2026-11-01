import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildInvoice } from '../../gst-invoice/scripts/build-invoice.mjs';
import { buildEinvoice, daysBetween, validateEinvoice } from '../scripts/einvoice.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');
const CONFIRM = 'Confirm with the official source before relying on this.';
const SUP = '29AABCC1234A1ZD';
const MH = '27AABCC1234A1ZH';

function party(gstin, stateCode, city, pin) {
  return { name: 'Sample Party', address: `1 Test Road, ${city}`, gstin, stateCode, pin, loc: city };
}

function invoice(overrides = {}) {
  return buildInvoice({
    supplier: party(SUP, '29', 'Bengaluru', '560001'),
    recipient: party(MH, '27', 'Mumbai', '400001'),
    invoiceNumber: 'INV/2026-27/0001',
    invoiceDate: '2026-04-15',
    placeOfSupply: '27',
    supplyType: 'domestic',
    reverseCharge: false,
    signature: 'Authorised signatory',
    priorNumbers: [],
    lines: [{ description: 'Consulting', hsn: '998313', quantity: '1', unit: 'NOS', taxable: '42000.00', rateBp: 1800, service: true }],
    ...overrides,
  });
}

describe('schema 1.1', () => {
  test('a minimal B2B payload is valid and is not submitted', () => {
    const built = buildEinvoice(invoice());
    assert.equal(built.valid, true);
    assert.equal(built.confirm, false);
    assert.equal(built.irpSubmitted, false);
    assert.equal(built.einvoice.Version, '1.1');
    assert.equal(built.einvoice.TranDtls.TaxSch, 'GST');
    assert.equal(built.einvoice.TranDtls.SupTyp, 'B2B');
    assert.equal(built.einvoice.TranDtls.RegRev, 'N');
    assert.equal(built.einvoice.DocDtls.Dt, '15/04/2026');
    assert.equal(built.einvoice.ValDtls.IgstVal, '7560.00');
    assert.equal(built.einvoice.ValDtls.TotInvVal, '49560.00');
    const checked = validateEinvoice(built.einvoice);
    assert.equal(checked.valid, true);
    assert.equal(checked.irpSubmitted, false);
    assert.match(checked.disclaimer, /2026-11-01/);
  });

  test('EXPWOP with a GSTIN buyer is an error and must be URP', () => {
    const foreign = {
      name: 'US Client',
      address: '1 Market Street',
      loc: 'San Francisco',
      country: 'United States',
      deliveryAddress: '1 Market Street, San Francisco',
    };
    const built = buildEinvoice(invoice({
      recipient: foreign,
      supplyType: 'export',
      supplyKind: 'services',
      lut: true,
      placeOfSupply: '96',
      invoiceNumber: 'EXP/2026-27/0001',
    }));
    assert.equal(built.valid, true);
    assert.equal(built.einvoice.TranDtls.SupTyp, 'EXPWOP');
    assert.equal(built.einvoice.BuyerDtls.Gstin, 'URP');
    assert.equal(built.einvoice.BuyerDtls.Pos, '96');
    assert.equal(built.einvoice.BuyerDtls.Stcd, '96');
    assert.equal(built.einvoice.BuyerDtls.Pin, '999999');
    assert.equal(built.einvoice.ValDtls.IgstVal, '0.00');
    assert.equal(built.confirm, true);
    assert.ok(built.warnings.includes(CONFIRM));
    const forged = structuredClone(built.einvoice);
    forged.BuyerDtls.Gstin = MH;
    const checked = validateEinvoice(forged);
    assert.equal(checked.valid, false);
    assert.ok(checked.errors.some((error) => error.path === 'BuyerDtls.Gstin' && error.msg.includes('URP')));
  });

  test('an ISO document date is rejected', () => {
    const built = buildEinvoice(invoice());
    const forged = structuredClone(built.einvoice);
    forged.DocDtls.Dt = '2026-04-01';
    const checked = validateEinvoice(forged);
    assert.equal(checked.valid, false);
    assert.ok(checked.errors.some((error) => error.path === 'DocDtls.Dt' && error.msg.includes('DD/MM/YYYY')));
  });

  test('version 1.00 is rejected', () => {
    const built = buildEinvoice(invoice());
    const forged = structuredClone(built.einvoice);
    forged.Version = '1.00';
    const checked = validateEinvoice(forged);
    assert.equal(checked.valid, false);
    assert.ok(checked.errors.some((error) => error.path === 'Version'));
  });

  test('item totals outside ₹1 are an error and ₹1 is only a warning', () => {
    const built = buildEinvoice(invoice());
    const mismatch = structuredClone(built.einvoice);
    mismatch.ValDtls.AssVal = '42002.00';
    mismatch.ValDtls.TotInvVal = '49562.00';
    const bad = validateEinvoice(mismatch);
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.some((error) => error.msg === 'Item totals mismatch.'));
    const tolerance = structuredClone(built.einvoice);
    tolerance.ValDtls.AssVal = '42001.00';
    tolerance.ValDtls.TotInvVal = '49561.00';
    const warned = validateEinvoice(tolerance);
    assert.equal(warned.valid, true);
    assert.ok(warned.warnings.some((warning) => warning.includes('rounding tolerance')));
    assert.equal(warned.errors.length, 0);
  });

  test('a credit note payload uses positive amounts and Typ CRN', () => {
    const note = invoice({
      documentType: 'credit-note',
      originalInvoiceNumber: 'INV/2026-27/0001',
      originalInvoiceDate: '2026-04-01',
      invoiceNumber: 'CRN/2026-27/0001',
      lines: [{ description: 'Return', hsn: '998313', quantity: '1', unit: 'NOS', taxable: '-1000.00', rateBp: 1800, service: true }],
    });
    const built = buildEinvoice(note);
    assert.equal(built.valid, true);
    assert.equal(built.einvoice.DocDtls.Typ, 'CRN');
    assert.equal(built.einvoice.ItemList[0].AssAmt, '1000.00');
    assert.equal(built.einvoice.ValDtls.IgstVal, '180.00');
    assert.equal(built.einvoice.RefDtls.PrecDocDtls[0].InvNo, 'INV/2026-27/0001');
    assert.equal(built.einvoice.RefDtls.PrecDocDtls[0].InvDt, '01/04/2026');
  });
});

describe('applicability', () => {
  test('day counts follow the 1 April 2025 advisory example', () => {
    assert.equal(daysBetween('2025-04-01', '2025-04-30'), 29);
    assert.equal(daysBetween('2025-04-01', '2025-05-01'), 30);
    assert.equal(daysBetween('2026-04-01', '2026-05-02'), 31);
  });

  test('31-day-old document with AATO 12 crore warns, and 29 days does not', () => {
    const old = invoice({ invoiceDate: '2026-04-01', invoiceNumber: 'INV/2026-27/0002' });
    const late = buildEinvoice({ ...old, aato: '120000000.00', asOf: '2026-05-02' });
    assert.equal(late.valid, true);
    assert.ok(late.warnings.includes('30-day IRP limit'));
    assert.equal(late.applicability.mandatory, true);
    const inside = buildEinvoice({ ...old, aato: '120000000.00', asOf: '2026-04-30' });
    assert.equal(inside.warnings.includes('30-day IRP limit'), false);
  });

  test('the advisory blocks 1 May for an invoice dated 1 April, at ₹10 crore and above', () => {
    const doc = invoice({ invoiceDate: '2025-04-01', invoiceNumber: 'INV/2025-26/0001' });
    const blocked = buildEinvoice({ ...doc, aato: '100000000.00', asOf: '2025-05-01' });
    assert.ok(blocked.warnings.includes('30-day IRP limit'));
    const below = buildEinvoice({ ...doc, aato: '99999999.99', asOf: '2025-05-01' });
    assert.equal(below.warnings.includes('30-day IRP limit'), false);
    const before = buildEinvoice({ ...doc, aato: '120000000.00', asOf: '2025-03-31' });
    assert.equal(before.warnings.includes('30-day IRP limit'), false);
  });

  test('AATO above ₹5 crore is mandatory from 1 Aug 2023 and ₹5 crore exactly is not', () => {
    const doc = invoice();
    assert.equal(buildEinvoice({ ...doc, aato: '50000000.00', asOf: '2026-04-20' }).applicability.mandatory, false);
    assert.equal(buildEinvoice({ ...doc, aato: '50000000.01', asOf: '2026-04-20' }).applicability.mandatory, true);
    const early = invoice({ invoiceDate: '2023-07-31', invoiceNumber: 'INV/2023-24/0001' });
    assert.equal(buildEinvoice({ ...early, aato: '120000000.00', asOf: '2023-07-31' }).applicability.mandatory, false);
  });

  test('exempt classes and IRN cancellation stay unverified', () => {
    const built = buildEinvoice({ ...invoice(), taxpayerClass: 'bank', asOf: '2026-04-20' });
    assert.equal(built.valid, true);
    assert.equal(built.confirm, true);
    assert.ok(built.warnings.some((warning) => warning.includes('may be exempt — confirm')));
    const cancel = validateEinvoice({ einvoice: buildEinvoice(invoice()).einvoice, cancel: true, irnAgeHours: 25, asOf: '2026-04-20' });
    assert.equal(cancel.valid, true);
    assert.equal(cancel.confirm, true);
    assert.ok(cancel.warnings.some((warning) => warning.includes('24 hours')));
  });
});

describe('evals and CLI', () => {
  test('evals.json expectations match the scripts', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'gst-e-invoice-json', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'gst-e-invoice-json');
    for (const item of evals.evals) {
      const built = item.expect.invoiceRequest
        ? buildEinvoice({ ...buildInvoice(item.expect.invoiceRequest), ...(item.expect.meta ?? {}) })
        : null;
      let result = built;
      if (item.expect.command === 'validate') {
        const einvoice = built ? structuredClone(built.einvoice) : item.expect.input;
        if (item.expect.set) {
          for (const [path, value] of Object.entries(item.expect.set)) {
            const parts = path.split('.');
            let cursor = einvoice;
            for (const part of parts.slice(0, -1)) cursor = cursor[part];
            cursor[parts.at(-1)] = value;
          }
        }
        result = validateEinvoice(item.expect.meta ? { einvoice, ...item.expect.meta } : einvoice);
      }
      assert.equal(result.valid, item.expect.valid, item.id);
      if (item.expect.confirm !== undefined) assert.equal(result.confirm, item.expect.confirm, item.id);
      if (item.expect.version) assert.equal(result.einvoice.Version, item.expect.version, item.id);
      if (item.expect.supTyp) assert.equal(result.einvoice.TranDtls.SupTyp, item.expect.supTyp, item.id);
      if (item.expect.warningIncludes) {
        assert.ok(result.warnings.some((warning) => warning.includes(item.expect.warningIncludes)), `${item.id} ${result.warnings}`);
      }
      if (item.expect.errorIncludes) {
        assert.ok(result.errors.some((error) => error.msg.includes(item.expect.errorIncludes)), item.id);
      }
    }
  });

  test('CLI exit codes and no portal call', () => {
    const built = buildEinvoice(invoice());
    const valid = run('validate-einvoice.mjs', ['--json', JSON.stringify(built.einvoice)]);
    assert.equal(valid.status, 0);
    assert.equal(JSON.parse(valid.stdout).valid, true);
    const forged = structuredClone(built.einvoice);
    forged.DocDtls.Dt = '2026-04-01';
    const invalid = run('validate-einvoice.mjs', ['--json', JSON.stringify(forged)]);
    assert.equal(invalid.status, 1);
    const usage = run('build-einvoice.mjs', []);
    assert.equal(usage.status, 2);
    assert.equal(JSON.parse(valid.stdout).irpSubmitted, false);
  });
});

function run(script, args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', script), ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return result;
}
