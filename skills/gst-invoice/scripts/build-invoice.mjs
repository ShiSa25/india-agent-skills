#!/usr/bin/env node
/**
 * Build a GST tax invoice, credit note, or debit note.
 *   node scripts/build-invoice.mjs --json '{"invoiceNumber":"INV/2026-27/0001", ...}'
 * Exit 0 when the invoice is usable, 1 when it is not, 2 on a usage error.
 * Prints one JSON object. Does not call the GST portal.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CONFIRM_SENTENCE, disclaimer } from './_lib/disclaimer.mjs';
import { fyOf, parseIsoDate } from './_lib/fy.mjs';
import { validateGstin } from './_lib/gstin.mjs';
import { formatMinor, parseAmount, pct } from './_lib/money.mjs';
import { compileAnchored, loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';
import { toWords } from './words.mjs';

const LIMIT = 10 * 1024;
const CAVEAT = 'Checksum valid ≠ registered/active; check services.gst.gov.in/services/searchtp';
const ZERO_WIDTH = new Set([
  0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff,
]);

if (invokedDirectly()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) finish(2, failure('Usage: node scripts/build-invoice.mjs --json \'<invoice>\''));
    else {
      const result = buildInvoice(parsed.input);
      finish(result.valid ? 0 : 1, result);
    }
  } catch (error) {
    finish(2, failure(error.message));
  }
}

/**
 * CGST/SGST or UTGST, or IGST. Cess is always zero: this skill does not compute cess.
 * Export and SEZ under LUT charge no integrated tax. SEZ is always inter-state.
 * @param {{
 *   supplierState: string,
 *   placeOfSupply: string,
 *   taxableMinor: bigint,
 *   rateBp: number,
 *   supplyType: 'domestic'|'sez'|'export'|'deemed-export',
 *   lut?: boolean,
 *   onDate?: string,
 * }} input
 */
export function taxSplit(input) {
  const onDate = input.onDate ?? '2026-11-01';
  const pack = loadPack(onDate);
  const supplier = mustState(pack, input.supplierState, 'supplierState');
  const place = mustState(pack, input.placeOfSupply, 'placeOfSupply');
  if (typeof input.taxableMinor !== 'bigint') throw new TypeError('taxableMinor must be a bigint of paise');
  if (!Number.isInteger(input.rateBp) || input.rateBp < 0) throw new TypeError('rateBp must be a non-negative integer');
  const supplyType = input.supplyType;
  if (!['domestic', 'sez', 'export', 'deemed-export'].includes(supplyType)) {
    throw new TypeError('supplyType must be domestic, sez, export, or deemed-export');
  }
  const lut = input.lut === true;
  if (lut && supplyType !== 'sez' && supplyType !== 'export') {
    throw new TypeError('lut applies only to an export or an SEZ supply');
  }
  const zeroRated = (supplyType === 'export' || supplyType === 'sez') && lut;
  const forcedIgst = supplyType === 'export' || supplyType === 'sez';
  const sameState = supplier.code === place.code;
  const interState = forcedIgst || !sameState;
  const igstOnIntra = forcedIgst && sameState;
  const ut = !interState && pack.utgstCodes.includes(place.code);
  let cgst = 0n;
  let sgst = 0n;
  let utgst = 0n;
  let igst = 0n;
  if (!zeroRated && input.rateBp !== 0) {
    if (interState) igst = pct(input.taxableMinor, input.rateBp);
    else {
      const half = halfTax(input.taxableMinor, input.rateBp);
      cgst = half;
      if (ut) utgst = half;
      else sgst = half;
    }
  }
  return {
    cgst,
    sgst,
    utgst,
    igst,
    cess: 0n,
    localTax: interState ? 'IGST' : ut ? 'UTGST' : 'SGST',
    interState,
    igstOnIntra,
    confirm: ut && needsConfirm(pack.utgstRule),
  };
}

/**
 * @param {object} input
 */
export function buildInvoice(input) {
  const shell = failure('');
  shell.errors = [];
  try {
    const blocked = guardInput(input);
    if (blocked) return { ...shell, errors: [blocked] };
    return assemble(input);
  } catch (error) {
    return { ...shell, errors: [error.message] };
  }
}

export function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { help: true };
  const index = argv.indexOf('--json');
  if (index === -1) throw usage('Pass the invoice with --json.');
  const value = argv[index + 1];
  if (value === undefined) throw usage('--json needs a value.');
  const unknown = argv.some((arg, i) => arg.startsWith('--') && i !== index);
  if (unknown || index + 2 < argv.length) throw usage('Unexpected argument.');
  if (Buffer.byteLength(value, 'utf8') > LIMIT) throw usage('Input exceeds the 10 KB limit.');
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw usage('--json value is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw usage('JSON must be an invoice object.');
  }
  return { input: parsed };
}

function assemble(input) {
  const errors = [];
  const warnings = [];
  let confirm = false;
  const documentType = input.documentType ?? 'invoice';
  if (!['invoice', 'credit-note', 'debit-note'].includes(documentType)) {
    errors.push('documentType must be invoice, credit-note, or debit-note.');
  }
  const invoiceDate = readDate(input.invoiceDate, 'invoiceDate', errors);
  const pack = invoiceDate ? loadPack(invoiceDate) : loadPack('2026-11-01');
  const mark = (rule) => {
    if (needsConfirm(rule)) confirm = true;
  };
  const noteConfirm = () => {
    confirm = true;
    if (!warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
  };

  const invoiceNumber = readText(input.invoiceNumber, 'invoiceNumber', errors, { max: 64 });
  if (typeof input.invoiceNumber === 'string' && input.invoiceNumber.normalize('NFKC').trim() !== input.invoiceNumber.trim()) {
    warnings.push('Invoice number was NFKC-normalised.');
  }
  checkNumber(invoiceNumber, pack, input.priorNumbers, errors, warnings, () => noteConfirm());

  const supplyType = input.supplyType ?? 'domestic';
  if (!['domestic', 'sez', 'export', 'deemed-export'].includes(supplyType)) {
    errors.push('supplyType must be domestic, sez, export, or deemed-export.');
  }
  const supplyKind = input.supplyKind ?? 'mixed';
  if (!['goods', 'services', 'mixed'].includes(supplyKind)) {
    errors.push('supplyKind must be goods, services, or mixed.');
  }
  let lut = false;
  if (supplyType === 'export' || supplyType === 'sez') {
    if (typeof input.lut !== 'boolean') errors.push('lut must be true or false for an export or SEZ supply.');
    else lut = input.lut;
  } else if (input.lut === true) {
    errors.push('lut applies only to an export or an SEZ supply.');
  }
  const reverseCharge = typeof input.reverseCharge === 'boolean' ? input.reverseCharge : null;
  if (reverseCharge === null) errors.push('reverseCharge must be true or false.');

  const signature = readSignature(input, pack, errors);

  const supplier = readParty(input.supplier, 'supplier', errors, warnings, { gstin: 'required' });
  const recipient = readParty(input.recipient, 'recipient', errors, warnings, {
    gstin: supplyType === 'export' ? 'forbidden' : supplyType === 'sez' || supplyType === 'deemed-export' ? 'required' : 'optional',
  });
  if (supplier?.confirm || recipient?.confirm) noteConfirm();
  bindState(supplier, pack, 'supplier', errors, warnings);
  bindState(recipient, pack, 'recipient', errors, warnings);
  if (supplyType === 'export' && recipient?.state?.code) {
    errors.push('Do not set an Indian state on an export recipient. Place of supply is 96.');
  }

  const country = readCountry(input, supplyType, errors);
  let place = null;
  if (supplyType === 'export') {
    if (input.placeOfSupply !== undefined && input.placeOfSupply !== '96') {
      errors.push('An export place of supply is 96 (Other Countries).');
    }
    place = findState(pack, '96');
  } else if (typeof input.placeOfSupply === 'string' && input.placeOfSupply.trim() !== '') {
    place = findState(pack, input.placeOfSupply.trim());
    if (!place) errors.push(`Unknown place of supply ${input.placeOfSupply}.`);
  } else if (supplyKind === 'services' || (supplyKind === 'mixed' && allServices(input.lines))) {
    place = inferServicePlace(pack, supplier, recipient, supplyType, warnings);
    if (!place) errors.push('Place of supply for this service could not be inferred. Pass placeOfSupply.');
  } else {
    errors.push('placeOfSupply is required. This skill does not infer a place of supply for goods.');
  }
  if (place?.legacy) warnOnce(warnings, pack.legacyWarning);
  if (supplyType === 'sez' && place?.code === '96') {
    errors.push('An SEZ place of supply is in India, not 96.');
  }

  if (input.financialYear !== undefined) {
    if (!invoiceDate) errors.push('financialYear cannot be checked without an invoice date.');
    else {
      try {
        const display = fyOf(invoiceDate);
        const given = String(input.financialYear).trim();
        if (given !== display && given !== fyPortal(display)) {
          errors.push(`financialYear ${given} does not match the invoice date (${display}).`);
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  let original = null;
  if (documentType === 'credit-note' || documentType === 'debit-note') {
    original = {
      number: readText(input.originalInvoiceNumber, 'originalInvoiceNumber', errors, { max: 16 }),
      date: readDate(input.originalInvoiceDate, 'originalInvoiceDate', errors),
    };
    if (original.date && invoiceDate && original.date > invoiceDate) {
      errors.push('originalInvoiceDate is after the note date.');
    }
  }

  const lines = readLines(input.lines, supplyKind, documentType, pack, errors, warnings, noteConfirm);
  const delivery = readDelivery(input, recipient, supplyType, errors);

  if (supplier && place && supplier.state.code !== supplier.gstinState && supplier.gstinState) {
    errors.push(`Supplier GSTIN state ${supplier.gstinState} does not match state ${supplier.state.code}.`);
  }
  if (recipient?.gstinState && recipient.state && recipient.gstinState !== recipient.state.code) {
    errors.push(`Recipient GSTIN state ${recipient.gstinState} does not match state ${recipient.state.code}.`);
  }

  const threshold = pack.unregisteredThreshold;
  const taxablePreview = lines.reduce((sum, line) => sum + (line.taxableMinor ?? 0n), 0n);
  if (recipient && !recipient.gstin && supplyType === 'domestic' && abs(taxablePreview) >= BigInt(threshold)) {
    if (!place) errors.push('Unregistered recipient at or above ₹50,000 needs the state name and code (Rule 46(e)).');
    if (!delivery) errors.push('Unregistered recipient at or above ₹50,000 needs a delivery address (Rule 46(e)).');
  }

  if (errors.length > 0 || !supplier || !place || !invoiceDate || lines.some((line) => line.taxableMinor === null)) {
    if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
    return invalid(errors, warnings, confirm, pack);
  }

  const builtLines = [];
  for (const line of lines) {
    const split = taxSplit({
      supplierState: supplier.state.code,
      placeOfSupply: place.code,
      taxableMinor: line.taxableMinor,
      rateBp: line.nominalRateBp,
      supplyType,
      lut,
      onDate: invoiceDate,
    });
    if (split.confirm) noteConfirm();
    const total = line.taxableMinor + split.cgst + split.sgst + split.utgst + split.igst + split.cess;
    builtLines.push({
      description: line.description,
      hsn: line.hsn,
      quantity: line.quantity,
      unit: line.unit,
      service: line.service,
      discount: money(line.discountMinor),
      taxable: money(line.taxableMinor),
      rateBp: lut ? 0 : line.nominalRateBp,
      nominalRateBp: line.nominalRateBp,
      cgst: money(split.cgst),
      sgst: money(split.sgst),
      utgst: money(split.utgst),
      igst: money(split.igst),
      cess: money(split.cess),
      total: money(total),
      localTax: split.localTax,
    });
  }

  const totals = sumLines(builtLines);
  const grandMinor = parseAmount(totals.taxable) + parseAmount(totals.cgst) + parseAmount(totals.sgst) + parseAmount(totals.utgst) + parseAmount(totals.igst);
  const roundedGrand = roundPayableToRupee(grandMinor);
  const wantRound = input.roundOff === true;
  const roundOffMinor = wantRound ? roundedGrand - grandMinor : 0n;
  const grand = wantRound ? roundedGrand : grandMinor;
  totals.roundOff = money(roundOffMinor);
  totals.grand = money(grand);
  totals.taxPayableRounded = {
    cgst: money(roundPayableToRupee(parseAmount(totals.cgst))),
    sgst: money(roundPayableToRupee(parseAmount(totals.sgst))),
    utgst: money(roundPayableToRupee(parseAmount(totals.utgst))),
    igst: money(roundPayableToRupee(parseAmount(totals.igst))),
    cess: money(0n),
  };

  const igstOnIntra = (supplyType === 'sez' || supplyType === 'export') && supplier.state.code === place.code;
  const localTax = supplyType === 'export' || supplyType === 'sez' ? 'IGST' : supplier.state.code === place.code && pack.utgstCodes.includes(place.code) ? 'UTGST' : supplier.state.code === place.code ? 'SGST' : 'IGST';
  if (localTax === 'UTGST') noteConfirm();

  let endorsement = null;
  if (supplyType === 'export' || supplyType === 'sez') {
    endorsement = lut ? pack.endorsementWithout : pack.endorsementWith;
  }

  if (!Array.isArray(input.priorNumbers)) {
    warnings.push('Uniqueness within the financial year was not checked. Pass priorNumbers for this FY.');
  }

  const invoice = {
    documentType,
    invoiceNumber,
    invoiceDate,
    fy: fyOf(invoiceDate),
    supplyType,
    supplyKind: supplyKind === 'mixed' ? (builtLines.every((line) => line.service) ? 'services' : builtLines.some((line) => line.service) ? 'mixed' : 'goods') : supplyKind,
    placeOfSupply: { code: place.code, name: place.name },
    interState: supplyType === 'export' || supplyType === 'sez' || supplier.state.code !== place.code,
    igstOnIntra,
    localTax,
    reverseCharge: reverseCharge === true,
    lut,
    endorsement,
    country,
    supplier: partyOut(supplier),
    recipient: partyOut(recipient, delivery),
    lines: builtLines,
    totals,
    amountInWords: toWords(grand),
    signature,
    originalInvoice: original,
  };

  if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
  return {
    valid: true,
    invoice,
    html: renderHtml(invoice, warnings, pack.disclaimerText),
    warnings,
    confirm,
    errors: [],
    disclaimer: pack.disclaimerText,
    portalSubmitted: false,
  };
}

function checkNumber(invoiceNumber, pack, priorNumbers, errors, warnings, noteConfirm) {
  if (!invoiceNumber) return;
  const chars = [...invoiceNumber];
  if (chars.length > pack.maxChars) {
    errors.push('Invoice number is longer than 16 characters.');
    return;
  }
  if (!pack.numberPattern.test(invoiceNumber)) {
    errors.push('Invoice number must use only letters, digits, hyphen, and slash.');
    return;
  }
  if (pack.rejectLiterals.includes(invoiceNumber)) {
    errors.push('Invoice number "0" is rejected.');
    noteConfirm();
    return;
  }
  if (pack.rejectSlashOnly && /^[/]+$/.test(invoiceNumber)) {
    errors.push('Invoice number made only of slashes is rejected.');
    noteConfirm();
    return;
  }
  const lead = invoiceNumber[0];
  if (pack.leadingRejected.includes(lead)) {
    warnings.push('IRP practice rejects a document number that starts with 0, / or -. Rule 46 still allows it. UNVERIFIED as a statutory bar.');
    noteConfirm();
  }
  if (Array.isArray(priorNumbers)) {
    const seen = priorNumbers.map((item) => (typeof item === 'string' ? item.normalize('NFKC').trim() : ''));
    if (seen.includes(invoiceNumber)) errors.push('Invoice number is not unique in this financial year.');
  }
}

function readLines(lines, supplyKind, documentType, pack, errors, warnings, noteConfirm) {
  if (!Array.isArray(lines) || lines.length === 0) {
    errors.push('At least one line is required.');
    return [];
  }
  return lines.map((line, index) => {
    const label = `lines[${index}]`;
    if (!line || typeof line !== 'object') {
      errors.push(`${label} must be an object.`);
      return { taxableMinor: null };
    }
    const description = readText(line.description, `${label}.description`, errors, { max: 300 });
    const hsn = readText(line.hsn ?? line.sac, `${label}.hsn`, errors, { max: 8 });
    if (hsn && !/^[0-9]{4,8}$/.test(hsn)) errors.push(`${label}.hsn must be 4 to 8 digits. A rate is never inferred from it.`);
    const service = supplyKind === 'services' ? true : supplyKind === 'goods' ? false : line.service === true;
    if (supplyKind === 'goods' && line.service === true) errors.push(`${label} is marked as a service on a goods invoice.`);
    let quantity = null;
    let unit = null;
    if (line.quantity !== undefined && line.quantity !== null) {
      if (typeof line.quantity !== 'string') errors.push(`${label}.quantity must be a decimal string.`);
      else {
        quantity = readText(line.quantity, `${label}.quantity`, errors, { max: 12 });
        if (quantity && !/^\d+(\.\d{1,3})?$/.test(quantity)) errors.push(`${label}.quantity must be a decimal with at most 3 places.`);
      }
    } else if (!service) {
      errors.push(`${label}.quantity is required for goods (Rule 46(i)).`);
    }
    if (line.unit !== undefined && line.unit !== null) {
      unit = readText(String(line.unit), `${label}.unit`, errors, { max: 8 });
      if (unit && !/^[A-Za-z0-9]{1,8}$/.test(unit)) errors.push(`${label}.unit must be 1 to 8 letters or digits.`);
    } else if (!service) {
      errors.push(`${label}.unit is required for goods (Rule 46(i)).`);
    }
    const taxableMinor = readMinor(line.taxable, `${label}.taxable`, errors);
    const discountMinor = line.discount === undefined ? 0n : readMinor(line.discount, `${label}.discount`, errors) ?? 0n;
    if (taxableMinor !== null && documentType === 'credit-note' && taxableMinor >= 0n) {
      errors.push(`${label}.taxable on a credit note must be negative.`);
    }
    if (taxableMinor !== null && documentType === 'debit-note' && taxableMinor <= 0n) {
      errors.push(`${label}.taxable on a debit note must be positive.`);
    }
    if (taxableMinor !== null && documentType === 'invoice' && taxableMinor < 0n) {
      errors.push(`${label}.taxable on a tax invoice must not be negative. Use a credit note.`);
    }
    const nominal = readRate(line, label, pack, errors, warnings, noteConfirm);
    return {
      description,
      hsn,
      quantity,
      unit,
      service,
      taxableMinor,
      discountMinor,
      nominalRateBp: nominal ?? 0,
    };
  });
}

function readRate(line, label, pack, errors, warnings, noteConfirm) {
  let bp = null;
  if (line.rateBp !== undefined) {
    if (typeof line.rateBp === 'number' && Number.isInteger(line.rateBp)) bp = line.rateBp;
    else if (typeof line.rateBp === 'string' && /^[0-9]+$/.test(line.rateBp)) bp = Number(line.rateBp);
    else {
      errors.push(`${label}.rateBp must be integer basis points.`);
      return null;
    }
  }
  if (line.ratePercent !== undefined) {
    try {
      const fromPercent = percentToBasisPoints(line.ratePercent);
      if (bp !== null && bp !== fromPercent) errors.push(`${label} rateBp and ratePercent do not match.`);
      bp = fromPercent;
    } catch (error) {
      errors.push(`${label}.ratePercent: ${error.message}`);
      return null;
    }
  }
  if (bp === null) {
    errors.push(`${label} needs rateBp or ratePercent. A rate is never inferred from the HSN.`);
    return null;
  }
  if (bp < 0 || bp > 10000) {
    errors.push(`${label} rate is outside 0 to 100 percent.`);
    return null;
  }
  if (!pack.knownRates.includes(bp)) {
    warnings.push(`${label} rate ${bp} basis points is outside the bundled examples. GST 2.0 slab changes are UNVERIFIED. The rate you entered is still used.`);
    noteConfirm();
  }
  return bp;
}

function readParty(value, label, errors, warnings, gstinMode) {
  if (!value || typeof value !== 'object') {
    errors.push(`${label} is required.`);
    return null;
  }
  const name = readText(value.name, `${label}.name`, errors, { max: 100 });
  const address = readText(value.address, `${label}.address`, errors, { max: 500 });
  if (address.length > 100) warnings.push(`${label}.address is longer than 100 characters. E-invoice Addr1 allows 100.`);
  const loc = value.loc === undefined ? '' : readText(value.loc, `${label}.loc`, errors, { required: false, max: 50 });
  let pin = '';
  if (value.pin !== undefined) {
    if (typeof value.pin !== 'string') errors.push(`${label}.pin must be a string.`);
    else pin = readText(value.pin, `${label}.pin`, errors, { required: false, max: 6 });
  }
  if (pin && !/^[1-9][0-9]{5}$/.test(pin)) errors.push(`${label}.pin must be a 6-digit PIN.`);
  let gstin = null;
  let gstinState = '';
  let confirm = false;
  if (gstinMode.gstin === 'forbidden') {
    if (value.gstin) errors.push(`${label}.gstin must be omitted on an export. The recipient is not registered in India.`);
  } else if (value.gstin !== undefined && value.gstin !== null && value.gstin !== '') {
    if (typeof value.gstin !== 'string') errors.push(`${label}.gstin must be a string.`);
    else {
      const checked = validateGstin(value.gstin);
      if (!checked.valid) {
        for (const error of checked.errors) errors.push(`${label} GSTIN: ${error}`);
      } else {
        gstin = checked.normalized;
        gstinState = checked.stateCode;
        if (checked.confirm) {
          confirm = true;
          for (const warning of checked.warnings) {
            if (warning === CAVEAT) continue;
            warnings.push(`${label} GSTIN: ${warning}`);
          }
        }
      }
    }
  } else if (gstinMode.gstin === 'required') {
    errors.push(`${label}.gstin is required.`);
  }
  let state = null;
  if (typeof value.stateCode === 'string' && value.stateCode.trim() !== '') {
    const code = value.stateCode.trim();
    state = { code, name: '' };
  } else if (gstinState) {
    state = { code: gstinState, name: '' };
  } else if (label === 'supplier') {
    errors.push(`${label}.stateCode is required.`);
  }
  return { name, address, loc, pin, gstin, gstinState, state, confirm };
}

function partyOut(party, delivery) {
  if (!party) return null;
  const out = {
    name: party.name,
    address: party.address,
    loc: party.loc || null,
    pin: party.pin || null,
    gstin: party.gstin,
    stateCode: party.state?.code ?? '',
    stateName: party.state?.name ?? '',
  };
  if (delivery !== undefined) out.deliveryAddress = delivery || party.address;
  return out;
}

function bindState(party, pack, label, errors, warnings) {
  if (!party?.state?.code) return;
  const found = findState(pack, party.state.code);
  if (!found) {
    errors.push(`Unknown ${label} state ${party.state.code}.`);
    return;
  }
  party.state = found;
  if (found.legacy) warnOnce(warnings, pack.legacyWarning);
}

function warnOnce(warnings, message) {
  if (!warnings.includes(message)) warnings.push(message);
}

function inferServicePlace(pack, supplier, recipient, supplyType, warnings) {
  if (supplyType === 'export') return findState(pack, '96');
  warnings.push('Place of supply was inferred for a service under IGST section 12(2) or 13(2). Sub-sections 12(3) to 12(14) and 13(3) to 13(13), including intermediary services, can put the place of supply somewhere else.');
  if (recipient?.gstinState) return findState(pack, recipient.gstinState);
  if (recipient?.state?.code) return findState(pack, recipient.state.code);
  if (supplier?.state?.code) return findState(pack, supplier.state.code);
  return null;
}

function readDelivery(input, recipient, supplyType, errors) {
  const raw = input.deliveryAddress ?? input.recipient?.deliveryAddress;
  if (raw === undefined || raw === null || raw === '') {
    if (supplyType === 'export' || supplyType === 'sez') {
      if (recipient?.address) return recipient.address;
      errors.push('deliveryAddress is required for an export or SEZ supply.');
      return '';
    }
    return recipient?.address ?? '';
  }
  return readText(raw, 'deliveryAddress', errors, { max: 500 });
}

function readCountry(input, supplyType, errors) {
  const raw = input.country ?? input.recipient?.country;
  const country = typeof raw === 'string' ? raw.normalize('NFKC').trim() : '';
  if (supplyType === 'export') {
    if (!country) errors.push('country of destination is required for an export.');
    else if (isIndia(country)) errors.push('An export destination cannot be India.');
    return country;
  }
  if (supplyType === 'sez') {
    if (country && !isIndia(country)) errors.push('An SEZ supply is in India.');
    return country || 'India';
  }
  if (country && !isIndia(country)) errors.push('Recipient country is outside India. Set supplyType to export, or correct the country.');
  return country || 'India';
}

function readSignature(input, pack, errors) {
  if (input.electronicInvoice === true) return pack.electronicSignature;
  if (typeof input.signature !== 'string') {
    errors.push('signature is required (Rule 46(q)), or set electronicInvoice true for the IT Act proviso.');
    return '';
  }
  const text = input.signature.normalize('NFKC').trim();
  if (blockedText(input.signature) || blockedText(text)) {
    errors.push('signature contains a zero-width or bidi control character.');
    return '';
  }
  if (text.length === 0) errors.push('signature is required (Rule 46(q)), or set electronicInvoice true for the IT Act proviso.');
  return text;
}

function sumLines(lines) {
  const keys = ['taxable', 'cgst', 'sgst', 'utgst', 'igst', 'cess'];
  const totals = {};
  for (const key of keys) {
    let sum = 0n;
    for (const line of lines) sum += parseAmount(line[key]);
    totals[key] = money(sum);
  }
  return totals;
}

function allServices(lines) {
  return Array.isArray(lines) && lines.length > 0 && lines.every((line) => line && line.service === true);
}

function halfTax(minor, rateBp) {
  if (rateBp % 2 === 0) return pct(minor, rateBp / 2);
  return divHalfAwayFromZero(minor * BigInt(rateBp), 20000n);
}

function divHalfAwayFromZero(numerator, denominator) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Section 170: 50 paise or more rounds away from zero to the next rupee. */
export function roundPayableToRupee(minor) {
  if (typeof minor !== 'bigint') throw new TypeError('minor units must be a bigint');
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const rupees = absolute / 100n;
  const paise = absolute % 100n;
  const roundedRupees = paise >= 50n ? rupees + 1n : rupees;
  const asMinor = 100n * roundedRupees;
  return negative ? -asMinor : asMinor;
}

function percentToBasisPoints(input) {
  const s = typeof input === 'number' && Number.isInteger(input) ? String(input) : input;
  if (typeof s !== 'string') throw new Error('rate percent must be a decimal string');
  const trimmed = s.trim();
  if (/[eE]/.test(trimmed)) throw new Error('exponent notation is not allowed');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new Error('rate percent must be a decimal string');
  const frac = match[2] ?? '';
  if (frac.length > 2) throw new Error('rate percent has more than 2 decimal places');
  const bp = BigInt(`${match[1]}${frac.padEnd(2, '0')}`);
  if (bp > 10000n) throw new Error('rate percent is above 100');
  return Number(bp);
}

function loadPack(onDate) {
  parseIsoDate(onDate);
  const gst = loadDomain('gst');
  const ids = loadDomain('ids');
  const asOf = gst.asOf <= ids.asOf ? gst.asOf : ids.asOf;
  const statesRule = ruleById('gst', 'gst.stateCodes', onDate);
  const utgstRule = ruleById('gst', 'gst.invoice.utgstStateCodes', onDate);
  const rejectRule = ruleById('gst', 'gst.invoice.number.rejectLiterals', onDate);
  const slashRule = ruleById('gst', 'gst.invoice.number.rejectSlashOnly', onDate);
  const leadingRule = ruleById('gst', 'gst.invoice.number.leadingRejectedByIrp', onDate);
  const unusual = ruleById('gst', 'gst.invoice.rates.unusual', onDate);
  return {
    disclaimerText: disclaimer(asOf),
    states: statesRule.value,
    legacyWarning: ruleById('gst', 'gst.gstin.legacyWarning', onDate).value,
    numberPattern: compileAnchored(ruleById('gst', 'gst.invoice.number.pattern', onDate).value, 'gst.invoice.number.pattern'),
    maxChars: ruleById('gst', 'gst.invoice.number.maxChars', onDate).value,
    rejectLiterals: rejectRule.value,
    rejectSlashOnly: slashRule.value === true,
    slashRule,
    leadingRejected: leadingRule.value,
    leadingRule,
    rejectRule,
    endorsementWithout: ruleById('gst', 'gst.invoice.endorsement.withoutPayment', onDate).value,
    endorsementWith: ruleById('gst', 'gst.invoice.endorsement.withPayment', onDate).value,
    utgstCodes: utgstRule.value,
    utgstRule,
    knownRates: ruleById('gst', 'gst.invoice.rates.knownBp', onDate).value,
    unusual,
    unregisteredThreshold: ruleById('gst', 'gst.invoice.unregistered.thresholdPaise', onDate).value,
    electronicSignature: ruleById('gst', 'gst.invoice.signature.electronic', onDate).value,
  };
}

function findState(pack, code) {
  const row = pack.states.find((item) => item.code === code);
  if (!row) return null;
  return { code: row.code, name: row.name, legacy: row.legacy === true };
}

function mustState(pack, code, label) {
  if (typeof code !== 'string' || !/^[0-9]{2}$/.test(code)) throw new TypeError(`${label} must be a two-digit state code`);
  const state = findState(pack, code);
  if (!state) throw new TypeError(`${label} ${code} is not a known state code`);
  return state;
}

function renderHtml(invoice, warnings, disclaimerText) {
  const title = invoice.documentType === 'credit-note' ? 'Credit note' : invoice.documentType === 'debit-note' ? 'Debit note' : 'Tax invoice';
  const rows = invoice.lines
    .map((line) => {
      const tax = line.localTax === 'IGST' ? `IGST ${rupee(line.igst)}` : line.localTax === 'UTGST' ? `CGST ${rupee(line.cgst)} + UTGST ${rupee(line.utgst)}` : `CGST ${rupee(line.cgst)} + SGST ${rupee(line.sgst)}`;
      return `<tr><td>${esc(line.description)}</td><td>${esc(line.hsn)}</td><td>${esc(line.quantity ?? '')}</td><td>${esc(line.unit ?? '')}</td><td>${rupee(line.taxable)}</td><td>${esc(String(line.rateBp))}</td><td>${esc(tax)}</td><td>${rupee(line.total)}</td></tr>`;
    })
    .join('');
  const endorsement = invoice.endorsement ? `<p>${esc(invoice.endorsement)}</p>` : '';
  const warningBlock = warnings.length ? `<ul>${warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul>` : '';
  const original = invoice.originalInvoice ? `<p>Original invoice ${esc(invoice.originalInvoice.number)} dated ${esc(invoice.originalInvoice.date)}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${esc(title)} ${esc(invoice.invoiceNumber)}</title></head>
<body>
<p>Draft. Not submitted to the GST portal.</p>
<h1>${esc(title)}</h1>
<p>${esc(invoice.supplier.name)}<br>${esc(invoice.supplier.address)}<br>GSTIN ${esc(invoice.supplier.gstin)}</p>
<p>No. ${esc(invoice.invoiceNumber)}<br>Date ${esc(invoice.invoiceDate)}<br>FY ${esc(invoice.fy)}</p>
<p>${esc(invoice.recipient.name)}<br>${esc(invoice.recipient.address)}<br>${invoice.recipient.gstin ? `GSTIN ${esc(invoice.recipient.gstin)}` : 'Unregistered'}</p>
<p>Place of supply: ${esc(invoice.placeOfSupply.name)} (${esc(invoice.placeOfSupply.code)})</p>
<p>Delivery: ${esc(invoice.recipient.deliveryAddress)}</p>
<p>Country of destination: ${esc(invoice.country)}</p>
${original}
${endorsement}
<table>
<thead><tr><th>Description</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Taxable</th><th>Rate bp</th><th>Tax</th><th>Total</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p>Taxable ${rupee(invoice.totals.taxable)}</p>
<p>CGST ${rupee(invoice.totals.cgst)} SGST ${rupee(invoice.totals.sgst)} UTGST ${rupee(invoice.totals.utgst)} IGST ${rupee(invoice.totals.igst)}</p>
<p>Round-off ${rupee(invoice.totals.roundOff)}</p>
<p>Total ${rupee(invoice.totals.grand)}</p>
<p>${esc(invoice.amountInWords)}</p>
<p>Reverse charge: ${invoice.reverseCharge ? 'Yes' : 'No'}</p>
<p>${esc(invoice.signature)}</p>
${warningBlock}
<p>${esc(disclaimerText)}</p>
</body>
</html>
`;
}

function rupee(amount) {
  const text = typeof amount === 'bigint' ? formatMinor(amount) : String(amount);
  const negative = text.startsWith('-');
  const body = groupInr(negative ? text.slice(1) : text);
  return negative ? `-₹${body}` : `₹${body}`;
}

function groupInr(amount) {
  const [whole, frac] = amount.split('.');
  const head = whole.length > 3 ? whole.slice(0, -3) : '';
  const tail = whole.slice(-3);
  if (!head) return frac === undefined ? tail : `${tail}.${frac}`;
  const digits = [...head].reverse();
  const parts = [];
  for (let i = 0; i < digits.length; i += 2) parts.push(digits.slice(i, i + 2).reverse().join(''));
  const grouped = `${parts.reverse().join(',')},${tail}`;
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function money(minor) {
  return formatMinor(minor);
}

function abs(minor) {
  return minor < 0n ? -minor : minor;
}

function fyPortal(display) {
  const year = Number(display.slice(0, 4));
  return `${year}-${year + 1}`;
}

function readDate(value, label, errors) {
  if (typeof value !== 'string') {
    errors.push(`${label} must be a YYYY-MM-DD string.`);
    return null;
  }
  if (blockedText(value)) {
    errors.push(`${label} contains a zero-width or bidi control character.`);
    return null;
  }
  try {
    parseIsoDate(value.trim());
    return value.trim();
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
}

function readText(value, label, errors, { required = true, max = 300 } = {}) {
  if (value === undefined || value === null) {
    if (required) errors.push(`${label} is required.`);
    return '';
  }
  if (typeof value !== 'string') {
    errors.push(`${label} must be a string.`);
    return '';
  }
  if (blockedText(value)) {
    errors.push(`${label} contains a zero-width or bidi control character.`);
    return '';
  }
  const text = value.normalize('NFKC').trim();
  if (required && text.length === 0) errors.push(`${label} is required.`);
  if ([...text].length > max) errors.push(`${label} is longer than ${max} characters.`);
  return text;
}

function readMinor(value, label, errors) {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string') {
    errors.push(`${label} must be a decimal string of rupees.`);
    return null;
  }
  try {
    return parseAmount(value);
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
}

function isIndia(country) {
  const value = country.trim().toLowerCase();
  return value === 'india' || value === 'in';
}

function guardInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Invoice must be an object.';
  let encoded;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return 'Invoice could not be read.';
  }
  if (Buffer.byteLength(encoded, 'utf8') > LIMIT) return 'Input exceeds the 10 KB limit.';
  if (walkBlocked(input)) return 'Zero-width or bidi control character rejected.';
  return '';
}

function walkBlocked(value) {
  if (typeof value === 'string') return blockedText(value);
  if (Array.isArray(value)) return value.some((item) => walkBlocked(item));
  if (value && typeof value === 'object') return Object.values(value).some((item) => walkBlocked(item));
  return false;
}

function blockedText(value) {
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    if (ZERO_WIDTH.has(cp)) return true;
    if (cp >= 0x202a && cp <= 0x202e) return true;
    if (cp >= 0x2066 && cp <= 0x2069) return true;
  }
  return false;
}

function invalid(errors, warnings, confirm, pack) {
  return {
    valid: false,
    invoice: null,
    html: '',
    warnings,
    confirm,
    errors,
    disclaimer: pack.disclaimerText,
  };
}

function failure(message) {
  return {
    valid: false,
    invoice: null,
    html: '',
    warnings: [],
    confirm: false,
    errors: message ? [message] : [],
    disclaimer: safeDisclaimer(),
    portalSubmitted: false,
  };
}

function safeDisclaimer() {
  try {
    const gst = loadDomain('gst');
    return disclaimer(gst.asOf);
  } catch {
    return disclaimer('2026-11-01');
  }
}

function usage(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

function finish(code, payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => {
    process.exit(code);
  });
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

