---
name: gstin-validator
description: >-
  Validate an Indian GSTIN: checksum, state code, and regular, TDS, TCS, UIN,
  or NRTP/OIDAR shape. A valid checksum does not prove the GSTIN is registered.
  Use when a user pastes a GSTIN, checks an invoice, or builds a GST form.
license: MIT
compatibility: Requires Node.js 20 or newer. No network and no runtime dependencies.
metadata: { version: "0.1.0", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---

# GSTIN validator

Format-check a Goods and Services Tax Identification Number. Run the script. Do not reimplement the checksum in the prompt.

## When to use

- A user pastes a 15-character GSTIN, or a GSTIN with spaces, hyphens, or mixed case.
- An invoice, e-invoice, or vendor master needs a GSTIN checked before it is saved.
- You need a synthetic GSTIN for a test or a fixture. Use the generator. Do not invent a personal PAN.

Do not use this skill to decide that a business is registered, active, or allowed to charge GST. Do not submit anything to the GST portal.

## Quick start

From the skill directory:

```bash
node scripts/validate-gstin.mjs --json '27AAACR5055K1Z7'
node scripts/validate-gstin.mjs --json '{"gstin":"27AAACR5055K1Z7"}'
node scripts/generate-gstin.mjs --json '{"stateCode":"29"}'
```

Exit codes: `0` valid, `1` invalid, `2` usage error. Stdout is one JSON object.

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
  "warnings": ["Checksum valid ≠ registered/active; check services.gst.gov.in/services/searchtp"],
  "confirm": false,
  "disclaimer": "This tool gives general information..."
}
```

`type` is `regular`, `tds`, `tcs`, `uin`, `nrtp_oidar`, or `unknown`. `pan` is set for a regular GSTIN. `tan` is set for TDS. When `confirm` is true, tell the user the warning text and do not drop the flag.

Imports for tests and fixtures: `validateGstin`, `checkChar`, and `generateSyntheticGstin` from `scripts/_lib/gstin.mjs`.

## Rules

Rules data is `scripts/_rules/gst.json` and `scripts/_rules/ids.json`, as of 2026-11-01. Do not hardcode a state name or a marker that contradicts those files.

- Checksum (verified in code 2026-11-01 against the public GSTINs below). Map `0-9A-Z` to 0..35. On the first 14 characters, weight 1-based odd positions by 1 and even positions by 2. For each product `p`, add `floor(p/36) + p%36`. The check character is alphabet `[(36 - sum%36) % 36]`. It catches every single-character substitution. It does not catch every transposition.
- Length is 15. [GST portal](https://www.gst.gov.in/).
- Regular: state + PAN + entity (`1-9A-Z`, never `0`) + `Z` + check. PAN shape is in `ids.pan.pattern` (holder types `ABCFGHJLPT`). There is no public checksum on the PAN's 10th character. [Income Tax Department](https://www.incometaxindia.gov.in/).
- TDS: state + TAN (`AAAA99999A`) + entity + `D` + check. The PAN rule does not apply. The TAN rule does.
- TCS: 14th character `C`. **UNVERIFIED** primary source. The script sets `confirm: true` and includes "Confirm with the official source before relying on this."
- UIN: state + year + three letters (country code or `UNO`) + five digits + two varying characters + check. Examples `2717USA00046UNV` and `2317UNO00001UND`. Validate checksum, length, and state. Do not force the 13th and 14th characters, and do not apply the PAN rule. [CBIC](https://www.cbic.gov.in/).
- NRTP/OIDAR: `99` + year + three letters + five digits + `OS` + check. Examples `9923USA29044OSE` (Upwork), `9924ISR29001OSH` (Fiverr), `9917USA29016OS6` (GoDaddy).
- State codes follow the [e-invoice MasterCodes](https://einvoice1.gst.gov.in/Others/MasterCodes) table opened 2026-11-01, and the [e-way bill state list](https://docs.ewaybillgst.gov.in/apidocs/state-code.html) cited as checked the same day. `01`–`38` (including gaps in older lists), `97` Other Territory, and `99` Centre Jurisdiction are GSTIN prefixes. `38` is Ladakh, `37` is Andhra Pradesh, `36` is Telangana. `25` and `28` are accepted with the warning `legacy state code`. `96` is a place-of-supply code and is never a GSTIN prefix.
- The master-code table labels `99` "OTHER COUNTRIES", the same label it gives `96`. This skill labels `99` Centre Jurisdiction because that is the NRTP/OIDAR jurisdiction. Say so if a user asks why.

State names for codes other than `28` and `99` are the MasterCodes names. Code `26` is "Dadra and Nagar Haveli" on that table.

## Edge cases

- `9917USA00013OS5` is a widely copied blog example. It is invalid. The check character is `P`.
- `27AAACR5055K1Z8` is invalid (Reliance's Maharashtra GSTIN ends in `7`).
- `29ABCDE1234F1ZW` has a matching checksum and a PAN segment whose 4th character is `D`. `D` is not a holder type, so the GSTIN is invalid.
- `27AAACX0000A1DK` is TDS-shaped (14th character `D`) and the checksum matches, but `AAACX0000A` is not a TAN (`AAAA99999A`), so it is invalid. A synthetic TAN such as `AAAA00000A` validates.
- `25AAACX0000A1ZF` is valid and warns `legacy state code`.
- Lowercase is normalised to uppercase and warned. Spaces and hyphens are removed and warned. Fullwidth digits are NFKC-normalised.
- A Cyrillic look-alike (for example `А`, U+0410) is rejected. It is not stripped.
- A zero-width or bidi control character is rejected.
- The 13th character `0` is invalid on regular, TDS, and TCS GSTINs.
- Input longer than 10 KB is rejected before any pattern runs.
- Checksum valid ≠ registered/active. Say that whenever the script puts it in `warnings`. The search page is [services.gst.gov.in/services/searchtp](https://services.gst.gov.in/services/searchtp). This skill does not call it.

Public GSTINs used only as checksum examples: `27AAACR5055K1Z7` (Reliance), `27AAPFU0939F1ZV` (GST portal sample), `9923USA29044OSE`, `9924ISR29001OSH`, `9917USA29016OS6`, `2717USA00046UNV`, `2317UNO00001UND`. Do not add a real individual's PAN or Aadhaar.

## Disclaimer

This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.
