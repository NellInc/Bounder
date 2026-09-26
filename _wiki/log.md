# Bounder Wiki Log

## [2026-05-23] bootstrap | Initial wiki creation
Pages created: systems/site-architecture, domain/geofencing-product, index, log
Sources ingested: CLAUDE.md, directory listing

## [2026-08-31] synthesis | Agent control plane and system architecture
Created: systems/system-architecture, seams/evidence-provenance, flows/agent-operating-loop
Updated: systems/site-architecture, domain/physical-interlock, index
Renamed: domain/geofencing-product to domain/physical-interlock
Sources ingested: public runtime, schemas, tests, build and release tooling, CI workflows, release manifests, integration and security guidance
Finding: current release provenance conflates website publisher source with independent Go decision-producer provenance

## [2026-08-31] implementation | Executable control plane and observability reference
Created: system descriptor and schema, agent inspection and changed-path planning, documentation and verification commands, Guardian heartbeat and Fleet snapshot/event schemas, strict telemetry envelope, reference state model, virtual-time fault corpus, and observability benchmark
Updated: systems/system-architecture, flows/agent-operating-loop, systems/runtime-observability, index, CLAUDE routing
Boundary: external Guardian producer and Fleet backend remain unchanged and deployed performance remains unverified
Hold: four new public observability schemas enter the allowlisted build but remain unpinned by release v1.0.4 pending provenance v2

## [2026-09-01] implementation | Producer derivation and generated task routes
Created: clean producer export and website cross-repository verifier, byte-identical canonical contracts, browser ownership seams, generated task routes, generated CI impact data, and changed-path verification
Updated: system descriptor, build allowlist, repository inspection, public topology guidance, and verification routes
Boundary: the producer repository remains private; public source reproducibility therefore requires repository access or a future public mirror or reviewable source bundle
Hold: no tag, push, deployment, or live-state mutation occurs without explicit publication authority

## [2026-09-03] correction | Documentation repair after the agent-ergonomic code pass
Updated: systems/system-architecture, systems/site-architecture, systems/runtime-observability, flows/agent-operating-loop, seams/evidence-provenance, domain/physical-interlock, index
Also updated: README.md, CLAUDE.md, SECURITY.md, guides/INTEGRATION.md
Repointed drifted `file:line` citations across every hand-written page and converted the touched ones to the anchored `path:N-M "fragment"` form that `npm run docs:check` enforces
Corrected: operating loop now names `npm run release:manifest:v2` as the sanctioned generator; the provenance-gap section describes verification against an explicit producer checkout rather than regeneration from `../Bounder-Drone`; README states the GitHub Actions Pages source instead of branch-and-folder; CLAUDE.md rule 1 enumerates the full published set and names `canonicalPublicPaths` as its authority; the producer checkout path is a placeholder in README and the integration guide; the design-lint command is the lockfile-pinned `node_modules/.bin/impeccable`
Recorded: publication lock owner pid, stale-lock reclaim, orphaned scratch sweep and `.failed-*` preservation, signal release; per-page meta Content-Security-Policy with hash-allowed inline scripts; receipt-drift producer commit resolved from the newest sealed manifest with a step-scoped private token; observability event, telemetry-parser, checkpoint-zero, and schema tightening changes; UI seam mounting of the policy panel; `design/brand-source/` outside the publication allowlist
Re-verified after concurrent tooling work: descriptor and publication-lock citations repointed, and the lock description rewritten for the atomic stale-lock rename, mkdir-time ownership, and promotion-deferred signal handling
Hold released: the four observability schemas are pinned by manifest v2 from v1.1.0 onward; `npm run inspect` reports unpinned schemas against the current `VERSION`, so a release cycle before its manifest is sealed reports them unpinned by design
Boundary: README.md, SECURITY.md, CHANGELOG.md, VERSION, and guides/INTEGRATION.md are release-pinned; these edits require release-aware validation and a regenerated manifest before sealing

## [2026-09-07] reconciliation | Browser workbench and named policy seams
Updated: systems/site-architecture, systems/system-architecture, systems/runtime-observability, domain/physical-interlock, flows/agent-operating-loop, seams/evidence-provenance, index, generated/task-routes
Rebased source citations to the current guide, page, controller, and named policy implementations. Replaced obsolete monolithic policy implementation references with validation, evaluator, round-trip, and presentation-state seams. Recorded extracted scene creation, Fleet rendering, and workbench UI ownership.
Updated the system component inventories and impact routing for the new source modules, then regenerated task routes and CI impact rules.
Boundary: these are local source-candidate documentation changes. Producer derivation, sealed release identity, deployed bytes, and physical authority remain separate proof gates. Historical manifests remain unchanged.

## [2026-09-07] reconciliation | Contact confirmation and demand rendering
Updated: systems/site-architecture, systems/system-architecture, index, generated/task-routes and CI impact rules
Recorded: contact progressive enhancement, explicit native hosted submission, preserved input on unconfirmed response, query-independent confirmation, and separate live-delivery proof; simulator demand-driven frames and evidence-settled fault initialization.
Routed ui/contact-form.js through the existing public-copy validation lane and rebased moved controller citations. No production code, tests, or deployment changed by this documentation pass.

## [2026-09-07] reconciliation | Browser capture overhead
Updated: systems/site-architecture and index
Recorded: automatic trace filmstrips disabled while DOM/source traces and explicit QA captures remain. Assertions and application limits are unchanged.

## [2026-09-07] reconciliation | Restored hero release readiness
Updated: systems/site-architecture, systems/system-architecture and index
Rebased the UI mounting citations after the restored illustrated hero moved the simulator script entry points. No authority or contract semantics changed.

## [2026-09-07] reconciliation | Concise testbed presentation
Updated: systems/site-architecture, systems/system-architecture and index
Rebased simulator mounting citations after removing repetitive presentation disclaimers. Development status is stated once on the homepage; verification and decision behavior are unchanged.

## [2026-09-26] reconciliation | Contact form, icons and legal pages
Updated: systems/site-architecture, domain/physical-interlock and index
Rebased the contact-form and homepage citations after the contact form gained a required-fields note, the submit label moved into its own span, and every page gained ICO and touch-icon links. The contact submission boundary is unchanged: only a provider-confirmed response shows acceptance.

## [2026-09-26] reconciliation | Observability reference hardening
Updated: systems/runtime-observability, systems/system-architecture, systems/site-architecture, domain/physical-interlock and index
Recorded: evidence lag judged at the heartbeat's generation time rather than re-aged at observation; liveness capped by Fleet receive time; same-boot clock regressions as a diagnostic, not a lockout; telemetry keys bound to one Guardian or the Fleet aggregator; guard retirement; snapshot expiry folding policy and lease deadlines; strict and quarantining aggregation; one evaluation per Guardian before public projection; `signed_audits` as a per-cohort count; the stable interval lowered to 40 seconds so one lost report cannot mark a stable Guardian unreachable; and the three distinct continuity freshness bounds.
Rebased observability, policy-contract and integration-guide citations moved by these edits. The telemetry-envelope `public_key_id` pattern is still unanchored in the producer-owned schema and is recorded as a producer change.
Boundary: reference-model and documentation changes only. Heartbeat loss still changes Fleet classification only; local authority rules are unchanged. guides/INTEGRATION.md is release-pinned and needs release-aware validation before sealing.

## [2026-09-26] reconciliation | Homepage typography tokens
Updated: systems/site-architecture
Rebased the font-token citations after the mono stack gained Menlo and the per-platform monospaces, and the display role gained a self-hosted OFL condensed fallback (`assets/fonts/open-sans-condensed-latin.woff2`, licence in `assets/fonts/OFL.txt`). Apple visitors keep Avenir Next and never fetch the fallback.
Boundary: presentation only; no evidence, contract or authority rule changed.

## [2026-09-26] implementation | Tooling, CI and publication hardening
Updated: flows/agent-operating-loop, seams/evidence-provenance, systems/system-architecture and index
Recorded: changed-path plans fail closed (an undescribed path selects the complete gate) and a unit test requires every tracked path to match an impact rule; the dead `release:manifest` v1 entry point is removed; `test:coverage` gates Node modules per file and reports browser-only modules without gating, in a private temporary directory it removes; focused `verify --phase` runs claim nothing and never replace `latest.json`; sealing refuses incomplete verification receipts, producer-commit mismatches and producer-statement hashes that disagree with the inventory; new manifests record `files` in code-unit order and the inventory hash is defined over the array as recorded; the publication walk skips operating-system metadata and rejects other stray dotfiles; browser acceptance serves `_site` through a keep-alive Node server; every checkout drops its persisted credential and the unconfigured producer token is reported as a warning.
Rebased the receipt-drift, descriptor and agent-command citations these edits moved.
Boundary: tooling and CI only. No authority, evidence or deployment trigger changed; deploy gating on sealed manifests remains an owner decision.

## [2026-09-26] implementation | Simulator page shell and accessible evidence view
Updated: systems/site-architecture, systems/system-architecture
The simulator page now leads with its own heading and hands over to the workbench (`#scenario-lab`, the skip-link and tour deep-link target). The accessible evidence view renders the recorded 100-Guardian pilot as well as the receipts; when neither entry module can load, the bootstrap retries the accessible entry once and otherwise resolves every panel to `bootstrap_unavailable` with no command authority and a reload control. Rebased the `simulator.html` and `ui/policy-panel.js` citations these edits moved.
Boundary: presentation only; no evidence, contract or authority rule changed. simulator.html, README.md, SECURITY.md and guides/INTEGRATION.md are release-pinned and need release-aware validation before sealing.

## [2026-09-26] implementation | Simulator scene fidelity, motion and recovery
Updated: systems/site-architecture, systems/system-architecture
The render loop now idles once a flight reaches its recorded decision and never throttles user input; under reduced motion Play jumps to the recorded decision instead of flying the route. Fault replay events re-render the envelope from the recorded timeline, including when scrubbed back. A lost WebGL context pauses fail-closed and recovers when the browser restores it; recorded receipts stay inspectable from the scenario buttons meanwhile. Rebased the `simulator/controller.js` citations these edits moved.
Boundary: presentation only; no evidence, contract or authority rule changed.

## [2026-09-26] reconciliation | Integration of the launch-readiness pass
Updated: domain/physical-interlock, systems/site-architecture
Rebased the homepage boundary citation and the contact-form action citation after the parallel page edits moved them.
Boundary: citation positions only; no claim, authority or evidence rule changed.

## [2026-09-26] reconciliation | Backfill for unlogged 2026-09-11 and 2026-09-20 changes
Recorded after the fact; these changes were made without a log entry or index update.
2026-09-11 (commit 56fdbed, v1.2.3 source): the visitor-facing copy pass moved SECURITY.md lines, and citations in domain/physical-interlock, seams/evidence-provenance, systems/site-architecture and systems/system-architecture were repointed without bumping their `wiki:updated` markers.
2026-09-20 (commit bd8daec, local only): the manipulator profile schema, example and signed golden vector were mirrored from the private producer under `schemas/`; the example and vector have since moved to `data/`, and the schema `$id` now sits under `https://www.bounder.io/schemas/`.
Boundary: no page content changed by those commits beyond citation positions.

## [2026-09-26] reconciliation | Documentation and release-status pass for the 1.2.4 candidate
Updated: seams/evidence-provenance, systems/runtime-observability, systems/site-architecture, flows/agent-operating-loop, domain/physical-interlock, systems/system-architecture and index
Recorded: the mirrored manipulator preview and why it sits outside producer derivation (manifest observation, SHA-256 pin, `$id` ahead of the producer, verifier rejection, no payload schema); the `public_inventory_sha256` definition and the switch to code-unit order from v1.2.4; release status (1.0.0 to 1.2.2 sealed, 1.2.3 deployed without a manifest, 1.2.4 the unsealed candidate, tags stopping at v1.1.1); the changelog relabel convention and its unit test; the staging continuity feed's observed cadence and why the reference model would reject it; the continuity monitor and named failure states; the same-origin recorded fallback; the `npm run system:check` command in place of an argument npm swallows.
Rebased every README, SECURITY and integration-guide citation moved by the manipulator section, the published-surface table and the release-step text, and repointed drifted unanchored citations into the manifest generator, continuity verifier, staging feed, fallback and Playwright configuration, mostly to anchored form. Replaced the stale simulator citation that pointed at hero markup with anchored evidence-section ids.
Boundary: documentation and release labelling only. No authority, evidence or contract byte changed. README.md, SECURITY.md, CHANGELOG.md, VERSION, guides/INTEGRATION.md and the new `.well-known/security.txt` are release-pinned and need release-aware validation before sealing.
