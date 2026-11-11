/**
 * GST e-invoice JSON (schema 1.1). Builds a payload and validates one.
 * Never calls an IRP or the GST portal.
 */
import { CONFIRM_SENTENCE, disclaimer } from './_lib/disclaimer.mjs';
import { istDate, parseIsoDate } from './_lib/fy.mjs';
import { validateGstin } from './_lib/gstin.mjs';
import { formatMinor, parseAmount } from './_lib/money.mjs';
import { compileAnchored, loadDomain, needsConfirm, ruleById } from './_lib/rules.mjs';

const LIMIT = 10 * 1024;
const ZERO_WIDTH = new Set([
  0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff,
]);

/**
 * @param {object} source buildInvoice() result, or the invoice object itself
 */
export function buildEinvoice(source) {
  const shell = blank();
  try {
    const blocked = guard(source);
    if (blocked) return { ...shell, errors: [{ path: '', msg: blocked }] };
    return assemble(source);
  } catch (error) {
    return { ...shell, errors: [{ path: '', msg: error.message }] };
  }
}

/**
 * @param {object} input schema object, or { einvoice, aato, asOf, taxpayerClass, cancel, irnAgeHours }
 */
export function validateEinvoice(input) {
  const shell = blank();
  try {
    const blocked = guard(input);
    if (blocked) return { ...shell, valid: false, errors: [{ path: '', msg: blocked }] };
    const wrapped = input && input.einvoice && typeof input.einvoice === 'object';
    const payload = wrapped ? input.einvoice : input;
    const meta = wrapped ? input : {};
    return checkPayload(payload, meta);
  } catch (error) {
    return { ...shell, valid: false, errors: [{ path: '', msg: error.message }] };
  }
}

export function daysBetween(startIso, endIso) {
  return civilDay(endIso) - civilDay(startIso);
}

function assemble(source) {
  const errors = [];
  const warnings = [];
  const invoice = source?.invoice?.lines ? source.invoice : source?.lines ? source : null;
  if (!invoice) {
    return fail(errors.concat([{ path: '', msg: 'Pass the invoice object from gst-invoice. This skill does not recompute tax.' }]), warnings, false);
  }
  if (source.valid === false) {
    const prior = Array.isArray(source.errors) ? source.errors.map((msg) => ({ path: '', msg: String(msg) })) : [];
    return fail(prior.length ? prior : [{ path: '', msg: 'The invoice is not valid.' }], warnings, false);
  }
  const docDate = invoice.invoiceDate;
  let pack;
  try {
    pack = loadPack(typeof docDate === 'string' ? docDate : '2026-11-01');
  } catch (error) {
    return fail([{ path: 'DocDtls.Dt', msg: error.message }], warnings, false);
  }
  const supTyp = supplyCode(invoice, errors);
  const typ = docCode(invoice.documentType, errors);
  if (!invoice.supplier?.pin) errors.push({ path: 'SellerDtls.Pin', msg: 'Supplier PIN is required on an e-invoice.' });
  if (!invoice.supplier?.loc) errors.push({ path: 'SellerDtls.Loc', msg: 'Supplier location is required on an e-invoice.' });
  if (!invoice.recipient?.loc && supTyp && !String(supTyp).startsWith('EXP')) {
    errors.push({ path: 'BuyerDtls.Loc', msg: 'Recipient location is required on an e-invoice.' });
  }
  if (invoice.recipient?.loc === undefined || invoice.recipient?.loc === null || invoice.recipient?.loc === '') {
    if (supTyp && String(supTyp).startsWith('EXP')) {
      errors.push({ path: 'BuyerDtls.Loc', msg: 'Export recipient location is required on an e-invoice.' });
    }
  }
  for (const party of [
    ['SellerDtls.Addr1', invoice.supplier?.address],
    ['BuyerDtls.Addr1', invoice.recipient?.address],
  ]) {
    if (typeof party[1] === 'string' && [...party[1]].length > 100) {
      errors.push({ path: party[0], msg: 'Address is longer than 100 characters.' });
    }
  }
  if (errors.length > 0) return fail(errors, warnings, false);

  const items = invoice.lines.map((line, index) => lineItem(line, index, warnings));
  const ass = sumField(items, 'AssAmt');
  const igst = sumField(items, 'IgstAmt');
  const cgst = sumField(items, 'CgstAmt');
  const sgst = sumField(items, 'SgstAmt');
  const itemTotal = sumField(items, 'TotItemVal');
  const grand = absMinor(parseAmount(invoice.totals.grand));
  const rnd = grand - itemTotal;
  const stated = absMinor(parseAmount(invoice.totals.taxable));
  if (stated !== ass) {
    errors.push({ path: 'ValDtls.AssVal', msg: 'Line taxable values do not match invoice totals.' });
  }
  if (errors.length > 0) return fail(errors, warnings, false);

  const exportSupply = supTyp === 'EXPWP' || supTyp === 'EXPWOP';
  const buyerGstin = exportSupply ? pack.exportGstin.value : invoice.recipient.gstin;
  const buyerPos = exportSupply ? pack.exportPos.value : invoice.placeOfSupply.code;
  const buyerStcd = exportSupply ? pack.exportPos.value : invoice.recipient.stateCode || invoice.placeOfSupply.code;
  const buyerPin = exportSupply ? pack.exportPin.value : invoice.recipient.pin || undefined;

  const einvoice = {
    Version: pack.version.value,
    TranDtls: {
      TaxSch: pack.taxScheme.value,
      SupTyp: supTyp,
      RegRev: invoice.reverseCharge ? 'Y' : 'N',
      IgstOnIntra: invoice.igstOnIntra ? 'Y' : 'N',
    },
    DocDtls: {
      Typ: typ,
      No: invoice.invoiceNumber,
      Dt: toDmy(invoice.invoiceDate),
    },
    SellerDtls: {
      Gstin: invoice.supplier.gstin,
      LglNm: invoice.supplier.name,
      Addr1: invoice.supplier.address,
      Loc: invoice.supplier.loc,
      Pin: invoice.supplier.pin,
      Stcd: invoice.supplier.stateCode,
    },
    BuyerDtls: {
      Gstin: buyerGstin,
      LglNm: invoice.recipient.name,
      Pos: buyerPos,
      Addr1: invoice.recipient.address,
      Loc: invoice.recipient.loc,
      Stcd: buyerStcd,
      ...(buyerPin ? { Pin: buyerPin } : {}),
    },
    ItemList: items,
    ValDtls: {
      AssVal: formatMinor(ass),
      CgstVal: formatMinor(cgst),
      SgstVal: formatMinor(sgst),
      IgstVal: formatMinor(igst),
      CesVal: formatMinor(0n),
      StCesVal: formatMinor(0n),
      Discount: formatMinor(0n),
      OthChrg: formatMinor(0n),
      RndOffAmt: formatMinor(rnd),
      TotInvVal: formatMinor(grand),
    },
  };
  if (invoice.originalInvoice?.number && invoice.originalInvoice?.date) {
    einvoice.RefDtls = {
      PrecDocDtls: [{ InvNo: invoice.originalInvoice.number, InvDt: toDmy(invoice.originalInvoice.date) }],
    };
  }

  const meta = {
    aato: source.aato ?? invoice.aato,
    asOf: source.asOf ?? invoice.asOf,
    taxpayerClass: source.taxpayerClass ?? invoice.taxpayerClass,
    cancel: source.cancel === true,
    irnAgeHours: source.irnAgeHours,
  };
  const checked = checkPayload(einvoice, meta);
  return {
    ...checked,
    einvoice,
    warnings: [...warnings, ...checked.warnings],
    confirm: checked.confirm,
    irpSubmitted: false,
  };
}

function lineItem(line, index, warnings) {
  const taxable = absMinor(parseAmount(line.taxable));
  const discount = absMinor(parseAmount(line.discount ?? '0'));
  const gross = taxable + discount;
  const price = unitPrice(gross, line.quantity);
  if (!price.exact) {
    warnings.push(`ItemList[${index}].UnitPrice times Qty is not TotAmt to the paisa. A unit price has at most 3 decimal places.`);
  }
  const igst = absMinor(parseAmount(line.igst));
  const cgst = absMinor(parseAmount(line.cgst));
  const sgst = absMinor(parseAmount(line.sgst)) + absMinor(parseAmount(line.utgst ?? '0'));
  const total = absMinor(parseAmount(line.total));
  const item = {
    SlNo: String(index + 1),
    PrdDesc: line.description,
    IsServc: line.service ? 'Y' : 'N',
    HsnCd: line.hsn,
    UnitPrice: price.text,
    TotAmt: formatMinor(gross),
    Discount: formatMinor(discount),
    AssAmt: formatMinor(taxable),
    GstRt: bpToPercent(line.rateBp),
    IgstAmt: formatMinor(igst),
    CgstAmt: formatMinor(cgst),
    SgstAmt: formatMinor(sgst),
    TotItemVal: formatMinor(total),
  };
  if (line.quantity) item.Qty = line.quantity;
  if (line.unit) item.Unit = line.unit;
  return item;
}

/**
 * Price per unit: the gross amount (before discount) over the quantity, half-up.
 * The schema gives a unit price 3 decimal places, so the sum is done in thousandths
 * of a rupee and of a unit. A line with no usable quantity is one unit.
 * @param {bigint} gross paise
 * @param {string|null|undefined} quantity decimal string with at most 3 places
 * @returns {{ text: string, exact: boolean }} exact is false when price times quantity is not the gross to the paisa
 */
function unitPrice(gross, quantity) {
  const qty = quantityMilli(quantity);
  if (qty === null) return { text: formatMinor(gross), exact: true };
  const milli = divHalfUp(gross * 10000n, qty);
  return {
    text: milli % 10n === 0n ? formatMinor(milli / 10n) : formatMinor(milli, 3),
    exact: divHalfUp(milli * qty, 10000n) === gross,
  };
}

function quantityMilli(quantity) {
  const match = typeof quantity === 'string' ? /^([0-9]+)(?:\.([0-9]{1,3}))?$/.exec(quantity) : null;
  if (!match) return null;
  const milli = BigInt(`${match[1]}${(match[2] ?? '').padEnd(3, '0')}`);
  return milli === 0n ? null : milli;
}

function divHalfUp(numerator, denominator) {
  const quotient = numerator / denominator;
  return (numerator % denominator) * 2n >= denominator ? quotient + 1n : quotient;
}

function checkPayload(payload, meta) {
  const errors = [];
  const warnings = [];
  let confirm = false;
  const noteConfirm = () => {
    confirm = true;
    if (!warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
  };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return done(false, [{ path: '', msg: 'E-invoice must be an object.' }], warnings, confirm, null);
  }
  let docIso = null;
  try {
    docIso = payload?.DocDtls?.Dt ? fromDmy(payload.DocDtls.Dt) : null;
  } catch {
    docIso = null;
  }
  const onDate = docIso ?? '2026-11-01';
  let pack;
  try {
    pack = loadPack(onDate);
  } catch (error) {
    return done(false, [{ path: '', msg: error.message }], warnings, confirm, null);
  }

  if (payload.Version !== pack.version.value) {
    errors.push({ path: 'Version', msg: `Version must be ${pack.version.value}.` });
  }
  const tran = objectAt(payload, 'TranDtls', errors);
  if (tran) {
    if (tran.TaxSch !== pack.taxScheme.value) errors.push({ path: 'TranDtls.TaxSch', msg: 'TaxSch must be GST.' });
    if (!pack.supplyTypes.value.includes(tran.SupTyp)) {
      errors.push({ path: 'TranDtls.SupTyp', msg: 'SupTyp is not a schema 1.1 supply type.' });
    }
    if (tran.RegRev !== 'Y' && tran.RegRev !== 'N') {
      errors.push({ path: 'TranDtls.RegRev', msg: 'RegRev must be Y or N.' });
    }
    if (tran.IgstOnIntra !== undefined && tran.IgstOnIntra !== 'Y' && tran.IgstOnIntra !== 'N') {
      errors.push({ path: 'TranDtls.IgstOnIntra', msg: 'IgstOnIntra must be Y or N.' });
    }
  }
  const doc = objectAt(payload, 'DocDtls', errors);
  if (doc) {
    if (!pack.documentTypes.value.includes(doc.Typ)) errors.push({ path: 'DocDtls.Typ', msg: 'Typ must be INV, CRN, or DBN.' });
    checkDocNo(doc.No, pack, errors, warnings, noteConfirm);
    if (typeof doc.Dt !== 'string' || !fromDmy(doc.Dt)) {
      errors.push({ path: 'DocDtls.Dt', msg: 'Document date must be DD/MM/YYYY.' });
    }
  }
  const seller = objectAt(payload, 'SellerDtls', errors);
  if (seller) checkSeller(seller, pack, errors);
  const buyer = objectAt(payload, 'BuyerDtls', errors);
  if (buyer && tran) checkBuyer(buyer, tran.SupTyp, pack, errors, warnings, noteConfirm);
  if (!Array.isArray(payload.ItemList) || payload.ItemList.length === 0) {
    errors.push({ path: 'ItemList', msg: 'At least one item is required.' });
  }
  const items = Array.isArray(payload.ItemList) ? payload.ItemList : [];
  const tolerance = BigInt(pack.tolerance.value);
  items.forEach((item, index) => checkItem(item, index, errors, warnings, tolerance));
  const val = objectAt(payload, 'ValDtls', errors);
  if (val && items.length > 0) checkTotals(items, val, pack, errors, warnings);

  const applicability = reviewApplicability(pack, docIso, meta, warnings, noteConfirm);
  const valid = errors.length === 0;
  return done(valid, errors, warnings, confirm, applicability, pack);
}

function checkDocNo(value, pack, errors, warnings, noteConfirm) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push({ path: 'DocDtls.No', msg: 'Document number is required.' });
    return;
  }
  if ([...value].length > pack.maxChars) {
    errors.push({ path: 'DocDtls.No', msg: 'Document number is longer than 16 characters.' });
    return;
  }
  if (!pack.numberPattern.test(value)) {
    errors.push({ path: 'DocDtls.No', msg: 'Document number must use only letters, digits, hyphen, and slash.' });
    return;
  }
  if (pack.rejectLiterals.includes(value)) {
    errors.push({ path: 'DocDtls.No', msg: 'Document number "0" is rejected.' });
    noteConfirm();
    return;
  }
  if (/^[/]+$/.test(value)) {
    errors.push({ path: 'DocDtls.No', msg: 'Document number made only of slashes is rejected.' });
    noteConfirm();
    return;
  }
  if (pack.leadingRejected.includes(value[0])) {
    warnings.push('IRP practice rejects a document number that starts with 0, / or -. UNVERIFIED as a statutory bar.');
    noteConfirm();
  }
}

function checkSeller(seller, pack, errors) {
  requireText(seller, 'SellerDtls', ['Gstin', 'LglNm', 'Addr1', 'Loc', 'Pin', 'Stcd'], errors);
  if (typeof seller.Gstin === 'string') {
    const checked = validateGstin(seller.Gstin);
    if (!checked.valid) errors.push({ path: 'SellerDtls.Gstin', msg: checked.errors[0] ?? 'Supplier GSTIN is not valid.' });
    else if (seller.Stcd && checked.stateCode !== seller.Stcd) {
      errors.push({ path: 'SellerDtls.Stcd', msg: 'Supplier state code does not match the GSTIN.' });
    }
  }
  if (seller.Stcd && !pack.states.some((row) => row.code === seller.Stcd)) {
    errors.push({ path: 'SellerDtls.Stcd', msg: 'Supplier state code is not in the state table.' });
  }
  if (seller.Pin !== undefined && !/^[1-9][0-9]{5}$/.test(String(seller.Pin))) {
    errors.push({ path: 'SellerDtls.Pin', msg: 'Supplier PIN must be 6 digits.' });
  }
}

function checkBuyer(buyer, supTyp, pack, errors, warnings, noteConfirm) {
  requireText(buyer, 'BuyerDtls', ['Gstin', 'LglNm', 'Pos', 'Addr1', 'Loc', 'Stcd'], errors);
  const exportSupply = supTyp === 'EXPWP' || supTyp === 'EXPWOP';
  if (exportSupply) {
    if (buyer.Gstin !== pack.exportGstin.value) {
      errors.push({ path: 'BuyerDtls.Gstin', msg: `${supTyp} buyer GSTIN must be URP.` });
    }
    if (buyer.Pos !== pack.exportPos.value) errors.push({ path: 'BuyerDtls.Pos', msg: 'Export place of supply must be 96.' });
    if (buyer.Stcd !== pack.exportPos.value) errors.push({ path: 'BuyerDtls.Stcd', msg: 'Export recipient state code must be 96.' });
    if (needsConfirm(pack.exportPin)) {
      warnings.push('Export buyer PIN 999999 is IRP practice. The notified schema says a recipient PIN need not be mentioned. UNVERIFIED.');
      noteConfirm();
    }
    if (buyer.Pin !== undefined && String(buyer.Pin) !== pack.exportPin.value) {
      warnings.push('Export buyer PIN is not 999999.');
    }
  } else if (buyer.Gstin === 'URP') {
    errors.push({ path: 'BuyerDtls.Gstin', msg: `${supTyp || 'This supply'} needs a registered GSTIN. URP is for exports.` });
  } else if (typeof buyer.Gstin === 'string') {
    const checked = validateGstin(buyer.Gstin);
    if (!checked.valid) errors.push({ path: 'BuyerDtls.Gstin', msg: checked.errors[0] ?? 'Buyer GSTIN is not valid.' });
  }
  if (buyer.Pos && !pack.states.some((row) => row.code === buyer.Pos)) {
    errors.push({ path: 'BuyerDtls.Pos', msg: 'Place of supply is not in the state table.' });
  }
  if (buyer.Stcd && !pack.states.some((row) => row.code === buyer.Stcd)) {
    errors.push({ path: 'BuyerDtls.Stcd', msg: 'Buyer state code is not in the state table.' });
  }
}

function checkItem(item, index, errors, warnings, tolerance) {
  const path = `ItemList[${index}]`;
  if (!item || typeof item !== 'object') {
    errors.push({ path, msg: 'Item must be an object.' });
    return;
  }
  for (const key of ['SlNo', 'IsServc', 'HsnCd', 'UnitPrice', 'TotAmt', 'AssAmt', 'GstRt', 'TotItemVal']) {
    if (item[key] === undefined || item[key] === null || item[key] === '') {
      errors.push({ path: `${path}.${key}`, msg: `${key} is required.` });
    }
  }
  if (item.IsServc !== undefined && item.IsServc !== 'Y' && item.IsServc !== 'N') {
    errors.push({ path: `${path}.IsServc`, msg: 'IsServc must be Y or N.' });
  }
  if (typeof item.HsnCd === 'string' && !/^[0-9]{4,8}$/.test(item.HsnCd)) {
    errors.push({ path: `${path}.HsnCd`, msg: 'HSN/SAC must be 4 to 8 digits.' });
  }
  const ass = moneyAt(item.AssAmt, `${path}.AssAmt`, errors);
  const igst = moneyAt(item.IgstAmt ?? '0', `${path}.IgstAmt`, errors);
  const cgst = moneyAt(item.CgstAmt ?? '0', `${path}.CgstAmt`, errors);
  const sgst = moneyAt(item.SgstAmt ?? '0', `${path}.SgstAmt`, errors);
  const total = moneyAt(item.TotItemVal, `${path}.TotItemVal`, errors);
  if (ass !== null && ass < 0n) errors.push({ path: `${path}.AssAmt`, msg: 'Item taxable value cannot be negative. Use CRN with positive amounts.' });
  if (igst !== null && cgst !== null && igst !== 0n && (cgst !== 0n || (sgst !== null && sgst !== 0n))) {
    errors.push({ path: `${path}.IgstAmt`, msg: 'Report IGST or CGST and SGST/UTGST, not both.' });
  }
  const ces = moneyAt(item.CesAmt ?? '0', `${path}.CesAmt`, errors) ?? 0n;
  const oth = moneyAt(item.OthChrg ?? '0', `${path}.OthChrg`, errors) ?? 0n;
  if (ass !== null && igst !== null && cgst !== null && sgst !== null && total !== null) {
    const expected = ass + igst + cgst + sgst + ces + oth;
    const diff = total > expected ? total - expected : expected - total;
    if (diff !== 0n && diff <= tolerance) warnings.push(`rounding tolerance at ${path}.TotItemVal`);
    else if (diff > tolerance) errors.push({ path: `${path}.TotItemVal`, msg: 'Item totals mismatch.' });
  }
}

function checkTotals(items, val, pack, errors, warnings) {
  const tolerance = BigInt(pack.tolerance.value);
  const sums = {
    AssVal: 0n,
    IgstVal: 0n,
    CgstVal: 0n,
    SgstVal: 0n,
    TotItemVal: 0n,
  };
  for (const item of items) {
    sums.AssVal += moneyAt(item.AssAmt, 'ItemList.AssAmt', errors) ?? 0n;
    sums.IgstVal += moneyAt(item.IgstAmt ?? '0', 'ItemList.IgstAmt', errors) ?? 0n;
    sums.CgstVal += moneyAt(item.CgstAmt ?? '0', 'ItemList.CgstAmt', errors) ?? 0n;
    sums.SgstVal += moneyAt(item.SgstAmt ?? '0', 'ItemList.SgstAmt', errors) ?? 0n;
    sums.TotItemVal += moneyAt(item.TotItemVal, 'ItemList.TotItemVal', errors) ?? 0n;
  }
  compareTotal(val.AssVal, sums.AssVal, 'ValDtls.AssVal', tolerance, errors, warnings);
  compareTotal(val.IgstVal ?? '0', sums.IgstVal, 'ValDtls.IgstVal', tolerance, errors, warnings);
  compareTotal(val.CgstVal ?? '0', sums.CgstVal, 'ValDtls.CgstVal', tolerance, errors, warnings);
  compareTotal(val.SgstVal ?? '0', sums.SgstVal, 'ValDtls.SgstVal', tolerance, errors, warnings);
  if (val.TotInvVal === undefined || val.TotInvVal === null || val.TotInvVal === '') {
    errors.push({ path: 'ValDtls.TotInvVal', msg: 'TotInvVal is required.' });
    return;
  }
  const rnd = moneyAt(val.RndOffAmt ?? '0', 'ValDtls.RndOffAmt', errors) ?? 0n;
  const oth = moneyAt(val.OthChrg ?? '0', 'ValDtls.OthChrg', errors) ?? 0n;
  const discount = moneyAt(val.Discount ?? '0', 'ValDtls.Discount', errors) ?? 0n;
  const expected = sums.TotItemVal + rnd + oth - discount;
  compareTotal(val.TotInvVal, expected, 'ValDtls.TotInvVal', tolerance, errors, warnings);
}

function compareTotal(actual, expected, path, tolerance, errors, warnings) {
  const got = moneyAt(actual, path, errors);
  if (got === null) return;
  const diff = got > expected ? got - expected : expected - got;
  if (diff === 0n) return;
  if (diff <= tolerance) warnings.push(`rounding tolerance at ${path}`);
  else errors.push({ path, msg: 'Item totals mismatch.' });
}

function reviewApplicability(pack, docIso, meta, warnings, noteConfirm) {
  const aatoText = meta.aato;
  let aato = null;
  if (aatoText !== undefined && aatoText !== null && aatoText !== '') {
    try {
      aato = typeof aatoText === 'bigint' ? aatoText : parseAmount(String(aatoText));
    } catch (error) {
      warnings.push(`AATO was not read (${error.message}).`);
    }
  }
  const asOf = typeof meta.asOf === 'string' ? meta.asOf : istDate();
  let asOfOk = false;
  try {
    parseIsoDate(asOf);
    asOfOk = true;
  } catch {
    warnings.push('asOf is not a YYYY-MM-DD date. The 30-day check was skipped.');
  }
  let mandatory = null;
  let reason = 'AATO was not provided, so e-invoice applicability was not decided.';
  if (aato === null) warnings.push(reason);
  else if (!docIso) reason = 'Document date was not a valid DD/MM/YYYY date, so applicability was not decided.';
  else if (docIso < pack.mandatory.value.from) {
    mandatory = false;
    reason = `The bundled ₹5 crore threshold starts on ${pack.mandatory.value.from}.`;
  } else if (aato > BigInt(pack.mandatory.value.abovePaise)) {
    mandatory = true;
    reason = 'AATO exceeds ₹5 crore in the figure you gave, and the document date is on or after 1 Aug 2023.';
  } else {
    mandatory = false;
    reason = 'This AATO does not exceed ₹5 crore. An earlier financial year from 2017-18 still could.';
    warnings.push(reason);
  }
  const reporting = pack.reporting.value;
  if (docIso && aato !== null && asOfOk && asOf >= reporting.from && aato >= BigInt(reporting.fromPaise) && daysBetween(docIso, asOf) >= reporting.blockWhenAgeDaysAtLeast) {
    warnings.push('30-day IRP limit');
  }
  if (typeof meta.taxpayerClass === 'string' && pack.exempt.value.includes(meta.taxpayerClass)) {
    warnings.push('may be exempt — confirm');
    noteConfirm();
  }
  if (meta.cancel === true) {
    const hours = meta.irnAgeHours;
    if (typeof hours !== 'number' || hours > pack.irnHours.value) {
      warnings.push('IRN cancellation is described as 24 hours in IRP documentation. UNVERIFIED.');
    }
    noteConfirm();
  }
  return { mandatory, reason, asOf, irpSubmitted: false };
}

function supplyCode(invoice, errors) {
  if (invoice.supplyType === 'export') return invoice.lut ? 'EXPWOP' : 'EXPWP';
  if (invoice.supplyType === 'sez') return invoice.lut ? 'SEZWOP' : 'SEZWP';
  if (invoice.supplyType === 'deemed-export') return 'DEXP';
  if (!invoice.recipient?.gstin) {
    errors.push({ path: 'BuyerDtls.Gstin', msg: 'A domestic e-invoice needs the recipient GSTIN. B2C is out of scope. This skill does not submit to the IRP.' });
    return null;
  }
  return 'B2B';
}

function docCode(documentType, errors) {
  if (documentType === 'credit-note') return 'CRN';
  if (documentType === 'debit-note') return 'DBN';
  if (documentType === 'invoice' || documentType === undefined) return 'INV';
  errors.push({ path: 'DocDtls.Typ', msg: 'documentType must be invoice, credit-note, or debit-note.' });
  return null;
}

function loadPack(onDate) {
  parseIsoDate(onDate);
  const gst = loadDomain('gst');
  const ids = loadDomain('ids');
  const asOf = gst.asOf <= ids.asOf ? gst.asOf : ids.asOf;
  return {
    disclaimerText: disclaimer(asOf),
    states: ruleById('gst', 'gst.stateCodes', onDate).value,
    version: ruleById('gst', 'gst.einvoice.version', onDate),
    taxScheme: ruleById('gst', 'gst.einvoice.taxScheme', onDate),
    supplyTypes: ruleById('gst', 'gst.einvoice.supplyTypes', onDate),
    documentTypes: ruleById('gst', 'gst.einvoice.documentTypes', onDate),
    exportGstin: ruleById('gst', 'gst.einvoice.export.gstin', onDate),
    exportPin: ruleById('gst', 'gst.einvoice.export.pin', onDate),
    exportPos: ruleById('gst', 'gst.einvoice.export.pos', onDate),
    mandatory: ruleById('gst', 'gst.einvoice.aato.mandatory', onDate),
    reporting: ruleById('gst', 'gst.einvoice.reporting', onDate),
    tolerance: ruleById('gst', 'gst.einvoice.roundingTolerancePaise', onDate),
    irnHours: ruleById('gst', 'gst.einvoice.irnCancelHours', onDate),
    exempt: ruleById('gst', 'gst.einvoice.exemptClasses', onDate),
    numberPattern: compileAnchored(ruleById('gst', 'gst.invoice.number.pattern', onDate).value, 'gst.invoice.number.pattern'),
    maxChars: ruleById('gst', 'gst.invoice.number.maxChars', onDate).value,
    rejectLiterals: ruleById('gst', 'gst.invoice.number.rejectLiterals', onDate).value,
    leadingRejected: ruleById('gst', 'gst.invoice.number.leadingRejectedByIrp', onDate).value,
  };
}

function objectAt(payload, key, errors) {
  const value = payload[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push({ path: key, msg: `${key} is required.` });
    return null;
  }
  return value;
}

function requireText(obj, prefix, keys, errors) {
  for (const key of keys) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === '') {
      errors.push({ path: `${prefix}.${key}`, msg: `${key} is required.` });
    }
  }
}

function moneyAt(value, path, errors) {
  if (typeof value === 'string') {
    try {
      return parseAmount(value.trim());
    } catch (error) {
      errors.push({ path, msg: error.message });
      return null;
    }
  }
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    try {
      return parseAmount(`${value}.00`);
    } catch (error) {
      errors.push({ path, msg: error.message });
      return null;
    }
  }
  errors.push({ path, msg: 'Amount must be a decimal string of rupees.' });
  return null;
}

function sumField(items, key) {
  let sum = 0n;
  for (const item of items) sum += parseAmount(item[key]);
  return sum;
}

function absMinor(minor) {
  return minor < 0n ? -minor : minor;
}

function bpToPercent(bp) {
  const rate = Number(bp);
  const digits = String(Math.abs(rate)).padStart(3, '0');
  const text = `${digits.slice(0, -2)}.${digits.slice(-2)}`.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return text === '' ? '0' : text;
}

function toDmy(iso) {
  const { y, m, d } = parseIsoDate(iso);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function fromDmy(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  try {
    parseIsoDate(iso);
    return iso;
  } catch {
    return null;
  }
}

function civilDay(iso) {
  const { y, m, d } = parseIsoDate(iso);
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function done(valid, errors, warnings, confirm, applicability, pack) {
  if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
  return {
    valid,
    errors,
    warnings,
    confirm,
    applicability,
    disclaimer: pack?.disclaimerText ?? safeDisclaimer(),
    irpSubmitted: false,
  };
}

function fail(errors, warnings, confirm) {
  if (confirm && !warnings.includes(CONFIRM_SENTENCE)) warnings.push(CONFIRM_SENTENCE);
  return {
    valid: false,
    einvoice: null,
    errors,
    warnings,
    confirm,
    applicability: null,
    disclaimer: safeDisclaimer(),
    irpSubmitted: false,
  };
}

function blank() {
  return {
    valid: false,
    einvoice: null,
    errors: [],
    warnings: [],
    confirm: false,
    applicability: null,
    disclaimer: safeDisclaimer(),
    irpSubmitted: false,
  };
}

function safeDisclaimer() {
  try {
    return disclaimer(loadDomain('gst').asOf);
  } catch {
    return disclaimer('2026-11-01');
  }
}

function guard(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'JSON must be an object.';
  let encoded;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return 'JSON could not be read.';
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
