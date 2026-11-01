---
name: dpdp-compliance-check
description: >-
  Build a DPDP Act 2023 and DPDP Rules 2025 readiness checklist: consent
  notice, purpose limitation, children's data and verifiable parental consent,
  breach timelines, retention and erasure, grievance contact, significant data
  fiduciary duties, cross-border transfer, and Consent Managers, with the
  13 November 2025 phases and Schedule penalties. Scan Prisma, SQL, and
  TypeScript for personal-data fields. Use when a schema or a privacy review
  needs the phased dates or a field-to-checklist map.
license: MIT
compatibility: Requires Node.js 20 or newer. No network and no runtime dependencies.
metadata: { version: "0.1.1", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---

# DPDP compliance check

Readiness checklist for the Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025. It also scans field names. It does not file anything and it does not decide that a product is compliant.

## When to use

- A Prisma schema, SQL `CREATE TABLE`, or TypeScript type may store personal data (email, phone, PAN, Aadhaar, date of birth, address, IP, device id, location, health).
- A launch review asks which DPDP duties those fields trigger, and whether the duty is in force on a given IST date.
- You need the Schedule maximums or the 13 November 2025 / 13 November 2026 / 13 May 2027 phases.

Do not use this skill as a legal opinion, a Data Protection Board filing, or a UIDAI check. A field name is not proof that personal data is stored. An official identifier still has its own statute.

## Quick start

From the skill directory:

```bash
node scripts/dpdp-check.mjs --json '{"asOf":"2026-11-01"}'
node scripts/dpdp-check.mjs --json '{"asOf":"2026-11-01","kind":"prisma","source":"model User {\n  id Int @id\n  aadhaarNumber String\n}"}'
```

Exit codes: `0` when there is no high-severity finding, `1` when there is (or the input is rejected), `2` on a usage error. Stdout is one JSON object. `asOf` defaults to today in IST. Pass a date in tests.

On 2026-11-01 the Consent Manager phase is `Rule 4 in force in 12 days`. A Prisma `aadhaarNumber` is high severity. `confirm` is true because the Third Schedule user-count line is UNVERIFIED.

```json
{
  "valid": false,
  "asOf": "2026-11-01",
  "confirm": true,
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
      ]
    }
  ]
}
```

`markdown` is the checklist. When `confirm` is true, tell the user: `Confirm with the official source before relying on this.`

## Example prompts

- Scan this Prisma schema and give me a DPDP checklist as of 2026-11-01.
- When do Consent Managers have to be registered, and which Act section matches rule 4?
- What is the maximum Schedule penalty for failing to notify a breach, and when can the Board impose it?
- Does `dateOfBirth` or `latitude` trigger the children's-data item?
- Which Third Schedule numbers are UNVERIFIED?

## Rules

Rules data is `scripts/_rules/dpdp.json`, as of 2026-11-01. Do not hardcode a date or a penalty that contradicts that file.

Notified 13 November 2025. Checked against [G.S.R. 843(E)](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) and the [Rules catalogue](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa).

- Rules 1, 2, and 17 to 21, and the Board provisions of the Act (sections 18 to 26 and the listed machinery sections): in force on 13 November 2025.
- Rule 4 and section 6(9) (Consent Manager registration), plus section 27(1)(d): 13 November 2026. On 2026-11-01 that is 12 days.
- Rules 3, 5 to 16, 22, and 23, and the operative duties in sections 3 to 17 (with the splits in G.S.R. 843(E)): 13 May 2027. Section 33, which applies the Schedule, is in this group.
- Consent notice: sections 5 and 6 and rule 3. Consent is free, specific, informed, unconditional, and unambiguous, and limited to the specified purpose. The notice is itemised and stands on its own.
- Purpose limitation: sections 4, 6, and 8(7). Erase when the purpose is over, unless the law requires retention.
- Children: section 2(f) and section 9. A child has not completed 18 years. Verifiable parental consent is rule 10. No tracking, behavioural monitoring, or targeted advertising directed at children, and no processing likely to harm well-being, subject to the narrow Fourth Schedule exemptions in rule 12.
- Breach: section 8(5) and rule 6 (safeguards, including a one-year log). Section 8(6) and rule 7: tell the Data Principal without delay, tell the Board without delay, and send the detailed report within 72 hours unless the Board allows longer.
- Retention: section 12 and rule 8. Third Schedule deemed period is 3 years for the listed classes. Warn the person at least 48 hours before that erasure. The user-count thresholds are UNVERIFIED.
- Grievance contact: sections 8(9), 8(10), and 13, rules 9 and 14. The Act does not create a post titled Grievance Officer. Publish the Data Protection Officer or another person who can answer. Respond within a reasonable period not exceeding 90 days.
- Significant Data Fiduciary: section 10 and rule 13, only if the Central Government notifies you. DPIA and audit every 12 months. Penalty up to ₹150 crore. This is not a startup default.
- Cross-border: section 16 and rule 15 allow transfer unless the government restricts it. Rule 13(4) can keep specified Significant Data Fiduciary data in India. This is not a general localisation ban.
- Consent Manager net worth in the First Schedule: not less than ₹2 crore.
- Schedule maximums, from [India Code](https://www.indiacode.nic.in/handle/123456789/22037): ₹250 crore, ₹200 crore, ₹200 crore, ₹150 crore, ₹10,000 (Data Principal duties, not the company), the undertaking penalty, and ₹50 crore for any other provision.

The scanner matches whole words, so `companyName`, `spanishName`, and `panelId` are not PAN. `aadhaar`, `pan`, date of birth, location, and health are high severity. Email, phone, address, IP, and device id are medium. Date of birth, location, and health also trigger the children's item.

## Edge cases

- On 2026-11-13 the phrase is `Rule 4 in force`. On 2026-11-14 it is `Rule 4 in force since 2026-11-13`.
- On 2027-05-13 the notice, children, retention, grievance, Significant Data Fiduciary, and cross-border items are `in-force`.
- A comment that mentions `aadhaarNumber` is ignored. A quoted `@map("aadhaar_number")` is not.
- `IPAddress` is reported as both `ip` and `address`. The word `lat` alone is not location. `latitude` is.
- Zero-width and bidi characters are rejected. Input over 10 KB is rejected. Dates are `YYYY-MM-DD` in IST. The script never parses a date-only string with `Date`.
- `confirm` is true while `dpdp.retention.user-threshold` is `verified: false`. Do not drop that flag. Do not treat "not less than two crore users" as settled.
- High severity makes exit code 1. Medium findings stay in `findings` and the exit code stays 0. A checklist with no schema is exit 0.
- Penalty figures are maximums. They are not a forecast of what the Board will impose. They cannot be imposed before section 33 commences on 13 May 2027.

## Disclaimer

This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.
