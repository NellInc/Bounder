# Copy and developer contract lane

## Changes

- index.html preserves the headline, promotes Try guided demo, labels software-only status in the hero, identifies public website versus private Go producer, and aligns source JSON-LD languages with HTML/CSS/JavaScript.
- contact.html adds optional intent guidance to the existing message using aria-describedby. Required field count remains four; no new submission fields or endpoint changes.
- README.md identifies repository ownership and links the developer guide.
- guides/INTEGRATION.md expands the existing guide with contract mapping, exact-byte signature/trust flow, existing positive/negative fixture examples, expiry/replay boundaries, and local file versus page networking distinctions. No invented service endpoints.
- tests/site-quality.test.js adds two claim-specific regressions.

## Verification

- New copy tests: 2 passed.
- Policy round-trip suite: 92 passed (tests/policy-roundtrip.test.js).
- Initial combined policy/site batch: 101 passed, 1 failed with ENOENT for ui/workbench.js while the parent was concurrently implementing that referenced module. Full integration rerun belongs to parent after all writes settle.
- Executable inline scripts and their CSP hashes unchanged. JSON-LD is metadata only.

## Caveats

Rendered typography/overflow and integrated browser acceptance are parent-owned. This is local source work only, no release seal or deployment. Historical manifests and preserved docs snapshot untouched. Full source lines and validation details are available in the actual diff and /tmp/bounder-copy-tests.log; /tmp/bounder-copy-policy.log contains final policy results.
