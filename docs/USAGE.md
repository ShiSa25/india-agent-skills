# How to use these skills

This is the long form of the section in the [README](../README.md). Commands were checked on 1 Nov 2026 against [Codex](https://developers.openai.com/codex/skills), [Claude Code skills](https://code.claude.com/docs/en/skills), [Claude Code plugins](https://code.claude.com/docs/en/plugins/install), [Cursor](https://cursor.com/docs/skills), and the [skills CLI](https://github.com/vercel-labs/skills). Slash-command syntax moves. If a command misses, use the page for that tool.

## How a skill gets loaded

A skill is a folder with a `SKILL.md`. The frontmatter `description` says what it does and when to use it. The agent starts with that description, not the whole file. If your request matches, it loads the instructions and can run the scripts in the folder.

You do not have to remember the description.

| Tool | Name it yourself | Let it match |
| --- | --- | --- |
| Codex | `$gstin-validator` in the prompt, or `/skills` | The description matches the request |
| Claude Code, installed as a plugin from this repo | `/india-agent-skills:gstin-validator` | Same |
| Claude Code, folder at `.claude/skills/gstin-validator` | `/gstin-validator` | Same |
| Cursor | `/gstin-validator` in Agent chat. Option+Enter (Alt+Enter) keeps it for the session | Same |

`npx skills add ShiSa25/india-agent-skills` copies the skill into the directory the agent already scans. Only skills that have a `SKILL.md` in this repo can load. Today that is `gstin-validator`.

## When to use which skill

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

## Demo: validate a GSTIN

This is real output from the script in this repo.

Prompt: "Validate this GSTIN and tell me the state: 27AAACR5055K1Z7."

What the agent should do: load `gstin-validator`, run the script, and answer with the state from the JSON. It should repeat the checksum warning. It should not claim the taxpayer is active.

```bash
node skills/gstin-validator/scripts/validate-gstin.mjs --json '27AAACR5055K1Z7'
```

Exit code `0`. Stdout, one line:

```json
{"valid":true,"normalized":"27AAACR5055K1Z7","type":"regular","stateCode":"27","stateName":"Maharashtra","pan":"AAACR5055K","tan":null,"errors":[],"warnings":["Checksum valid ≠ registered/active; check services.gst.gov.in/services/searchtp"],"confirm":false,"disclaimer":"This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."}
```

The same script on the blog example `9917USA00013OS5` exits `1`:

```json
{"valid":false,"normalized":"9917USA00013OS5","type":"nrtp_oidar","stateCode":"99","stateName":"Centre Jurisdiction","pan":null,"tan":null,"errors":["Checksum does not match (expected P)."],"warnings":[],"confirm":false,"disclaimer":"This tool gives general information and format checks only, not tax, legal or financial advice. Rules are as of 2026-11-01 and change often. A valid format does not prove that an ID is registered or active. Confirm with the official source or a qualified professional before filing, invoicing or paying."}
```

The check character on that body is `P`, not `5`.

## Demo: zero-rated export invoice

**Illustrative.** `gst-invoice` and `freelancer-export-compliance` are not in the repo yet. The wording below is the SPEC text those skills have to implement, not output from a script.

Prompt: "Create a zero-rated export invoice for my US client. Invoice date 2026-03-15, taxable value ₹1,00,000, LUT already filed for this financial year, no IGST."

What the agent should do once those skills exist:

1. Decide the financial year of 2026-03-15, which is `2025-26`, and the LUT year that matches it.
2. Treat the supply as an export under LUT: IGST is 0, not a split of CGST and SGST.
3. Put this endorsement on the invoice, byte for byte: `SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX`.
4. Compute the GST realisation deadline as one year from the invoice (2027-03-15) and the FEMA deadline from `rules/fema.json` for that invoice date. FEMA month-counts that are not tied to a primary source we opened stay `confirm: true`.

Abbreviated shape the agent should show, marked as not yet produced by a script:

```json
{
  "fy": "2025-26",
  "lutRequired": false,
  "igstMinor": "0",
  "endorsement": "SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
  "gstRealisationDeadline": "2027-03-15",
  "confirm": true,
  "disclaimer": "This tool gives general information and format checks only, not tax, legal or financial advice."
}
```

`lutRequired: false` here means an LUT for that FY was already filed, not that an LUT is optional for zero-rating. If no LUT is filed, IGST is paid and refunded. The skill must say that.

## Demo: Razorpay webhook

**Illustrative.** `razorpay-integration` is not in the repo yet.

Prompt: "Add Razorpay webhook verification to my Express app."

What the agent should write:

```js
app.post('/razorpay/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.header('x-razorpay-signature');
  const valid = verifyWebhook({ rawBody: req.body, signature, secret: process.env.RAZORPAY_WEBHOOK_SECRET });
  if (!valid) return res.sendStatus(400);
  const event = JSON.parse(req.body.toString('utf8'));
  if (event.event === 'payment.captured') {
    // fulfil once; dedupe on x-razorpay-event-id
  }
  res.sendStatus(200);
});
```

`verifyWebhook` is HMAC-SHA256 over the raw body, hex, compared with `crypto.timingSafeEqual` only when the two buffers have the same length. A different length returns false and does not throw. Uppercase hex does not match. `JSON.stringify(req.body)` is the wrong input. `payment.authorized` is not paid.

## Run the scripts yourself

Installed skill folder:

```bash
node scripts/validate-gstin.mjs --json '27AAACR5055K1Z7'
node scripts/validate-gstin.mjs --json '{"gstin":"27aaacr5055k1z7"}'
node scripts/generate-gstin.mjs --json '{"stateCode":"27","type":"tds","tan":"AAAA00000A"}'
```

This repo, from the root:

```bash
node skills/gstin-validator/scripts/validate-gstin.mjs --json '27AAACR5055K1Z7'
```

| Exit | Meaning |
| --- | --- |
| 0 | `valid` is true. `confirm` may still be true. Read it. |
| 1 | The ID is invalid. `errors` says why. |
| 2 | Usage: missing `--json`, or JSON that is not a GSTIN string or `{ "gstin": "..." }`. |

Lowercase is accepted and warned. A Cyrillic look-alike is rejected. The generator is for fixtures. `generateSyntheticGstin('29')` from `scripts/_lib/gstin.mjs` builds a checksum-valid synthetic regular GSTIN; the CLI validates it before printing.

## When not to use them

- Not tax, legal, or financial advice. The `disclaimer` string in every tax, legal, and payment result says the same thing.
- No portal submission. These skills do not log in to GST, generate an IRN, or create a Razorpay order.
- `confirm: true` means an input to the answer is unverified. Say that to the user. Do not drop the flag. The open list is in [SPEC.md](../SPEC.md).
- A checksum-valid GSTIN can be unregistered, cancelled, or suspended. The warning points at [the taxpayer search](https://services.gst.gov.in/services/searchtp). This pack does not call it.
- Do not store or log a full Aadhaar number. When that skill lands, its scanner prints masked values only.
- Skills marked coming in v0.1 are not installed by `npx skills add` until their folders exist.
