# Site Architecture

<!-- wiki:type = system -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-05-23 -->
<!-- wiki:updated = 2026-09-03 -->
<!-- wiki:status = active -->

## Summary

Bounder.io is the static public verification and presentation layer for a simulation-only physical-interlock reference architecture. The root source includes a Three.js simulator, recorded decision and Fleet evidence, strict browser verification, a signed live continuity view, published JSON Schemas, and an accessible evidence fallback. (`README.md:1-45`; `simulator-bootstrap.js:28-49`)

## Source and Archive Boundary

The root pages and modules are the only active site source. The `docs/` tree is a preserved Squarespace-era snapshot with search exclusion and no production support. (`README.md:47-53 "preserved Squarespace-era clone"`; `SECURITY.md:3-10`; `tests/site-quality.test.js:48-54`)

The publication build uses an explicit recursive allowlist that excludes `docs/`, tests, repository automation, temporary design assets, and the wiki. It copies the accepted tree into `_site/` and verifies the promoted artifact byte for byte. (`scripts/build-site.mjs:10-19 "canonicalPublicPaths"`; `scripts/build-site.mjs:350-362`; `README.md:151-157 "deliberately allowlisted artifact"`)

The build takes an exclusive publication lock at `<output>.lock` and records its owner pid inside it. Ownership begins at the `mkdir`, not at the owner write, so an owner write that fails on a full or read-only filesystem still leaves a lock this build knows it holds and will release, rather than an ownerless directory that blocks every later build. A lock with no recorded owner is treated as held, because a peer may be between its `mkdir` and its owner write and stealing it there would let two builds promote at once. Only `ESRCH` proves the owner exited; `EPERM` is a live process owned by another user. (`scripts/build-site.mjs:540-541 "LOCK_OWNER_FILE"`; `scripts/build-site.mjs:682-689 "Ownership begins at mkdir"`; `scripts/build-site.mjs:555-563 "Only ESRCH proves the owner is gone."`; `scripts/build-site.mjs:713-729 "a peer may be between its mkdir"`)

Reclaiming a dead owner's lock is an atomic rename onto a unique `.stale-*` name, not a remove followed by a fresh `mkdir`. Two builders that both read the same dead pid would otherwise both proceed, and the loser's orphan sweep would delete the winner's live stage. Exactly one builder wins the rename; the loser sees the directory already gone and reports the lock as held. (`scripts/build-site.mjs:690-707 "A rename is the atomic claim"`)

While the lock is held the build sweeps orphaned `.stage-*` and `.backup-*` siblings left by an interrupted run, and deliberately preserves `.failed-*` quarantine trees, which are rollback evidence rather than litter. (`scripts/build-site.mjs:564-586 "sweepOrphanedScratch"`)

`SIGINT` and `SIGTERM` release the stage and the lock before the signal is re-raised — except during promotion, the one window where cleaning up is worse than not doing so. Removing the stage mid-promotion, or dying between the backup and the rename, can leave the published artifact half-replaced, so a signal arriving then is recorded and re-raised only after promotion has settled and the normal cleanup has run. (`scripts/build-site.mjs:731-754 "Release the lock and the stage on interruption."`; `scripts/build-site.mjs:734-741 "Promotion is the one window where cleaning up is worse than not"`; `scripts/build-site.mjs:822-824 "A signal deferred through promotion is re-raised only now"`)

## Runtime Decomposition

```text
index.html
  +-- site.js
  +-- continuity-evidence.js
  +-- simulator.html?embed=1

simulator.html
  +-- simulator-bootstrap.js
        +-- simulator.js
        |     +-- simulator-world.js
        |     +-- simulator-contracts.js
        |     +-- staging-feed.js
        |           +-- runtime/json/policy-json.js
        +-- simulator-fallback.js
              +-- simulator-contracts.js
  +-- ui/policy-roundtrip-panel.js
        +-- runtime/policy/core.js
```

The imports establish this dependency shape. The UI seam, not the policy runtime, mounts the round-trip panel. (`simulator.html:375 "ui/policy-roundtrip-panel.js"`; `simulator-bootstrap.js:28-49`; `simulator/controller.js:1-12`; `simulator-fallback.js:1-8`; `runtime/simulator/contracts-core.js:1-1`; `staging-feed.js:1-1`)

## Component Map

| Surface | Responsibility | Inputs | Output or effect | Safe failure |
|---|---|---|---|---|
| `continuity-evidence.js` | Verify and lease signed aggregate live proof | Bounded cross-origin evidence envelope | `LIVE_VERIFIED` homepage status | Recorded or unavailable state |
| `policy-roundtrip.js` | Strict JSON, exact policy signature, schema relations, request re-evaluation | Published or local policy vector | Local verification result | Authority held |
| `simulator-contracts.js` | Exact receipt, Fleet, resilience, URL, and transport contracts | Same-origin JSON and optional streams | Immutable validated models | Reject input |
| `staging-feed.js` | Load optional read-only staging pilot evidence | Configured URL or recorded fallback | Validated Fleet projection | Recorded fallback |
| `simulator-world.js` | Own finite world geometry and collision checks | Canonical route waypoints | Collision-free route model | Explicit rejection |
| `simulator.js` | Render scene, evidence, tour, Fleet, and resilience state | Validated models | Interactive evidence presentation | Stop animation and fallback |
| `simulator-fallback.js` | Present receipts without WebGL | Same receipt bundle | Accessible evidence view | Unavailable state |
| `scripts/build-site.mjs` | Assemble the public inventory | Explicit root allowlist | Verified `_site` tree | Preserve prior valid artifact |
| `scripts/generate-release-manifest-v2.mjs` | Seal a release from an existing publisher commit plus producer and verification receipts | Publisher commit, producer-derivation receipt, verification receipt | Immutable manifest v2 | Refuse to seal on receipt or provenance mismatch |
| `scripts/generate-release-manifest.js` | Historical v1 generator, retained only for the byte-immutable v1 records | Version, source commit, pinned paths | Immutable v1 manifest | Exclusive rollback and no target |

The module exports, browser structure, and build code define these roles. (`continuity-evidence.js:198-503`; `runtime/policy/core.js:168-995`; `runtime/simulator/contracts-core.js:197-849`; `staging-feed.js:112-463`; `simulator-world.js:7-143`; `scripts/build-site.mjs:365-520`; `scripts/generate-release-manifest.js:715-928`; `scripts/generate-release-manifest-v2.mjs:101-170`)

## Evidence Modes

1. **Recorded receipts:** deterministic same-origin decisions drive every simulator scenario. (`README.md:28 "Deterministic decisions generated by the canonical Go interlock"`; `simulator/controller.js:849-862 "loadReceiptBundle"`)
2. **Recorded Fleet pilot:** a local evidence bundle supports fleet and resilience views. (`README.md:26 "Recorded 100-Guardian pilot"`; `simulator/controller.js:1205-1243 "loadPilotEvidence"`)
3. **Optional staging feed:** bounded external data can replace the recorded pilot only after validation; failure retains the fallback. (`staging-feed.js:277-463`)
4. **Optional resilience stream:** same-origin or loopback events can drive the lab; malformed or absent streams fall back to the committed timeline. (`runtime/simulator/contracts-core.js:763-849`; `simulator/controller.js:1110-1125 "resilience stream timed out"`)
5. **Live continuity proof:** the homepage verifies a signed aggregate envelope and expires it when its lease ends. (`index.html:14-16`; `continuity-evidence.js:260-295`; `continuity-evidence.js:439-503`)
6. **Local policy laboratory:** the browser verifies the published Fleet vector and recorded round trip without creating authority. (`guides/INTEGRATION.md:47-57 "Inspection is entirely local"`)

## Publication Pipeline

```text
source tree
   |
   +--> unit coverage
   +--> design lint
   +--> allowlisted build --> _site
                                |
                                +--> Chromium acceptance
                                |
                                +--> Pages artifact upload
                                           |
                                           +--> privileged deploy
```

The Pages workflow keeps verification in an unprivileged job and grants Pages and identity permissions only to the dependent deploy job. (`.github/workflows/deploy-pages.yml:19-58`)

Every published page carries a `Content-Security-Policy` `<meta>` element. GitHub Pages emits no response headers, so a meta policy is the only enforcement route available, and each inline script is allowed by its own SHA-256 hash rather than by `'unsafe-inline'`. `tests/page-security.test.js` recomputes those hashes, rejects a hash left behind after its script is gone, forbids reintroduced inline handlers and style attributes, and requires the configured continuity-feed origin to match the origin `connect-src` permits. Directives a meta policy cannot carry — `frame-ancestors` and `report-to` — are therefore undelivered, so the site claims no clickjacking protection or violation reporting. (`index.html:8 "Content-Security-Policy"`; `tests/page-security.test.js:8-11 "GitHub Pages cannot emit response headers"`; `tests/page-security.test.js:49-63 "dead policy weight"`; `SECURITY.md:46-49 "not delivered"`)

Playwright always builds and serves an isolated `_site` artifact, uses one Chromium worker, disables retries, and refuses reuse of an unrelated server. (`playwright.config.js:3-22`)

## Design System

The root CSS defines system-font families for sans, condensed display, and monospace roles. It applies those tokens across the shared pages and simulator presentation. (`styles.css:12-14 "--font-mono"`; `styles.css:25-29 "font-family: var(--font-sans)"`)

The current canonical domain file contains `www.bounder.io`, matching page canonical and Open Graph metadata. (`CNAME:1`; `README.md:44 "custom domain"`)

## Current Friction

1. `policy-roundtrip.js`, `simulator-contracts.js`, and `simulator.js` each combine several abstraction levels, raising the amount of code an agent must load to change one concern. (`runtime/policy/core.js:168-995`; `runtime/simulator/contracts-core.js:197-849`; `simulator/controller.js:825-1751`)
2. The same evidence concept appears in recorded, staging, continuity, resilience-stream, and policy-laboratory forms. Their proof strength needs one shared state vocabulary. (`index.html:448-470 "continuity-proof"`; `simulator.html:152-253`)
3. Public independent producer regeneration still requires access to the private producer revision or a future public mirror or reviewable source bundle. ([[bounder:seams/evidence-provenance]])
4. Internal guidance previously described the source as having no build system, while release acceptance actually depends on an allowlisted build. (`README.md:88-91 "assembles the exact GitHub Pages payload"`; `scripts/build-site.mjs:10-19 "canonicalPublicPaths"`)

## Working If

This subsystem is working when an agent can identify a page, runtime, evidence mode, trust boundary, and exact gate from one table, while the built artifact contains only the declared public inventory and every failure preserves a visible evidence-only state.

## Provenance

- Sources consulted: `README.md`, `SECURITY.md`, `CNAME`, `index.html`, `simulator.html`, `styles.css`, runtime JavaScript modules, `scripts/build-site.mjs`, `scripts/generate-release-manifest.js`, `scripts/generate-release-manifest-v2.mjs`, `playwright.config.js`, `.github/workflows/deploy-pages.yml`, `tests/site-quality.test.js`, `tests/page-security.test.js`
- Last verified against sources: 2026-09-03

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:seams/evidence-provenance]]
- [[bounder:flows/agent-operating-loop]]
- [[bounder:domain/physical-interlock]]
