---
name: freelancer-export-compliance
description: >-
  Decide whether a freelancer invoice is an export of services under IGST
  section 2(6), and compute the financial year, LUT, Rule 96A, and FEMA
  realisation dates. Use when a freelancer invoices a foreign client or an SEZ,
  or asks about an LUT, FIRA, e-BRC, an intermediary, an own branch, or the
  9-month and 15-month realisation clocks.
license: MIT
compatibility: Requires Node.js 20 or newer. No network and no runtime dependencies.
metadata: { version: "0.1.0", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---

# Freelancer export compliance

Run the script. Do not recompute a financial year or a realisation date in the prompt. `confirm: true` means the answer used a rule that was not confirmed from the primary text. Say so, and keep the sentence `Confirm with the official source before relying on this.`

## When to use

- A freelancer in India is invoicing a client outside India, or a supply to an SEZ developer or SEZ unit.
- The user asks whether all five IGST s.2(6) conditions are met, including an own foreign branch or an intermediary.
- The user asks which financial year the LUT must cover, or whether Form GST RFD-11 is what makes a supply an export.
- The user asks for the GST Rule 96A date and the FEMA date. They are different clocks. Show both.
- The user asks what to keep as proof: a bank FIRA/FIRC or advice, and whether an e-BRC is required.

Do not use this skill to file a GST return, to generate the export endorsement on the invoice, or to decide a goods-export shipping period. Do not call the GST portal or an authorised dealer. Do not treat a passing checklist as permission to skip IGST.

## Quick start

From the skill directory:

```bash
node scripts/export-checklist.mjs --json '{"invoiceDate":"2026-03-15","currency":"USD","clientCountry":"US","supplierInIndia":true,"recipientOutsideIndia":true,"placeOfSupplyOutsideIndia":true,"ownBranch":false,"intermediary":false,"forexReceived":true,"lutFiledFY":"2025-26"}'
```

Exit `0` when the supply qualifies as an export or a zero-rated SEZ supply and no stated payment is already late. Exit `1` when it does not qualify, or a clock is already late. Exit `2` on a usage error. Stdout is one JSON object.

`gstRealisationDeadline` is one year from the invoice. `femaRealisationDeadline` is the FEMA date. `rule96aReceiptDeadline` is the later of those two, which is the Rule 96A receipt date when the supply is made without paying IGST. `rule96aTaxPaymentDeadline` is 15 days after that.

Deadline fields taken from that command's real stdout, exit 0. The process also prints `items` and `confirmReasons`:

```json
{"valid":true,"qualifies":true,"isExport":true,"fy":"2025-26","lutRequired":false,"lutFiledFY":"2025-26","gstRealisationDeadline":"2027-03-15","rule96aReceiptDeadline":"2027-06-15","rule96aTaxPaymentDeadline":"2027-06-30","femaRealisationDeadline":"2027-06-15","femaMonths":15,"femaInstrument":"FEMA 23(R)/(7)/2025-RB","femaAlso":[],"confirm":true,"warnings":["Confirm with the official source before relying on this."]}
```

The live object also contains `items` (one row per condition, plus LUT, both clocks, FIRA, and e-BRC) and `confirmReasons`. The dates above are the dates the script prints. Read `items`, do not replace them with a shorter summary that drops a failed limb.

Ask the user for a yes or no on each s.2(6) limb before you fill the booleans. Required fields: `invoiceDate`, `currency`, `clientCountry`, `supplierInIndia`, `recipientOutsideIndia`, `placeOfSupplyOutsideIndia`, `ownBranch`, `intermediary`. Optional: `lutFiledFY` (`2025-26` or `2025-2026`), `paymentReceivedDate`, `sez`, `withPaymentOfTax`, `inrPermittedByRbi`, `forexReceived`.

`amountMinor` is not an input. This skill does not compute tax. `ytdMinor` belongs to the TDS skill.

## Rules

Rules data is `scripts/_rules/gst.json` and `scripts/_rules/fema.json`, as of 2026-11-01. Do not hardcode a month count that contradicts those files.

- **Export of services, IGST s.2(6), all five.** Supplier in India. Recipient outside India. Place of supply outside India. Payment received in convertible foreign exchange, or in Indian rupees wherever the RBI permits. Supplier and recipient are not merely establishments of a distinct person (Explanation 1 in s.8). Any "no" means it is not an export, so GST applies. An LUT is not a sixth condition. [CBIC s.2](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapteri/section2_v1.00.html).
- **Place of supply.** s.13(2) is the recipient's location, except s.13(3) to s.13(13). Until 29 Mar 2026, s.13(8)(b) put intermediary services at the supplier's location, so an Indian intermediary failed limb (iii). The warning text is exactly `intermediary services may not qualify`.
- **Intermediary from 30 Mar 2026.** [Finance Act, 2026, s.157](https://egazette.gov.in/WriteReadData/2026/271439.pdf) omits s.13(8)(b). Section 1(2) does not defer s.157, so the omission is taken from the assent date. s.13(2) then applies unless another s.13 exception still puts the place of supply in India (performance on goods or a person, immovable property, an event, banking to account holders, short-term hire of transport). The warning stays, because those other exceptions remain. The CBIC HTML of s.13 still showed clause (b) when it was read; the Gazette is the amending Act.
- **Own branch.** `ownBranch: true` fails limb (v). It is not an export.
- **INR.** The warning text is exactly `check whether RBI permits; may fail s.2(6)(iv)`. Set `inrPermittedByRbi` only when the user has that permission. Otherwise limb (iv) fails.
- **Zero-rating, IGST s.16.** Exports and supplies to an SEZ developer or SEZ unit. Either a bond or LUT without IGST, or IGST paid and refunded. [Council compilation of s.16](https://gstcouncil.gov.in/sites/default/files/2024-03/annexure-5-igst-act%5F2017.pdf).
- **LUT.** Form GST RFD-11, for the financial year selected on the portal. A LUT for 2025-26 does not cover 1 Apr 2026. Missing LUT does not stop the supply being an export: pay IGST and claim the refund instead. [GST tutorial](https://tutorial.gst.gov.in/userguide/refund/Furnishing_of_Letter_of_Undertaking_for_Export_of_Goods_or_Services.htm).
- **Rule 96A.** For services supplied without IGST, payment must arrive by the later of one year from the invoice and the FEMA period (including an RBI extension). IGST and interest are then due within 15 days. The same clock applies to an SEZ supply without IGST (sub-rule (6)). Paying IGST (`withPaymentOfTax: true`) takes the supply off this bond clock. FEMA still runs. [Rule 96A](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter10/rule96a_v1.00.html).
- **FEMA, separate from Rule 96A.** Foreign-exchange invoices: 9 months through 13 Nov 2025; 15 months from 14 Nov 2025 through 30 Sep 2026 under FEMA 23(R)/(7)/2025-RB; 9 months from 1 Oct 2026 under FEMA 23(R)/(1)/2026-RB. INR invoices from 1 Oct 2026: 12 months. An authorised dealer can extend. [2025 amendment](https://www.rbi.org.in/Scripts/BS_FemaNotifications.aspx?Id=12923), [press release 61626](https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=61626), [2026 regulations](https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=13277).
- **Proof.** Keep the bank advice. FIRA/FIRC as a document title is UNVERIFIED. e-BRC for every services exporter is UNVERIFIED and is not treated as compulsory.

`femaAlso` lists the other month count when the Gazette day of the November 2025 amendment is the invoice date (13 or 14 Nov 2025). On those two dates, show both deadlines.

## Edge cases

- 15 Mar 2026: FY `2025-26`, one-year date `2027-03-15`, FEMA 15 months `2027-06-15`, Rule 96A receipt `2027-06-15`, tax-pay date `2027-06-30`. A 9-month FEMA date is not what the RBI text supports for this invoice.
- 10 Jan 2026: FEMA 15 months, `2027-04-10`.
- 31 Mar 2026 and 1 Apr 2026 are different financial years. The LUT has to be filed again.
- 31 Jan plus one month clamps to 28 Feb in a non-leap year (`2026-02-28`). 31 May 2024 plus the 9-month period in force then is `2025-02-28`. 31 May 2023 plus 9 months is `2024-02-29`. 31 May 2026 is inside the 15-month window, so its FEMA date is `2027-08-31`, not a 9-month date.
- From 1 Oct 2026 a USD invoice is 9 FEMA months, and Rule 96A uses the later one-year date. A payment can miss FEMA while the one-year limb is still open. That payment is late.
- While the 15-month window is open, a payment after the one-year anniversary can still be inside Rule 96A, because the rule takes the later date. FEMA is still its own clock.
- Before 1 Oct 2026 the script starts FEMA on the invoice date. For services that are not software, the 2015 regulations say "date of export", and the invoice-date sentence is written for software. That use is UNVERIFIED, so `confirm` is true.
- Client country India, and not an SEZ, fails "recipient outside India" even if the boolean was set true.
- Input over 10 KB, or a zero-width or bidi character, is a usage error. Dates are `YYYY-MM-DD` in IST. Do not parse them with `new Date('YYYY-MM-DD')`.

## Example prompts

- "I invoiced a US client on 15 March 2026 in dollars. Does my 2025-26 LUT cover it, and when do GST and FEMA say the money must arrive?"
- "The client is my own branch in Singapore. Is this an export?"
- "I only arranged the supply between a foreign marketplace and the buyer. Invoice date 29 March 2026, and the same question for 30 March 2026."
- "The client will pay in INR. Does s.2(6)(iv) still hold?"
- "Payment arrived on 1 August 2027 for an invoice dated 15 October 2026. Did I miss FEMA, Rule 96A, or both?"

## Disclaimer

This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.
