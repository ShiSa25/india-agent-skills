---
name: sms-otp-dlt
description: >-
  Lint a TRAI DLT SMS template for {#var#} variables, the 11-character header
  and -P/-S/-T/-G suffix, category (transactional, service-implicit,
  service-explicit, promotional), URL whitelisting from 1 October 2024, and
  PE-TM chain rejection from 11 December 2024. Shape an MSG91 SendOTP request
  without calling the network. Use when writing an OTP SMS, a DLT template,
  or an MSG91 OTP call.
license: MIT
compatibility: Requires Node.js 20 or newer. No network and no runtime dependencies.
metadata: { version: "0.1.0", rules-as-of: "2026-11-01", jurisdiction: "IN" }
---

# SMS OTP and DLT linter

Check a commercial SMS template against the DLT rules this pack has sourced, and build the MSG91 SendOTP request shape. The scripts do not send an SMS and do not call MSG91.

## When to use

- A template uses `{#var#}`, a header of up to 11 characters, or a category such as transactional or promotional.
- A message contains a URL, an APK, an OTT link, or a callback number and you have a whitelist.
- You need the MSG91 v5 OTP query (`template_id`, `mobile`, `otp_length`, `otp_expiry`) and a review of how the code generates the OTP.

Do not use this skill to register a template on a DLT portal, to send traffic, or to store an authkey. Operator limits are warnings, not TRAI text.

## Quick start

From the skill directory:

```bash
node scripts/lint-dlt.mjs --json '{"asOf":"2026-11-01","template":"Your OTP is {#var#}. Do not share it. - Acme","message":"Your OTP is 482913. Do not share it. - Acme","variables":["482913"],"header":"ACMEIN-T","category":"transactional","brandName":"Acme","chainRegistered":true,"templateRegistered":true,"sentAtIst":"16:30"}'
node scripts/msg91-otp.mjs --json '{"asOf":"2026-11-01","templateId":"tpl_otp_01","mobile":"919800000000","otpLength":6,"otpExpiryMinutes":10,"template":"Your OTP is ##OTP##. - Acme"}'
node scripts/msg91-otp.mjs --json '{"action":"review","asOf":"2026-11-01","code":"import { randomInt } from '\''node:crypto'\'';\nconst otp = String(randomInt(0, 1000000)).padStart(6, '\''0'\'');\nconst ttlMinutes = 10;\nconst maxAttempts = 5;"}'
```

Exit codes: `0` when `valid` is true, `1` when there is an error, `2` on a usage error. A warning does not change the exit code. `confirm` is true because several rows are operator guidance or are not TRAI gazette text.

Real lint of the OTP template above, exit 0:

```json
{
  "valid": true,
  "asOf": "2026-11-01",
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
  "confirm": true
}
```

A URL that is not in `whitelist`, exit 1:

```json
{
  "valid": false,
  "errors": [
    {
      "code": "url-not-whitelisted",
      "message": "URL is not in the whitelist set: https://pay.example/x",
      "source": "trai"
    }
  ]
}
```

MSG91 request, exit 0. The authkey is never printed. Defaults shown here are the skill practice (6 digits, 10 minutes), not MSG91's own defaults (4 digits, 15 minutes):

```json
{
  "valid": true,
  "method": "POST",
  "url": "https://control.msg91.com/api/v5/otp",
  "query": {
    "template_id": "tpl_otp_01",
    "mobile": "919800000000",
    "otp_length": "6",
    "otp_expiry": "10"
  },
  "headers": { "authkey": "<missing>", "Content-Type": "application/json" },
  "practice": {
    "digits": 6,
    "ttlMinutes": { "min": 5, "max": 10 },
    "generator": "crypto.randomInt",
    "neverLogOtp": true
  },
  "confirm": true
}
```

## Example prompts

- Lint this DLT OTP template and say whether the header suffix matches transactional.
- The SMS links to https://pay.example/x and that URL is not whitelisted. Is that an error after 1 October 2024?
- `{#var#}` is the last word and the value is 31 characters. Are those TRAI errors or operator warnings?
- Can I send a promotional SMS at 22:00 IST?
- Build the MSG91 SendOTP call for 919800000000. Do not include the authkey in the output.

## Rules

Rules data is `scripts/_rules/trai.json`, as of 2026-11-01.

- Templates and headers are registered on DLT. `{#var#}` is the portal variable token. That token is operator practice, not a sentence in the TCCCPR gazette. TRAI's 18 November 2025 direction uses different pre-tags (`#url#`, `#numeric#`). This linter does not scrub those tags.
- From 1 October 2024, a URL, APK, or OTT link that is not in `whitelist` is an error. [Direction of 30 August 2024](https://www.trai.gov.in/sites/default/files/2024-09/Direction_30082024_0.pdf). Press release 53/2024 had said 1 September and had included callback numbers. Press release 60/2024 deferred callbacks. A callback that is not in `callbackWhitelist` is a warning, not an error.
- From 11 December 2024, `chainRegistered: false` is an error. [Press release 92/2024](https://www.trai.gov.in/sites/default/files/2024-12/PR_No.92of2024.pdf).
- Header: letters and digits, at most one hyphen, length at most 11 including the suffix. From 13 April 2025 the suffix must match the category: promotional `-P`, service-implicit and service-explicit `-S`, transactional `-T`, government `-G`. [Second Amendment Regulations, 2025](https://www.trai.gov.in/sites/default/files/2025-02/Regulation_12022025.pdf), regulation 17, sixty days after the 12 February 2025 notification.
- Transactional means within 30 minutes of a customer-initiated transaction. Pass `minutesSinceTransaction`. A later message is a service message. Service content must not be promotional.
- Promotional sends before 10:00 or at or after 21:00 IST warn that promotional messages are restricted to 10:00–21:00 IST by default. Schedule II of the consolidated TCCCPR text marks those outer bands default OFF unless the recipient switches them on. That file says the gazette prevails, so the row is `verified: false`.
- A promotional template should contain an opt-out. The linter looks for obvious words (`STOP`, `opt-out`, `unsubscribe`, `block`). TRAI says the mechanism is "as specified".
- Operator warnings, `source` `operator`: more than 2 variables, a variable longer than 30 characters, a variable as the last word, and a missing brand name. MSG91's own pages disagree (30 vs 40 characters). A 31-character value warns. A 30-character value does not.
- The rendered `message` must equal the template with each `{#var#}` replaced in order. The check is exact.
- MSG91 OTP, from [docs.msg91.com/otp/sendotp](https://docs.msg91.com/otp/sendotp), tagged UNVERIFIED against TRAI and MeitY: POST `https://control.msg91.com/api/v5/otp`, query `template_id` and `mobile` (country code, 11 to 15 digits), header `authkey`, body `Param1`, `Param2`, … The template must contain `##OTP##`, which is not `{#var#}`. `otp_length` 4–9 (vendor default 4). `otp_expiry` 1–10080 minutes (vendor default 15). Skill practice, also not a TRAI rule: 6 digits from `crypto.randomInt`, pad to 6, TTL 5–10 minutes, an attempt limit, and never log the OTP. The attempt cap of 5 in the rules file is a local default.

## Edge cases

- Before 2024-10-01 a non-whitelisted URL is a warning. On that date it is an error.
- Before 2024-12-11 `chainRegistered: false` is a warning. On that date it is an error.
- Before 2025-04-13 a header without `-T` / `-S` / `-P` / `-G` is a warning. On that date a mismatch is an error.
- `21:00` IST is outside the default promotional window (the off band starts at 21:00). `10:00` is inside. A transactional template at 22:00 does not get the promotional warning.
- `9800000000` in the message is a callback warning unless `callbackWhitelist` contains it. A 6-digit OTP is not a callback.
- Passing `otp` into the MSG91 builder drops the value and warns. If `authkey` is set, the output says `<redacted>` and the process refuses to print the secret.
- `Math.random`, or `console.log` of the OTP, fails `action: "review"`. `randomInt(0, 1000000)` without `padStart` warns that the code can be shorter than 6 digits.
- Zero-width and bidi characters are rejected. Input over 10 KB is rejected. `sentAtIst` is `HH:MM` in IST. A `sentAt` value is read only when it contains `+05:30`, and the clock time is taken from the string.

## Disclaimer

This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying.
