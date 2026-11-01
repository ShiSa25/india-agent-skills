---
name: gst-invoice
description: >-
  Build an Indian GST tax invoice, credit note, or debit note: Rule 46 fields,
  CGST and SGST or UTGST, IGST for inter-state, export, and SEZ supplies, LUT
  endorsements, and paise rounding. Use when creating an invoice, a credit note,
  or an export or SEZ bill. Does not file a return or call the GST portal.
license: MIT
compatibility: Requires Node.js 20 or newer. No network and no runtime dependencies.
metadata: { version: "0.1.1", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---

# GST invoice

Build a tax invoice, credit note, or debit note. Run the script. Do not recompute tax in the prompt, and do not submit the document to the GST portal.

## When to use

- A user wants a tax invoice, credit note, or debit note with CGST, SGST or UTGST, and IGST.
- The supply is intra-state, inter-state, an export, or to an SEZ unit or developer, including export of services under a letter of undertaking.
- You need the Rule 46 endorsement, the place of supply, or the amount in words.

Do not use this skill to file GSTR-1, to generate an IRN, or to decide that a GSTIN is active. Check the GSTIN with `gstin-validator` when the question is only the checksum. For the IRN payload, use `gst-e-invoice-json` after this invoice exists. This skill never calls the portal.

## Quick start

From the skill directory:

```bash
node scripts/build-invoice.mjs --json '{"supplier":{"name":"Acme Supplies","address":"1 Test Road, Bengaluru","gstin":"29AABCC1234A1ZD","stateCode":"29","pin":"560001","loc":"Bengaluru"},"recipient":{"name":"Beta Buyers","address":"2 Sample Lane, Mumbai","gstin":"27AABCC1234A1ZH","stateCode":"27","pin":"400001","loc":"Mumbai"},"invoiceNumber":"INV/2026-27/0001","invoiceDate":"2026-04-15","placeOfSupply":"27","supplyType":"domestic","reverseCharge":false,"signature":"Authorised signatory","priorNumbers":[],"lines":[{"description":"Consulting","hsn":"998313","quantity":"1","unit":"NOS","taxable":"42000.00","rateBp":1800,"service":true}]}'
```

Exit codes: `0` usable, `1` rejected, `2` usage error. Stdout is one JSON object. Amounts are rupee strings. `portalSubmitted` is false.

Real run of that command, exit 0. `html` is omitted here; the object also contains it.

```json
{
  "valid": true,
  "confirm": false,
  "portalSubmitted": false,
  "invoice": {
    "fy": "2026-27",
    "interState": true,
    "localTax": "IGST",
    "endorsement": null,
    "totals": { "taxable": "42000.00", "cgst": "0.00", "sgst": "0.00", "igst": "7560.00", "grand": "49560.00" },
    "amountInWords": "Rupees Forty-Nine Thousand Five Hundred Sixty Only"
  }
}
```

`rateBp` is basis points (18% is `1800`). `ratePercent` accepts `"18"`, `"0.25"`, `"1.5"`, and `"0.1"`. `taxable` is after discount. `priorNumbers` is the list already used in that financial year; omit it and the script warns that uniqueness was not checked.

Imports: `buildInvoice`, `taxSplit`, and `roundPayableToRupee` from `scripts/build-invoice.mjs`. `taxSplit` returns bigint paise and `cess` of `0n`.

## Rules

Rules data is `scripts/_rules/gst.json`, as of 2026-11-01. Do not hardcode a rate or a threshold that contradicts that file.

- Intra-state (supplier state equals place of supply): CGST and SGST are each half the rate, rounded half-up per head. In Chandigarh (`04`), Dadra and Nagar Haveli and Daman and Diu (`26`), Lakshadweep (`31`), Andaman and Nicobar (`35`), and Ladakh (`38`) the local head is labelled UTGST. That code list is UNVERIFIED, so `confirm` is true. Delhi and Puducherry stay SGST.
- Inter-state: IGST at the full rate. [IGST section 7](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapteriv/section7_v1.00.html).
- SEZ supplies are always inter-state, even in the same state (section 7(5)(b) and the section 8 proviso). `igstOnIntra` is true when the states match. Under LUT, IGST is 0. With payment, IGST is charged.
- Export under LUT: IGST 0 and this sentence, byte for byte: `SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX`. With payment of tax, IGST is charged and the sentence ends `ON PAYMENT OF INTEGRATED TAX`. Also require the recipient address, the delivery address, and the country of destination. Place of supply is `96`.
- Services, when `placeOfSupply` is omitted: IGST section 12(2) if both parties are in India (registered recipient's location; otherwise the address on record; otherwise the supplier). Section 13(2) when either party is outside India. The script warns that sections 12(3) to 12(14) and 13(3) to 13(13), including intermediary services, can differ. Pass `placeOfSupply` when you know it. Goods do not infer a place of supply.
- [Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html), opened 2026-11-01. Number matches `^[A-Za-z0-9/-]{1,16}$`, consecutive, unique in the financial year (1 April–31 March, IST). Required: supplier name, address, and GSTIN; number; date; recipient name and address; GSTIN or UIN if registered; place of supply with state name and code when inter-state; HSN/SAC; description; quantity and unit for goods; taxable value after discount; rate and tax; reverse charge; signature. An unregistered recipient at or above ₹50,000 also needs the delivery address and the state (clause (e)).
- `"0"` and a slash-only number are rejected. A number that starts with `0`, `/` or `-` is warned. Those bars are UNVERIFIED against Rule 46 and set `confirm`.
- Tax is computed per line in paise, half-up, away from zero. [Section 170](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter21/section170_v1.00.html) rounds each tax head of the amount payable to the nearest rupee (50 paise rounds up). The invoice still shows paise. `taxPayableRounded` is that payable. `roundOff: true` adds a line that rounds the grand total to the rupee. Do not add the rounded heads back onto the lines.
- Rates are whatever the user supplies. Known examples, in basis points: 0, 10, 25, 150, 300, 500, 1200, 1800, 2800. Anything else warns. GST 2.0 is UNVERIFIED. Never infer a rate from the HSN.
- A credit note's taxable value is negative. A debit note's is positive. Both need `originalInvoiceNumber` and `originalInvoiceDate`.
- The financial year of 2026-03-31 is `2025-26`. The financial year of 2026-04-01 is `2026-27`.

## Edge cases

- ₹0.03 at 1,800 bp is ₹0.01 of IGST. ₹0.02 is ₹0.00. Two lines of ₹0.03 sum to ₹0.02, not the tax on ₹0.06.
- ₹25.00 at 18% inter-state is IGST ₹4.50, which section 170 rounds to ₹5.00. The same value intra-state is CGST ₹2.25 and SGST ₹2.25, which round to ₹2.00 and ₹2.00. Rounding each head is not the same as rounding the total.
- 0.25% (25 bp) intra-state on ₹100 is 13 paise and 13 paise. IGST on the same value is 25 paise. The halves are rounded separately.
- `INV/2026-27/0001` is 16 characters and is accepted. `INV/2026-27/00001` is 17 and is rejected.
- A credit note of −₹1,000 at 18% inter-state is IGST −₹180.
- An export LUT invoice shows rate 0 on the line and keeps `nominalRateBp` for the rate you typed. The charged tax is zero.
- Pass `electronicInvoice: true` only for an electronic invoice under the Information Technology Act, 2000, where Rule 46 drops the signature.
- Code `25` or `28` warns `legacy state code`. Code `96` is a place of supply, not a supplier GSTIN.
- The rupee sign in the HTML is `₹`. The script does not write `Rs.`.
- Amounts in words use Thousand, Lakh, and Crore. Above 99 crore the same scale continues ("Hundred Crore"). There is no "Arab". The helper is `scripts/words.mjs`, so an installed copy of this skill stands on its own. The same scale lives in `inr-formatting`.

## Example prompts

- Create an intra-state tax invoice for ₹42,000 at 18%.
- The SEZ unit is in my state. Is this IGST or CGST and SGST?
- Export of services under LUT. Put the endorsement on the invoice and do not charge IGST.
- Credit note for ₹1,000 at 18% against invoice INV/2026-27/0001.
- The invoice number is 17 characters. Can I use it?

## Disclaimer

This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.
