# Policy seam refactor, 2026-09-07

## Scope and implementation

Owned policy runtime, JSON/crypto/bounded transport seams, policy UI implementation and focused tests only. No root HTML/CSS/controller/docs/system changes were made by this lane.

The original 1135-line runtime/policy/core.js is now a ten-line compatibility facade. Existing public exports and narrow seam exports remain stable. Implementation ownership:

- runtime/json/policy-json.js: exact strict JSON parser and decimal normalization.
- runtime/crypto/encoding.js: pinned trusted keys, canonical base64, SHA256.
- runtime/transport/bounded-json.js: bounded fetch, deadline, abort, response identity and streaming guards.
- runtime/policy/contracts.js: versions, timestamp parsing, constraints/profile/policy/envelope validation.
- runtime/policy/evaluator.js: browser replay evaluation, documented as no actuator authority.
- runtime/policy/roundtrip.js: exact evidence binding and replay validation, documented unmatched versus rejected outcomes.
- runtime/policy/primitives.js: internal shared assertions, immutable snapshots and byte helpers.
- runtime/policy/request.js: internal exact request schema.
- runtime/policy/presentation-state.js: latest-request gate and time classification.
- ui/policy-panel.js: explicit callable panel bootstrap. ui/policy-roundtrip-panel.js retains the existing browser-entrypoint mounting behavior. Importing the core or implementation does not mount.

Only behavioral edit: published-vector fetch failure preserves rejection, then appends connection/retry/local-file guidance. It does not broaden acceptance or change file guards.

## Evidence

1. Compared each original top-level declaration body from HEAD with moved implementations, ignoring export visibility and added JSDoc. Every body remains verbatim except bootstrapPolicyRoundTrip (the intentional guidance change).
2. Focused tests: node --test tests/policy-roundtrip.test.js tests/browser-module-boundaries.test.js, 96 passed in final coverage run.
3. Focused per-file c8 with unchanged repository floors 85% lines, 75% branches, 85% functions passes all owned runtime files. Overall focused coverage: 94.30% lines, 80.68% branches, 100% functions.
4. Added tests for acyclic dependency graph, real implementation ownership, inert implementation bootstrap, safe unavailable retry text, and all supported authority-time representations.
5. Initial focused test exposed an accidental decision helper export from lexical extraction. Removed it before successful rerun. Initial focused coverage exposed presentation-state branch coverage at 70%; explicit timestamp-input tests raise it to 100%, with no threshold/exclusion changes.

## Caveats and integration

Root must inspect the integrated diff and rerun aggregate coverage, build, system inventory, browser acceptance and frontend lint as appropriate. New runtime/UI module files must be represented by any explicit system inventory. UI files are outside the repository's current runtime coverage include; tests exercise the moved UI through its compatibility export, but this is not a claim of a new UI per-file coverage gate. No deployed bytes, publication or producer-derivation claim is made. Current workspace includes other lanes' concurrent edits, which were preserved.

Raw focused coverage output: /tmp/bounder-policy-coverage.log. No memory files were used.
