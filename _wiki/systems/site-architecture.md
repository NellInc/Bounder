# Site Architecture

<!-- wiki:type = system -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-05-23 -->
<!-- wiki:updated = 2026-09-26 -->
<!-- wiki:status = active -->

## Summary

Bounder.io is the static public verification and presentation layer for a simulation-only physical-interlock reference architecture. The root source includes a Three.js simulator, recorded decision and Fleet evidence, strict browser verification, a signed live continuity view, published JSON Schemas, and an accessible evidence fallback. (`README.md:1-50`; `simulator-bootstrap.js:28-49`)

## Source and Archive Boundary

The root pages and modules are the only active site source. The `docs/` tree is a preserved Squarespace-era snapshot with search exclusion and no production support. (`README.md:57-63 "preserved Squarespace-era clone"`; `SECURITY.md:3-10`; `tests/site-quality.test.js:48-54`)

The publication build uses an explicit recursive allowlist that excludes `docs/`, tests, repository automation, temporary design assets, and the wiki. It copies the accepted tree into `_site/` and verifies the promoted artifact byte for byte. (`scripts/build-site.mjs:10-19 "canonicalPublicPaths"`; `scripts/build-site.mjs:350-362`; `README.md:167-173 "deliberately allowlisted artifact"`)

The build takes an exclusive publication lock at `<output>.lock` and records its owner pid inside it. Ownership begins at the `mkdir`, not at the owner write, so an owner write that fails on a full or read-only filesystem still leaves a lock this build knows it holds and will release, rather than an ownerless directory that blocks every later build. A lock with no recorded owner is treated as held, because a peer may be between its `mkdir` and its owner write and stealing it there would let two builds promote at once. Only `ESRCH` proves the owner exited; `EPERM` is a live process owned by another user. (`scripts/build-site.mjs:540-541 "LOCK_OWNER_FILE"`; `scripts/build-site.mjs:682-689 "Ownership begins at mkdir"`; `scripts/build-site.mjs:555-563 "Only ESRCH proves the owner is gone."`; `scripts/build-site.mjs:713-729 "a peer may be between its mkdir"`)

Reclaiming a dead owner's lock is an atomic rename onto a unique `.stale-*` name, not a remove followed by a fresh `mkdir`. Two builders that both read the same dead pid would otherwise both proceed, and the loser's orphan sweep would delete the winner's live stage. Exactly one builder wins the rename; the loser sees the directory already gone and reports the lock as held. (`scripts/build-site.mjs:690-707 "A rename is the atomic claim"`)

While the lock is held the build sweeps orphaned `.stage-*` and `.backup-*` siblings left by an interrupted run, and deliberately preserves `.failed-*` quarantine trees, which are rollback evidence rather than litter. (`scripts/build-site.mjs:564-586 "sweepOrphanedScratch"`)

`SIGINT` and `SIGTERM` release the stage and the lock before the signal is re-raised — except during promotion, the one window where cleaning up is worse than not doing so. Removing the stage mid-promotion, or dying between the backup and the rename, can leave the published artifact half-replaced, so a signal arriving then is recorded and re-raised only after promotion has settled and the normal cleanup has run. (`scripts/build-site.mjs:731-754 "Release the lock and the stage on interruption."`; `scripts/build-site.mjs:734-741 "Promotion is the one window where cleaning up is worse than not"`; `scripts/build-site.mjs:822-824 "A signal deferred through promotion is re-raised only now"`)

## Runtime Decomposition

```text
index.html -> site.js + continuity-evidence.js + embedded simulator
simulator.html
  +-- simulator-bootstrap.js -> simulator.js -> simulator/controller.js
  |     +-- simulator/scene.js + simulator-world.js
  |     +-- runtime/receipts, fleet, resilience, transport
  |     +-- ui/fleet-view.js + staging-feed.js
  |     +-- simulator-fallback.js
  +-- ui/workbench.js
  +-- ui/policy-roundtrip-panel.js -> ui/policy-panel.js
        +-- runtime/policy/contracts.js + roundtrip.js + presentation-state.js
        +-- runtime/json/policy-json.js + runtime/transport/bounded-json.js
```

The controller and UI imports establish this dependency shape. (`simulator/controller.js:4 "createTownScene"`; `ui/policy-panel.js:1-6`; `ui/policy-roundtrip-panel.js:1 "policy-panel.js"`) The UI seam, not the policy runtime, mounts the round-trip panel. (`simulator.html:486 "ui/policy-roundtrip-panel.js"`; `simulator-bootstrap.js:28-49`; `simulator/controller.js:1-14`; `simulator-fallback.js:1-8`; `runtime/simulator/contracts-core.js:1-1`; `staging-feed.js:1-1`)

## Component Map

| Surface | Responsibility | Inputs | Output or effect | Safe failure |
|---|---|---|---|---|
| `continuity-evidence.js` | Verify, lease and refresh signed aggregate live proof | Bounded cross-origin evidence envelope | `LIVE_VERIFIED` homepage status | Named unavailable state (feed offline, proof expired, cannot verify here, not verified) with em-dash metrics and a link to the recorded run |
| `policy-roundtrip.js` | Strict JSON, exact policy signature, schema relations, request re-evaluation | Published or local policy vector | Local verification result | Authority held |
| `simulator-contracts.js` | Exact receipt, Fleet, resilience, URL, and transport contracts | Same-origin JSON and optional streams | Immutable validated models | Reject input |
| `staging-feed.js` | Load optional read-only staging pilot evidence | Configured URL or recorded fallback | Validated Fleet projection | Recorded fallback |
| `simulator-world.js` | Own finite world geometry and collision checks | Canonical route waypoints | Collision-free route model | Explicit rejection |
| `simulator.js` | Render scene, evidence, tour, Fleet, and resilience state | Validated models | Interactive evidence presentation | Stop animation and fallback |
| `simulator-fallback.js` | Present receipts and the recorded Fleet pilot without WebGL | Same receipt bundle and staging pilot | Accessible evidence view | Unavailable state; the bootstrap shows `bootstrap_unavailable` with a reload control when no view can load |
| `scripts/build-site.mjs` | Assemble the public inventory | Explicit root allowlist | Verified `_site` tree | Preserve prior valid artifact |
| `scripts/generate-release-manifest-v2.mjs` | Seal a release from an existing publisher commit plus producer and verification receipts | Publisher commit, producer-derivation receipt, verification receipt | Immutable manifest v2 | Refuse to seal on receipt or provenance mismatch |
| `scripts/generate-release-manifest.js` | Historical v1 generator, retained only for the byte-immutable v1 records | Version, source commit, pinned paths | Immutable v1 manifest | Exclusive rollback and no target |

The module exports, browser structure, and build code define these roles. (`continuity-evidence.js:158 "verifyContinuityEnvelope"`; `continuity-evidence.js:514 "startContinuityMonitor"`; `runtime/policy/contracts.js:145 "verifyEnvelope"`; `runtime/policy/roundtrip.js:44 "validateRoundTripEvidence"`; `runtime/simulator/contracts-core.js:197-849`; `staging-feed.js:117 "validatePilotEvidence"`; `staging-feed.js:438 "loadPilotEvidence"`; `simulator-world.js:7-143`; `scripts/build-site.mjs:365-520`; `scripts/generate-release-manifest.js:715-928`; `scripts/generate-release-manifest-v2.mjs:175-257 "buildManifestV2"`)

## Contact and rendering lifecycle

The contact page progressively enhances its existing Formspree form through `ui/contact-form.js`. A successful HTTP response must also contain a string `next` and no error fields before the page displays acceptance; the browser does not follow that returned URL. Query parameters cannot display success. Failure keeps the entered message and exposes an explicit hosted submission option, with a warning that retrying an unconfirmed submission could duplicate a message. Native form submission remains available without JavaScript. This describes source behavior only; actual provider acceptance and recipient delivery require separate live evidence. (`contact.html:101 "https://formspree.io/f/xqalyykn"`; `ui/contact-form.js:13-17`; `ui/contact-form.js:25-54`)

The contact CSP permits connections to the same origin and Formspree. That submission channel is separate from local policy-file inspection. (`contact.html:8 "connect-src"`; `guides/INTEGRATION.md:128 "Selecting a JSON file reads its contents in the browser and does not upload it."`)

The simulator schedules rendering on demand: after a frame it continues only while a flight plays (never under reduced motion, where Play jumps to the recorded decision), a navigation key is held, or the camera is moving, otherwise it marks the animation idle; a finished flight stops playback so the loop idles on the recorded state. The scheduler waits for evidence bootstrap to settle and for a visible, operational scene; interaction can request another frame while paused. An initially open fault disclosure selects its first recorded fault after Fleet evidence is ready. These are presentation transitions, never changes to policy authority. (`simulator/controller.js:1454 "if ((playing && !reduceMotion) || pressedNavigationKeys.size"`; `simulator/controller.js:1609 "Reduced motion: no flight"`; `simulator/controller.js:1464 "bootstrapSettled"`; `simulator/controller.js:1844 "bootstrapSettled = true"`; `simulator/controller.js:1837 "fault-replay"`)

## Evidence Modes

1. **Recorded receipts:** deterministic same-origin decisions drive every simulator scenario. (`README.md:30 "Deterministic decisions generated by the canonical Go interlock"`; `simulator/controller.js:1786 "loadReceiptBundle"`)
2. **Recorded Fleet pilot:** a local evidence bundle supports fleet and resilience views. (`README.md:28 "Recorded 100-Guardian pilot"`; `simulator/controller.js:821 "loadPilotEvidence"`)
3. **Optional staging feed:** bounded external data can replace the recorded pilot only after validation; failure retains the fallback. The recorded fallback loads from any same-origin http(s) page, while the live URL stays behind the host allowlist. (`staging-feed.js:283 "resolveFeedURL"`; `staging-feed.js:300 "resolveRecordedURL"`; `staging-feed.js:438 "loadPilotEvidence"`)
4. **Optional resilience stream:** same-origin or loopback events can drive the lab; malformed or absent streams fall back to the committed timeline. (`runtime/simulator/contracts-core.js:763-849`; `simulator/controller.js:711 "resilience stream timed out"`)
5. **Live continuity proof:** the homepage verifies a signed aggregate envelope and expires it when its lease ends. A monitor re-reads the feed a minute before the lease ends and at least every five minutes, backs off after failures, pauses in hidden tabs, and keeps a still-valid proof on screen until its own expiry; a repeated proof counts as no newer proof, and rollback is still refused. Each failure is named rather than shown as recorded figures in live cells, and a browser without Ed25519 WebCrypto reads "Cannot verify here". Without JavaScript, a `<noscript>` note replaces the loading state. (`index.html:18-20 "bounder-continuity-feed"`; `index.html:488 "continuity-noscript"`; `continuity-evidence.js:399 "createContinuityLeaseController"`; `continuity-evidence.js:490-498 "CONTINUITY_REFRESH"`; `continuity-evidence.js:500 "classifyContinuityFailure"`; `continuity-evidence.js:514 "startContinuityMonitor"`)
6. **Local policy laboratory:** the browser verifies the published Fleet vector and recorded round trip without creating authority. (`guides/INTEGRATION.md:74-84 "Inspection is entirely local"`)

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

Every published page carries a `Content-Security-Policy` `<meta>` element. GitHub Pages emits no response headers, so a meta policy is the only enforcement route available, and each inline script is allowed by its own SHA-256 hash rather than by `'unsafe-inline'`. `tests/page-security.test.js` recomputes those hashes, rejects a hash left behind after its script is gone, forbids reintroduced inline handlers and style attributes, and requires the configured continuity-feed origin to match the origin `connect-src` permits. Directives a meta policy cannot carry — `frame-ancestors` and `report-to` — are therefore undelivered, so the site claims no clickjacking protection or violation reporting. (`index.html:8 "Content-Security-Policy"`; `tests/page-security.test.js:8-11 "GitHub Pages cannot emit response headers"`; `tests/page-security.test.js:49-63 "dead policy weight"`; `SECURITY.md:38-41 "not delivered"`)

Playwright always builds and serves an isolated `_site` artifact, uses one Chromium worker, disables retries, and refuses reuse of an unrelated server. (`playwright.config.js:3-24`)

Failure traces retain DOM snapshots and sources without automatic filmstrip screenshots. Explicit workspace, mobile and Fleet screenshots are captured by the browser acceptance tests. This avoids incidental GPU readbacks during verification; it does not disable rendering or alter assertions. (`playwright.config.js:15-17`; `tests/browser/workspace.spec.js:18 "workspace-desktop.png"`)

## Design System

The root CSS defines font tokens for sans, condensed display, and monospace roles: system stacks led by Avenir Next and Menlo, plus a self-hosted OFL condensed fallback (`assets/fonts/`) for the display role on systems without Avenir Next Condensed. It applies those tokens across the shared pages and simulator presentation. (`styles.css:12-19 "--font-mono"`; `styles.css:27-29 "Bounder Display"`; `styles.css:46-50 "font-family: var(--font-sans)"`)

The current canonical domain file contains `www.bounder.io`, matching page canonical and Open Graph metadata. (`CNAME:1`; `README.md:49 "custom domain"`)

## Current Friction

1. Compatibility facades preserve existing imports while named policy modules own validation, evaluation, round-trip matching, and presentation state. The controller delegates scene creation and Fleet row rendering; controller orchestration and the simulator contract implementation remain broader maintenance surfaces. (`runtime/policy/contracts.js:145 "verifyEnvelope"`; `runtime/policy/roundtrip.js:44 "validateRoundTripEvidence"`; `runtime/simulator/contracts-core.js:197-849`; `simulator/controller.js:4 "createTownScene"`; `ui/policy-panel.js:44 "bootstrapPolicyRoundTrip"`)
2. The same evidence concept appears in recorded, staging, continuity, resilience-stream, and policy-laboratory forms. Their proof strength needs one shared state vocabulary. (`index.html:464-495 "continuity-proof"`; `simulator.html:315 "fleet-evidence"`; `simulator.html:344 "policy-roundtrip-title"`; `simulator.html:384 "fault-replay"`; `simulator.html:407 "continuity-proof-title"`)
3. Public independent producer regeneration still requires access to the private producer revision or a future public mirror or reviewable source bundle. ([[bounder:seams/evidence-provenance]])
4. Internal guidance previously described the source as having no build system, while release acceptance actually depends on an allowlisted build. (`README.md:103-106 "assembles the exact GitHub Pages payload"`; `scripts/build-site.mjs:10-19 "canonicalPublicPaths"`)

## Working If

This subsystem is working when an agent can identify a page, runtime, evidence mode, trust boundary, and exact gate from one table, while the built artifact contains only the declared public inventory and every failure preserves a visible evidence-only state.

## Provenance

- Sources consulted: `README.md`, `SECURITY.md`, `CNAME`, `index.html`, `simulator.html`, `styles.css`, runtime JavaScript modules, `scripts/build-site.mjs`, `scripts/generate-release-manifest.js`, `scripts/generate-release-manifest-v2.mjs`, `playwright.config.js`, `.github/workflows/deploy-pages.yml`, `tests/site-quality.test.js`, `tests/page-security.test.js`
- Last verified against sources: 2026-09-07

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:seams/evidence-provenance]]
- [[bounder:flows/agent-operating-loop]]
- [[bounder:domain/physical-interlock]]
