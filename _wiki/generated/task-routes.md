# Generated Task Routes

<!-- wiki:type = flow -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-08-31 -->
<!-- wiki:updated = 2026-08-31 -->

This page is compiled from the canonical system descriptor. Run `npm run system:generate` after changing impact rules. (`system/bounder-system.v1.json:1-1`)

| Route | Changed paths | Components | Commands | Proof classes | Release-sensitive |
|---|---|---|---|---|---|
| `control_model` | `system/**`<br>`scripts/lib/system-model.mjs`<br>`scripts/system-inspect.mjs`<br>`scripts/check-changed.mjs`<br>`scripts/docs-check.mjs`<br>`scripts/verify.mjs`<br>`tests/system-model.test.js`<br>`tests/agent-commands.test.js`<br>`package.json`<br>`scripts/generate-system-views.mjs`<br>`scripts/verify-changed.mjs`<br>`.github/generated/impact-rules.json`<br>`_wiki/generated/task-routes.md`<br>`tests/browser-module-boundaries.test.js`<br>`tests/producer-derivation.test.js`<br>`.github/workflows/site-quality.yml` | `agent_control_plane` | `system_check`<br>`unit`<br>`docs_check`<br>`verify`<br>`generate_system_views` | `source_behavior` | No |
| `observability_runtime` | `runtime/observability/**`<br>`runtime/json/**`<br>`tests/guardian-fleet-observability.test.js`<br>`tests/observability-benchmark.test.js`<br>`tests/helpers/observability-fixtures.js`<br>`scripts/benchmark-observability.mjs` | `guardian_observability_reference`<br>`fleet_observability_reference` | `observability_test`<br>`observability_benchmark`<br>`unit_coverage`<br>`docs_check` | `runtime_observability`<br>`observability_performance` | No |
| `observability_contracts` | `schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json`<br>`schemas/creedspace-bounder-fleet-snapshot-v1.schema.json`<br>`schemas/creedspace-bounder-fleet-event-v1.schema.json`<br>`schemas/creedspace-bounder-telemetry-envelope-v1.schema.json` | `guardian_observability_reference`<br>`fleet_observability_reference`<br>`publication_builder` | `observability_test`<br>`observability_benchmark`<br>`unit_coverage`<br>`build`<br>`browser`<br>`docs_check`<br>`producer_derivation` | `runtime_observability`<br>`observability_performance`<br>`publisher_integrity`<br>`browser_behavior`<br>`cross_repository_compatibility` | Yes |
| `continuity` | `continuity-evidence.js`<br>`tests/continuity-evidence.test.js` | `continuity_verifier` | `unit_coverage`<br>`browser` | `source_behavior`<br>`browser_behavior`<br>`live_continuity` | Yes |
| `policy_and_receipts` | `policy-roundtrip.js`<br>`simulator-contracts.js`<br>`staging-feed.js`<br>`schemas/bounder-resilience-evidence.v1.schema.json`<br>`schemas/bounder.receipt-bundle.v1.schema.json`<br>`schemas/bounder.receipt.v1.schema.json`<br>`schemas/creedspace-bounder-checkpoint-v1.schema.json`<br>`schemas/creedspace-bounder-envelope-v1.schema.json`<br>`schemas/creedspace-bounder-policy-v1.schema.json`<br>`schemas/creedspace-bounder-profile-v1.schema.json`<br>`schemas/creedspace-bounder-roundtrip-v1.schema.json`<br>`data/**`<br>`tests/policy-roundtrip.test.js`<br>`tests/receipt-bundle.test.js`<br>`tests/simulator-contracts.test.js`<br>`tests/staging-feed.test.js`<br>`schemas/bounder-evidence-provenance-v1.schema.json`<br>`scripts/verify-producer-derivation.mjs`<br>`tests/producer-derivation.test.js`<br>`runtime/policy/**`<br>`runtime/transport/**`<br>`runtime/crypto/**`<br>`runtime/receipts/**`<br>`runtime/fleet/**`<br>`runtime/resilience/**`<br>`runtime/simulator/**`<br>`ui/policy-roundtrip-panel.js`<br>`schemas/bounder-release-manifest-v2.schema.json`<br>`.github/workflows/receipt-drift.yml` | `guardian_decision`<br>`browser_policy_verifier`<br>`simulator` | `unit_coverage`<br>`browser`<br>`producer_derivation` | `source_behavior`<br>`browser_behavior`<br>`cross_repository_compatibility` | Yes |
| `simulator_presentation` | `simulator.js`<br>`simulator-fallback.js`<br>`simulator-world.js`<br>`simulator.html`<br>`simulator.css`<br>`tests/simulator-world.test.js`<br>`tests/browser/site.spec.js`<br>`simulator/**` | `simulator` | `unit_coverage`<br>`browser`<br>`design_lint` | `source_behavior`<br>`browser_behavior` | Yes |
| `publication` | `scripts/build-site.mjs`<br>`tests/publication.test.js`<br>`.github/workflows/deploy-pages.yml` | `publication_builder` | `unit_coverage`<br>`build`<br>`browser` | `publisher_integrity`<br>`browser_behavior` | Yes |
| `release` | `scripts/generate-release-manifest.js`<br>`tests/release-manifest.test.js`<br>`release/**`<br>`VERSION`<br>`CHANGELOG.md`<br>`scripts/generate-release-manifest-v2.mjs`<br>`schemas/bounder-release-manifest-v2.schema.json`<br>`tests/release-manifest-v2.test.js`<br>`.github/workflows/receipt-drift.yml` | `release_manifest` | `unit_coverage`<br>`build`<br>`browser`<br>`docs_check`<br>`producer_derivation` | `publisher_integrity`<br>`producer_derivation`<br>`cross_repository_compatibility` | Yes |
| `public_copy` | `*.html`<br>`styles.css`<br>`site.js`<br>`README.md`<br>`SECURITY.md`<br>`guides/**` | `simulator`<br>`publication_builder` | `unit_coverage`<br>`build`<br>`browser`<br>`design_lint`<br>`docs_check` | `source_behavior`<br>`browser_behavior`<br>`publisher_integrity` | Yes |
| `architecture_docs` | `CLAUDE.md`<br>`AGENTS.md`<br>`_wiki/**`<br>`_contprompts/**` | `architecture_knowledge` | `system_check`<br>`docs_check` | `source_behavior` | No |

## Use

1. Run `npm run inspect` for current state.
2. Run `npm run check:changed` for the least expensive sufficient plan.
3. Run `npm run verify:changed` to execute the selected gates.
4. Run `npm run verify` for an aggregate candidate.

**Working if:** this page, CI selection, and local changed-path execution change together when one descriptor rule changes.

## Provenance

- Generated by `scripts/generate-system-views.mjs`.
- Source: `system/bounder-system.v1.json:1-1`.
