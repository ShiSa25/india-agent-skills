---
name: inr-formatting
description: >-
  Format rupees with Indian lakh and crore grouping, in words, and in short
  form (1.2 L, 1.2 Cr), using integer paise. Use when showing an amount, an
  amount-in-words line, or converting rupees and paise. Does not use Node Intl.
license: MIT
compatibility: Requires Node.js 20 or newer. No network and no runtime dependencies.
metadata: { version: "0.1.0", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---

# INR formatting

Format a rupee amount with Indian digit grouping, in words, and in a short form. The arithmetic is integer paise. Run the script. Do not call `Intl`, and do not scale a float by 100.

## When to use

- A user wants an amount in Indian grouping (`₹12,34,567.00`) or on an invoice amount-in-words line.
- A user wants a short form such as `1.2 L` or `1.2 Cr`.
- A user gives rupees as a decimal string, or paise as an integer string or a bigint, and those two must agree.

Do not use this skill for a tax rate, a UPI limit, or a currency other than INR. Do not use Node's `Intl` en-IN output. ICU grouping and compact notation differ across Node versions.

## Quick start

From the skill directory:

```bash
node scripts/format-inr.mjs --json '{"rupees":"123456789.50"}'
node scripts/format-inr.mjs --json '{"paise":"12345678901234567890"}'
node scripts/format-inr.mjs --json '"100000"'
```

A decimal string is rupees. A JSON `paise` field is an integer string of paise. A bigint argument to `formatINR` / `toWords` / `compact` is paise. A JSON number is rejected. Exit `0` when the amount is accepted, `1` when it is not, `2` on a usage error.

`formatINR(minor, {symbol=true, paise=true})` returns the grouped string. `symbol: false` omits `₹`. `paise: false` (the `showPaise` field in JSON) omits the fraction and warns if paise were dropped. `accounting: true` wraps a negative in parentheses. The sign is always before `₹`: `-₹1,234.00`. The rupee sign is `₹` (U+20B9).

Real output for `123456789.50` rupees, exit 0:

```json
{"valid":true,"paise":"12345678950","rupees":"123456789.50","formatted":"₹12,34,56,789.50","words":"Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine and Fifty Paise Only","compact":"12.35 Cr","negative":false,"errors":[],"warnings":["Short forms such as L and Cr are abbreviations, not a statutory format.","Confirm with the official source before relying on this."],"confirm":true,"disclaimer":"This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."}
```

`confirm` is true here because the short form is an abbreviation, not a statute. Zero rupees is `₹0.00` / `Rupees Zero Only` with `confirm: false`. One lakh is `₹1,00,000.00`, `Rupees One Lakh Only`, and compact `1 L`.

### Example prompts

- Format 100000 rupees with Indian commas and say it in words.
- Write 123456789.50 rupees in words the Indian way, including paise.
- Format 12345678901234567890 paise in Indian grouping and in words.
- Format minus fifty paise, and show the accounting parentheses form.

## Rules

Rules data is `scripts/_rules/inr.json`, as of 2026-11-01. Place values are read from that file. Do not hardcode a lakh or a crore.

- One rupee is 100 paise. [RBI Indian Currency FAQ](https://www.rbi.org.in/commonman/Upload/English/FAQs/PDFs/INDIANCURRENCY15042025.pdf), updated 15 Apr 2025, opened 2026-11-01. Conversion uses `parseAmount` / `formatMinor`. More decimal places than paise, and exponent notation such as `1e5`, are rejected.
- One lakh is 100000 rupees. One crore is 100 lakh. [RBI explanatory notes](https://www.rbi.org.in/scripts/Explanatory.aspx), opened 2026-11-01. Grouping is the last three digits, then groups of two: `₹1,00,000.00`, `₹1,00,00,000.00`, `₹12,34,567.00`.
- Words use Thousand, Lakh, and Crore. There is no "and" inside the rupees. Paise use "and": `Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine and Fifty Paise Only`. One paisa uses "Paisa". Zero paise omits the paise clause: `Rupees One Lakh Only`. A negative is `Minus Rupees …`.
- At or above 100 crore the crore count is spelled the same way: `One Hundred Crore`, `One Thousand Crore`, `One Lakh Crore`, `One Crore Crore`. Arab, kharab, nil, and padma are not used. **UNVERIFIED** as a cheque-words statute. The script sets `confirm` true and says arab is not used.
- Short form, also **UNVERIFIED**: below 1 lakh, the grouped rupees; then `1.2 L`, `1.2 Cr`, `1.2 L Cr`, and `1.2 Cr Cr`. At most two decimal places, half-up, trailing zeros removed. No rupee sign. `confirm` is true when a suffix is used. `120000` rupees is `1.2 L`. `12000000` rupees is `1.2 Cr`. `100500` rupees is `1.01 L`.

## Edge cases

- `0` and `0.00` are `₹0.00` and `Rupees Zero Only`. `-0.50` is `-₹0.50` and `Minus Rupees Zero and Fifty Paise Only`.
- `100000` rupees is one lakh. The same digits as a bigint are paise: `formatINR(100n)` is `₹1.00`, `formatINR('100')` is `₹100.00`.
- `12345678901234567890` paise is `₹1,23,45,67,89,01,23,45,678.90`, compact `1,234.57 Cr Cr`, and the words in the eval for `bigint-paise`. `confirm` is true.
- Commas and a leading `₹` are stripped on input. Fullwidth digits are NFKC-normalised. A zero-width or bidi character is rejected. Input over 10 KB is rejected.
- `{"rupees":"1.00","paise":"50"}` is rejected because the two amounts disagree.
- Tests compare these strings directly. They do not call `Intl` and they do not depend on the Node ICU version.
- `99` crore is `Rupees Ninety-Nine Crore Only`. The hundred-crore wording starts at `100` crore.

## Disclaimer

This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.
