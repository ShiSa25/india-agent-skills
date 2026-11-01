# india-agent-skills — Build SPEC v0.1

Last checked: 1 Nov 2026 (IST). Repo: github.com/ShiSa25/india-agent-skills (MIT). Distribution: GitHub only, no npm.
Every rule below has a source and an "as of" date. **UNVERIFIED** means no primary source was opened. Code must not assert UNVERIFIED rules as fact: print them with `confirm: true` and the text "Confirm with the official source before relying on this."

---------------------------------------------------------------------
## 0. Shared conventions (every agent MUST follow)

### 0.1 Repo tree
```
README.md  LICENSE  CHANGELOG.md  SPEC.md  skills.sh.json  package.json(private, "type":"module", no deps)
.claude-plugin/marketplace.json
.github/workflows/ci.yml
rules/                       # versioned data, one file per domain
  gst.json  tds.json  fema.json  upi.json  trai.json  dpdp.json  ids.json
lib/                         # shared, zero-dep, owned by Agent 0
  money.mjs  fy.mjs  gstin.mjs  verhoeff.mjs  rules.mjs  disclaimer.mjs
  vendor/qrcodegen.mjs       # Nayuki QR Code generator, MIT, header kept verbatim
skills/<skill-name>/
  SKILL.md  scripts/*.mjs  references/*.md  tests/*.test.mjs
evals/<skill-name>/evals.json
```
At runtime, skills must be self-contained, because installers copy only the skill folder. So copy the `lib/` files each skill needs into `skills/<name>/scripts/_lib/`, using `node tools/sync-lib.mjs`. CI fails when a copy drifts from `lib/`.

### 0.2 SKILL.md frontmatter (Agent Skills spec, agentskills.io/specification)
```yaml
---
name: gstin-validator            # 1–64 chars, [a-z0-9-], equals folder name
description: >-                  # ≤1024 chars; say WHAT and WHEN ("Use when…")
  Validate Indian GSTINs ... Use when a user pastes a GSTIN or builds GST forms.
license: MIT
metadata: { version: "0.1.0", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---
```
- Keep the body under 500 lines. Sections in this order: When to use · Quick start (commands) · Rules (with source links and as-of dates) · Edge cases · Disclaimer.
- Scripts are invoked as `node scripts/x.mjs --json '<input>'`. They print JSON to stdout, exit 0 when valid, 1 when invalid, and 2 on a usage error.

### 0.3 Coding rules
- Node ≥ 20, ESM `.mjs`, **zero runtime dependencies**, and no network calls anywhere (tests included). The optional IFSC `--lookup` flag is the only exception: it must be opt-in, and tests mock `fetch`.
- **Money:** never floats. Keep amounts as BigInt paise (minor units) internally, and accept them as a string `"1234.50"` or a BigInt. `lib/money.mjs` provides:
  - `parseAmount(str, exponent=2) -> bigint`, which rejects more decimals than `exponent`, exponent notation, and NaN.
  - `formatMinor(bigint, exponent)`.
  - `pct(minor, rateBasisPoints, mode='half-up') -> bigint`. Rates are basis points (18% = 1800).
  - Rounding is half-up, away from zero for positive amounts. Negative amounts (credit notes) round symmetrically.
- **Dates:** all date logic runs in IST (`Asia/Kolkata`, UTC+05:30, no DST). Inputs are `YYYY-MM-DD` strings. Never use `new Date('YYYY-MM-DD')` (that parses as UTC); use `lib/fy.mjs`.
- **FY:** 1 Apr–31 Mar. `fyOf('2026-03-31') -> "2025-26"`, `fyOf('2026-04-01') -> "2026-27"`. Display format `"2025-26"`; the GST portal also uses `"2025-2026"`, so accept both on input.
- **Input sanitisation:**
  - Trim the input and NFKC-normalise it. Strip internal spaces and hyphens for IDs, uppercase PAN, GSTIN and IFSC, and reject zero-width characters.
  - Limit input length to 10 KB to prevent regex DoS; use only anchored regexes with no nested quantifiers.
- **Crypto:** `crypto.timingSafeEqual`, only on equal-length Buffers; check the length first.
- **Unicode:** the rupee sign is U+20B9 `₹`. Never write "Rs." in generated invoices unless the user asks for it.
- **Test IDs:** synthetic only. Use the generators in `lib/gstin.mjs` and `lib/verhoeff.mjs`. The only real GSTINs allowed are the public company and platform ones listed in §1, used solely to check the checksum. Never use a real individual's PAN or Aadhaar.

### 0.4 Rules data files (`rules/*.json`)
```json
{ "schema": 1, "domain": "tds", "asOf": "2026-11-01",
  "rules": [ { "id": "tds.contractor.rate.individual", "value": 100, "unit": "bp",
     "effectiveFrom": "2026-04-01", "effectiveTo": null,
     "source": "https://www.incometaxindia.gov.in/w/section-393-6", "verified": true, "note": "" } ] }
```
- Scripts read their values from these files and never hardcode them.
- Any output that depends on a rule with `verified:false` sets `"confirm": true`.
- Lookups take a date, so they can pick a rule by date (for example FEMA 9 vs 15 months).

### 0.5 Disclaimer (`lib/disclaimer.mjs`; print it in SKILL.md and in every tax/legal/payment script's output)
> This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of {asOf} and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.

### 0.6 Tests and CI
- Use `node --test` (node:test + node:assert/strict). Name test files `skills/<s>/tests/*.test.mjs`.
- Every rule in §1 has at least one positive and one negative vector. Add a fuzz test wherever there is a checksum: flip any single character and the ID must fail. (The GSTIN mod-36 checksum catches all single-character substitutions; it does not catch every transposition, so do not assert that.)
- `ci.yml`: Node 20 and 22 matrix. Steps:
  1. `node --test`.
  2. `npx skills-ref validate skills/*`, pinned to a commit. If that tool is not available, use the fallback `node tools/validate-frontmatter.mjs`.
  3. `node tools/sync-lib.mjs --check`.
  4. `node tools/check-rules.mjs`: every rule has a source and asOf, and every URL is https.
  5. A grep guard: fail on `parseFloat(` or `* 100` in money code.
  6. `scan-aadhaar` over the repo, which must find 0 unmasked values outside the allow-listed synthetic fixtures.

### 0.7 Parallel agents: branch/PR rules
- Branch `feat/<skill-name>`, one PR per skill. Touch only `skills/<own>/`, `evals/<own>/`, and your own `rules/<domain>.json` keys.
- Agent 0 (the integrator) alone edits `lib/`, `tools/`, README, `marketplace.json`, `skills.sh.json`, CHANGELOG and ci.yml. Agent 0 merges `lib/` first; everyone else rebases onto it.
- PR body: the vectors added, any UNVERIFIED items, and the output of `node --test`. Merge only when CI is green. No force-push to main.
- Ownership:
  - Agent 0: lib + gstin-validator.
  - Agent 1: gst-invoice + gst-e-invoice-json.
  - Agent 2: freelancer-export-compliance + tds-freelancer-payments.
  - Agent 3: razorpay + cashfree.
  - Agent 4: upi-payment-links + inr-formatting.
  - Agent 5: indian-id-validators + aadhaar-safe-handling.
  - Agent 6: dpdp + sms-otp-dlt.

### 0.8 marketplace.json (Claude Code)
`{"name":"india-agent-skills","owner":{"name":"Shivanshu Sahu","url":"https://github.com/ShiSa25"},"plugins":[{"name":"india-agent-skills","source":"./","strict":false,"skills":["./skills/gstin-validator", "..."]}]}`. Validate it with `claude plugin validate .` (manual step).

---------------------------------------------------------------------
## 1. Skills

### 1.1 gstin-validator  (Agent 0)
- **Signature:** `validateGstin(s) -> {valid, normalized, type:'regular'|'tds'|'tcs'|'uin'|'nrtp_oidar'|'unknown', stateCode, stateName, pan?, errors[], warnings[]}`. Also exported: `checkChar(first14)` and `generateSyntheticGstin(stateCode, opts)`.
- **Checksum:** map `0-9A-Z` to 0..35. Weight odd positions (1-based) by 1 and even positions by 2. For each product p, add `floor(p/36) + p%36`. Check character = `C[(36 - sum%36) % 36]`. Verified in code on 1 Nov 2026.
- **Structure:**
  - **Regular:** `SS` + PAN(10) + entity character (1–9 then A–Z) + `Z` + check character.
  - **TDS deductor:** `SS` + TAN(10, format `AAAA99999A`) + entity character + `D` + check character.
  - **TCS (e-commerce operator):** 14th character `C` — UNVERIFIED primary; secondary sources only.
  - **UIN (UN bodies/embassies):** `SS` + `YY` + `CCC` (country code or `UNO`) + 5 digits + `UN`, or `ON`/`OP` per CBIC ("…UIN"/"ONP") — the 13th and 14th characters vary, so validate the checksum and length only. Example: `2717USA00046UNV` is valid.
  - **NRTP/OIDAR:** `99` + `YY` + `CCC` + 5 digits + `OS` + check character.
- **State codes** (e-way bill master, docs.ewaybillgst.gov.in/apidocs/state-code.html, and the e-invoice MasterCodes, both checked 1 Nov 2026):
  - 01–24, 26, 27, 29–38 (38 = Ladakh, 37 = Andhra Pradesh, 36 = Telangana), 97 = Other Territory.
  - 99 = centre jurisdiction / NRTP / OIDAR.
  - 25 (Daman & Diu): still listed in the e-invoice master, but merged into 26 from 1 Aug 2020 (secondary). Accept it with the warning "legacy state code".
  - 28 (undivided Andhra Pradesh): legacy, so accept with a warning.
  - 96 = "Other countries": a place-of-supply code only, never a GSTIN prefix.
- **Vectors:**
  - Valid real (public entities):
    - `27AAACR5055K1Z7` (Reliance)
    - `9923USA29044OSE` (Upwork), `9924ISR29001OSH` (Fiverr), `9917USA29016OS6` (GoDaddy)
    - `2717USA00046UNV`, `2317UNO00001UND`
    - `27AAPFU0939F1ZV` (GST portal sample)
  - Invalid: `9917USA00013OS5` (a widely copied blog example; correct check character `P`); `27AAACR5055K1Z8`; length 14 or 16; lowercase input → normalise to valid with a warning; `00…`, `98…`, `96…` → invalid state.
  - Synthetic: `29ABCDE1234F1ZW`, `27AAACX0000A1DK` (TDS type), `25AAACX0000A1ZF` (legacy-code warning).
- **Edge cases:**
  - 13th character `0` is invalid.
  - The PAN segment must pass PAN format (§1.10), except for UIN/NRTP/TDS types.
  - Unicode look-alikes (Cyrillic А) must be rejected.
  - Output must say: "Checksum valid ≠ registered/active; check services.gst.gov.in/services/searchtp".

### 1.2 gst-invoice  (Agent 1)
- **Signature:** `buildInvoice(input) -> {invoice, html, warnings[], confirm}` and `taxSplit({supplierState, placeOfSupply, taxableMinor, rateBp, supplyType}) -> {cgst, sgst, igst, cess:0n}`.
- **Rules:**
  - Intra-state (supplier state == place of supply): CGST = SGST = rate/2.
  - Inter-state, export or SEZ: IGST at the full rate. Export/SEZ under LUT: IGST 0 plus the endorsement. With payment of tax: IGST charged.
  - **SEZ supplies are always inter-state**, even within the same state (IGST s.7(5)(b)).
  - Union territories without a legislature (UTGST): code 04, 26, 31, 35, 38 → label "UTGST" instead of "SGST" (secondary; mark verified:false).
- **Rule 46** (CBIC; mirror cggst.com/uploads/document/1755065070-rule-46.pdf; as of 1 Nov 2026):
  - Invoice number ≤ 16 characters, using only `[A-Za-z0-9/-]`, consecutive, unique within the FY. Regex `^[A-Za-z0-9/-]{1,16}$`. Reject `"0"` and `"/"`-only numbers (GSTN advisory, UNVERIFIED).
  - Required fields: supplier name/address/GSTIN; number; date; recipient name/address/GSTIN or UIN if registered; place of supply with state name and code when inter-state; HSN/SAC; description; quantity/unit; total and taxable value after discount; rate and amount per tax; reverse-charge flag; signature.
- **Export endorsement**, exact text: `SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX`, or `…ON PAYMENT OF INTEGRATED TAX`. Also needed: recipient address, delivery address, and country of destination.
- **Rounding:**
  - Compute tax per line in paise, half-up.
  - CGST s.170 rounds tax *payable* to the nearest rupee (≥ 50 paise rounds up). So invoices show paise, and an optional `roundOff` line rounds the total to the rupee. Round each tax head separately.
- **Amount in words:** use inr-formatting `toWords`, e.g. `Rupees Forty-Nine Thousand Five Hundred Sixty Only`.
- **Rates:** user-supplied, as basis points from {0, 5, 12, 18, 28, 3, 0.25, 1.5, 0.1}. GST 2.0 (22 Sep 2025) moved most goods to 5/18/40 — UNVERIFIED in this run, so just accept any non-negative rate and warn on unusual ones. Never infer a rate from the HSN code.
- **Vectors:**
  - 1,800 bp on ₹42,000.00: inter-state → IGST 7,560.00; intra → 3,780.00 + 3,780.00.
  - 1,800 bp on ₹0.03 → ₹0.01 (3 paise × 18% = 0.54 paise, half-up → 1 paise); ₹0.02 → 0.36 paise → ₹0.00.
  - Credit note −₹1,000 → −₹180.
  - 17-character invoice number → error; `INV/2026-27/0001` (16 characters) → ok.
  - SEZ recipient in the same state → IGST.
  - Export under LUT → IGST 0 and the endorsement string, byte-exact.

### 1.3 gst-e-invoice-json  (Agent 1)
- **Signature:** `buildEinvoice(invoice) -> object` and `validateEinvoice(obj) -> {valid, errors[{path,msg}]}`. It never calls an IRP.
- **Schema v1.1:** notified by CGST Notification 60/2020 (30 Jul 2020). PDF: einvoice1.gst.gov.in/Documents/E-INVOICE-SCHEMA.pdf (that PDF is an older draft showing `1.00`; emit `"Version":"1.1"`).
- **Key fields:** `TranDtls.TaxSch="GST"`; `SupTyp` ∈ {B2B, SEZWP, SEZWOP, EXPWP, EXPWOP, DEXP}; `RegRev` Y/N; `DocDtls.Typ` ∈ {INV, CRN, DBN}; `DocDtls.No` ≤ 16 characters; `DocDtls.Dt` `DD/MM/YYYY`.
- **Export buyer:** `Gstin:"URP"`, `Pos:"96"`, `Stcd:"96"`, `Pin:999999`. Code 96 is confirmed in MasterCodes; URP and 999999 are secondary (ClearTax/IRP sandbox), so mark them verified:false.
- **Totals:** `ValDtls` = the sum of items. Allow a ±₹1 rounding tolerance only as a warning.
- **Applicability (einvoice.gst.gov.in; GSTN advisory 543 of 5 Nov 2024):**
  - Mandatory where AATO > ₹5 crore in any FY from 2017-18 (from 1 Aug 2023).
  - Taxpayers with AATO ≥ ₹10 crore must report to the IRP within **30 days** of the document date, from 1 Apr 2025. This applies to invoices, credit notes and debit notes.
  - IRN cancellation within 24 hours (IRP documentation; mark verified:false).
  - Exempt classes (SEZ units, insurers, banks/NBFCs, GTA, passenger transport, multiplex) → print "may be exempt — confirm" (UNVERIFIED list).
- **Vectors:**
  - A minimal B2B payload is valid.
  - EXPWOP with a GSTIN buyer → error (must be URP).
  - `Dt "2026-04-01"` → error (format).
  - A 31-day-old document date with AATO 12 crore → warning "30-day IRP limit".
  - Item totals mismatch → error.

### 1.4 freelancer-export-compliance  (Agent 2)
- **Signature:** `exportChecklist({invoiceDate, currency, clientCountry, lutFiledFY?, paymentReceivedDate?, sez?}) -> {fy, lutRequired, gstRealisationDeadline, femaRealisationDeadline, items[], confirm}`.
- **Rules:**
  - **Export of services (IGST s.2(6)), all five conditions:** supplier in India; recipient outside India; place of supply outside India; paid in convertible foreign exchange (or INR where RBI permits); not merely establishments of the same person.
    - The skill asks a yes/no for each condition. If any answer is no, it is not an export, so GST applies.
    - **Place of supply:** IGST s.13(2) is the general rule (recipient's location). Intermediary and other s.13(3)–(13) services are exceptions (an intermediary's place of supply = supplier's location), so warn "intermediary services may not qualify".
  - **Zero-rating (IGST s.16):** exports and SEZ supplies, either under LUT without IGST or with IGST paid and refunded.
  - **LUT:** form GST RFD-11, valid for the FY it is furnished in, renewed each FY (GST tutorial). Without an LUT you must pay IGST and claim a refund — an LUT is not a condition of being an export.
  - **GST realisation:** CGST Rule 96A — payment within **1 year** of the invoice date (or as RBI extends it), else pay IGST plus interest. As of 1 Nov 2026.
  - **FEMA realisation (separate):**
    - 9 months by default.
    - **15 months** under RBI FEMA 23(R)/(7)/2025-RB, 13 Nov 2025 (rbi.org.in PR prid=61626, verified).
    - Reported back to **9 months** under FEMA 23(R)/(8)/2026-RB, dated 5 Jun 2026 — **UNVERIFIED primary**.
    - In code, pick by invoice date from `rules/fema.json` and always set `confirm:true`.
  - **Proof:** FIRA/FIRC or a bank advice; e-BRC (DGFT) for exporters who need it. For services exporters, e-BRC is optional/when required — UNVERIFIED.
- **Vectors:**
  - Invoice 2026-03-15 → FY "2025-26", GST deadline 2027-03-15, FEMA 2026-12-15 (9 months, confirm).
  - Invoice 2026-01-10 → FEMA 15 months → 2027-04-10 (confirm).
  - 2026-03-31 vs 2026-04-01 → different FY and LUT.
  - 31 Jan + 1 month clamps to month end: invoice 2026-05-31, 9 months → 2027-02-28.
  - Paid in INR from a foreign client → "check whether RBI permits; may fail s.2(6)(iv)".
  - Client is the user's own foreign branch → not an export.

### 1.5 tds-freelancer-payments  (Agent 2)
- **Signature:** `tds({paymentDate, payerType, payeeType, category, amountMinor, ytdMinor, panAvailable}) -> {tdsMinor, rateBp, section, oldSection, paymentCode, thresholdHit, confirm}`.
- **Rules:** Income-tax Act 2025 (from 1 Apr 2026), s.393(1) Table. Source: incometaxindia s.393 page (403 to bots; read via search excerpts and the taxguru table) → set `verified:false` until a human confirms.
  - **6(i) contractors (old 194C):** 1% individual/HUF payee, 2% others; ₹30,000 single or ₹1,00,000 aggregate in the FY.
  - **6(ii) individual/HUF payers not required to audit (old 194M):** 2% above ₹50 lakh.
  - **6(iii) fees (old 194J):**
    - 10% professional; 2% FTS (non-professional), royalty for films, call centre.
    - Threshold ₹50,000 per FY per category; no threshold for director remuneration.
    - Payment codes 1026 (FTS), 1027 (professional), 1028 (director), 1023/1024 (contractor).
  - **No PAN:** s.397(2), higher of the specified rate / rate in force / **20%** (5% for certain items). incometaxindia FAQ on s.397.
  - **Old s.206AB:** not carried into the 2025 Act — do not apply it for payments on or after 1 Apr 2026.
  - Before 1 Apr 2026, use 1961 Act labels (194C/194J/206AA), with confirm.
- **Vectors:**
  - Professional, YTD ₹40,000 + ₹9,000 → 0; + ₹11,000 (crossing 50k) → 10% on ₹51,000 = ₹5,100 (TDS on the whole amount once crossed; confirm).
  - Contractor, individual, ₹25,000 → 0; ₹35,000 single → ₹350.
  - No PAN, professional ₹60,000 → 20% = ₹12,000.
  - Date 2026-03-31 → old-Act path.

### 1.6 razorpay-integration  (Agent 3)
- **Signatures:**
  - `verifyPaymentSignature({orderId, paymentId, signature, secret}) -> bool`, computing HMAC-SHA256 hex of `${order_id}|${payment_id}`.
  - `verifyWebhook({rawBody:Buffer|string, signature, secret}) -> bool`: header `X-Razorpay-Signature`, HMAC-SHA256 hex over the **raw** body.
  - `toSubunits(amountStr, currency) -> bigint`.
- **Rules (razorpay.com/docs, as of 1 Nov 2026):**
  - Amounts are in the smallest subunit: INR paise (×100). Zero-decimal currencies such as JPY ×1.
  - Three-decimal currencies KWD, BHD, OMR are ×1000 **and the last digit must be 0** (295.991 → reject, or round to 295990 with a warning).
  - INR minimum ₹1 = 100 paise (secondary; confirm).
  - Webhooks are retried for up to 24 hours when there is no 2xx within 5 seconds. Deduplicate on the `x-razorpay-event-id` header, stored atomically, and return 200 on duplicates.
  - Events can arrive out of order.
  - `payment.authorized` ≠ paid. Fulfil on `payment.captured` / `order.paid`. Auto-capture is a dashboard setting; uncaptured payments auto-refund after a window (UNVERIFIED duration).
  - Refunds: `refund.processed`/`refund.failed`. A partial refund must be ≤ captured minus refunded (BigInt).
- **Examples:** Express `express.raw({type:'application/json'})` and Next.js `await req.text()`. Never `JSON.stringify(req.body)`.
- **Vectors:** HMAC computed in-test with node:crypto; a whitespace change in the body → fail; an uppercase-hex signature → fail (documented choice: no normalisation); a signature of a different length → false with no throw; KWD `"1.005"` → error.

### 1.7 cashfree-integration  (Agent 3)
- **Signature:** `verifyCashfreeWebhook({rawBody, timestamp, signature, secret, nowMs, toleranceSec=300}) -> {valid, reason}`.
- **Rules (cashfree.com/docs api-reference webhooks/signature-verification, as of 1 Nov 2026):**
  - Signature = Base64(HMAC-SHA256(`x-webhook-timestamp` + rawBody, client secret)), compared with `x-webhook-signature`.
  - Version header `x-webhook-version: 2025-01-01`; deduplicate on `x-idempotency-key`.
  - Replay window: Cashfree does not publish a number in what we read, so the **300-second tolerance is our default (UNVERIFIED as a Cashfree requirement)**. The timestamp is in ms vs s — detect it: a value > 1e12 means ms.
- **Vectors:** valid; tampered body; stale timestamp at +301 s → reject; hex digest supplied → reject with "expected base64".

### 1.8 upi-payment-links  (Agent 4)
- **Signatures:** `buildUpiLink({pa, pn, am?, tn?, tr?, mc?, cu='INR', mode?}) -> string`, `parseUpiLink(str)`, and `upiQrSvg(link)` using vendored Nayuki qrcodegen (MIT, header retained, ECC M).
- **Rules** (NPCI UPI Linking Specs v1.6, Nov 2017; mirror labnol.org/files/linking.pdf):
  - `pa` and `pn` are mandatory.
  - `am` is a decimal string; if it is absent, the amount is editable.
  - `mam` is the minimum amount.
  - `cu` is only INR.
  - `tr` is mandatory for merchant/dynamic links.
  - `mode`: 00 default, 01 QR, 02 secure QR, 04 intent, 05 secure intent, 06 NFC, 07 BLE, 08 UHF, 15 SEBI.
  - `sign` and `orgid` (`000000` for merchant-created) apply to signed merchant intents — **out of scope**, so the skill must say "unsigned links: P2P/personal use; merchants use their PSP/PG".
  - Encoding: `encodeURIComponent` per value, with spaces as `%20`.
- **Amount format:** up to 2 decimals and > 0 (UNVERIFIED as a spec rule; enforced as a safe default).
- **VPA regex:** `^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$` — our heuristic, UNVERIFIED.
- **Limits** (NPCI OC 185-A addendum, effective 15 Sep 2025):
  - P2P ₹1,00,000 per day.
  - Specified P2M categories: ₹5 lakh per transaction / ₹10 lakh per day (capital markets, insurance, GeM, travel, collections); credit-card bill ₹5 lakh / ₹6 lakh per day; jewellery ₹2 lakh / ₹6 lakh.
  - Banks may set lower limits.
  - Behaviour: warn above ₹1 lakh for P2P; never hard-block.
- **No proof of payment:** a link and QR prove nothing. Reconcile via the bank statement or PG webhook only.
- **Vectors:** round-trip; `pn="Shiv & Co"` → `Shiv%20%26%20Co`; `am="10.999"` → error; `cu=USD` → error; missing `pa` → error; Unicode name; QR SVG is deterministic (snapshot hash).

### 1.9 inr-formatting  (Agent 4)
- **Signatures:** `formatINR(minor:bigint|string, {symbol=true, paise=true})`, `toWords(minor) -> "Rupees … and … Paise Only"`, and `compact(minor)`.
- **Rules:**
  - Indian grouping: the last 3 digits, then groups of 2.
  - Implement it with BigInt string math. Node 24 `Intl en-IN` gives `12,34,567` and `-₹12,34,567.50`, and with compact it gives `1.2Cr`. Do not rely on it for parity, because ICU differs across versions.
- **Words:** units are Thousand, Lakh, Crore. Above 99 crore, continue as "Hundred Crore", "Thousand Crore" (convention; there is no "Arab" by default).
- **Negatives:** `-₹1,234.00` (minus before ₹), with an option for accounting parentheses `(₹1,234.00)`.
- **Vectors:**
  - 0 → `₹0.00` / "Rupees Zero Only".
  - 100000 rupees → `₹1,00,000.00` "One Lakh".
  - 1,00,00,000 → "One Crore".
  - 12,34,56,789.50 → "Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine and Fifty Paise Only".
  - 12345678901234567890 paise (BigInt).
  - `-0.50` → `-₹0.50`.
  - `"1e5"` → error.

### 1.10 indian-id-validators  (Agent 5)
- **PAN:** `^[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]$`. The 4th character is the holder type: P individual, C company, H HUF, F firm/LLP, A AOP, T trust, B BOI, L local authority, J artificial juridical person, G government.
  - The 5th character is the surname/name initial (cannot be checked).
  - There is no public checksum on the 10th character, so don't claim one.
- **TAN:** `^[A-Z]{4}[0-9]{5}[A-Z]$`.
- **IFSC:** `^[A-Z]{4}0[A-Z0-9]{6}$` (RBI). `--lookup` against ifsc.razorpay.com is opt-in.
- **PIN:** `^[1-9][0-9]{5}$`. Zones: 1–2 North, 3–4 West, 5–6 South, 7–8 East, 9 Army Postal Service (India Post). An optional state cross-check uses the PIN-prefix ranges in einvoice1 MasterCodes (e.g. 27 MH 400–445, 29 KA 560–591). Overlaps exist (396 is shared by 24/25/26), so a mismatch is only a warning.
- **Mobile:**
  - Accept `+91`, `91`, `0` prefixes and spaces/hyphens.
  - Core rule `^[6-9][0-9]{9}$` (DoT numbering; mark verified:false).
  - Reject toll-free (1800) and landline numbers.
- **Vectors:** `ABCPE1234F` valid (synthetic); `ABCDE1234F` → invalid (D is not a holder type); `SBIN0001234` valid; `SBIN1001234` invalid; `011001` invalid; `+91 98765-43210` → `9876543210`; `5876543210` invalid.

### 1.11 aadhaar-safe-handling  (Agent 5)
- **Signatures:** `verhoeffValid(s)`, `generateSynthetic(seed)`, `mask(s) -> "XXXX XXXX 1234"`, and `scanText(text) -> [{line, masked}]`.
- **Rules:**
  - 12 digits plus a Verhoeff check digit.
  - **First digit not 0/1** is a common implementation rule, but UIDAI does not publish it. Flag it as a warning only (UNVERIFIED).
  - Masking shows the last 4 digits only.
  - Aadhaar Act s.29 restricts use and sharing of core biometric and identity information. Full numbers must be stored only in an Aadhaar Data Vault (UIDAI circular/FAQ; site flaky, mark verified:false for the details).
  - Never log full numbers; the scanner must itself output masked values only.
  - Virtual ID: 16 digits — treat it as sensitive too.
- **Vectors:** synthetic `234123412346`, `999999999999`, `123456789010` (Verhoeff-valid; the last two trip the 0/1 warning); flipping any digit → invalid; `2341 2341 2346` with spaces → valid; the scanner ignores 12-digit numbers that fail Verhoeff and timestamps.

### 1.12 dpdp-compliance-check  (Agent 6)
- **Rules:** DPDP Act 2023 plus the DPDP Rules notified **13 Nov 2025** (MeitY/PIB; livelaw copy of the gazette).
  - Rules 1, 2, 17–21: in force immediately (Data Protection Board).
  - Rule 4 (consent managers): **13 Nov 2026**.
  - Rules 3, 5–16, 22, 23: **13 May 2027**.
  - Schedule penalties (maximum): ₹250 crore for failing reasonable security safeguards; ₹200 crore for not notifying a breach; ₹200 crore for children's data obligations. Other items from the schedule must be filled from the Act text (≤ ₹50 crore general; ₹10,000 for data-principal duties — UNVERIFIED in this run).
- **Scanner:** detects PII column names (email, phone/mobile, aadhaar, pan, dob, address, ip, device_id, location) in Prisma, SQL DDL and TS types. The output is a checklist markdown with the effective dates computed relative to "today" (IST).
- **Vectors:** a Prisma model with `aadhaarNumber` → high-severity finding; a snapshot of the checklist on a fixed date of 2026-11-01 shows "Rule 4 in force in 12 days".

### 1.13 sms-otp-dlt  (Agent 6)
- **Rules:**
  - Templates must be registered on DLT; variables are `{#var#}`.
  - Since **1 Oct 2024**, URLs/APK/OTT links and call-back numbers in commercial SMS must be whitelisted (TRAI PR 53/2024).
  - From 11 Dec 2024, unregistered PE–TM chains are rejected (TRAI PR 92/2024).
  - Header suffixes -P/-S/-T/-G by category — UNVERIFIED (operator notices, 2025).
  - "Max 2 vars", "var not last word" and "≤ 30 chars per var" are operator guidance (MSG91), not TRAI. Lint them as warnings tagged `source:"operator"`.
- **Lint checks:** the template matches the rendered message exactly; URL present but not in the whitelist set; brand name present.
- **OTP practice:** 6 digits, generated with `crypto.randomInt`, a 5–10 minute TTL, attempt limits, and the OTP never logged.
- **Vectors:** good template; a URL not whitelisted → error; `{#var#}` as the last word → warning; a 31-character variable → warning; a promotional category sent at 22:00 IST → warning that promotional messages are restricted to 10:00–21:00 IST (UNVERIFIED).

---------------------------------------------------------------------
## 2. Open UNVERIFIED list (fill `verified:true` only after opening a primary source)
- FEMA return to 9 months (FEMA 23(R)/(8)/2026-RB, 5 Jun 2026).
- TCS GSTIN 14th character `C`.
- UTGST code list.
- Invoice number "0" advisory.
- GST 2.0 rate slabs.
- e-invoice URP/999999; IRN 24-hour cancellation; exempt classes.
- TDS figures (pending a bare-Act check).
- e-BRC for services.
- Razorpay minimum amount and auto-refund window.
- Cashfree replay tolerance.
- UPI 2-decimal rule, VPA regex, `purpose` parameter (not in v1.6).
- Aadhaar first digit 0/1; ADV details.
- Mobile 6–9 rule.
- DPDP non-headline penalties.
- TRAI header suffixes and promotional hours.
