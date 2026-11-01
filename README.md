# india-agent-skills

Tested, source-linked Agent Skills for Indian GST, payments, IDs, and compliance.

AI agents get this wrong: rupees as floats, the financial year as the calendar year, `new Date('YYYY-MM-DD')` as UTC, GSTIN check digits, CGST/SGST versus IGST, and a checksum treated as proof that a GSTIN is registered. This pack is a set of `SKILL.md` skills those agents can load. Each rule has a source and an as-of date. The licence is MIT. Nothing here is published to npm.

## Install

Only `gstin-validator` is in the repo today. The other skills in the table are coming in v0.1.

**Codex, Claude Code, Cursor, and other agents** — the [skills CLI](https://github.com/vercel-labs/skills) installs the folder into the agent you pick:

```bash
npx skills add ShiSa25/india-agent-skills
```

Add `-g` for a user-level install. One skill: `npx skills add ShiSa25/india-agent-skills --skill gstin-validator`.

**Codex.** The CLI puts the skill in `.codex/skills` or `~/.codex/skills`. Codex also reads a skill when your request matches its description. Invoke it yourself with `$gstin-validator`, or open `/skills`. [Codex skills](https://developers.openai.com/codex/skills).

**Claude Code.**

```text
/plugin marketplace add ShiSa25/india-agent-skills
/plugin install india-agent-skills@india-agent-skills
```

A skill from this plugin is `/india-agent-skills:gstin-validator`. The same folder copied to `.claude/skills/gstin-validator` is `/gstin-validator`. Claude also loads a skill when the description matches. [Skills](https://code.claude.com/docs/en/skills), [plugins](https://code.claude.com/docs/en/plugins/install).

**Cursor.** Type `/gstin-validator` in Agent chat. Cursor loads `.cursor/skills/`, `.agents/skills/`, and the Claude and Codex skill directories, and it applies a skill when the description matches. [Cursor skills](https://cursor.com/docs/skills).

Those commands were checked on 1 Nov 2026. If a slash command misses, use the page above for that tool.

## How to use these skills

An agent sees each skill's `name` and `description` and loads the `SKILL.md` when your request matches. You can also name the skill, as in the install section. A skill that is still "coming in v0.1" has no folder, so it will not load.

More detail, including the full JSON from the validator: [docs/USAGE.md](docs/USAGE.md).

### When to use which skill

| Situation | Skill | Example prompt | Status |
| --- | --- | --- | --- |
| You have a GSTIN and want the state and the checksum | `gstin-validator` | Validate this GSTIN and tell me the state: 27AAACR5055K1Z7 | ready |
| You need a tax invoice, credit note, or export bill | `gst-invoice` | Create an intra-state tax invoice for ₹42,000 at 18%. | coming in v0.1 |
| You need e-invoice JSON and you will not call the IRP | `gst-e-invoice-json` | Build schema 1.1 JSON for this B2B invoice. Do not call the IRP. | coming in v0.1 |
| A foreign or SEZ client, LUT, or FEMA deadline | `freelancer-export-compliance` | Invoice date 2026-03-15 to a US client. What is my FY, LUT, and the GST and FEMA deadlines? | coming in v0.1 |
| TDS on a contractor or professional fee | `tds-freelancer-payments` | Company paying a professional ₹60,000 on 2026-06-01. How much TDS, and what if there is no PAN? | coming in v0.1 |
| Razorpay checkout or webhook | `razorpay-integration` | Add Razorpay webhook verification to my Express app. Fulfil only on payment.captured. | coming in v0.1 |
| Cashfree webhook | `cashfree-integration` | Verify this Cashfree webhook and reject a stale timestamp. | coming in v0.1 |
| A UPI link or QR | `upi-payment-links` | UPI link for merchant@upi, name "Shiv & Co", amount 499.00, plus a QR. | coming in v0.1 |
| Rupees in Indian grouping or in words | `inr-formatting` | Format 12345678901234567890 paise in Indian grouping and in words. | coming in v0.1 |
| PAN, TAN, IFSC, PIN, or a mobile number | `indian-id-validators` | Check this PAN and this IFSC. Do not look the IFSC up online. | coming in v0.1 |
| Text that may contain an Aadhaar number | `aadhaar-safe-handling` | Mask Aadhaar numbers in this text. Do not log a full number. | coming in v0.1 |
| A schema that stores personal data | `dpdp-compliance-check` | Scan this Prisma schema and give me a DPDP checklist as of today. | coming in v0.1 |
| An OTP SMS or a DLT template | `sms-otp-dlt` | Lint this DLT template and show a 6-digit OTP that is never logged. | coming in v0.1 |

### Demos

**1. Validate a GSTIN.** Real output from `gstin-validator`, exit code 0:

```bash
node skills/gstin-validator/scripts/validate-gstin.mjs --json '27AAACR5055K1Z7'
```

```json
{"valid":true,"normalized":"27AAACR5055K1Z7","type":"regular","stateCode":"27","stateName":"Maharashtra","pan":"AAACR5055K","tan":null,"errors":[],"warnings":["Checksum valid ≠ registered/active; check services.gst.gov.in/services/searchtp"],"confirm":false,"disclaimer":"This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."}
```

The warning is the point: the checksum matches and the state is Maharashtra. That does not mean the GSTIN is active.

**2. Zero-rated export invoice.** Illustrative until `gst-invoice` and `freelancer-export-compliance` land. Prompt: "Create a zero-rated export invoice for my US client. Invoice date 2026-03-15, LUT filed, no IGST." The agent should show FY `2025-26`, IGST 0, `confirm: true` on the FEMA month count, and this endorsement exactly: `SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX`.

**3. Razorpay webhook.** Illustrative until `razorpay-integration` lands. Prompt: "Add Razorpay webhook verification to my Express app." The agent should read the raw body with `express.raw({ type: 'application/json' })`, HMAC that raw body, and compare with `crypto.timingSafeEqual` only after the lengths match. It should not `JSON.stringify(req.body)`, and it should fulfil on `payment.captured`, not on `payment.authorized`.

### Run a script without an agent

From the repo (or from the installed skill folder, where the script path is `scripts/validate-gstin.mjs`):

```bash
node skills/gstin-validator/scripts/validate-gstin.mjs --json '27AAACR5055K1Z7'
node skills/gstin-validator/scripts/generate-gstin.mjs --json '{"stateCode":"29"}'
```

Exit `0` valid, `1` invalid, `2` usage error. Stdout is one JSON object. `--json` also accepts `{"gstin":"..."}`.

### When not to use them

- They are not tax, legal, or financial advice, and they do not file anything.
- They do not call the GST portal, an IRP, a bank, or a payment gateway.
- A valid checksum is not proof of registration. Search [services.gst.gov.in/services/searchtp](https://services.gst.gov.in/services/searchtp) yourself.
- If the JSON has `confirm: true`, the underlying rule was not checked against a primary source. Do not treat it as settled.
- Do not paste a real individual's Aadhaar or PAN into an issue or a log.

## Skills

<!-- skills:start -->
| Skill | What it does | Status |
| --- | --- | --- |
| [gstin-validator](skills/gstin-validator/SKILL.md) | Validate an Indian GSTIN: checksum, state code, and regular, TDS, TCS, UIN, or NRTP/OIDAR shape. A valid checksum does not prove the GSTIN is registered. Use when a user pastes a GSTIN, checks an invoice, or builds a GST form. | 0.1.0 |
| `gst-invoice` | Build a GST tax invoice with CGST, SGST or UTGST, IGST, and export endorsements. Use when creating an invoice, credit note, or export or SEZ bill. | coming in v0.1 |
| `gst-e-invoice-json` | Build and validate GST e-invoice JSON (schema 1.1) without calling an IRP. Use when a user needs an IRN payload or a schema check. | coming in v0.1 |
| `freelancer-export-compliance` | Financial year, LUT, GST realisation, and FEMA deadlines for an export of services. Use when a freelancer invoices a foreign or SEZ client. | coming in v0.1 |
| `tds-freelancer-payments` | TDS on contractor and professional payments under the Income-tax Act 2025. Use when computing a deduction, a threshold, or the no-PAN rate. | coming in v0.1 |
| [razorpay-integration](skills/razorpay-integration/SKILL.md) | Verify Razorpay checkout signatures (HMAC-SHA256 of order_id\|payment_id), webhook signatures over the raw body, and convert amounts to currency subunits. Use when adding Razorpay checkout, a webhook, a capture decision, or an amount in paise or another subunit. Create orders, capture, and refund through the official Razorpay MCP server, not from this skill. | 0.1.0 |
| [cashfree-integration](skills/cashfree-integration/SKILL.md) | Verify Cashfree webhook signatures for version 2025-01-01: Base64 of HMAC-SHA256 over the timestamp plus the raw body, with a replay window and millisecond-versus-seconds detection. Use when adding a Cashfree webhook, checking x-webhook-signature, or deciding whether a payment_status may fulfil. Call Payment Gateway APIs through the official Cashfree MCP server, not from this skill. | 0.1.0 |
| `upi-payment-links` | Build unsigned UPI payment links and QR SVGs. Use when a user asks for a UPI link or QR. A link is not proof of payment. | coming in v0.1 |
| `inr-formatting` | Format rupees in Indian grouping and in words. Use when showing an amount or an amount-in-words line. | coming in v0.1 |
| [indian-id-validators](skills/indian-id-validators/SKILL.md) | Format-check an Indian PAN (4th-character holder type), TAN, IFSC, PIN code, or mobile number. Use when a user pastes a PAN, TAN, IFSC, PIN, or +91 mobile, or asks whether an IFSC matches the RBI pattern. An IFSC directory lookup is opt-in and is not proof that a branch is live. | 0.1.0 |
| [aadhaar-safe-handling](skills/aadhaar-safe-handling/SKILL.md) | Check, mask, and scan for Aadhaar numbers with the Verhoeff checksum, and state the storage limits in the Aadhaar Act and the UIDAI data-vault circular. Use when text, logs, or a repository may contain an Aadhaar or Virtual ID. Never log a full number. | 0.1.0 |
| `dpdp-compliance-check` | Scan a schema for personal data and list DPDP Act and Rules dates. Use when reviewing a schema or a privacy checklist. | coming in v0.1 |
| `sms-otp-dlt` | Lint DLT SMS templates and OTP handling. Use when writing an OTP SMS or a DLT template. | coming in v0.1 |
<!-- skills:end -->

## Safety

Read [DISCLAIMER.md](DISCLAIMER.md) before you file, invoice, or pay from an answer. Rules are as of 2026-11-01 and change. Unverified points are listed in [SPEC.md](SPEC.md) and are returned with `confirm: true` instead of being stated as fact.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers a new skill and the sourcing rule: a primary https source and an as-of date, or `verified: false` and `confirm: true`. [AGENTS.md](AGENTS.md) is the contract for agents that add skills. [SECURITY.md](SECURITY.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
