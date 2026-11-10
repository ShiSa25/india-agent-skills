# How to use these skills

This is the long form of the section in the [README](../README.md). Commands were checked on 1 Nov 2026 against [Codex](https://developers.openai.com/codex/skills), [Claude Code skills](https://code.claude.com/docs/en/skills), [Claude Code plugins](https://code.claude.com/docs/en/plugins/install), [Cursor](https://cursor.com/docs/skills), and the [skills CLI](https://github.com/vercel-labs/skills). Slash-command syntax moves. If a command misses, use the page for that tool.

Tax, legal, and payment output is an aid. Confirm it with the official source or a qualified professional before you file, invoice, or pay. If `confirm` is true, keep the flag and the sentence `Confirm with the official source before relying on this.`

The JSON below is stdout from this repo, pretty-printed. A trimmed block names every key that was removed. Values are copied from the run.

## How a skill gets loaded

A skill is a folder with a `SKILL.md`. The frontmatter `description` says what it does and when to use it. The agent starts with that description, not the whole file. If your request matches, it loads the instructions and can run the scripts in the folder.

| Tool | Name it yourself | Let it match |
| --- | --- | --- |
| Codex | `$gstin-validator` in the prompt, or `/skills`. The same `$` form works for every skill name. | The description matches the request |
| Claude Code, installed as a plugin from this repo | `/india-agent-skills:gstin-validator` | Same. Replace the name after the colon. |
| Claude Code, folder at `.claude/skills/<skill>` | `/gstin-validator` | Same |
| Cursor | `/gstin-validator` in Agent chat. Option+Enter (Alt+Enter) keeps it for the session | Same |

`npx skills add ShiSa25/india-agent-skills` copies every skill in this repo into the directory the agent already scans. One skill: `npx skills add ShiSa25/india-agent-skills --skill <name>`. All 13 folders are present at v0.1.2.

## When to use which skill

| Situation | Skill | Example prompt |
| --- | --- | --- |
| You have a GSTIN and want the state and the checksum | `gstin-validator` | Validate this GSTIN and tell me the state: 27AAACR5055K1Z7 |
| You need a tax invoice, credit note, or export bill | `gst-invoice` | Create an intra-state tax invoice for ₹42,000 at 18%. |
| You need e-invoice JSON and you will not call the IRP | `gst-e-invoice-json` | Build schema 1.1 JSON for this B2B invoice. Do not call the IRP. |
| A foreign or SEZ client, LUT, or FEMA deadline | `freelancer-export-compliance` | Invoice date 2026-03-15 to a US client. What is my FY, LUT, and the GST and FEMA deadlines? |
| TDS on a contractor or professional fee | `tds-freelancer-payments` | Company paying a professional ₹11,000 on 2026-06-01, with ₹40,000 already unpaid this year. How much TDS, and what if there is no PAN on ₹60,000? |
| Razorpay checkout or webhook | `razorpay-integration` | Add Razorpay webhook verification to my Express app. Fulfil only on payment.captured. |
| Cashfree webhook | `cashfree-integration` | Verify this Cashfree webhook and reject a stale timestamp. |
| A UPI link or QR | `upi-payment-links` | UPI link for merchant@upi, name "Shiv & Co", amount 499.00, plus a QR. |
| Rupees in Indian grouping or in words | `inr-formatting` | Format 123456789.50 rupees in Indian grouping and in words. |
| PAN, TAN, IFSC, PIN, or a mobile number | `indian-id-validators` | Check this PAN and this IFSC. Do not look the IFSC up online. |
| Text that may contain an Aadhaar number | `aadhaar-safe-handling` | Mask Aadhaar numbers in this text. Do not log a full number. |
| A schema that stores personal data | `dpdp-compliance-check` | Scan this Prisma schema and give me a DPDP checklist as of 2026-11-01. |
| An OTP SMS or a DLT template | `sms-otp-dlt` | Lint this DLT template and show a 6-digit OTP that is never logged. |

## gstin-validator

```bash
node skills/gstin-validator/scripts/validate-gstin.mjs --json '27AAACR5055K1Z7'
```

Exit `0`.

```json
{
  "valid": true,
  "normalized": "27AAACR5055K1Z7",
  "type": "regular",
  "stateCode": "27",
  "stateName": "Maharashtra",
  "pan": "AAACR5055K",
  "tan": null,
  "errors": [],
  "warnings": [
    "Checksum valid ≠ registered/active; check services.gst.gov.in/services/searchtp"
  ],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

```bash
node skills/gstin-validator/scripts/validate-gstin.mjs --json '9917USA00013OS5'
```

Exit `1` for `9917USA00013OS5`:

```json
{
  "valid": false,
  "normalized": "9917USA00013OS5",
  "type": "nrtp_oidar",
  "stateCode": "99",
  "stateName": "Centre Jurisdiction",
  "pan": null,
  "tan": null,
  "errors": [
    "Checksum does not match (expected P)."
  ],
  "warnings": [],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

## gst-invoice

Exit `0`. `html` is omitted. The rest of the object is the stdout.

```bash
node skills/gst-invoice/scripts/build-invoice.mjs --json '{"supplier":{"name":"Acme Supplies","address":"1 Test Road, Bengaluru","gstin":"29AABCC1234A1ZD","stateCode":"29","pin":"560001","loc":"Bengaluru"},"recipient":{"name":"Beta Buyers","address":"2 Sample Lane, Mumbai","gstin":"27AABCC1234A1ZH","stateCode":"27","pin":"400001","loc":"Mumbai"},"invoiceNumber":"INV/2026-27/0001","invoiceDate":"2026-04-15","placeOfSupply":"27","supplyType":"domestic","reverseCharge":false,"signature":"Authorised signatory","priorNumbers":[],"lines":[{"description":"Consulting","hsn":"998313","quantity":"1","unit":"NOS","taxable":"42000.00","rateBp":1800,"service":true}]}'
```

```json
{
  "valid": true,
  "invoice": {
    "documentType": "invoice",
    "invoiceNumber": "INV/2026-27/0001",
    "invoiceDate": "2026-04-15",
    "fy": "2026-27",
    "supplyType": "domestic",
    "supplyKind": "services",
    "placeOfSupply": {
      "code": "27",
      "name": "Maharashtra"
    },
    "interState": true,
    "igstOnIntra": false,
    "localTax": "IGST",
    "reverseCharge": false,
    "lut": false,
    "endorsement": null,
    "country": "India",
    "supplier": {
      "name": "Acme Supplies",
      "address": "1 Test Road, Bengaluru",
      "loc": "Bengaluru",
      "pin": "560001",
      "gstin": "29AABCC1234A1ZD",
      "stateCode": "29",
      "stateName": "Karnataka"
    },
    "recipient": {
      "name": "Beta Buyers",
      "address": "2 Sample Lane, Mumbai",
      "loc": "Mumbai",
      "pin": "400001",
      "gstin": "27AABCC1234A1ZH",
      "stateCode": "27",
      "stateName": "Maharashtra",
      "deliveryAddress": "2 Sample Lane, Mumbai"
    },
    "lines": [
      {
        "description": "Consulting",
        "hsn": "998313",
        "quantity": "1",
        "unit": "NOS",
        "service": true,
        "discount": "0.00",
        "taxable": "42000.00",
        "rateBp": 1800,
        "nominalRateBp": 1800,
        "cgst": "0.00",
        "sgst": "0.00",
        "utgst": "0.00",
        "igst": "7560.00",
        "cess": "0.00",
        "total": "49560.00",
        "localTax": "IGST"
      }
    ],
    "totals": {
      "taxable": "42000.00",
      "cgst": "0.00",
      "sgst": "0.00",
      "utgst": "0.00",
      "igst": "7560.00",
      "cess": "0.00",
      "roundOff": "0.00",
      "grand": "49560.00",
      "taxPayableRounded": {
        "cgst": "0.00",
        "sgst": "0.00",
        "utgst": "0.00",
        "igst": "7560.00",
        "cess": "0.00"
      }
    },
    "amountInWords": "Rupees Forty-Nine Thousand Five Hundred Sixty Only",
    "signature": "Authorised signatory",
    "originalInvoice": null
  },
  "warnings": [],
  "confirm": false,
  "errors": [],
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.",
  "portalSubmitted": false
}
```

Export under LUT. Exit `0`. `html` is omitted.

```bash
node skills/gst-invoice/scripts/build-invoice.mjs --json '{"supplier":{"name":"Acme Supplies","address":"1 Test Road, Bengaluru","gstin":"29AABCC1234A1ZD","stateCode":"29","pin":"560001","loc":"Bengaluru"},"recipient":{"name":"US Client","address":"1 Market Street","loc":"San Francisco","country":"United States","deliveryAddress":"1 Market Street, San Francisco"},"invoiceNumber":"EXP/2025-26/0001","invoiceDate":"2026-03-15","placeOfSupply":"96","supplyType":"export","supplyKind":"services","lut":true,"reverseCharge":false,"signature":"Authorised signatory","priorNumbers":[],"lines":[{"description":"Software services","hsn":"998314","quantity":"1","unit":"NOS","taxable":"100000.00","rateBp":1800,"service":true}]}'
```

```json
{
  "valid": true,
  "invoice": {
    "documentType": "invoice",
    "invoiceNumber": "EXP/2025-26/0001",
    "invoiceDate": "2026-03-15",
    "fy": "2025-26",
    "supplyType": "export",
    "supplyKind": "services",
    "placeOfSupply": {
      "code": "96",
      "name": "Other Countries"
    },
    "interState": true,
    "igstOnIntra": false,
    "localTax": "IGST",
    "reverseCharge": false,
    "lut": true,
    "endorsement": "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
    "country": "United States",
    "supplier": {
      "name": "Acme Supplies",
      "address": "1 Test Road, Bengaluru",
      "loc": "Bengaluru",
      "pin": "560001",
      "gstin": "29AABCC1234A1ZD",
      "stateCode": "29",
      "stateName": "Karnataka"
    },
    "recipient": {
      "name": "US Client",
      "address": "1 Market Street",
      "loc": "San Francisco",
      "pin": null,
      "gstin": null,
      "stateCode": "",
      "stateName": "",
      "deliveryAddress": "1 Market Street, San Francisco"
    },
    "lines": [
      {
        "description": "Software services",
        "hsn": "998314",
        "quantity": "1",
        "unit": "NOS",
        "service": true,
        "discount": "0.00",
        "taxable": "100000.00",
        "rateBp": 0,
        "nominalRateBp": 1800,
        "cgst": "0.00",
        "sgst": "0.00",
        "utgst": "0.00",
        "igst": "0.00",
        "cess": "0.00",
        "total": "100000.00",
        "localTax": "IGST"
      }
    ],
    "totals": {
      "taxable": "100000.00",
      "cgst": "0.00",
      "sgst": "0.00",
      "utgst": "0.00",
      "igst": "0.00",
      "cess": "0.00",
      "roundOff": "0.00",
      "grand": "100000.00",
      "taxPayableRounded": {
        "cgst": "0.00",
        "sgst": "0.00",
        "utgst": "0.00",
        "igst": "0.00",
        "cess": "0.00"
      }
    },
    "amountInWords": "Rupees One Lakh Only",
    "signature": "Authorised signatory",
    "originalInvoice": null
  },
  "warnings": [],
  "confirm": false,
  "errors": [],
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.",
  "portalSubmitted": false
}
```

The endorsement string is byte-exact:

`SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX`

## gst-e-invoice-json

Input: the inter-state `gst-invoice` stdout above, including `html`. Exit `0`. Full object:

```bash
node skills/gst-e-invoice-json/scripts/build-einvoice.mjs --json '<gst-invoice stdout>'
```

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    "AATO was not provided, so e-invoice applicability was not decided."
  ],
  "confirm": false,
  "applicability": {
    "mandatory": null,
    "reason": "AATO was not provided, so e-invoice applicability was not decided.",
    "asOf": "2026-11-01",
    "irpSubmitted": false
  },
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.",
  "irpSubmitted": false,
  "einvoice": {
    "Version": "1.1",
    "TranDtls": {
      "TaxSch": "GST",
      "SupTyp": "B2B",
      "RegRev": "N",
      "IgstOnIntra": "N"
    },
    "DocDtls": {
      "Typ": "INV",
      "No": "INV/2026-27/0001",
      "Dt": "15/04/2026"
    },
    "SellerDtls": {
      "Gstin": "29AABCC1234A1ZD",
      "LglNm": "Acme Supplies",
      "Addr1": "1 Test Road, Bengaluru",
      "Loc": "Bengaluru",
      "Pin": "560001",
      "Stcd": "29"
    },
    "BuyerDtls": {
      "Gstin": "27AABCC1234A1ZH",
      "LglNm": "Beta Buyers",
      "Pos": "27",
      "Addr1": "2 Sample Lane, Mumbai",
      "Loc": "Mumbai",
      "Stcd": "27",
      "Pin": "400001"
    },
    "ItemList": [
      {
        "SlNo": "1",
        "PrdDesc": "Consulting",
        "IsServc": "Y",
        "HsnCd": "998313",
        "UnitPrice": "42000.00",
        "TotAmt": "42000.00",
        "Discount": "0.00",
        "AssAmt": "42000.00",
        "GstRt": "18",
        "IgstAmt": "7560.00",
        "CgstAmt": "0.00",
        "SgstAmt": "0.00",
        "TotItemVal": "49560.00",
        "Qty": "1",
        "Unit": "NOS"
      }
    ],
    "ValDtls": {
      "AssVal": "42000.00",
      "CgstVal": "0.00",
      "SgstVal": "0.00",
      "IgstVal": "7560.00",
      "CesVal": "0.00",
      "StCesVal": "0.00",
      "Discount": "0.00",
      "OthChrg": "0.00",
      "RndOffAmt": "0.00",
      "TotInvVal": "49560.00"
    }
  }
}
```

## freelancer-export-compliance

Exit `0`. Full object, including `items` and `confirmReasons`.

```bash
node skills/freelancer-export-compliance/scripts/export-checklist.mjs --json '{"invoiceDate":"2026-03-15","currency":"USD","clientCountry":"US","supplierInIndia":true,"recipientOutsideIndia":true,"placeOfSupplyOutsideIndia":true,"ownBranch":false,"intermediary":false,"forexReceived":true,"lutFiledFY":"2025-26"}'
```

```json
{
  "valid": true,
  "qualifies": true,
  "isExport": true,
  "fy": "2025-26",
  "lutRequired": false,
  "lutFiledFY": "2025-26",
  "gstRealisationDeadline": "2027-03-15",
  "rule96aReceiptDeadline": "2027-06-15",
  "rule96aTaxPaymentDeadline": "2027-06-30",
  "femaRealisationDeadline": "2027-06-15",
  "femaMonths": 15,
  "femaInstrument": "FEMA 23(R)/(7)/2025-RB",
  "femaAlso": [],
  "items": [
    {
      "id": "intermediary",
      "status": "pass",
      "text": "Not marked as an intermediary. Other IGST s.13(3) to s.13(13) rules can still put the place of supply in India, including services performed on goods or on a person who is present, services tied to immovable property or an event, banking and NBFC services to account holders, and hiring of a means of transport for up to one month."
    },
    {
      "id": "s2-6-i",
      "status": "pass",
      "text": "the supplier of service is located in India"
    },
    {
      "id": "s2-6-ii",
      "status": "pass",
      "text": "the recipient of service is located outside India"
    },
    {
      "id": "s2-6-iii",
      "status": "pass",
      "text": "the place of supply of service is outside India"
    },
    {
      "id": "s2-6-iv",
      "status": "pass",
      "text": "the payment for such service has been received by the supplier of service in convertible foreign exchange or in Indian rupees wherever permitted by the Reserve Bank of India"
    },
    {
      "id": "s2-6-v",
      "status": "pass",
      "text": "the supplier of service and the recipient of service are not merely establishments of a distinct person in accordance with Explanation 1 in section 8"
    },
    {
      "id": "lut",
      "status": "pass",
      "text": "Form GST RFD-11 for FY 2025-26 covers this invoice. It lets you supply without paying IGST. It is not itself a condition of export."
    },
    {
      "id": "rule96a",
      "status": "info",
      "text": "Rule 96A(1)(b): payment must be received by the later of one year from the invoice (2027-03-15) and the FEMA period (2027-06-15). That date is 2027-06-15. If it is missed, IGST and interest are payable within 15 days, by 2027-06-30. A Commissioner or an RBI extension can move this date."
    },
    {
      "id": "fema",
      "status": "info",
      "text": "FEMA realisation: 15 months under FEMA 23(R)/(7)/2025-RB, deadline 2027-06-15. The invoice date is used as the start. For a service invoice before 1 Oct 2026 that reading is not confirmed for non-software services. An authorised dealer can extend the period. This is not the GST one-year limb."
    },
    {
      "id": "zero-rated",
      "status": "info",
      "text": "IGST s.16 zero-rates this supply. Either: bond or letter of undertaking, without payment of integrated tax, with a refund of unutilised input tax credit; or: on payment of integrated tax, with a refund of the tax paid."
    },
    {
      "id": "fira",
      "status": "info",
      "text": "Keep the bank's foreign inward remittance advice (FIRA), or the earlier FIRC, or the bank advice that shows the inward remittance."
    },
    {
      "id": "ebrc",
      "status": "info",
      "text": "e-BRC on the DGFT portal is for exporters who need it for a foreign-trade scheme. For a services exporter it is optional, or required only when a scheme asks for it."
    }
  ],
  "warnings": [
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "confirmReasons": [
    "fema.services.clock.invoiceDate: UNVERIFIED for services that are not software. Regulation 9 of the 2015 regulations runs from the date of export. The invoice-date explanation on the consolidated text is written for software in a form other than physical. This skill still starts the clock on the invoice date. Confirm the date of export with the authorised dealer.",
    "fema.proof.fira: UNVERIFIED as a document title. Regulation 18 of the 2026 regulations tells the authorised dealer to mark off EDPMS when the export value is realised. It does not name FIRA or FIRC. Banks issue those advices. Keep whichever advice the bank gives.",
    "fema.proof.ebrc: UNVERIFIED. No DGFT public notice was opened that makes e-BRC compulsory for every services exporter. Do not treat a missing e-BRC as proof that the FEMA clock was missed. FIRA or the bank advice is the realisation record for the authorised dealer."
  ],
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

`lutRequired: false` here means an LUT for FY 2025-26 was already passed in. An LUT is what lets the supply go out without IGST. It is not itself a condition of export. With no LUT, IGST is paid and refunded.

## tds-freelancer-payments

Professional fees crossing ₹50,000. Exit `0`.

```bash
node skills/tds-freelancer-payments/scripts/tds.mjs --json '{"paymentDate":"2026-06-01","payerType":"other","payeeType":"individual","category":"professional","amountMinor":"1100000","ytdMinor":"4000000","panAvailable":true}'
```

```json
{
  "valid": true,
  "tdsMinor": "510000",
  "tds": "5100.00",
  "taxableMinor": "5100000",
  "rateBp": 1000,
  "section": "393(1) [Table Sl. No. 6(iii)]",
  "oldSection": "194J",
  "paymentCode": "1027",
  "thresholdHit": true,
  "act": "Income-tax Act, 2025",
  "warnings": [
    "s.206AB, the old non-filer higher rate, is not applied. That omission is not confirmed from the full Act text.",
    "TDS is on the whole FY aggregate of ₹51,000.00, not only on this payment of ₹11,000.00. Deposit the tax even when it is more than the amount being paid out.",
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "confirmReasons": [
    "tds.206ab.apply: UNVERIFIED. The old non-filer higher deduction (Income-tax Act, 1961, s.206AB) is not mentioned on the s.393 page or the s.397(2) FAQ opened 2026-11-01. The bare Act PDF that was retrieved did not contain the deduction chapter, so the omission was not confirmed from the full Act text. This skill does not apply s.206AB on either side of 1 Apr 2026.",
    "tds.paymentCode.map: UNVERIFIED. Form 26Q section codes from return-preparation tables, not from the s.393 page. 1023 contractor individual or HUF, 1024 other contractors, 1026 technical fees and film royalty, 1027 professional fees, 1028 director fees. Serial 6(ii) (old 194M) has no code in those tables; this skill returns null for it. The source URL is the Act section and does not print these codes."
  ],
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

No PAN, ₹60,000. Exit `0`.

```bash
node skills/tds-freelancer-payments/scripts/tds.mjs --json '{"paymentDate":"2026-06-01","payerType":"other","payeeType":"individual","category":"professional","amountMinor":"6000000","ytdMinor":"0","panAvailable":false}'
```

```json
{
  "valid": true,
  "tdsMinor": "1200000",
  "tds": "12000.00",
  "taxableMinor": "6000000",
  "rateBp": 2000,
  "section": "393(1) [Table Sl. No. 6(iii)]",
  "oldSection": "194J",
  "paymentCode": "1027",
  "thresholdHit": true,
  "act": "Income-tax Act, 2025",
  "warnings": [
    "s.206AB, the old non-filer higher rate, is not applied. That omission is not confirmed from the full Act text.",
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "confirmReasons": [
    "tds.206ab.apply: UNVERIFIED. The old non-filer higher deduction (Income-tax Act, 1961, s.206AB) is not mentioned on the s.393 page or the s.397(2) FAQ opened 2026-11-01. The bare Act PDF that was retrieved did not contain the deduction chapter, so the omission was not confirmed from the full Act text. This skill does not apply s.206AB on either side of 1 Apr 2026.",
    "tds.paymentCode.map: UNVERIFIED. Form 26Q section codes from return-preparation tables, not from the s.393 page. 1023 contractor individual or HUF, 1024 other contractors, 1026 technical fees and film royalty, 1027 professional fees, 1028 director fees. Serial 6(ii) (old 194M) has no code in those tables; this skill returns null for it. The source URL is the Act section and does not print these codes."
  ],
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

## razorpay-integration

`key_secret` and `whsec_test` are fixtures. ₹299.00, exit `0`.

```bash
node skills/razorpay-integration/scripts/to-subunits.mjs --json '{"amount":"299.00","currency":"INR"}'
```

```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.",
  "subunits": "29900",
  "subunitsText": "29900",
  "currency": "INR",
  "exponent": 2
}
```

Checkout signature over `order_id|payment_id`. Exit `0`.

```bash
node skills/razorpay-integration/scripts/verify-payment-signature.mjs --json '{"orderId":"order_9A33XWu170gUtm","paymentId":"pay_29QQoUBi66xm2f","signature":"7920f7497f3db0d8c993fa160dc7e0a1ebf7424a95a786c40c62c6059f80d04d","secret":"key_secret"}'
```

```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

Webhook over the raw body, including the trailing newline that was signed. Exit `0`.

```bash
node skills/razorpay-integration/scripts/verify-webhook.mjs --json '{"rawBody":"{\"entity\":\"event\",\"event\":\"payment.captured\"}\n","signature":"00941bc52ad7dbe75c5886b3ed820bb858e86a49781f36c55b04277dc9af7c9c","secret":"whsec_test"}'
```

```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

Fulfil decision. Exit `0`.

```bash
node skills/razorpay-integration/scripts/decide-event.mjs --json '{"signatureVerified":true,"eventId":"evt_1","event":"payment.captured","amountMinor":"50000","expectedMinor":"50000"}'
```

```json
{
  "valid": true,
  "httpStatus": 200,
  "action": "fulfil",
  "fulfil": true,
  "duplicate": false,
  "storeEventId": true,
  "event": "payment.captured",
  "eventIdHeader": "x-razorpay-event-id",
  "retryHours": 24,
  "ackWithinSeconds": 5,
  "state": "captured",
  "capturedMinor": "50000",
  "refundedMinor": "0",
  "errors": [],
  "warnings": [],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

In Express, read the raw body with `express.raw({ type: 'application/json' })`. HMAC-SHA256 that raw body. Compare with `crypto.timingSafeEqual` only when the two buffers have the same length. A different length returns false and does not throw. Fulfil on `payment.captured` or `order.paid`. `payment.authorized` is not paid.

## cashfree-integration

Signature. Exit `0`.

```bash
node skills/cashfree-integration/scripts/verify-webhook.mjs --json '{"rawBody":"{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\"}","timestamp":"1617695238078","signature":"qYpxv9z56awnigrZ4WIKtxozJ3UJqAaqk4BuDtqCcWU=","secret":"client_secret","nowMs":1617695238078}'
```

```json
{
  "valid": true,
  "reason": "ok",
  "errors": [],
  "warnings": [
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.",
  "timestampUnit": "ms",
  "toleranceSec": 300
}
```

Fulfil on `SUCCESS`. Exit `0`.

```bash
node skills/cashfree-integration/scripts/decide-event.mjs --json '{"signatureVerified":true,"version":"2025-01-01","idempotencyKey":"n9rn7079wqXcse3GEDEXCYle9ajXmU0SUQY8zrUNAlc=","paymentStatus":"SUCCESS","paymentAmount":"170.00","expectedAmount":"170.00"}'
```

```json
{
  "valid": true,
  "httpStatus": 200,
  "action": "fulfil",
  "fulfil": true,
  "duplicate": false,
  "storeKey": true,
  "priorStatus": "SUCCESS",
  "paymentStatus": "SUCCESS",
  "idempotencyHeader": "x-idempotency-key",
  "errors": [],
  "warnings": [],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

## upi-payment-links

Exit `0`.

```bash
node skills/upi-payment-links/scripts/upi-link.mjs --json '{"pa":"merchant@upi","pn":"Shiv & Co","am":"499.00"}'
```

```json
{
  "valid": true,
  "link": "upi://pay?pa=merchant%40upi&pn=Shiv%20%26%20Co&am=499.00&cu=INR&mode=00",
  "params": {
    "pa": "merchant@upi",
    "pn": "Shiv & Co",
    "am": "499.00",
    "cu": "INR",
    "mode": "00"
  },
  "amountEditable": false,
  "amountPaise": "49900",
  "channel": "p2p",
  "signed": false,
  "limits": {
    "name": "P2P",
    "perTransactionPaise": "10000000",
    "perDayPaise": null,
    "exceedsPerTransaction": false,
    "bankMaySetLower": true
  },
  "qr": null,
  "errors": [],
  "warnings": [
    "Unsigned links are for P2P or personal use. Merchants should use their PSP or payment gateway. A link or QR is not proof of payment; reconcile from the bank statement or the payment-gateway webhook.",
    "Banks and UPI apps may set a lower limit than the published ceiling.",
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

QR. Exit `0`. `qr.svg` is omitted. The file is 7,692 bytes. The hash below is from that SVG.

```bash
node skills/upi-payment-links/scripts/upi-link.mjs --json '{"op":"qr","pa":"shop@okbank","pn":"Cafe","am":"10.50"}'
```

```json
{
  "valid": true,
  "link": "upi://pay?pa=shop%40okbank&pn=Cafe&am=10.50&cu=INR&mode=00",
  "params": {
    "pa": "shop@okbank",
    "pn": "Cafe",
    "am": "10.50",
    "cu": "INR",
    "mode": "00"
  },
  "amountEditable": false,
  "amountPaise": "1050",
  "channel": "p2p",
  "signed": false,
  "limits": {
    "name": "P2P",
    "perTransactionPaise": "10000000",
    "perDayPaise": null,
    "exceedsPerTransaction": false,
    "bankMaySetLower": true
  },
  "qr": {
    "sha256": "4550842a8a9055a3cafcbf391ba6c28b18f82a24374cc5383344fc726a9822aa",
    "version": 4,
    "size": 33,
    "ecc": "M",
    "border": 4
  },
  "errors": [],
  "warnings": [
    "Unsigned links are for P2P or personal use. Merchants should use their PSP or payment gateway. A link or QR is not proof of payment; reconcile from the bank statement or the payment-gateway webhook.",
    "Banks and UPI apps may set a lower limit than the published ceiling.",
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

## inr-formatting

Exit `0`.

```bash
node skills/inr-formatting/scripts/format-inr.mjs --json '{"rupees":"123456789.50"}'
```

```json
{
  "valid": true,
  "paise": "12345678950",
  "rupees": "123456789.50",
  "formatted": "₹12,34,56,789.50",
  "words": "Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine and Fifty Paise Only",
  "compact": "12.35 Cr",
  "negative": false,
  "errors": [],
  "warnings": [
    "Short forms such as L and Cr are abbreviations, not a statutory format.",
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

Exit `0`.

```bash
node skills/inr-formatting/scripts/format-inr.mjs --json '{"paise":"12345678901234567890"}'
```

```json
{
  "valid": true,
  "paise": "12345678901234567890",
  "rupees": "123456789012345678.90",
  "formatted": "₹1,23,45,67,89,01,23,45,678.90",
  "words": "Rupees One Thousand Two Hundred Thirty-Four Crore Fifty-Six Lakh Seventy-Eight Thousand Nine Hundred One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Ninety Paise Only",
  "compact": "1,234.57 Cr Cr",
  "negative": false,
  "errors": [],
  "warnings": [
    "Amounts at or above one hundred crore are spelled by repeating lakh and crore. Arab is not used.",
    "Short forms such as L and Cr are abbreviations, not a statutory format.",
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

## indian-id-validators

PAN, exit `0`.

```bash
node skills/indian-id-validators/scripts/validate-pan.mjs --json 'ABCPE1234F'
```

```json
{
  "valid": true,
  "normalized": "ABCPE1234F",
  "holderType": "P",
  "holderName": "Individual",
  "nameInitial": "E",
  "checkDigitChecked": false,
  "errors": [],
  "warnings": [],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

TAN, exit `0`.

```bash
node skills/indian-id-validators/scripts/validate-tan.mjs --json 'AAAA00000A'
```

```json
{
  "valid": true,
  "normalized": "AAAA00000A",
  "jurisdiction": "AAA",
  "nameInitial": "A",
  "serial": "00000",
  "checkDigitChecked": false,
  "errors": [],
  "warnings": [],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

IFSC format only, exit `0`.

```bash
node skills/indian-id-validators/scripts/validate-ifsc.mjs --json 'SBIN0001234'
```

```json
{
  "valid": true,
  "normalized": "SBIN0001234",
  "bankCode": "SBIN",
  "branchCode": "001234",
  "formatValid": true,
  "lookedUp": false,
  "found": null,
  "bank": null,
  "branch": null,
  "city": null,
  "state": null,
  "errors": [],
  "warnings": [
    "Format valid does not mean the branch participates in NEFT or RTGS."
  ],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

PIN, exit `0`.

```bash
node skills/indian-id-validators/scripts/validate-pin.mjs --json '{"pin":"396210","stateCode":"24"}'
```

```json
{
  "valid": true,
  "normalized": "396210",
  "prefix": "396",
  "zoneDigit": "3",
  "zone": "Western",
  "states": [
    {
      "code": "24",
      "name": "Gujarat"
    },
    {
      "code": "25",
      "name": "Daman and Diu"
    },
    {
      "code": "26",
      "name": "Dadra and Nagar Haveli"
    }
  ],
  "stateCode": "24",
  "stateMatch": "shared",
  "errors": [],
  "warnings": [
    "First-digit zone \"Western\" is UNVERIFIED. Confirm with the official source before relying on this.",
    "PIN prefix 396 is shared by 24 Gujarat, 25 Daman and Diu, 26 Dadra and Nagar Haveli. A match is not proof of the state."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

Mobile, exit `0`.

```bash
node skills/indian-id-validators/scripts/validate-mobile.mjs --json '+91 98765-43210'
```

```json
{
  "valid": true,
  "normalized": "9876543210",
  "e164": "+919876543210",
  "errors": [],
  "warnings": [
    "Spaces or hyphens were removed.",
    "The mobile pattern ^[6-9][0-9]{9}$ is UNVERIFIED. Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

## aadhaar-safe-handling

Validate, exit `0`.

```bash
node skills/aadhaar-safe-handling/scripts/validate-aadhaar.mjs --json '234123412346'
```

```json
{
  "valid": true,
  "kind": "aadhaar",
  "masked": "XXXX XXXX 2346",
  "length": 12,
  "errors": [],
  "warnings": [
    "Verhoeff valid does not mean UIDAI issued this number."
  ],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

Mask of the spaced form, exit `0`.

```bash
node skills/aadhaar-safe-handling/scripts/mask-aadhaar.mjs --json '2341 2341 2346'
```

```json
{
  "valid": true,
  "kind": "aadhaar",
  "masked": "XXXX XXXX 2346",
  "length": 12,
  "errors": [],
  "warnings": [
    "Spaces or hyphens were removed.",
    "Verhoeff valid does not mean UIDAI issued this number."
  ],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

Scan, exit `1`.

```bash
node skills/aadhaar-safe-handling/scripts/scan-aadhaar.mjs --json '{"text":"ts=202611011530 ref=123456789012 aadhaar=2341-2341-2346"}'
```

```json
{
  "valid": false,
  "findings": [
    {
      "line": 1,
      "masked": "XXXX XXXX 2346",
      "kind": "aadhaar"
    }
  ],
  "count": 1,
  "errors": [],
  "warnings": [
    "Findings are masked. Do not log a full Aadhaar number."
  ],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

Storage limits, exit `0`. `confirm` is false on this run. The vault sentence was read from UIDAI Circular No. 14 of 2025.

```bash
node skills/aadhaar-safe-handling/scripts/aadhaar-storage.mjs --json '{}'
```

```json
{
  "valid": true,
  "section29": "Section 29 restricts sharing. Core biometric information must not be shared, and must not be used except to generate Aadhaar numbers and to authenticate. Other identity information may be shared only as the Act and regulations allow. A requesting entity or offline verification-seeking entity may use or disclose identity information only for the purposes told to the person in writing, in clear language. An Aadhaar number, demographic information, or photograph must not be published or displayed publicly except as regulations allow.",
  "dataVault": "Requesting entities must store Aadhaar numbers and connected Aadhaar data, such as eKYC XML, only in an Aadhaar Data Vault. Other systems keep a reference key. The Aadhaar number must not be recoverable from that key, and hashing the Aadhaar number is not allowed as the key.",
  "virtualId": "Do not store a Virtual ID. UIDAI says it is temporary, the holder can replace it, and agencies should not store it in a database or in logs.",
  "errors": [],
  "warnings": [],
  "confirm": false,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

## dpdp-compliance-check

Checklist only. Exit `0`. `markdown` is omitted. It is the same checklist rendered as Markdown. The phases below are the stdout.

```bash
node skills/dpdp-compliance-check/scripts/dpdp-check.mjs --json '{"asOf":"2026-11-01"}'
```

```json
{
  "valid": true,
  "asOf": "2026-11-01",
  "rulesAsOf": "2026-11-01",
  "phases": [
    {
      "id": "dpdp.phase.rules.immediate",
      "label": "Rules 1, 2 and 17 to 21",
      "commencement": "2025-11-13",
      "summary": "Short title, definitions, and the Data Protection Board.",
      "phrase": "Rules 1, 2 and 17 to 21 in force since 2025-11-13",
      "inForce": true,
      "verified": true
    },
    {
      "id": "dpdp.phase.rules.one-year",
      "label": "Rule 4",
      "commencement": "2026-11-13",
      "summary": "Registration and obligations of Consent Managers.",
      "phrase": "Rule 4 in force in 12 days",
      "inForce": false,
      "verified": true
    },
    {
      "id": "dpdp.phase.rules.eighteen-months",
      "label": "Rules 3, 5 to 16, 22 and 23",
      "commencement": "2027-05-13",
      "summary": "Notice, security, breach intimation, erasure, children, grievances, cross-border transfer, appeals, and calls for information.",
      "phrase": "Rules 3, 5 to 16, 22 and 23 in force in 193 days",
      "inForce": false,
      "verified": true
    },
    {
      "id": "dpdp.phase.act.immediate",
      "label": "Act sections that commence on notification",
      "commencement": "2025-11-13",
      "summary": "Section 1(2), section 2, sections 18 to 26, sections 35 and 38 to 43, and section 44(1) and (3).",
      "phrase": "Act sections that commence on notification in force since 2025-11-13",
      "inForce": true,
      "verified": true
    },
    {
      "id": "dpdp.phase.act.one-year",
      "label": "Act sections that commence one year after notification",
      "commencement": "2026-11-13",
      "summary": "Section 6(9) (Consent Manager registration) and section 27(1)(d).",
      "phrase": "Act sections that commence one year after notification in force in 12 days",
      "inForce": false,
      "verified": true
    },
    {
      "id": "dpdp.phase.act.eighteen-months",
      "label": "Act sections that commence eighteen months after notification",
      "commencement": "2027-05-13",
      "summary": "Sections 3 to 5, section 6(1) to (8) and (10), sections 7 to 17, section 27 except 27(1)(d), sections 28 to 34, 36 and 37, and section 44(2).",
      "phrase": "Act sections that commence eighteen months after notification in force in 193 days",
      "inForce": false,
      "verified": true
    }
  ],
  "findings": [],
  "errors": [],
  "warnings": [
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

The Markdown starts:

```text
# DPDP readiness checklist

As of 2026-11-01. Rules data as of 2026-11-01.

## Phased commencement

- Rules 1, 2 and 17 to 21 in force since 2025-11-13. Short title, definitions, and the Data Protection Board.
- Rule 4 in force in 12 days. Registration and obligations of Consent Managers.
- Rules 3, 5 to 16, 22 and 23 in force in 193 days. Notice, security, breach intimation, erasure, children, grievances, cross-border transfer, appeals, and calls for information.
- Act sections that commence on notification in force since 2025-11-13. Section 1(2), section 2, sections 18 to 26, sections 35 and 38 to 43, and section 44(1) and (3).
- Act sections that commence one year after notification in force in 12 days. Section 6(9) (Consent Manager registration) and section 27(1)(d).
- Act sections that commence eighteen months after notification in force in 193 days. Sections 3 to 5, section 6(1) to (8) and (10), sections 7 to 17, section 27 except 27(1)(d), sections 28 to 34, 36 and 37, and section 44(2).
```

Schema scan. Exit `1`. `markdown`, `checklist`, `penalties`, and `facts` are omitted. Phases are cut to four fields. The finding is complete.

```bash
node skills/dpdp-compliance-check/scripts/dpdp-check.mjs --json '{"asOf":"2026-11-01","kind":"prisma","source":"model User {\n  id Int @id\n  aadhaarNumber String\n}"}'
```

```json
{
  "valid": false,
  "asOf": "2026-11-01",
  "confirm": true,
  "errors": [],
  "warnings": [
    "Confirm with the official source before relying on this."
  ],
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.",
  "findings": [
    {
      "name": "aadhaarNumber",
      "line": 3,
      "where": "prisma",
      "kind": "aadhaar",
      "severity": "high",
      "items": [
        "dpdp.item.consent-notice",
        "dpdp.item.purpose-limitation",
        "dpdp.item.retention",
        "dpdp.item.breach-notice",
        "dpdp.item.grievance"
      ],
      "verified": true
    }
  ],
  "phases": [
    {
      "id": "dpdp.phase.rules.immediate",
      "phrase": "Rules 1, 2 and 17 to 21 in force since 2025-11-13",
      "commencement": "2025-11-13",
      "inForce": true
    },
    {
      "id": "dpdp.phase.rules.one-year",
      "phrase": "Rule 4 in force in 12 days",
      "commencement": "2026-11-13",
      "inForce": false
    },
    {
      "id": "dpdp.phase.rules.eighteen-months",
      "phrase": "Rules 3, 5 to 16, 22 and 23 in force in 193 days",
      "commencement": "2027-05-13",
      "inForce": false
    },
    {
      "id": "dpdp.phase.act.immediate",
      "phrase": "Act sections that commence on notification in force since 2025-11-13",
      "commencement": "2025-11-13",
      "inForce": true
    },
    {
      "id": "dpdp.phase.act.one-year",
      "phrase": "Act sections that commence one year after notification in force in 12 days",
      "commencement": "2026-11-13",
      "inForce": false
    },
    {
      "id": "dpdp.phase.act.eighteen-months",
      "phrase": "Act sections that commence eighteen months after notification in force in 193 days",
      "commencement": "2027-05-13",
      "inForce": false
    }
  ]
}
```

## sms-otp-dlt

Lint. Exit `0`. The result does not echo the OTP.

```bash
node skills/sms-otp-dlt/scripts/lint-dlt.mjs --json '{"asOf":"2026-11-01","template":"Your OTP is {#var#}. Do not share it. - Acme","message":"Your OTP is 482913. Do not share it. - Acme","variables":["482913"],"header":"ACMEIN-T","category":"transactional","brandName":"Acme","chainRegistered":true,"templateRegistered":true,"sentAtIst":"16:30"}'
```

```json
{
  "valid": true,
  "asOf": "2026-11-01",
  "rulesAsOf": "2026-11-01",
  "category": "transactional",
  "header": "ACMEIN-T",
  "errors": [],
  "warnings": [
    {
      "code": "confirm",
      "message": "Confirm with the official source before relying on this.",
      "source": "skill"
    }
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

MSG91 shape. Exit `0`. No network call.

```bash
node skills/sms-otp-dlt/scripts/msg91-otp.mjs --json '{"asOf":"2026-11-01","templateId":"tpl_otp_01","mobile":"919800000000","otpLength":6,"otpExpiryMinutes":10,"template":"Your OTP is ##OTP##. - Acme"}'
```

```json
{
  "valid": true,
  "asOf": "2026-11-01",
  "rulesAsOf": "2026-11-01",
  "method": "POST",
  "url": "https://control.msg91.com/api/v5/otp",
  "query": {
    "template_id": "tpl_otp_01",
    "mobile": "919800000000",
    "otp_length": "6",
    "otp_expiry": "10"
  },
  "headers": {
    "authkey": "<missing>",
    "Content-Type": "application/json"
  },
  "body": {},
  "practice": {
    "digits": 6,
    "ttlMinutes": {
      "min": 5,
      "max": 10
    },
    "generator": "crypto.randomInt",
    "neverLogOtp": true
  },
  "errors": [],
  "warnings": [
    "MSG91 defaults are 4 digits and 15 minutes. This skill's practice is 6 digits and 5–10 minutes. The vendor figures are not a TRAI rule.",
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

## Run the scripts yourself

| Exit | Meaning |
| --- | --- |
| 0 | The result is usable. `confirm` may still be true. Read it. |
| 1 | Rejected. `errors` says why. An Aadhaar scan also uses 1 when it finds a number. |
| 2 | Usage: missing `--json`, input over 10 KB, or JSON in the wrong shape. |

## When not to use them

- An aid, not a filing. The `disclaimer` string in every tax, legal, and payment result says so.
- No portal submission. These skills do not log in to GST, generate an IRN, or create a Razorpay or Cashfree order.
- `confirm: true` means an input to the answer is unverified. Say that to the user. The 0.1.0 list is in [CHANGELOG.md](../CHANGELOG.md). The page that was opened, or the UNVERIFIED tag, is in that skill's `references/sources.md`.
- A checksum-valid GSTIN can be unregistered, cancelled, or suspended. The warning points at [the taxpayer search](https://services.gst.gov.in/services/searchtp). This pack does not call it.
- Do not store or log a full Aadhaar number. The scanner prints masked values only.
