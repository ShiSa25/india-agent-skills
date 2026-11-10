# Changelog

## 0.1.2 — 2026-11-10

Patch on the 0.1.1 pack. No rule values changed. The same 13 skills are at metadata version 0.1.2.

- `inr-formatting`: a short form that rounds up to the next unit is written in that unit. `9999500` rupees is `1 Cr`, not `100 L`. Credit ohnitesh (#15).
- `inr-formatting`: a minus sign may come before `₹`, so the tool reads back the `-₹1,234.00` it writes. Credit ohnitesh (#16).
- `tds-freelancer-payments`: optional `ytdTaxedMinor` holds the part of the year already taxed. The threshold uses the whole year, and the base uses only the untaxed part plus this bill, so a later bill is taxed once and a crossing bill does not tax those rupees again. Credit ohnitesh (#17, #18).

## 0.1.1 — 2026-11-01

Security patch on the 0.1.0 pack. No rule values changed. The same 13 skills are at metadata version 0.1.1.

- Aadhaar scans fold Unicode digits, zero-width marks, and grouped separators (dot, comma, NBSP, dash). Long lines are scanned. Paths in the result are masked. The repo scanner uses the same fold and covers more text extensions.
- DPDP findings label a column with letters, digits, and underscores only, capped at 64 characters.
- Cashfree `toleranceSec` cannot exceed the rules-file window. `expectedAmount` must match before fulfilment.
- Razorpay fulfilment compares `expectedMinor` when it is passed.
- Webhook samples for Razorpay and Cashfree return 200 only after the idempotency transaction. Signing secrets and the MSG91 authkey stay on the server.
- OTP review rejects `==` / `===` and a broader set of log and response writes. An MSG91 authkey is redacted by walking values, not by searching the JSON text.
- IFSC lookup caps the body, checks an echoed IFSC, and drops directory fields that are not short plain text.
- `pct` rejects a negative rate. `jsonDecimalToken` returns null on exponent notation instead of a truncated number.
- Link check does not follow a redirect onto a non-public or non-https URL.
- `SECURITY.md` says how to report a vulnerability. Dependabot checks GitHub Actions weekly.
- GitHub Actions are pinned to commits. `actions/checkout` is v7.0.1. `actions/setup-node` is v7.1.0.

## 0.1.0 — 2026-11-01

First public pack. All 13 skills are in the repo at version 0.1.0. Rules data is as of 2026-11-01. Nothing here is published to npm.

Tax, legal, and payment output is an aid. It is general information and a format check. Confirm it with the official source or a qualified professional before you file, invoice, or pay. A result that depends on a rule with `verified: false` sets `confirm: true` and includes `Confirm with the official source before relying on this.`

### Skills

- `gstin-validator` — GSTIN checksum, state, and regular, TDS, TCS, UIN, or NRTP/OIDAR shape.
- `gst-invoice` — Rule 46 tax invoice, credit note, and debit note, with CGST/SGST or UTGST, IGST, and LUT endorsements.
- `gst-e-invoice-json` — schema 1.1 e-invoice JSON. It does not call an IRP.
- `freelancer-export-compliance` — export-of-services checklist, financial year, LUT, Rule 96A, and FEMA dates.
- `tds-freelancer-payments` — TDS on freelancer payments under the Income-tax Act, 2025, section 393, and the pre-1 Apr 2026 labels.
- `razorpay-integration` — checkout signature, raw-body webhook HMAC, subunit conversion, and capture versus authorisation.
- `cashfree-integration` — webhook signature for version 2025-01-01, replay window, and when a status may fulfil.
- `upi-payment-links` — unsigned `upi://pay` link and a QR SVG at ECC M.
- `inr-formatting` — Indian grouping, words, and short form, in integer paise.
- `indian-id-validators` — PAN, TAN, IFSC, PIN, and mobile format checks. IFSC directory lookup is opt-in.
- `aadhaar-safe-handling` — Verhoeff check, mask, scan, and the storage limits. Output is masked.
- `dpdp-compliance-check` — DPDP Act 2023 and DPDP Rules 2025 checklist, plus a schema scan.
- `sms-otp-dlt` — DLT template lint and an MSG91 SendOTP request shape. It does not send the SMS.

### UNVERIFIED items that set `confirm: true`

These are the bundled rules with `verified: false`. Applying one sets `confirm: true`.

- **GSTIN.** TCS marker, 14th character `C` (`gst.gstin.marker.tcs`). No primary source was opened.
- **Invoice and e-invoice.** Rejecting invoice number `"0"` and a slash-only number, and warning on a leading `0`, `/`, or `-` (`gst.invoice.number.rejectLiterals`, `gst.invoice.number.rejectSlashOnly`, `gst.invoice.number.leadingRejectedByIrp`). UTGST labels for state codes `04`, `26`, `31`, `35`, `38` (`gst.invoice.utgstStateCodes`). A rate outside the bundled examples, including GST 2.0 slabs (`gst.invoice.rates.unusual`). Export buyer PIN `999999` (`gst.einvoice.export.pin`). IRN cancellation within 24 hours (`gst.einvoice.irnCancelHours`). Exempt classes: SEZ unit, insurer, bank, NBFC, GTA, passenger transport, multiplex (`gst.einvoice.exemptClasses`).
- **Export of services.** Starting the pre-1 Oct 2026 FEMA clock on the invoice date for services that are not software (`fema.services.clock.invoiceDate`). The exact gazette day of the 13/14 Nov 2025 fifteen-month amendment (`fema.services.gazetteDay.uncertain`): those two invoice dates show both the 9-month and the 15-month deadlines. FIRA/FIRC as a document title (`fema.proof.fira`). e-BRC as compulsory for every services exporter (`fema.proof.ebrc`). A return to nine months by FEMA 23(R)/(8)/2026-RB dated 5 Jun 2026 was not on the RBI notification page, so that instrument is not applied.
- **TDS.** Form 26Q section codes 1023, 1024, 1026, 1027, and 1028 (`tds.paymentCode.map`). Not applying the old non-filer rate in s.206AB (`tds.206ab.apply`). The Income-tax Act, 1961 labels and figures for 1 Apr 2025 through 31 Mar 2026 (`tds.1961.*`), because the bare 1961 text was not opened. A payment on or after 1 Apr 2026 still sets `confirm: true` while the code map or the s.206AB omission is in the answer.
- **Razorpay.** Checkout minima USD 50, EUR 50, GBP 30, and SGD 50 (`razorpay.amount.checkoutMinimumSubunits`). They are not on the integration page that was opened. The skill does not enforce a ₹5,00,000 maximum.
- **Cashfree.** Treating a numeric timestamp above `1000000000000` as milliseconds (`cashfree.webhook.millisecondThreshold`). Cashfree does not publish that threshold. A result that applies the detector sets `confirm: true`.
- **UPI.** VPA grammar (`upi.vpa.pattern`), amount greater than zero with at most two decimal places (`upi.amount.positive`, `upi.amount.maxDecimals`), and a four-digit `mc` (`upi.mc.pattern`). `purpose` is not a v1.6 parameter and is rejected. A successful link still sets `confirm: true` because the VPA grammar and the two-decimal rule are not in the linking spec.
- **Rupees.** Spelling amounts at or above one hundred crore by repeating lakh and crore, with no arab (`inr.aboveCrore.words`). Short forms `L` and `Cr` (`inr.compact.suffix`). `confirm` is true when that spelling or a short form is used. Zero rupees does not trip it.
- **IDs.** IFSC lookup via ifsc.razorpay.com as proof a branch is live (`ids.ifsc.lookupHost`), only when `--lookup` is passed. PIN zone names (`ids.pin.zones`). Mobile pattern `^[6-9][0-9]{9}$` (`ids.mobile.pattern`). Toll-free prefix `1800` (`ids.mobile.tollFreePrefix`).
- **Aadhaar.** A leading digit 0 or 1 (`ids.aadhaar.leadingDigit`): warn, and do not reject on that alone. `999999999999` starts with 9 and does not trip it. VID display `XXXX XXXX XXXX` plus the last 4 (`ids.aadhaar.vid.mask`).
- **DPDP.** Third Schedule user-count line (`dpdp.retention.user-threshold`). The English PDF text layer splits columns, so "not less than two crore" can be misread as "less than". The checklist prints the counts and sets `confirm: true`.
- **DLT and OTP.** Operator `{#var#}` token, variable count, 30-character cap, variable-not-last, and brand-name guidance (`trai.sms.variable.*`, `trai.sms.brand.required`). Callback-number whitelisting has no fixed date (`trai.sms.callback.whitelist`). Promotional hours 10:00–21:00 IST as an absolute ban (`trai.sms.promotional.hours`). MSG91 URL, OTP length, expiry, `##OTP##`, and the attempt limit (`msg91.otp.*`, `otp.practice.attempt-limit`). Those rows are vendor or operator guidance, not TRAI gazette text.

### Where a primary source overrode SPEC.md

Taken from each skill's `references/sources.md`.

- **FEMA clock.** SPEC §1.4's vector for an invoice on 2026-03-15 is a 9-month FEMA date of 2026-12-15, and it treats a return to 9 months under FEMA 23(R)/(8)/2026-RB (5 Jun 2026) as the open question. That instrument was not on the RBI page opened 2026-11-01. FEMA 23(R)/(7)/2025-RB (13 Nov 2025) substituted fifteen months. The 2026 regulations (FEMA 23(R)/2026-RB, 13 Jan 2026, in force 1 Oct 2026) give nine months from the invoice, or twelve months if the export is invoiced or settled in INR. Notification FEMA 23(R)/(1)/2026-RB (22 Sep 2026) replaced "fifteen months" with "nine months" and "eighteen months" with "twelve months" before those regulations commenced. A 2026-03-15 invoice therefore reports 15 months, deadline 2027-06-15, with `confirm: true`.
- **Rule 96A.** SPEC §1.4 states a one-year GST realisation date. The rule text that was read gives services the later of one year and the FEMA period, then 15 days to pay IGST and interest. The script keeps the one-year date and also returns `rule96aReceiptDeadline` and `rule96aTaxPaymentDeadline`.
- **Intermediary place of supply.** SPEC §1.4 states that an intermediary's place of supply is the supplier's location. Finance Act, 2026, section 157 omits IGST s.13(8)(b). Section 1(2) does not defer section 157, so the skill treats the omission as effective on the assent date, 30 Mar 2026. Other s.13 exceptions remain, and the warning stays.
- **E-invoice URP.** SPEC §1.3 and §2 mark buyer `URP` and PIN `999999` as secondary and unverified. Notification 60/2020, as reproduced in the Jharkhand gazette copy that was opened, names `URP` for an export recipient. PIN `999999` is still unverified: the notified schema says an export PIN need not be given. Emitting it sets `confirm: true`.
- **Razorpay capture window.** SPEC §1.6 leaves the auto-refund duration unverified. The capture-settings page opened 2026-11-01 says an authorised payment must be captured within 3 days (minimum 12 minutes; default and maximum 3 days) or it is auto-refunded. The orders API says the amount must be at least INR 1.00; the skill accepts 100 paise. Three-decimal subunits follow the orders API trailing-zero rule. The international-payments example that sends 99.999 KWD as 99999 is not followed. The webhook sample that calls `JSON.stringify` on a parsed body is not followed; the same page says not to parse the body.
- **Cashfree replay window and header.** SPEC §1.7 sets a 300-second tolerance and marks it unverified as a Cashfree requirement. The Payment Gateway signature page still publishes no number. The subscriptions signature page recommends 5 minutes, and the skill uses 300 seconds for PG webhooks as that recommendation. The overview text says `x-idempotency-header`. The 2025-01-01 header table says `x-idempotency-key`, and the skill follows the table. Current samples also show version `2026-01-01` with the same signature headers.
- **UPI P2P ceiling.** SPEC §1.8 states a P2P limit of ₹1,00,000 per day. OC 185B says the P2P per-transaction limit continues under the extant guidelines, and the RBI statement of 9 Apr 2025 keeps P2P at ₹1 lakh. The script reports `perTransactionPaise` of `10000000` and leaves `perDayPaise` null. Banks may set a lower limit. The link is unsigned: v1.6 makes `sign` mandatory for a signed intent, and signing is out of scope.
- **PIN zone names.** SPEC §1.10 shortens the zones to North, West, South, and East. The India Post page returned HTTP 504. A search index of that page used Northern, Western, Southern, Eastern, and Army Postal Service. The script reports the longer names and sets `confirm: true`.
- **Aadhaar vault and the nines specimen.** SPEC §1.11 says to mark the data-vault details `verified: false` because the UIDAI site was flaky, and it says `999999999999` trips the leading-digit warning. Circular No. 14 of 2025 (4 Nov 2025) was opened, so the storage sentence is `verified: true`. The shared Verhoeff helper does not warn on a number that starts with 9. SPEC's parenthetical on that specimen is not applied. `123456789010` starts with 1 and does warn.
- **DPDP Schedule rows.** SPEC §1.12 and §2 leave the ₹10,000 Data Principal duty and the ₹50 crore residual penalty unverified. The Schedule on India Code confirms both. Section 33, which applies the Schedule, commences on 13 May 2027 with the eighteen-month group in G.S.R. 843(E).
- **DLT header suffixes.** SPEC §1.13 calls `-P`, `-S`, `-T`, and `-G` unverified operator notices. The TCCCPR Second Amendment Regulations, 2025, state them. The notification is dated 12 Feb 2025 and the skill treats regulation 17 as in force 60 days later, on 13 Apr 2025. SPEC's 1 Oct 2024 whitelist, read from press release 53/2024, included callback numbers. The direction of 30 Aug 2024 and press release 60/2024 extend URL, APK, and OTT links to 1 Oct 2024 and leave the callback date open, so callback whitelisting stays `verified: false`.
- **TDS table text.** SPEC §1.5 says the s.393 page returned 403 and that every TDS figure stays `verified: false` until a human confirms it. The s.393 page and the s.397(2) FAQ were opened on 2026-11-01, and the rates and thresholds used on or after 1 Apr 2026 are taken from those pages. The bare Act PDF extract that was retrieved did not include the deduction chapter, so the section codes, the s.206AB omission, and the 1961 path stay unverified.
- **GSTIN state names.** SPEC §1.1 cites the e-way bill state list. That URL returned HTTP 403 in the build environment. Display names follow the e-invoice MasterCodes table that was opened. Code 28 is not in that table. The skill still accepts 25 and 28 with the legacy-state warning.

### Release files

`README.md` and `docs/USAGE.md` show real CLI stdout from this tree. `.claude-plugin/marketplace.json` lists all 13 skill paths. `skills.sh.json` groups the same 13 folder names. That file's schema accepts skill names only; the description an installer matches is the `SKILL.md` frontmatter. There is no `.agents/skills` directory in this repo. Cursor reads that path after a skill is installed.
