import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseAmount } from '../scripts/_lib/money.mjs';
import { buildInvoice, roundPayableToRupee, taxSplit } from '../scripts/build-invoice.mjs';
import { toWords } from '../scripts/words.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(here, '..');
const repoRoot = join(here, '..', '..', '..');
const CONFIRM = 'Confirm with the official source before relying on this.';
const LUT = 'SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX';
const PAY = 'SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS ON PAYMENT OF INTEGRATED TAX';
const SUP = '29AABCC1234A1ZD';
const MH = '27AABCC1234A1ZH';
const KA2 = '29AABCC1234A2ZC';
const CH = '04AABCC1234A1ZP';

function party(gstin, stateCode, city, pin) {
  return { name: 'Sample Party', address: `1 Test Road, ${city}`, gstin, stateCode, pin, loc: city };
}

function invoice(overrides = {}, line = {}) {
  const input = {
    supplier: party(SUP, '29', 'Bengaluru', '560001'),
    recipient: party(MH, '27', 'Mumbai', '400001'),
    invoiceNumber: 'INV/2026-27/0001',
    invoiceDate: '2026-04-15',
    placeOfSupply: '27',
    supplyType: 'domestic',
    reverseCharge: false,
    signature: 'Authorised signatory',
    priorNumbers: [],
    lines: [
      {
        description: 'Consulting',
        hsn: '998313',
        quantity: '1',
        unit: 'NOS',
        taxable: '42000.00',
        rateBp: 1800,
        service: true,
        ...line,
      },
    ],
    ...overrides,
  };
  return buildInvoice(input);
}

describe('taxSplit vectors', () => {
  test('1800 bp on ₹42,000 inter-state and intra-state', () => {
    const inter = taxSplit({
      supplierState: '29',
      placeOfSupply: '27',
      taxableMinor: 4200000n,
      rateBp: 1800,
      supplyType: 'domestic',
    });
    assert.equal(inter.igst, 756000n);
    assert.equal(inter.cgst, 0n);
    assert.equal(inter.sgst, 0n);
    assert.equal(inter.cess, 0n);
    const intra = taxSplit({
      supplierState: '29',
      placeOfSupply: '29',
      taxableMinor: 4200000n,
      rateBp: 1800,
      supplyType: 'domestic',
    });
    assert.equal(intra.cgst, 378000n);
    assert.equal(intra.sgst, 378000n);
    assert.equal(intra.igst, 0n);
    assert.equal(intra.cess, 0n);
    assert.equal(intra.localTax, 'SGST');
  });

  test('half-up paise and a negative credit note', () => {
    assert.equal(taxSplit({ supplierState: '29', placeOfSupply: '27', taxableMinor: 3n, rateBp: 1800, supplyType: 'domestic' }).igst, 1n);
    assert.equal(taxSplit({ supplierState: '29', placeOfSupply: '27', taxableMinor: 2n, rateBp: 1800, supplyType: 'domestic' }).igst, 0n);
    assert.equal(taxSplit({ supplierState: '29', placeOfSupply: '27', taxableMinor: -100000n, rateBp: 1800, supplyType: 'domestic' }).igst, -18000n);
    const intra = taxSplit({ supplierState: '29', placeOfSupply: '29', taxableMinor: -100000n, rateBp: 1800, supplyType: 'domestic' });
    assert.equal(intra.cgst + intra.sgst, -18000n);
  });

  test('SEZ in the same state is IGST, including under LUT', () => {
    const paid = taxSplit({ supplierState: '29', placeOfSupply: '29', taxableMinor: 4200000n, rateBp: 1800, supplyType: 'sez', lut: false });
    assert.equal(paid.igst, 756000n);
    assert.equal(paid.cgst, 0n);
    assert.equal(paid.igstOnIntra, true);
    const lut = taxSplit({ supplierState: '29', placeOfSupply: '29', taxableMinor: 4200000n, rateBp: 1800, supplyType: 'sez', lut: true });
    assert.equal(lut.igst, 0n);
    assert.equal(lut.igstOnIntra, true);
  });

  test('an odd rate rounds each head', () => {
    const intra = taxSplit({ supplierState: '29', placeOfSupply: '29', taxableMinor: 10000n, rateBp: 25, supplyType: 'domestic' });
    assert.equal(intra.cgst, 13n);
    assert.equal(intra.sgst, 13n);
    assert.equal(taxSplit({ supplierState: '29', placeOfSupply: '27', taxableMinor: 10000n, rateBp: 25, supplyType: 'domestic' }).igst, 25n);
  });

  test('Chandigarh intra-state is labelled UTGST and confirms', () => {
    const split = taxSplit({ supplierState: '04', placeOfSupply: '04', taxableMinor: 10000n, rateBp: 1800, supplyType: 'domestic' });
    assert.equal(split.localTax, 'UTGST');
    assert.equal(split.utgst, 900n);
    assert.equal(split.sgst, 0n);
    assert.equal(split.confirm, true);
  });
});

describe('Rule 46 invoice', () => {
  test('inter-state ₹42,000 at 18% and the 16-character number', () => {
    const result = invoice();
    assert.equal(result.valid, true);
    assert.equal(result.confirm, false);
    assert.equal(result.invoice.fy, '2026-27');
    assert.equal(result.invoice.invoiceNumber.length, 16);
    assert.equal(result.invoice.totals.igst, '7560.00');
    assert.equal(result.invoice.totals.cgst, '0.00');
    assert.equal(result.invoice.amountInWords, 'Rupees Forty-Nine Thousand Five Hundred Sixty Only');
    assert.equal(result.portalSubmitted, false);
    assert.match(result.disclaimer, /2026-11-01/);
    assert.equal(result.html.includes('Rs.'), false);
    assert.equal(result.html.includes('₹7,560.00'), true);
    assert.equal(result.html.includes('Not submitted to the GST portal'), true);
  });

  test('intra-state split is equal CGST and SGST', () => {
    const result = invoice({ recipient: party(KA2, '29', 'Bengaluru', '560001'), placeOfSupply: '29' });
    assert.equal(result.invoice.totals.cgst, '3780.00');
    assert.equal(result.invoice.totals.sgst, '3780.00');
    assert.equal(result.invoice.totals.igst, '0.00');
    assert.equal(result.invoice.interState, false);
  });

  test('17-character number, 0, and slashes fail', () => {
    const long = invoice({ invoiceNumber: 'INV/2026-27/00001' });
    assert.equal(long.valid, false);
    assert.ok(long.errors.some((error) => error.includes('longer than 16')));
    const zero = invoice({ invoiceNumber: '0' });
    assert.equal(zero.valid, false);
    assert.equal(zero.confirm, true);
    assert.ok(zero.warnings.includes(CONFIRM));
    const slash = invoice({ invoiceNumber: '//' });
    assert.equal(slash.valid, false);
    assert.equal(slash.confirm, true);
  });

  test('a leading zero warns and does not reject the number', () => {
    const result = invoice({ invoiceNumber: '01' });
    assert.equal(result.valid, true);
    assert.equal(result.confirm, true);
    assert.ok(result.warnings.some((warning) => warning.includes('starts with 0')));
  });

  test('duplicate number in the same FY is rejected', () => {
    const result = invoice({ priorNumbers: ['INV/2026-27/0001'] });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes('not unique')));
  });

  test('31 March and 1 April are different financial years', () => {
    assert.equal(invoice({ invoiceDate: '2026-03-31', invoiceNumber: 'INV/2025-26/0001' }).invoice.fy, '2025-26');
    assert.equal(invoice({ invoiceDate: '2026-04-01', invoiceNumber: 'INV/2026-27/0009' }).invoice.fy, '2026-27');
    const mismatch = invoice({ invoiceDate: '2026-03-31', financialYear: '2026-27' });
    assert.equal(mismatch.valid, false);
  });

  test('export under LUT and with payment use the Rule 46 sentences', () => {
    const foreign = {
      name: 'US Client',
      address: '1 Market Street',
      loc: 'San Francisco',
      country: 'United States',
      deliveryAddress: '1 Market Street, San Francisco',
    };
    const lut = invoice({
      recipient: foreign,
      supplyType: 'export',
      supplyKind: 'services',
      lut: true,
      placeOfSupply: '96',
    });
    assert.equal(lut.valid, true);
    assert.equal(lut.invoice.totals.igst, '0.00');
    assert.equal(lut.invoice.endorsement, LUT);
    assert.equal(lut.html.includes(LUT), true);
    assert.equal(lut.confirm, false);
    const paid = invoice({
      recipient: foreign,
      supplyType: 'export',
      supplyKind: 'services',
      lut: false,
      placeOfSupply: '96',
    });
    assert.equal(paid.invoice.totals.igst, '7560.00');
    assert.equal(paid.invoice.endorsement, PAY);
  });

  test('SEZ in the supplier state is IGST and carries the endorsement', () => {
    const result = invoice({
      recipient: party(KA2, '29', 'Bengaluru', '560001'),
      placeOfSupply: '29',
      supplyType: 'sez',
      lut: false,
    });
    assert.equal(result.invoice.totals.igst, '7560.00');
    assert.equal(result.invoice.totals.cgst, '0.00');
    assert.equal(result.invoice.igstOnIntra, true);
    assert.equal(result.invoice.endorsement, PAY);
  });

  test('services place of supply follows the registered recipient', () => {
    const result = buildInvoice({
      supplier: party(SUP, '29', 'Bengaluru', '560001'),
      recipient: party(MH, '27', 'Mumbai', '400001'),
      invoiceNumber: 'INV/2026-27/0008',
      invoiceDate: '2026-04-15',
      supplyType: 'domestic',
      supplyKind: 'services',
      reverseCharge: false,
      signature: 'Authorised signatory',
      priorNumbers: [],
      lines: [{ description: 'Advice', hsn: '998313', taxable: '100.00', rateBp: 1800, service: true }],
    });
    assert.equal(result.valid, true);
    assert.equal(result.invoice.placeOfSupply.code, '27');
    assert.equal(result.invoice.totals.igst, '18.00');
    assert.ok(result.warnings.some((warning) => warning.includes('section 12(2)')));
  });

  test('same-state services are CGST and SGST', () => {
    const result = buildInvoice({
      supplier: party(SUP, '29', 'Bengaluru', '560001'),
      recipient: party(KA2, '29', 'Bengaluru', '560001'),
      invoiceNumber: 'INV/2026-27/0007',
      invoiceDate: '2026-04-15',
      supplyType: 'domestic',
      supplyKind: 'services',
      reverseCharge: false,
      signature: 'Authorised signatory',
      priorNumbers: [],
      lines: [{ description: 'Advice', hsn: '998313', taxable: '100.00', rateBp: 1800 }],
    });
    assert.equal(result.invoice.totals.cgst, '9.00');
    assert.equal(result.invoice.totals.sgst, '9.00');
    assert.equal(result.invoice.totals.igst, '0.00');
  });

  test('goods need quantity and unit; a rate is not inferred from HSN', () => {
    const missing = invoice({}, { quantity: undefined, unit: undefined, service: false, hsn: '8471' });
    assert.equal(missing.valid, false);
    assert.ok(missing.errors.some((error) => error.includes('quantity')));
    const noRate = invoice({}, { rateBp: undefined, hsn: '8471', service: false });
    assert.equal(noRate.valid, false);
    assert.ok(noRate.errors.some((error) => error.includes('never inferred')));
  });

  test('a supplier with no usable state reports the supplier errors, not a crash', () => {
    const shortGstin = invoice({ supplier: party('29AABCC1234A1Z', undefined, 'Bengaluru', '560001') });
    assert.equal(shortGstin.valid, false);
    assert.ok(shortGstin.errors.some((error) => error.startsWith('supplier GSTIN: ')));
    assert.ok(shortGstin.errors.includes('supplier.stateCode is required.'));
    assert.equal(shortGstin.errors.some((error) => error.includes('Cannot read')), false);
    const noGstin = invoice({ supplier: { name: 'Sample Party', address: '1 Test Road, Bengaluru' } });
    assert.equal(noGstin.valid, false);
    assert.ok(noGstin.errors.includes('supplier.gstin is required.'));
    assert.ok(noGstin.errors.includes('supplier.stateCode is required.'));
    assert.equal(noGstin.errors.some((error) => error.includes('Cannot read')), false);
  });

  test('per-line rounding is not recomputed on the invoice sum', () => {
    const result = invoice({
      lines: [
        { description: 'A', hsn: '8471', quantity: '1', unit: 'NOS', taxable: '0.03', rateBp: 1800 },
        { description: 'B', hsn: '8471', quantity: '1', unit: 'NOS', taxable: '0.03', rateBp: 1800 },
      ],
    });
    assert.equal(result.invoice.lines[0].igst, '0.01');
    assert.equal(result.invoice.totals.igst, '0.02');
  });

  test('section 170 rounds each head, and roundOff rounds the grand total', () => {
    const inter = invoice({ roundOff: true }, { taxable: '25.00', service: false, hsn: '8471' });
    assert.equal(inter.invoice.totals.igst, '4.50');
    assert.equal(inter.invoice.totals.taxPayableRounded.igst, '5.00');
    assert.equal(inter.invoice.totals.roundOff, '0.50');
    assert.equal(inter.invoice.totals.grand, '30.00');
    const intra = invoice(
      { recipient: party(KA2, '29', 'Bengaluru', '560001'), placeOfSupply: '29' },
      { taxable: '25.00', service: false, hsn: '8471' },
    );
    assert.equal(intra.invoice.lines[0].cgst, '2.25');
    assert.equal(intra.invoice.lines[0].sgst, '2.25');
    assert.equal(intra.invoice.totals.taxPayableRounded.cgst, '2.00');
    assert.equal(intra.invoice.totals.taxPayableRounded.sgst, '2.00');
    assert.equal(roundPayableToRupee(50n), 100n);
    assert.equal(roundPayableToRupee(49n), 0n);
    assert.equal(roundPayableToRupee(-50n), -100n);
  });

  test('credit note tax is negative and needs the original invoice', () => {
    const note = invoice({
      documentType: 'credit-note',
      originalInvoiceNumber: 'INV/2026-27/0001',
      originalInvoiceDate: '2026-04-01',
      lines: [{ description: 'Return', hsn: '8471', quantity: '1', unit: 'NOS', taxable: '-1000.00', rateBp: 1800 }],
    });
    assert.equal(note.valid, true);
    assert.equal(note.invoice.totals.igst, '-180.00');
    assert.equal(note.invoice.amountInWords, 'Minus Rupees One Thousand One Hundred Eighty Only');
    const missing = invoice({ documentType: 'credit-note' });
    assert.equal(missing.valid, false);
  });

  test('UTGST label, unusual rate, and a legacy place of supply', () => {
    const ut = buildInvoice({
      supplier: party(CH, '04', 'Chandigarh', '160017'),
      recipient: party(CH, '04', 'Chandigarh', '160017'),
      invoiceNumber: 'UT/2026-27/0001',
      invoiceDate: '2026-04-15',
      placeOfSupply: '04',
      supplyType: 'domestic',
      reverseCharge: false,
      signature: 'Authorised signatory',
      priorNumbers: [],
      lines: [{ description: 'Goods', hsn: '8471', quantity: '1', unit: 'NOS', taxable: '100.00', rateBp: 1800 }],
    });
    assert.equal(ut.invoice.localTax, 'UTGST');
    assert.equal(ut.confirm, true);
    assert.equal(ut.html.includes('UTGST'), true);
    const unusual = invoice({}, { rateBp: 4000 });
    assert.equal(unusual.valid, true);
    assert.equal(unusual.confirm, true);
    assert.ok(unusual.warnings.some((warning) => warning.includes('UNVERIFIED')));
    const legacy = invoice({ placeOfSupply: '25' });
    assert.equal(legacy.valid, true);
    assert.ok(legacy.warnings.includes('legacy state code'));
  });

  test('required flags and hostile input', () => {
    const noSign = invoice({ signature: undefined });
    assert.equal(noSign.valid, false);
    const electronic = invoice({ signature: undefined, electronicInvoice: true });
    assert.equal(electronic.valid, true);
    assert.match(electronic.invoice.signature, /Information Technology Act/);
    const wide = invoice({ recipient: { ...party(MH, '27', 'Mumbai', '400001'), name: 'A\u200b' } });
    assert.equal(wide.valid, false);
    assert.ok(wide.errors.some((error) => error.includes('Zero-width') || error.includes('bidi')));
    const huge = invoice({ recipient: { ...party(MH, '27', 'Mumbai', '400001'), address: 'A'.repeat(20000) } });
    assert.equal(huge.valid, false);
    assert.ok(huge.errors.some((error) => error.includes('10 KB')));
  });
});

describe('amount in words', () => {
  test('SPEC examples', () => {
    assert.equal(toWords(0n), 'Rupees Zero Only');
    assert.equal(toWords(parseAmount('100000.00')), 'Rupees One Lakh Only');
    assert.equal(toWords(parseAmount('10000000.00')), 'Rupees One Crore Only');
    assert.equal(toWords(parseAmount('1000000000.00')), 'Rupees One Hundred Crore Only');
    assert.equal(
      toWords(parseAmount('123456789.50')),
      'Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine and Fifty Paise Only',
    );
    assert.equal(toWords(parseAmount('-0.50')), 'Minus Rupees Zero and Fifty Paise Only');
  });
});

describe('evals and CLI', () => {
  test('evals.json expectations match the script', () => {
    const evals = JSON.parse(readFileSync(join(repoRoot, 'evals', 'gst-invoice', 'evals.json'), 'utf8'));
    assert.equal(evals.skill, 'gst-invoice');
    for (const item of evals.evals) {
      const result = buildInvoice(item.expect.input);
      assert.equal(result.valid, item.expect.valid, item.id);
      if (item.expect.confirm !== undefined) assert.equal(result.confirm, item.expect.confirm, item.id);
      if (item.expect.igst) assert.equal(result.invoice.totals.igst, item.expect.igst, item.id);
      if (item.expect.cgst) assert.equal(result.invoice.totals.cgst, item.expect.cgst, item.id);
      if (item.expect.sgst) assert.equal(result.invoice.totals.sgst, item.expect.sgst, item.id);
      if (item.expect.fy) assert.equal(result.invoice.fy, item.expect.fy, item.id);
      if (item.expect.endorsement) assert.equal(result.invoice.endorsement, item.expect.endorsement, item.id);
      if (item.expect.amountInWords) assert.equal(result.invoice.amountInWords, item.expect.amountInWords, item.id);
      if (item.expect.errorIncludes) {
        assert.ok(result.errors.some((error) => error.includes(item.expect.errorIncludes)), item.id);
      }
      if (item.expect.warningIncludes) {
        assert.ok(result.warnings.some((warning) => warning.includes(item.expect.warningIncludes)), item.id);
      }
    }
  });

  test('CLI exit codes', () => {
    const payload = JSON.stringify({
      supplier: party(SUP, '29', 'Bengaluru', '560001'),
      recipient: party(MH, '27', 'Mumbai', '400001'),
      invoiceNumber: 'INV/2026-27/0001',
      invoiceDate: '2026-04-15',
      placeOfSupply: '27',
      reverseCharge: false,
      signature: 'Authorised signatory',
      priorNumbers: [],
      lines: [{ description: 'Consulting', hsn: '998313', quantity: '1', unit: 'NOS', taxable: '42000.00', rateBp: 1800, service: true }],
    });
    const valid = run(['--json', payload]);
    assert.equal(valid.status, 0);
    assert.equal(JSON.parse(valid.stdout).invoice.totals.igst, '7560.00');
    const invalid = run(['--json', JSON.stringify({ invoiceNumber: '0' })]);
    assert.equal(invalid.status, 1);
    const usage = run([]);
    assert.equal(usage.status, 2);
  });
});

function run(args) {
  const result = spawnSync(process.execPath, [join(skillRoot, 'scripts', 'build-invoice.mjs'), ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return result;
}
