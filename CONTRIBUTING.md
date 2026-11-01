# Contributing

Thanks for checking a rule instead of guessing one. This pack is MIT, and the build contract is [SPEC.md](SPEC.md). Agent authors should follow [AGENTS.md](AGENTS.md). The short version is below.

## Sourcing rule

Every behaviour that can change a number, a date, or a pass/fail decision comes from `rules/<domain>.json`.

1. Open the primary source (gazette, CBIC, RBI, NPCI, UIDAI, Income Tax, GST portal). Put the https URL in `source` and the date you opened it in the skill's `rules-as-of` and in `references/sources.md`.
2. If you could not open that page, set `verified` to `false`. The script must set `confirm: true` and include the sentence `Confirm with the official source before relying on this.` Do not phrase an unverified rule as a hard fact in `SKILL.md`.
3. A blog can explain a search. It cannot set `verified` to `true`.
4. Dates are `YYYY-MM-DD` interpreted in IST (UTC+05:30, no DST). The financial year is 1 April–31 March. Money is integer minor units (paise), never a float.
5. Test IDs are synthetic. Use `generateSyntheticGstin` and `generateSynthetic`. The only real GSTINs allowed are the public company and platform numbers in SPEC §1.1, used only to check the checksum. Never commit a real individual's PAN or Aadhaar. The Aadhaar scanner fails the build if you do.

## Add a skill

1. Branch `feat/<skill-name>`.
2. Copy the shape of [skills/gstin-validator](skills/gstin-validator/SKILL.md): `SKILL.md`, `scripts/*.mjs`, `references/sources.md`, `tests/*.test.mjs`, `evals/<skill-name>/evals.json`, and `scripts/lib-manifest.json`.
3. List the `lib/` modules and `rules/` files the skill needs in the manifest, then run `npm run sync-lib`. Commit the `scripts/_lib` and `scripts/_rules` copies. Do not edit those copies by hand.
4. Add only your keys to `rules/<domain>.json`. Leave other domains alone.
5. Run `npm test` and `npm run validate`. If your skill is new, `npm run readme` refreshes the table between the markers in `README.md`. Commit that block. Leave the rest of the README, `marketplace.json`, and `lib/` for the integrator.
6. Open a pull request with the template: vectors, UNVERIFIED items, and the `npm test` summary.

`SKILL.md` sections, in order: When to use, Quick start, Rules, Edge cases, Disclaimer. The description says what the skill does and includes `Use when`. Scripts print JSON and use exit codes 0 (valid), 1 (invalid), and 2 (usage).

## Fix a fact

Use the [fact-correction](.github/ISSUE_TEMPLATE/fact-correction.md) template, or send a PR that changes the rule's `value`, `effectiveFrom` / `effectiveTo`, `source`, and `verified` flag. Add a vector for the date on each side of the change. Do not silently rewrite history: a payment dated before the change still uses the old row.

## Conduct and security

[Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately; see [SECURITY.md](SECURITY.md). Do not put live secrets or real identity numbers in an issue.
