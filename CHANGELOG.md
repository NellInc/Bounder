# Changelog

## 1.1.0 · 2026-09-01

Agent control plane, explicit producer provenance, and Guardian and Fleet
observability reference.

### Changed

1. A validated system descriptor now owns components, roles, artifacts, authority boundaries, commands, proof classes, impact rules, and observability budgets.
2. Inspection, changed-path planning, generated task routes, generated CI impact data, focused verification, and aggregate verification emit compact machine-readable state and receipts.
3. The private Go producer and public website publisher now have distinct immutable identities. Clean producer export regenerates three published artifacts and checks 13 byte-identical shared contracts.
4. Release manifest v2 records producer inputs and outputs, publisher source, build proof, recorded observations, deployment status, and live-observation status without changing historical manifests.
5. Guardian heartbeat, Fleet snapshot, Fleet transition, and telemetry-envelope contracts now have deterministic validation, replay, rollback, expiry, fault, privacy, scheduling, and 10,000-Guardian reference-performance tests.
6. Browser entry points are stable composition facades with narrow policy, transport, receipt, Fleet, resilience, UI, and simulator ownership seams.
7. The 16-Guardian Fleet laboratory and 100-Guardian staging pilot remain explicitly classified as recorded observations.

### Proof limits

1. The producer repository is private, so independent public regeneration requires access or a future public mirror or reviewable source bundle.
2. Deployed Guardian performance, Fleet backend integration, hardware safety, certification, and human, legal, rights, and regulatory review remain unverified.
3. This local candidate does not establish deployment or live-byte parity.

## 1.0.4 · 2026-08-25

Browser continuity-proof hotfix.

### Fixed

1. Live proof transport deadlines and freshness leases now invoke native browser timers with the correct `Window` receiver, restoring the signed 100-Guardian proof on the homepage.
2. Chromium acceptance now exercises the default browser timer path so an illegal native-function invocation cannot silently downgrade valid live evidence again.
3. Release generation now pins the immutable v1.0.3 manifest and provenance, allowing subsequent release manifests to be sealed without weakening historical integrity checks.

## 1.0.3 · 2026-08-20

Adversarial correctness and evidence-contract hardening for the simulation,
browser runtime, release tooling, and automated acceptance gates.

### Changed

1. Receipt, Fleet, resilience, staging, continuity, policy, and checkpoint inputs now use exact bounded contracts with canonical timestamps, strict provenance relations, immutable snapshots, and fail-closed error states.
2. Network readers enforce exact origins and media types, cumulative byte and chunk limits, authoritative deadlines, abort cleanup, fatal UTF-8 decoding, and protection from late or reordered completions.
3. The simulator independently gates receipt and Fleet readiness, validates every recorded decision before enabling controls, rejects malformed or partial event streams, and preserves local evidence when optional Fleet data fails.
4. Fleet resilience mappings are deterministic across the 100-Guardian pilot, including exact six-canary behavior, while recorded Fleet signatures are explicitly labelled unauthenticated because the fixture does not publish the audit public key.
5. Route collision checks use constant-work exact slab clipping against frozen visible building bounds and reject malformed, mutable, nonfinite, or resource-exhausting geometry.
6. Policy round-trip verification re-evaluates the signed policy against snapshotted request state, evidence, and global rules, preserves nanosecond time semantics, and prevents stale asynchronous results from changing the interface.
7. Every published JSON Schema now pins practical size, shape, time, encoding, scenario, ordering, and relational constraints, with local cryptographic verification of the published signed vectors.
8. Publication and manifest generation reject symlinks, aliases, special files, resource exhaustion, corrupt history, concurrent mutation, ambiguous filesystem outcomes, and ownership races without damaging a prior valid artifact.
9. Browser acceptance always builds and serves the allowlisted `_site` artifact, and now covers readiness races, malformed evidence, stream fallback, visibility, WebGL loss, the full operator tour, embedded-message trust, inline query states, accessibility, and mobile layout.
10. Unit coverage uses an all-source, per-file gate of 85% lines, 75% branches, and 85% functions. Weak implementation-text assertions duplicated by behavior tests were removed.
11. GitHub Pages separates unprivileged verification from the privileged deployment job, and both quality workflows gate the exact dependency install, strong unit coverage, allowlisted build, design lint, and Chromium acceptance.

## 1.0.2 · 2026-08-12

Repository-wide trust and publication hardening. The simulator decision model and
canonical evidence fixtures are unchanged.

### Changed

1. GitHub Pages now deploys an explicit public allowlist, excluding historical snapshots, tests, working assets, and repository automation.
2. Deployment verifies the test suite before assembling the public artifact.
3. Security guidance now describes this repository's actual static-site and simulator threat surface, with a working private-reporting route.
4. Documentation consistently names the canonical `NellInc/Bounder` repository.
5. Canonical pages publish a strict cross-origin referrer policy, and sitemap modification dates reflect the update.
6. Playwright and axe-core development dependencies were refreshed to their current compatible releases.
7. New regression tests pin publication boundaries, local references, canonical metadata, and repository guidance.
8. Privileged GitHub Actions now use immutable commit pins; invalid checkout v7 references were replaced with the verified v6 release.
9. The footer is timeless, removing an annual bot that would have changed release-pinned pages and broken manifest verification.

## 1.0.1 · 2026-07-23

Site polish and link-integrity patch. No changes to the interlock, receipts, or
simulator behaviour. Ships together with the staging-evidence work merged on
main since 1.0.0 (integrity-pinned Bounder staging pilot, signed live
continuity feed, GitHub Pages Actions deploy, accessible page transitions).

### Fixed

1. Canonical header and footer navigation across all pages (previously every page carried a different link set), pinned by a new browser test.
2. All thirteen repository links now point to the canonical `NellInc/Bounder` (previously the retired `NellWatson/Bounder` mirror).
3. Security-policy link resolves: `SECURITY.md` ported from the retired mirror and linked on `main`.
4. Brand emphasis words render in the display face (`--font-heading` referenced an undefined token).
5. Twitter-card image alt text matches the actual Open Graph image; homepage card gained its missing alt.
6. Interior-page `theme-color` matches the rendered white surface.
7. Keyboard focus ring uses ink on light interior pages (lime was ~1.4:1 on white).
8. Accessibility (axe) release gate extended to contact, privacy, terms, and 404 pages.
9. Release manifest v1.0.1 re-pins published artifacts with the canonical-interlock reference corrected to `NellInc/Bounder@main`.

## 1.0.0 · 2026-07-15

First release of Bounder as a simulation-only physical-interlock reference architecture.

### Included

1. Widescreen Three.js town and Fleet simulator with keyboard navigation.
2. Deterministic Go-generated decision receipts and public schemas.
3. Civilian, friendly-force, protected-place, humanitarian, surrender, incapacitation, identification, proportionality, authorization, operational, weather, link, and replay scenarios.
4. Sixteen-Guardian Creed Space Fleet evidence and resilience replay.
5. Local Ed25519 verification of the cross-language signed Fleet vector.
6. Evidence-only fallback when WebGL is unavailable.
7. Browser accessibility, responsive-layout, failure-state, and interaction release gates.
8. Apache License 2.0 licensing and attribution.
9. SHA-256 release manifest pinned to the merged canonical interlock commit.
