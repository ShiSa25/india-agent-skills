## Summary

## Vectors

Positive and negative cases this PR adds. Name the test file (`skills/<skill>/tests/*.test.mjs`).

## UNVERIFIED

List every rule with `verified: false` that this PR adds or changes. If there are none, write "none".

## Test output

Paste the summary line from `npm test` (and `npm run validate` if you touched the scaffold).

```
# tests 
# pass 
# fail 0
```

## Checklist

- [ ] I edited only `skills/<this-skill>/`, `evals/<this-skill>/`, and my own keys in `rules/<domain>.json` (scaffold changes are Agent 0)
- [ ] Rules values are read from `rules/*.json`, not hardcoded
- [ ] Unverified facts set `confirm: true` and include "Confirm with the official source before relying on this."
- [ ] Money is integer minor units. Dates are YYYY-MM-DD in IST. No `new Date('YYYY-MM-DD')`
- [ ] Tests use `node:test`, make no network calls, and use synthetic IDs only
- [ ] `node tools/sync-lib.mjs` was run and the `_lib` / `_rules` copies are committed
- [ ] `references/sources.md` links are https, and UNVERIFIED claims are tagged
