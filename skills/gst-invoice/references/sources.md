# Sources

Rules as of 2026-11-01. A bullet is either a page that was opened or an explicit UNVERIFIED tag.

- [CGST Rule 46](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html) — opened 2026-11-01. Invoice particulars, the 16-character number, the ₹50,000 unregistered-recipient clause, and both export / SEZ endorsement sentences.
- [CGST section 170](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter21/section170_v1.00.html) — opened 2026-11-01. Tax payable rounds to the nearest rupee; 50 paise or more rounds up. Each head rounds on its own.
- [IGST section 7](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/active/chapteriv/section7_v1.00.html) — opened 2026-11-01. Section 7(5)(b): a supply to or by an SEZ developer or unit is inter-state.
- [IGST Act (sections 8, 12 and 13)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_IGST_Act/documents/Integrated_Goods_And_Services_Tax_Act,_2017_27-March-2020.html) — opened 2026-11-01. Section 8 excludes SEZ from intra-state. Section 12(2) and section 13(2) are the general place-of-supply rules for services.
- [e-invoice MasterCodes](https://einvoice1.gst.gov.in/Others/MasterCodes) — opened 2026-11-01. State names and code 96, Other Countries. Codes 25 and 28 are legacy.
- Invoice number "0", a slash-only number, and a number that starts with `0`, `/` or `-` — UNVERIFIED. Rule 46 does not say this. IRP practice is secondary. The script rejects only `"0"` and slash-only numbers, warns on a leading `0`, `/` or `-`, and sets `confirm`.
- UTGST state codes `04`, `26`, `31`, `35`, `38` — UNVERIFIED against the gazette. The label is used and `confirm` is set. Code 97 (other territory) is not relabelled.
- GST 2.0 slabs (22 Sep 2025) — UNVERIFIED. Any non-negative rate is accepted. A rate outside the bundled examples warns and sets `confirm`. A rate is never inferred from an HSN or SAC.
- The shared `gst.json` also carries the TCS GSTIN marker — UNVERIFIED. This skill does not decide TCS registration. A TCS-shaped supplier GSTIN sets `confirm` because that shared rule is unverified.
