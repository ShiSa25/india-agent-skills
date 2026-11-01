---
name: Fact correction
about: A rate, date, code, or source in rules/ or a skill is wrong
title: "[fact] "
---

## Rule

`rules/<file>.json` id, or the skill and the sentence that is wrong.

## Current value

Quote it. Include `verified` and `asOf`.

## Proposed value

The corrected value, the effective date range, and whether older dates should keep the old value.

## Primary source

The https URL of the gazette, circular, or official page, and the date you opened it. A blog is not enough to set `verified` to true.

## Output change

Should existing outputs gain `confirm: true`, lose it, or change a number? Paste a synthetic vector, not a real person's ID.
