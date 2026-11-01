# Sources

Rules as of 2026-11-01. A bullet is either a page that was opened or an explicit UNVERIFIED tag.

- [Notification 60/2020 schema PDF](https://einvoice.gst.gov.in/uiassets/js/assets/files/60%20of%202020%20Dt.%2030-7-2020%20-%20Revised%20schema%201.1%20notified.pdf) — opened 2026-11-01. Schema version 1.1. The older draft file is marked 1.00; this skill emits `1.1`.
- [Notification 60/2020 as reproduced in the Jharkhand gazette](https://upload.indiacode.nic.in/showfile?actid=AC_JH_70_697_00001_00001_1542707582220&filename=60_-_84_-_07.12.20_tax.pdf&type=notification) — opened 2026-11-01. Recipient GSTIN sample includes `URP` for exports. Recipient PIN is optional, and the note says an export PIN need not be mentioned. Mandatory item and value fields follow that table.
- [Notification 10/2023](https://tutorial.gst.gov.in/einvoice/files/Notification_No._10_2023.pdf) — opened 2026-11-01. Substitutes "five crore rupees" with effect from 1 August 2023.
- [GSTN advisory on the 30-day limit](https://einvoice1.gst.gov.in/Documents/advisory270325.pdf) — opened 2026-11-01. From 1 April 2025, AATO of ₹10 crore and above cannot report a document after the 30-day window. The example is an invoice dated 1 April 2025, which cannot be reported after 30 April 2025. Advisory 543 of 5 November 2024 is the same text.
- [e-invoice MasterCodes](https://einvoice1.gst.gov.in/Others/MasterCodes) — opened 2026-11-01. Code 96 is Other Countries.
- [CGST Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html) — opened 2026-11-01. Document number length and character set.
- Export buyer PIN `999999` — UNVERIFIED. The notified schema does not require it. IRP practice uses it. The payload emits it and sets `confirm`.
- IRN cancellation within 24 hours — UNVERIFIED. A cancellation request sets `confirm`. It does not block the payload.
- Exempt classes (SEZ unit, insurer, bank, NBFC, GTA, passenger transport, multiplex) — UNVERIFIED as a list this skill may rely on. The script prints "may be exempt — confirm" and does not clear the turnover test.
- Invoice number `"0"`, a slash-only number, and a leading `0`, `/` or `-` — UNVERIFIED as a statutory bar. Rule 46 does not say it. IRP practice rejects a leading `0`, `/` or `-`.
- The shared `gst.json` TCS GSTIN marker — UNVERIFIED. This skill does not use it to accept or reject a payload by itself.
