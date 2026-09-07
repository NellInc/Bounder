# Documentation and system reconciliation

Owned only _wiki/**, system/bounder-system.v1.json, and generated .github/generated/impact-rules.json, plus this note. No source/CSS/test edits in this lane.

## Reconciliation

- Updated site runtime dependency diagram and component role descriptions for named policy implementations, DOM panel ownership, controller, extracted scene, Fleet renderer, and workbench.
- Replaced stale monolithic policy implementation citations with specific exports in contracts.js, evaluator.js, roundtrip.js, and presentation-state.js.
- Rebased changed file citations against actual current lines. Retained existing unchanged valid citation ranges and exact text anchors; broad old citations were mapped only where unchanged source endpoints remained identifiable.
- Refreshed wiki index/log and changed page dates to 2026-09-07.
- Added concrete policy/runtime/UI paths to browser verifier and simulator component inventories. Added runtime/json and new UI modules to relevant impact routes; existing runtime/policy/** and simulator/** patterns already cover new members.
- Regenerated task routes and CI impact rules. No new artifact IDs were needed: files belong to existing components and their existing evidence flows.
- The system descriptor has no current release version field. Existing producer/backend standing uncertainty statements remain unchanged; no 1.2.0 seal or deployment claim added.

## Checks

- npm run system:generate: successful.
- npm run docs:check: passed, 9 pages, 40 links, 232 citations, 134 anchored.
- Programmatic checkDocumentation report after reconciliation: no routing warnings, warnings, or errors (same citation counts).
- npm run system:check: passed (12 roles, 11 components, 10 artifacts, 11 impact rules; generated files current).
- git diff --check for owned files: clean.

## Residual boundary

Root is still refining controller and browser source. Any later line shifts require a final docs:check after source settles. Checks establish routing/citation consistency, not producer derivation, browser runtime, release sealing, live bytes, or physical authority. Final root integrated verification remains required.

## Contact and rendering follow-up

Added the contact source behavior and its distinct delivery boundary to site architecture: progressive AJAX to the existing endpoint, HTTP plus next-string/no-error confirmation, preserved input and duplicate-risk warning, explicit native hosted submission, and no query-driven success. No real provider acceptance or recipient delivery is claimed; browser tests intercept the provider.

Documented demand-driven paused rendering, bootstrap-settled initial frame gating, and open fault disclosure initialization after evidence readiness. Added ui/contact-form.js to the existing public_copy route and regenerated views; a separate actuator/evidence component was not invented for the contact form. Updated index/log and current controller citations.

Follow-up checks: docs:check passed (241 citations, 141 anchored), system:check passed, generated views current, no routing warnings/errors, scoped diff check clean. Subsequent source edits can still shift references and require the root's final integrated check.
