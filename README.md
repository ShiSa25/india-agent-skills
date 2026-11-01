# india-agent-skills

Tested, source-linked Agent Skills for Indian GST, payments, IDs, and compliance.

AI agents get this wrong: rupees as floats, the financial year as the calendar year, `new Date('YYYY-MM-DD')` as UTC, GSTIN check digits, CGST/SGST versus IGST, and a checksum treated as proof that a GSTIN is registered. This pack is a set of `SKILL.md` skills those agents can load. Each rule has a source and an as-of date. The licence is MIT. Nothing here is published to npm.

## Install

All 13 skills are in the repo at v0.1.0.

**Codex, Claude Code, Cursor, and other agents** — the [skills CLI](https://github.com/vercel-labs/skills) installs the folder into the agent you pick:

```bash
npx skills add ShiSa25/india-agent-skills
```

Add `-g` for a user-level install. One skill: `npx skills add ShiSa25/india-agent-skills --skill gstin-validator`. Swap the last argument for any folder name in the table below.

**Codex.** The CLI puts the skill in `.codex/skills` or `~/.codex/skills`. Codex also reads a skill when your request matches its description. Invoke it yourself with `$gstin-validator` (the same `$` form works for every skill name), or open `/skills`. [Codex skills](https://developers.openai.com/codex/skills).

**Claude Code.**

```text
/plugin marketplace add ShiSa25/india-agent-skills
/plugin install india-agent-skills@india-agent-skills
```

A skill from this plugin is `/india-agent-skills:gstin-validator`. Replace `gstin-validator` with any skill name. The same folder copied to `.claude/skills/gstin-validator` is `/gstin-validator`. Claude also loads a skill when the description matches. [Skills](https://code.claude.com/docs/en/skills), [plugins](https://code.claude.com/docs/en/plugins/install).

**Cursor.** Type `/gstin-validator` in Agent chat, or `/` plus any other skill name. Cursor loads `.cursor/skills/`, `.agents/skills/`, and the Claude and Codex skill directories, and it applies a skill when the description matches. [Cursor skills](https://cursor.com/docs/skills).

Those commands were checked on 1 Nov 2026. If a slash command misses, use the page above for that tool.

## How to use these skills

An agent sees each skill's `name` and `description` and loads the `SKILL.md` when your request matches. You can also name the skill, as in the install section.

Tax, legal, and payment output is an aid. It is general information and a format check. Confirm it with the official source or a qualified professional before you file, invoice, or pay. If the JSON has `confirm: true`, an input to the answer was not checked against a primary source. Keep that flag, and keep the sentence `Confirm with the official source before relying on this.`

The blocks below are real stdout from this repo, pretty-printed. A trimmed block names the keys that were removed. The same runs, with fewer keys removed, are in [docs/USAGE.md](docs/USAGE.md).

From the repo root, `node skills/<skill>/scripts/<file>.mjs --json '...'`. From an installed skill folder, the path is `scripts/<file>.mjs`. Exit `0` when the result is usable, `1` when it is rejected, `2` on a usage error. Stdout is one JSON object.

### When to use which skill

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

### gstin-validator

Use it when someone pastes a GSTIN. The checksum match leaves registration unchecked.

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

The blog example `9917USA00013OS5` exits `1`. The check character on that body is `P`.

```bash
node skills/gstin-validator/scripts/validate-gstin.mjs --json '9917USA00013OS5'
```

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

### gst-invoice

Use it for a tax invoice, credit note, debit note, or an export or SEZ bill. It does not file the return. `29AABCC1234A1ZD` and `27AABCC1234A1ZH` are synthetic GSTINs from `generate-gstin`.

Inter-state consulting, ₹42,000 at 1,800 basis points (18%). Exit `0`. Trimmed: `html` is omitted, and `invoice` is shown without supplier, recipient, and lines.

```bash
node skills/gst-invoice/scripts/build-invoice.mjs --json '{"supplier":{"name":"Acme Supplies","address":"1 Test Road, Bengaluru","gstin":"29AABCC1234A1ZD","stateCode":"29","pin":"560001","loc":"Bengaluru"},"recipient":{"name":"Beta Buyers","address":"2 Sample Lane, Mumbai","gstin":"27AABCC1234A1ZH","stateCode":"27","pin":"400001","loc":"Mumbai"},"invoiceNumber":"INV/2026-27/0001","invoiceDate":"2026-04-15","placeOfSupply":"27","supplyType":"domestic","reverseCharge":false,"signature":"Authorised signatory","priorNumbers":[],"lines":[{"description":"Consulting","hsn":"998313","quantity":"1","unit":"NOS","taxable":"42000.00","rateBp":1800,"service":true}]}'
```

```json
{
  "valid": true,
  "confirm": false,
  "portalSubmitted": false,
  "errors": [],
  "warnings": [],
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.",
  "invoice": {
    "fy": "2026-27",
    "invoiceNumber": "INV/2026-27/0001",
    "invoiceDate": "2026-04-15",
    "interState": true,
    "igstOnIntra": false,
    "localTax": "IGST",
    "lut": false,
    "endorsement": null,
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
    "amountInWords": "Rupees Forty-Nine Thousand Five Hundred Sixty Only"
  }
}
```

Export of services under LUT, invoice date 2026-03-15, taxable ₹1,00,000. Exit `0`. IGST is 0. The endorsement is the Rule 46 sentence. Trimmed the same way.

```bash
node skills/gst-invoice/scripts/build-invoice.mjs --json '{"supplier":{"name":"Acme Supplies","address":"1 Test Road, Bengaluru","gstin":"29AABCC1234A1ZD","stateCode":"29","pin":"560001","loc":"Bengaluru"},"recipient":{"name":"US Client","address":"1 Market Street","loc":"San Francisco","country":"United States","deliveryAddress":"1 Market Street, San Francisco"},"invoiceNumber":"EXP/2025-26/0001","invoiceDate":"2026-03-15","placeOfSupply":"96","supplyType":"export","supplyKind":"services","lut":true,"reverseCharge":false,"signature":"Authorised signatory","priorNumbers":[],"lines":[{"description":"Software services","hsn":"998314","quantity":"1","unit":"NOS","taxable":"100000.00","rateBp":1800,"service":true}]}'
```

```json
{
  "valid": true,
  "confirm": false,
  "portalSubmitted": false,
  "errors": [],
  "warnings": [],
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.",
  "invoice": {
    "fy": "2025-26",
    "invoiceNumber": "EXP/2025-26/0001",
    "invoiceDate": "2026-03-15",
    "supplyType": "export",
    "interState": true,
    "lut": true,
    "endorsement": "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
    "totals": {
      "taxable": "100000.00",
      "igst": "0.00",
      "cgst": "0.00",
      "sgst": "0.00",
      "grand": "100000.00"
    },
    "amountInWords": "Rupees One Lakh Only"
  }
}
```

### gst-e-invoice-json

Use it when you need schema 1.1 JSON and you will not call an IRP. The input below was the stdout of the inter-state invoice command, including `html`. Exit `0`. `irpSubmitted` is false. Trimmed: `SellerDtls`, `BuyerDtls`, and `ItemList` are omitted. `Dt` is `15/04/2026`.

```bash
node skills/gst-e-invoice-json/scripts/build-einvoice.mjs --json '<gst-invoice stdout>'
```

```json
{
  "valid": true,
  "confirm": false,
  "irpSubmitted": false,
  "errors": [],
  "warnings": [
    "AATO was not provided, so e-invoice applicability was not decided."
  ],
  "applicability": {
    "mandatory": null,
    "reason": "AATO was not provided, so e-invoice applicability was not decided.",
    "asOf": "2026-11-01",
    "irpSubmitted": false
  },
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.",
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

### freelancer-export-compliance

Use it for a foreign or SEZ client, an LUT year, or the GST and FEMA clocks. The booleans are the five limbs of IGST s.2(6). Ask the user before you fill them in. Exit `0`. Trimmed: `items` and `confirmReasons` are omitted. `confirm` is true. FEMA for this invoice date is 15 months under FEMA 23(R)/(7)/2025-RB, deadline 2027-06-15. Rule 96A uses the later of the one-year date and that FEMA date.

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
  "warnings": [
    "Confirm with the official source before relying on this."
  ],
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."
}
```

### tds-freelancer-payments

Use it when a payer deducts tax on professional fees, technical services, a contract, director remuneration, or a missing PAN. `1100000` paise is ₹11,000. `4000000` paise is ₹40,000 already untaxed this year. Exit `0`. The whole ₹51,000 is the base, so TDS is ₹5,100. `confirm` is true because the section code and the decision to skip s.206AB were not on the Act page.

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

No PAN, professional ₹60,000 (`6000000` paise), same date. Exit `0`. The rate is 20% (2,000 basis points), TDS ₹12,000.

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

### razorpay-integration

Use it for checkout HMAC, a webhook over the raw body, or a paise conversion. Fulfil on `payment.captured`. `key_secret` and `whsec_test` are fixtures. ₹299.00 is 29900 subunits. Exit `0`.

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

`payment.captured` after the signature has already verified. Exit `0`. `fulfil` is true.

```bash
node skills/razorpay-integration/scripts/decide-event.mjs --json '{"signatureVerified":true,"eventId":"evt_1","event":"payment.captured","amountMinor":"50000"}'
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

The payment-signature and webhook commands, and their stdout, are in [docs/USAGE.md](docs/USAGE.md). Compare with `crypto.timingSafeEqual` only after the buffers have the same length. Read the raw body. A re-serialised `JSON.stringify(req.body)` is the wrong input.

### cashfree-integration

Use it for a Cashfree webhook signature or a decision on `payment_status`. The timestamp `1617695238078` is the worked example on Cashfree's signature page. `client_secret` is a fixture. Exit `0`. `confirm` is true because the milliseconds-versus-seconds detector is not published by Cashfree.

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

`SUCCESS` on version `2025-01-01`. Exit `0`. `fulfil` is true.

```bash
node skills/cashfree-integration/scripts/decide-event.mjs --json '{"signatureVerified":true,"version":"2025-01-01","idempotencyKey":"n9rn7079wqXcse3GEDEXCYle9ajXmU0SUQY8zrUNAlc=","paymentStatus":"SUCCESS"}'
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

### upi-payment-links

Use it for an unsigned UPI link or a QR. A link is not proof of payment. Exit `0`. `confirm` is true because the VPA grammar and the two-decimal amount rule are not in the linking spec. `pn` "Shiv & Co" is percent-encoded.

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

QR for `shop@okbank` / Cafe / ₹10.50. Exit `0`. Trimmed: `qr.svg` is omitted (7,692 bytes). `qr.sha256` is `4550842a8a9055a3cafcbf391ba6c28b18f82a24374cc5383344fc726a9822aa`, version 4, 33 modules, ECC M.

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

### inr-formatting

Use it for Indian grouping, amount in words, or a short form. Amounts are integer paise inside the script. Exit `0`. `confirm` is true because `Cr` is an abbreviation, not a statute.

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

`12345678901234567890` paise. Exit `0`. The words repeat crore. Arab is not used, and that choice sets `confirm: true`.

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

### indian-id-validators

Use it for a PAN, TAN, IFSC, PIN, or +91 mobile. A format match leaves the holder and the branch unchecked. Do not pass `--lookup` unless you mean the opt-in directory call. These runs do not.

Synthetic PAN `ABCPE1234F`. Exit `0`. The 10th character is not a published checksum, so `checkDigitChecked` is false.

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

IFSC `SBIN0001234`, format only. Exit `0`.

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

Mobile `+91 98765-43210`. Exit `0`. `confirm` is true because the `^[6-9]` pattern is unverified as a complete DoT rule.

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

TAN `AAAA00000A` and PIN `396210` are in [docs/USAGE.md](docs/USAGE.md). The PIN zone name is `Western`, and that name sets `confirm: true`.

### aadhaar-safe-handling

Use it when text, a log, or a repository may contain an Aadhaar or a Virtual ID. The stdout is masked. `234123412346` is a synthetic allow-listed number. Exit `0`.

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

A log line that also contains a non-Verhoeff 12-digit reference and a timestamp. Exit `1` because a number was found. The finding is masked.

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

### dpdp-compliance-check

Use it for a DPDP checklist or a scan of Prisma, SQL, or TypeScript. Pass `asOf`. On 2026-11-01, Rule 4 is `in force in 12 days`. Exit `0` with no schema. `confirm` is true because the Third Schedule user-count line is unverified. Trimmed: `markdown`, `checklist`, `penalties`, and `facts` are omitted.

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

A Prisma model with `aadhaarNumber`. Exit `1`. Severity is high. Trimmed: `markdown`, `checklist`, `penalties`, and `facts` are omitted, and each phase is cut to `id`, `phrase`, `commencement`, and `inForce`.

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

### sms-otp-dlt

Use it to lint a DLT template or to shape an MSG91 SendOTP request. It does not send the SMS and it does not print the OTP in the result. The `482913` below is the variable in the input, used only to show that the rendered message matches the template. Exit `0`. `confirm` is true because several rows are operator guidance.

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

MSG91 request shape for a 6-digit OTP, 10-minute expiry, template id `tpl_otp_01`. Exit `0`. `authkey` is `<missing>`. The script does not put a generated OTP in the JSON.

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

### When not to use them

- They are an aid. They are not a filing, and they are not tax, legal, or financial advice. The `disclaimer` string in every tax, legal, and payment result says the same thing.
- They do not call the GST portal, an IRP, a bank, or a payment gateway. Create Razorpay and Cashfree orders through those companies' MCP servers.
- A valid checksum is a format check. Search [services.gst.gov.in/services/searchtp](https://services.gst.gov.in/services/searchtp) yourself before you treat a GSTIN as active.
- If the JSON has `confirm: true`, say that to the user. The v0.1.0 list is in [CHANGELOG.md](CHANGELOG.md).
- Do not paste a real individual's Aadhaar or PAN into an issue or a log. The Aadhaar scripts print masked values.

<!-- skills:start -->
| Skill | What it does | Status |
| --- | --- | --- |
| [gstin-validator](skills/gstin-validator/SKILL.md) | Validate an Indian GSTIN: checksum, state code, and regular, TDS, TCS, UIN, or NRTP/OIDAR shape. A valid checksum does not prove the GSTIN is registered. Use when a user pastes a GSTIN, checks an invoice, or builds a GST form. | 0.1.0 |
| [gst-invoice](skills/gst-invoice/SKILL.md) | Build an Indian GST tax invoice, credit note, or debit note: Rule 46 fields, CGST and SGST or UTGST, IGST for inter-state, export, and SEZ supplies, LUT endorsements, and paise rounding. Use when creating an invoice, a credit note, or an export or SEZ bill. Does not file a return or call the GST portal. | 0.1.0 |
| [gst-e-invoice-json](skills/gst-e-invoice-json/SKILL.md) | Build and validate GST e-invoice JSON for schema 1.1 (B2B, SEZ, export, and deemed export), including the AATO threshold and the 30-day IRP reporting check. Use when a user needs an IRN payload or a schema check. Never submits the payload to the IRP or the GST portal. | 0.1.0 |
| [freelancer-export-compliance](skills/freelancer-export-compliance/SKILL.md) | Decide whether a freelancer invoice is an export of services under IGST section 2(6), and compute the financial year, LUT, Rule 96A, and FEMA realisation dates. Use when a freelancer invoices a foreign client or an SEZ, or asks about an LUT, FIRA, e-BRC, an intermediary, an own branch, or the 9-month and 15-month realisation clocks. | 0.1.0 |
| [tds-freelancer-payments](skills/tds-freelancer-payments/SKILL.md) | Compute TDS on a payment to a freelancer under the Income-tax Act, 2025, section 393 (old sections 194C, 194J, and 194M), including thresholds and the no-PAN rate in section 397. Use when a payer deducts tax on professional fees, technical services, a contract payment, director remuneration, or a missing PAN. | 0.1.0 |
| [razorpay-integration](skills/razorpay-integration/SKILL.md) | Verify Razorpay checkout signatures (HMAC-SHA256 of order_id\|payment_id), webhook signatures over the raw body, and convert amounts to currency subunits. Use when adding Razorpay checkout, a webhook, a capture decision, or an amount in paise or another subunit. Create orders, capture, and refund through the official Razorpay MCP server, not from this skill. | 0.1.0 |
| [cashfree-integration](skills/cashfree-integration/SKILL.md) | Verify Cashfree webhook signatures for version 2025-01-01: Base64 of HMAC-SHA256 over the timestamp plus the raw body, with a replay window and millisecond-versus-seconds detection. Use when adding a Cashfree webhook, checking x-webhook-signature, or deciding whether a payment_status may fulfil. Call Payment Gateway APIs through the official Cashfree MCP server, not from this skill. | 0.1.0 |
| [upi-payment-links](skills/upi-payment-links/SKILL.md) | Build and parse an unsigned upi://pay link and draw a QR SVG at ECC M. Checks the payee VPA, percent-encoding, INR amount, mode, and P2P or P2M limit warnings. Use when a user wants a UPI payment link, a UPI QR, or a check of pa, pn, am, tr, tn, mc, or mode. A link is not proof of payment. | 0.1.0 |
| [inr-formatting](skills/inr-formatting/SKILL.md) | Format rupees with Indian lakh and crore grouping, in words, and in short form (1.2 L, 1.2 Cr), using integer paise. Use when showing an amount, an amount-in-words line, or converting rupees and paise. Does not use Node Intl. | 0.1.0 |
| [indian-id-validators](skills/indian-id-validators/SKILL.md) | Format-check an Indian PAN (4th-character holder type), TAN, IFSC, PIN code, or mobile number. Use when a user pastes a PAN, TAN, IFSC, PIN, or +91 mobile, or asks whether an IFSC matches the RBI pattern. An IFSC directory lookup is opt-in and is not proof that a branch is live. | 0.1.0 |
| [aadhaar-safe-handling](skills/aadhaar-safe-handling/SKILL.md) | Check, mask, and scan for Aadhaar numbers with the Verhoeff checksum, and state the storage limits in the Aadhaar Act and the UIDAI data-vault circular. Use when text, logs, or a repository may contain an Aadhaar or Virtual ID. Never log a full number. | 0.1.0 |
| [dpdp-compliance-check](skills/dpdp-compliance-check/SKILL.md) | Build a DPDP Act 2023 and DPDP Rules 2025 readiness checklist: consent notice, purpose limitation, children's data and verifiable parental consent, breach timelines, retention and erasure, grievance contact, significant data fiduciary duties, cross-border transfer, and Consent Managers, with the 13 November 2025 phases and Schedule penalties. Scan Prisma, SQL, and TypeScript for personal-data fields. Use when a schema or a privacy review needs the phased dates or a field-to-checklist map. | 0.1.0 |
| [sms-otp-dlt](skills/sms-otp-dlt/SKILL.md) | Lint a TRAI DLT SMS template for {#var#} variables, the 11-character header and -P/-S/-T/-G suffix, category (transactional, service-implicit, service-explicit, promotional), URL whitelisting from 1 October 2024, and PE-TM chain rejection from 11 December 2024. Shape an MSG91 SendOTP request without calling the network. Use when writing an OTP SMS, a DLT template, or an MSG91 OTP call. | 0.1.0 |
<!-- skills:end -->

## Safety

Read [DISCLAIMER.md](DISCLAIMER.md) before you file, invoice, or pay from an answer. Rules are as of 2026-11-01 and change. A rule with `verified: false` comes back with `confirm: true`. The 0.1.0 list, and the places a primary source overrode [SPEC.md](SPEC.md), are in [CHANGELOG.md](CHANGELOG.md). Each skill's `references/sources.md` names the page.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers a new skill and the sourcing rule: a primary https source and an as-of date, or `verified: false` and `confirm: true`. [AGENTS.md](AGENTS.md) is the contract for agents that add skills. [SECURITY.md](SECURITY.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
