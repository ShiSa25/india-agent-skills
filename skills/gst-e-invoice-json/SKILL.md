---
name: gst-e-invoice-json
description: >-
  Build and validate GST e-invoice JSON for schema 1.1 (B2B, SEZ, export, and
  deemed export), including the AATO threshold and the 30-day IRP reporting
  check. Use when a user needs an IRN payload or a schema check. Never submits
  the payload to the IRP or the GST portal.
license: MIT
compatibility: Requires Node.js 20 or newer. No network and no runtime dependencies.
metadata: { version: "0.1.0", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---

# GST e-invoice JSON

Build or validate a schema 1.1 payload. Run the script. Do not post it to an Invoice Registration Portal. `irpSubmitted` is always false. There is no network call.

## When to use

- A user needs e-invoice JSON for a B2B invoice, credit note, or debit note, or for an SEZ, export, or deemed-export document.
- A user pasted a payload and wants it checked against schema 1.1.
- The question is whether e-invoicing is mandatory at a given AATO, or whether a document is inside the 30-day reporting window.

Do not use this skill to obtain an IRN, a signed QR, or an acknowledgement. Build the tax invoice with `gst-invoice` first. This skill reads that invoice and does not recompute the rate. It does not call `einvoice.gst.gov.in` or any IRP.

## Quick start

From the skill directory, after you have the invoice object from `gst-invoice` (the CLI wrapper, or its `invoice` field):

```bash
node scripts/build-einvoice.mjs --json '<gst-invoice result>'
node scripts/validate-einvoice.mjs --json '<schema object>'
node scripts/validate-einvoice.mjs --json '{"einvoice":<schema>,"aato":"120000000.00","asOf":"2026-05-02"}'
```

Exit codes: `0` valid, `1` invalid, `2` usage error. Stdout is one JSON object.

A minimal B2B payload from a real `buildEinvoice` run, exit 0, `confirm` false:

```json
{
  "Version": "1.1",
  "TranDtls": { "TaxSch": "GST", "SupTyp": "B2B", "RegRev": "N", "IgstOnIntra": "N" },
  "DocDtls": { "Typ": "INV", "No": "INV/2026-27/0001", "Dt": "15/04/2026" },
  "ValDtls": { "AssVal": "42000.00", "IgstVal": "7560.00", "CgstVal": "0.00", "SgstVal": "0.00", "TotInvVal": "49560.00" }
}
```

`Dt` is `DD/MM/YYYY`. Money fields are decimal strings, not JSON numbers, so paise stay exact. The portal's samples use numbers; this pack does not emit floats.

Imports: `buildEinvoice` and `validateEinvoice` from `scripts/einvoice.mjs`.

## Rules

Rules data is `scripts/_rules/gst.json`, as of 2026-11-01.

- Schema 1.1 was notified by [Notification 60/2020](https://einvoice.gst.gov.in/uiassets/js/assets/files/60%20of%202020%20Dt.%2030-7-2020%20-%20Revised%20schema%201.1%20notified.pdf) (30 July 2020). An older draft PDF says `1.00`. Emit `"Version":"1.1"`.
- `TranDtls.TaxSch` is `GST`. `SupTyp` is `B2B`, `SEZWP`, `SEZWOP`, `EXPWP`, `EXPWOP`, or `DEXP`. `RegRev` is `Y` or `N`. The notified schema marks reverse charge optional; this skill requires it because the field decides who pays.
- `DocDtls.Typ` is `INV`, `CRN`, or `DBN`. `No` is at most 16 characters, the Rule 46 set. `Dt` must be `DD/MM/YYYY`. `2026-04-01` is an error.
- Seller: GSTIN, legal name, address, location, PIN, state code. Buyer: GSTIN, legal name, place of supply, address, location, state code. Item: serial, goods or service, HSN/SAC, unit price, gross, taxable value, GST rate, item total. `ValDtls.AssVal` and `TotInvVal` are required. Totals must match the items.
- Export buyer: `Gstin` `URP`, `Pos` `96`, `Stcd` `96`. The notified schema names `URP`. `Pin` `999999` is IRP practice and is UNVERIFIED (the schema says an export PIN need not be given). Emitting it sets `confirm`. `EXPWOP` or `EXPWP` with any other GSTIN is an error.
- SEZ with LUT is `SEZWOP`. SEZ with payment is `SEZWP`. `IgstOnIntra` is `Y` when IGST applies inside one state. A credit note is positive amounts with `Typ` `CRN`, not negative item values. The schema says taxable value cannot be negative.
- Totals: a gap of ₹1 or less is a warning (`rounding tolerance`). A larger gap is `Item totals mismatch.`
- Applicability, from [Notification 10/2023](https://tutorial.gst.gov.in/einvoice/files/Notification_No._10_2023.pdf): on or after 1 August 2023, e-invoicing is mandatory when AATO exceeds ₹5 crore (strictly greater) in any preceding financial year from 2017-18. ₹5 crore exactly does not cross it. One figure cannot prove that no earlier year did.
- Reporting, from the [GSTN advisory](https://einvoice1.gst.gov.in/Documents/advisory270325.pdf) opened 2026-11-01 (advisory 543 of 5 November 2024): from 1 April 2025, a taxpayer with AATO of ₹10 crore or more cannot report an invoice, credit note, or debit note after the 30-day window. An invoice dated 1 April 2025 cannot be reported after 30 April 2025. The script warns `30-day IRP limit` when the reporting date is 30 or more civil days after the document date. A 31-day-old document with AATO ₹12 crore warns. It does not make the JSON invalid, and it does not submit the document.
- IRN cancellation within 24 hours is UNVERIFIED. Asking to cancel sets `confirm`. Exempt classes (SEZ unit, insurer, bank, NBFC, GTA, passenger transport, multiplex) print `may be exempt — confirm` and set `confirm`. They do not switch the turnover result off.
- `"0"` and a slash-only document number are rejected. A leading `0`, `/` or `-` warns. That IRP practice is UNVERIFIED as a statutory rule.

## Edge cases

- Pass `aato` as a rupee string (`"120000000.00"` is ₹12 crore) and `asOf` as `YYYY-MM-DD`. Without `asOf`, the reporting date is today in IST.
- AATO under ₹10 crore does not get the 30-day warning. A reporting date before 1 April 2025 does not either.
- A domestic recipient without a GSTIN is not built. B2C is out of scope. Say so, and do not invent `B2C`.
- Supplier PIN and location are required here even though a paper invoice can omit them. Address lines longer than 100 characters are rejected for `Addr1`.
- Item tax is either IGST or CGST plus SGST/UTGST, not both. UTGST is carried in `SgstAmt`, which is the schema's shared field.
- A gap of ₹1.01 on `AssVal` or `TotInvVal` is an error. A gap of ₹1.00 is only a warning.
- Do not add an IRN. The portal generates it. Do not tell the user the payload has been registered.

## Example prompts

- Build schema 1.1 JSON for this B2B invoice. Do not call the IRP.
- This export is without payment of IGST. The buyer has a GSTIN. What is wrong?
- The document date is 2026-04-01. Is that the e-invoice format?
- This credit note is 31 days old and our AATO is ₹12 crore. Can we still report it?
- Our turnover is exactly ₹5 crore. Is e-invoicing mandatory?

## Disclaimer

This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.
