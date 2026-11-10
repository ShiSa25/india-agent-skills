---
name: tds-freelancer-payments
description: >-
  Compute TDS on a payment to a freelancer under the Income-tax Act, 2025,
  section 393 (old sections 194C, 194J, and 194M), including thresholds and the
  no-PAN rate in section 397. Use when a payer deducts tax on professional
  fees, technical services, a contract payment, director remuneration, or a
  missing PAN.
license: MIT
compatibility: Requires Node.js 20 or newer. No network and no runtime dependencies.
metadata: { version: "0.1.1", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---

# TDS on freelancer payments

Run the script. Do not recompute a rate or a threshold in the prompt. Amounts are strings of paise, or rupee strings with a decimal point. A JSON number is rejected. `confirm: true` means something in the answer was not confirmed from the Act text. Keep the sentence `Confirm with the official source before relying on this.`

## When to use

- A company, firm, or other payer is paying a resident freelancer for professional work, technical work, or a contract.
- An individual or HUF payer needs the fifty-lakh residual row (old s.194M) rather than the main contractor or fee rows. You must pass `auditRequired`.
- The payee has not furnished a PAN, and the user needs the higher rate.
- The payment date is before 1 Apr 2026 and the user needs the 1961 section label.

Do not use this skill for salary, rent, a non-resident payee, a purchase of goods, or an e-commerce operator. Do not file the TDS return. Do not apply the old non-filer uplift in s.206AB: this skill never adds it, and that omission is UNVERIFIED. Do not invent a rate for a category the script refuses.

## Quick start

From the skill directory:

```bash
node scripts/tds.mjs --json '{"paymentDate":"2026-06-01","payerType":"other","payeeType":"individual","category":"professional","amountMinor":"1100000","ytdMinor":"4000000","panAvailable":true}'
```

`amountMinor` and `ytdMinor` here are paise: `1100000` is ₹11,000 and `4000000` is ₹40,000. `11000.00` is the same ₹11,000 written as rupees. `ytdMinor` is the financial-year total of this category for this payee on which tax has not yet been deducted. `ytdTaxedMinor` is optional and defaults to `0`. It is the financial-year total already included in a deduction. The threshold test adds `ytdMinor`, `ytdTaxedMinor`, and this payment. When the aggregate is over the limit, the base is `ytdMinor` plus this payment, so a rupee already taxed is not taxed again. A later bill is taxed on that bill: pass the taxed total in `ytdTaxedMinor` and pass `ytdMinor` as `0`. Omitting `ytdTaxedMinor` leaves the older calls unchanged.

Exit `0` when a section applies, including when the tax is zero because a threshold is not crossed. Exit `1` when no row in this skill covers the payment. Exit `2` on a usage error.

Real output, exit 0:

```json
{"valid":true,"tdsMinor":"510000","tds":"5100.00","taxableMinor":"5100000","rateBp":1000,"section":"393(1) [Table Sl. No. 6(iii)]","oldSection":"194J","paymentCode":"1027","thresholdHit":true,"act":"Income-tax Act, 2025","confirm":true,"warnings":["s.206AB, the old non-filer higher rate, is not applied. That omission is not confirmed from the full Act text.","TDS is on the whole FY aggregate of ₹51,000.00, not only on this payment of ₹11,000.00. Deposit the tax even when it is more than the amount being paid out.","Confirm with the official source before relying on this."]}
```

`tdsMinor` is paise. `510000` is ₹5,100.00. `rateBp` 1000 is 10%. The live object also has `confirmReasons`. The 10% rate and the "whole amount" base were read from s.393. `confirm` is still true because the section code `1027` and the decision not to apply s.206AB were not in that text.

`payerType` is `individual`, `huf`, or `other`. `payeeType` is the same set. `category` is `professional`, `technical`, `contractor`, `director`, `call_centre`, `film_royalty`, or `royalty`. For an individual or HUF payer, `auditRequired: true` means they must deduct on the main contractor or fee row. `false` means the fifty-lakh residual row.

## Rules

Rules data is `scripts/_rules/tds.json`, as of 2026-11-01. Rates and thresholds are read from that file. 1% is 100 basis points, 2% is 200, 10% is 1000, 20% is 2000.

On or after 1 Apr 2026 the Act is the Income-tax Act, 2025. The page opened is [s.393](https://www.incometaxindia.gov.in/w/section-393-6).

- **s.393(1)(a).** Tax is on the entire amount once the sum, or the aggregate, exceeds the threshold. A figure equal to the threshold is not over it. The part above the threshold is not the base, except on other rows this skill does not compute (purchase of goods).
- **Serial 6(i), old s.194C.** Contract work, including labour. 1% if the payee is an individual or HUF, 2% otherwise. A single sum over ₹30,000, or an aggregate over ₹1,00,000 in the tax year. A single sum over ₹30,000 is taxed on that sum. Once the aggregate exceeds ₹1,00,000, the base is this payment plus earlier untaxed sums. Amounts in `ytdTaxedMinor` count toward the ₹1,00,000 test and stay out of the base. A later bill is taxed on that bill.
- **Serial 6(ii), old s.194M.** An individual or HUF who does not have to deduct under serial 6(i) or 6(iii). 2% on contract work or professional fees, once the aggregate exceeds ₹50 lakh, on the untaxed aggregate. A later bill is taxed on that bill. Technical services, royalty, call centres, and director fees are not in this row. The script then exits 1. There is no section code for this row.
- **Serial 6(iii), old s.194J.** 10% professional fees, other royalty, and director remuneration. 2% for technical services that are not professional services, cinematographic-film royalty, and a payee who only operates a call centre. Threshold ₹50,000 in the tax year. The crossing bill is taxed on the untaxed aggregate. Once the year is over ₹50,000, each later bill is taxed on that bill. Director remuneration has no threshold and is taxed on this payment only.
- **No PAN, s.397(2).** The highest of the section rate, the rate in force, and 20%. For these rows that is 20%. The 5% ceiling is only for serial 8(ii) and 8(v), which this skill does not compute. [FAQ](https://www.incometaxindia.gov.in/documents/d/guest/faqs-on-higher-rate-of-tds-under-section-397).
- **Section codes.** 1023 individual or HUF contractor, 1024 any other contractor, 1026 technical / film royalty / call centre, 1027 professional, 1028 director. UNVERIFIED. Not on the s.393 page.
- **s.206AB.** Not applied. UNVERIFIED that the 2025 Act dropped it. Do not add it back in the prompt.
- **Before 1 Apr 2026, and on or after 1 Apr 2025.** The script returns the 1961 labels `194C`, `194J`, `194M`, and `206AA`, with `confirm: true`. The bare 1961 text on 31 Mar 2026 was not opened. Dates before 1 Apr 2025 are rejected, because this skill does not carry the older ₹30,000 fee threshold.

`paymentCode` is null on the 1961 path and on serial 6(ii).

## Edge cases

- YTD ₹40,000 plus ₹9,000 stays at or under ₹50,000: tax ₹0, rate still 10% for a later bill. Plus ₹11,000 crosses: 10% of ₹51,000 = ₹5,100, not 10% of ₹11,000 only.
- The next bill, ₹10,000 on 1 July 2026, with `ytdMinor` `0` and `ytdTaxedMinor` `5100000`: 10% of ₹10,000 = ₹1,000. Omitting `ytdTaxedMinor` makes the year look like ₹10,000 and the tax is ₹0. Passing the ₹51,000 already taxed as `ytdMinor` taxes ₹6,100 and counts those rupees again.
- Contractor: ₹40,000 not yet taxed, ₹35,000 already taxed because that single sum was over ₹30,000, then ₹30,000. The year is ₹1,05,000. Tax is 1% of the untaxed ₹70,000 = ₹700. The next ₹10,000, with that ₹1,05,000 in `ytdTaxedMinor`, is ₹100.
- ₹50,000 exactly, ₹30,000 exactly, ₹1,00,000 aggregate exactly, and ₹50 lakh exactly do not exceed the threshold.
- Contractor, individual payee, one bill of ₹25,000: ₹0. One bill of ₹35,000: ₹350. Another person as payee: 2%, ₹700, code 1024.
- No PAN, professional ₹60,000: 20% = ₹12,000. No PAN does not create a deduction when the threshold is not crossed.
- 31 Mar 2026, professional ₹60,000: section `194J`, tax ₹6,000, `paymentCode` null, `confirm` true. 1 Apr 2026 is section `393(1) [Table Sl. No. 6(iii)]`.
- Director fees of ₹1 are taxed at 10%. Earlier director payments in `ytdMinor` or `ytdTaxedMinor` are not added again.
- An audited individual's technical bill is serial 6(iii) at 2%. The same bill from an individual who is not required to deduct on that row is not serial 6(ii).
- If the tax on the whole aggregate is more than the current payment, the warning says to deposit the shortfall. The script does not cap the figure at the payment.
- Input over 10 KB, a zero-width or bidi character, or a number written as `1e5`, is a usage error.

## Example prompts

- "We paid a designer ₹40,000 earlier this year and this invoice is ₹11,000. PAN is on file. Payment date 1 June 2026. What do I deduct?"
- "The same designer, but this invoice is only ₹9,000."
- "That designer was already taxed on ₹51,000. This bill is ₹10,000 on 1 July 2026. PAN is on file."
- "One contract bill of ₹35,000 to an individual, nothing earlier, PAN available."
- "Professional fee of ₹60,000 and they have not given a PAN."
- "That fee was credited on 31 March 2026. Which section do I quote?"
- "I am an individual and I am not audited. I am paying a freelancer ₹60 lakh for professional work this year."

## Disclaimer

This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.
