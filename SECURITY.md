# Security

This pack is a local format checker. Scripts do not send GSTINs, PANs, or Aadhaar numbers anywhere. Do not add a network call except the opt-in IFSC lookup described in SPEC §1.10, and do not let tests hit the network.

## Reporting

Report a vulnerability privately through [GitHub security advisories](https://github.com/ShiSa25/india-agent-skills/security/advisories/new). Do not open a public issue that contains a live secret, a webhook signing key, or a real person's Aadhaar or PAN.

## What to include

What you ran, the skill version, and a synthetic input that shows the problem. Mask identifiers. A checksum bypass, a comparison that is not constant-time where SPEC requires `crypto.timingSafeEqual`, or a scanner that prints a full Aadhaar number are in scope. A wrong tax rate is a [fact correction](.github/ISSUE_TEMPLATE/fact-correction.md), not a security advisory, unless it also leaks data.
