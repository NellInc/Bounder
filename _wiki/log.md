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
