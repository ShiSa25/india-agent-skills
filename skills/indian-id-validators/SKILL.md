---
name: indian-id-validators
description: >-
  Format-check an Indian PAN (4th-character holder type), TAN, IFSC, PIN code,
  or mobile number. Use when a user pastes a PAN, TAN, IFSC, PIN, or +91
  mobile, or asks whether an IFSC matches the RBI pattern. An IFSC directory
  lookup is opt-in and is not proof that a branch is live.
license: MIT
compatibility: Requires Node.js 20 or newer. No network except opt-in IFSC lookup in scripts/ifsc-lookup.mjs.
metadata: { version: "0.1.0", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---

# Indian ID validators

Format-check a PAN, TAN, IFSC, PIN, or Indian mobile number. Run the script. Do not reimplement the patterns in the prompt.

## When to use

- A user pastes a PAN, TAN, IFSC, PIN, or mobile number, including spaces, hyphens, or mixed case.
- A form needs the PAN holder type (the 4th character) or a PIN checked against a GST state code.
- You need an IFSC shape check. Add `--lookup` only when the user explicitly wants a directory call.

Do not use this skill to decide that a PAN or TAN was issued, that a bank branch is on NEFT, or that a mobile number is assigned to a person. Do not look an IFSC up unless the user asks. This skill does not validate Aadhaar; use `aadhaar-safe-handling` for that.

## Quick start

From the skill directory:

```bash
node scripts/validate-pan.mjs --json 'ABCPE1234F'
node scripts/validate-tan.mjs --json 'AAAA00000A'
node scripts/validate-ifsc.mjs --json 'SBIN0001234'
node scripts/ifsc-lookup.mjs --lookup --json 'SBIN0001234'
node scripts/validate-pin.mjs --json '{"pin":"396210","stateCode":"24"}'
node scripts/validate-mobile.mjs --json '+91 98765-43210'
```

Exit codes: `0` valid, `1` invalid, `2` usage error. Stdout is one JSON object. `--lookup` is accepted only by `ifsc-lookup.mjs`. Without it, that script checks the format and does not call the network.

PAN `ABCPE1234F` (synthetic):

```json
{"valid":true,"normalized":"ABCPE1234F","holderType":"P","holderName":"Individual","nameInitial":"E","checkDigitChecked":false,"errors":[],"warnings":[],"confirm":false,"disclaimer":"This tool gives general information..."}
```

Mobile `+91 98765-43210`:

```json
{"valid":true,"normalized":"9876543210","e164":"+919876543210","errors":[],"warnings":["Spaces or hyphens were removed.","The mobile pattern ^[6-9][0-9]{9}$ is UNVERIFIED. Confirm with the official source before relying on this."],"confirm":true,"disclaimer":"This tool gives general information..."}
```

When `confirm` is true, tell the user and keep the sentence `Confirm with the official source before relying on this.`

## Rules

Rules data is `scripts/_rules/ids.json`, as of 2026-11-01. Do not hardcode a holder letter, a PIN range, or the mobile pattern.

- PAN: `ids.pan.pattern`. The 4th character is the holder type from `ids.pan.holderTypes`: P Individual, C Company, H HUF, F Firm/Limited Liability Partnership, A AOP, T Trust, B BOI, L Local Authority, J Artificial Juridical Person, G Government Agency. The 5th character is the name initial and is not checked. [Income Tax Department](https://www.incometaxindia.gov.in/w/how-pan-is-formed-and-how-it-gets-its-unique-identity-), opened 2026-11-01.
- The department calls the PAN's 10th character an alphabetic check digit and does not publish the algorithm. `checkDigitChecked` is false. Do not say the checksum passed.
- TAN: `ids.tan.pattern`, layout in `ids.tan.layout`. First 3 letters are the jurisdiction code, the 4th is the name initial, then 5 digits. The 10th character is an unpublished check digit. [Tax deductor page](https://www.incometaxindia.gov.in/tax-deductor), opened 2026-11-01. The page's illustrative TAN is `DELM12345L`. Prefer a synthetic value such as `AAAA00000A` in fixtures.
- IFSC: `ids.ifsc.pattern`. Four letters, then `0`, then six letters or digits. [RBI NEFT FAQ](https://www.rbi.org.in/scripts/FAQView.aspx?Id=60), updated 2024-09-02, opened 2026-11-01. A format match does not mean the branch participates in NEFT or RTGS.
- `--lookup` calls only `https://ifsc.razorpay.com/<IFSC>`. That host is not the RBI list, so `confirm` is true. Tests must pass a mock and must not call the network.
- PIN: `ids.pin.pattern`, six digits, first digit 1–9. Zones come from `ids.pin.zones` and are UNVERIFIED (the India Post page returned HTTP 504 on 2026-11-01). The script says Northern, Western, Southern, Eastern, or Army Postal Service and sets `confirm` true.
- Optional `stateCode` uses `ids.pin.stateRanges` from the [e-invoice MasterCodes](https://einvoice1.gst.gov.in/Others/MasterCodes) table opened 2026-11-01. `stateMatch` is `match`, `shared`, `mismatch`, `unknown-state`, or `not-checked`. A mismatch or a shared prefix is only a warning. `396` is on states 24, 25, and 26. `403` is inside Maharashtra `400–445` and is also Goa.
- Mobile: accept `+91`, `91`, and a single trunk `0`, plus spaces and hyphens. The core is 10 digits. The pattern `^[6-9][0-9]{9}$` is UNVERIFIED. Toll-free `1800` is rejected and is also UNVERIFIED. Landlines dialled with trunk `0` that are not 10 digits starting 6–9 are rejected.

## Edge cases

- `ABCDE1234F` is invalid. `D` is not a holder type. The error lists `ABCFGHJLPT`.
- `SBIN0001234` is valid as a shape. `SBIN1001234` is invalid because the 5th character is not `0`.
- `HDFC0ABC123` is a valid shape: the branch code may contain letters.
- `011001` is not a PIN. `560001` with state `29` matches Karnataka. `396210` with state `24` is `shared`. `396210` with state `29` is still a valid PIN and warns of a mismatch.
- `+91 98765-43210` becomes `9876543210` and `+919876543210`. `5876543210` is invalid and `confirm` is true. `9198765432` is ten digits starting with 9, so the leading `91` is not stripped. `1800-123-4567` is toll-free. `011-23456789` is a landline. `+1 9876543210` is the wrong country code.
- Lowercase PAN, TAN, and IFSC are uppercased and warned. Spaces and hyphens are removed. Fullwidth digits are NFKC-normalised. A Cyrillic look-alike is rejected. A zero-width or bidi character is rejected. Input over 10 KB is rejected.
- SPEC §1.10 says holder `G` means "government". The department page says "Government Agency". This skill uses the department's words.

## Example prompts

- "Is ABCPE1234F a valid PAN, and what kind of holder is it?"
- "Is SBIN1001234 a valid IFSC? Do not look it up."
- "Normalise this mobile number: +91 98765-43210."
- "The invoice PIN is 396210 and the state code is 24. Does that match?"
- "Check the synthetic TAN AAAA00000A."

`396210` with state `24` (real script output, disclaimer shortened here):

```json
{"valid":true,"normalized":"396210","prefix":"396","zoneDigit":"3","zone":"Western","states":[{"code":"24","name":"Gujarat"},{"code":"25","name":"Daman and Diu"},{"code":"26","name":"Dadra and Nagar Haveli"}],"stateCode":"24","stateMatch":"shared","errors":[],"warnings":["First-digit zone \"Western\" is UNVERIFIED. Confirm with the official source before relying on this.","PIN prefix 396 is shared by 24 Gujarat, 25 Daman and Diu, 26 Dadra and Nagar Haveli. A match is not proof of the state."],"confirm":true,"disclaimer":"This tool gives general information..."}
```

## Disclaimer

This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.
