# Site Architecture

<!-- wiki:type = system -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-05-23 -->
<!-- wiki:updated = 2026-08-31 -->
<!-- wiki:status = active -->

## Summary

Bounder.io is the static public verification and presentation layer for a simulation-only physical-interlock reference architecture. The root source includes a Three.js simulator, recorded decision and Fleet evidence, strict browser verification, a signed live continuity view, published JSON Schemas, and an accessible evidence fallback. (`README.md:1-36`; `simulator-bootstrap.js:28-49`)

## Source and Archive Boundary

The root pages and modules are the only active site source. The `docs/` tree is a preserved Squarespace-era snapshot with search exclusion and no production support. (`README.md:36-36`; `SECURITY.md:3-10`; `tests/site-quality.test.js:48-54`)

The publication build uses an explicit recursive allowlist that excludes `docs/`, tests, repository automation, temporary design assets, and the wiki. It copies the accepted tree into `_site/` and verifies the promoted artifact byte for byte. (`scripts/build-site.mjs:14-25`; `scripts/build-site.mjs:350-362`; `README.md:107-113`)

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
        |           +-- policy-roundtrip.js
        +-- simulator-fallback.js
              +-- simulator-contracts.js
  +-- policy-roundtrip.js
```

The imports establish this dependency shape. (`simulator-bootstrap.js:28-49`; `simulator/controller.js:1-12`; `simulator-fallback.js:1-8`; `runtime/simulator/contracts-core.js:1-1`; `staging-feed.js:1-1`)

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
| `scripts/generate-release-manifest.js` | Seal pinned source bytes and history | Version, source commit, pinned paths | Immutable manifest | Exclusive rollback and no target |

The module exports, browser structure, and build code define these roles. (`continuity-evidence.js:198-503`; `runtime/policy/core.js:168-995`; `runtime/simulator/contracts-core.js:197-849`; `staging-feed.js:112-463`; `simulator-world.js:7-143`; `scripts/build-site.mjs:365-520`; `scripts/generate-release-manifest.js:715-928`)

## Evidence Modes

1. **Recorded receipts:** deterministic same-origin decisions drive every simulator scenario. (`README.md:20-22`; `simulator/controller.js:825-841`)
2. **Recorded Fleet pilot:** a local evidence bundle supports fleet and resilience views. (`README.md:17-18`; `simulator/controller.js:1174-1219`)
3. **Optional staging feed:** bounded external data can replace the recorded pilot only after validation; failure retains the fallback. (`staging-feed.js:277-463`)
4. **Optional resilience stream:** same-origin or loopback events can drive the lab; malformed or absent streams fall back to the committed timeline. (`runtime/simulator/contracts-core.js:763-849`; `simulator/controller.js:957-1057`)
5. **Live continuity proof:** the homepage verifies a signed aggregate envelope and expires it when its lease ends. (`index.html:14-16`; `continuity-evidence.js:260-295`; `continuity-evidence.js:439-503`)
6. **Local policy laboratory:** the browser verifies the published Fleet vector and recorded round trip without creating authority. (`guides/INTEGRATION.md:43-55`)

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

Playwright always builds and serves an isolated `_site` artifact, uses one Chromium worker, disables retries, and refuses reuse of an unrelated server. (`playwright.config.js:3-22`)

## Design System

The root CSS defines system-font families for sans, condensed display, and monospace roles. It applies those tokens across the shared pages and simulator presentation. (`styles.css:11-13`; `styles.css:28-28`)

The current canonical domain file contains `www.bounder.io`, matching page canonical and Open Graph metadata. (`CNAME:1`; `README.md:107-113`)

## Current Friction

1. `policy-roundtrip.js`, `simulator-contracts.js`, and `simulator.js` each combine several abstraction levels, raising the amount of code an agent must load to change one concern. (`runtime/policy/core.js:168-995`; `runtime/simulator/contracts-core.js:197-849`; `simulator/controller.js:825-1551`)
2. The same evidence concept appears in recorded, staging, continuity, resilience-stream, and policy-laboratory forms. Their proof strength needs one shared state vocabulary. (`index.html:444-469`; `simulator.html:152-253`)
3. Public independent producer regeneration still requires access to the private producer revision or a future public mirror or reviewable source bundle. ([[bounder:seams/evidence-provenance]])
4. Internal guidance previously described the source as having no build system, while release acceptance actually depends on an allowlisted build. (`README.md:55-78`; `scripts/build-site.mjs:14-25`)

## Working If

This subsystem is working when an agent can identify a page, runtime, evidence mode, trust boundary, and exact gate from one table, while the built artifact contains only the declared public inventory and every failure preserves a visible evidence-only state.

## Provenance

- Sources consulted: `README.md`, `SECURITY.md`, `CNAME`, `index.html`, `simulator.html`, `styles.css`, runtime JavaScript modules, `scripts/build-site.mjs`, `scripts/generate-release-manifest.js`, `playwright.config.js`, `.github/workflows/deploy-pages.yml`, `tests/site-quality.test.js`
- Last verified against sources: 2026-08-31

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:seams/evidence-provenance]]
- [[bounder:flows/agent-operating-loop]]
- [[bounder:domain/physical-interlock]]
