# Sources

Rules as of 2026-11-01. A bullet is either a page that was used or an explicit UNVERIFIED tag.

- [e-invoice MasterCodes (state codes)](https://einvoice1.gst.gov.in/Others/MasterCodes) — opened 2026-11-01. Codes 01–38 with 25 and 26 both present, plus 96, 97, and 99. Code 28 is not in this table.
- [e-way bill state codes](https://docs.ewaybillgst.gov.in/apidocs/state-code.html) — cited by SPEC §1.1 as checked 2026-11-01. The build environment received HTTP 403, so display names follow the MasterCodes table that was opened.
- [GST portal](https://www.gst.gov.in/) — GSTIN length, regular marker `Z`, and the checksum verified in code on 2026-11-01 against the public GSTINs in SPEC §1.1.
- [Taxpayer search](https://services.gst.gov.in/services/searchtp) — a matching checksum does not show that the GSTIN is registered or active. This skill never calls the page.
- [Income Tax Department](https://www.incometaxindia.gov.in/) — PAN holder-type class and TAN shape used for the GSTIN body (SPEC §1.10). The 10th PAN character has no public checksum.
- [CBIC](https://www.cbic.gov.in/) — UIN shape (year, three-letter code, five digits; 13th and 14th characters vary).
- TCS marker, 14th character `C` — UNVERIFIED. No primary source was opened. Secondary descriptions only. `verified` is false and the script sets `confirm` true.
