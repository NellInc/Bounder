# Bounder System Architecture

<!-- wiki:type = system -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-08-31 -->
<!-- wiki:updated = 2026-09-03 -->
<!-- wiki:status = active -->

## Summary

Bounder is a system of narrowing authority, local decision, safe physical response, auditable evidence, public demonstration, and release assurance. The public website in this repository is the presentation and publication projection of that system. It verifies and displays evidence; it carries no actuator transport and does not originate operational authority. (`README.md:113-119 "The simulator never decides whether a scenario is allowed."`; `guides/INTEGRATION.md:7-14`; `SECURITY.md:3-10`)

## North Star

Every transition down the tower may preserve or narrow authority. No transition may silently broaden it.

```text
human and organizational intent
             |
             v
typed protective policy
             |
             v
signed, device-bound envelope
             |
             v
local verification plus fresh state
             |
             v
bounded decision
             |
             v
device-specific safe response
             |
             +------> signed evidence
                            |
                            v
                 verification and presentation
                            |
                            v
                    release and live proof
```

The policy envelope is bound to exact signed bytes, issuer, subject, sequence, and time. The adapter receives a bounded result and owns the platform-specific safe response. Audit delivery cannot change the local decision. (`guides/INTEGRATION.md:9-14`; `guides/INTEGRATION.md:90 "An adapter should be narrow, deterministic, separately tested, and fail safe"`; `guides/INTEGRATION.md:97 "Audit delivery failure cannot change the local decision."`)

## Abstraction Tower

| Level | Question answered | Input | Output | Authority owner | Failure default |
|---|---|---|---|---|---|
| 0. Safety outcome | What physical state is acceptable here? | Hazard analysis and platform constraints | Approved safe-state vocabulary | Deployment owner and adapter reviewer | No inferred universal response |
| 1. Governance intent | Which protective conditions apply? | Organization, team, mission, and device rules | Resolved intent | Creed Space Fleet | No policy projection |
| 2. Machine authority | What exact authority is authentic and current? | Typed policy plus Fleet signature | Verified device-bound policy | Signed policy issuer | No new permission |
| 3. Local decision | Does the requested action satisfy current constraints? | Verified policy, request, local state, fresh evidence | Allow or hold decision | Bounder Guardian | Hold |
| 4. Physical response | What safe transition should this platform perform? | Bounded decision and device state | Narrow adapter command or no state change | Platform adapter | Device-specific safe state |
| 5. Evidence | What happened, under which inputs and authority? | Decision and immutable snapshots | Receipt, checkpoint, audit, or continuity envelope | Producing runtime and signing identity | Evidence unavailable |
| 6. Verification and presentation | What can a browser establish from supplied evidence? | Same-origin fixtures or bounded live evidence | Labelled local verification and visualization | Browser verifier | Unavailable or recorded fallback |
| 7. Publication assurance | Which exact source bytes became the site? | Allowlisted source tree | Byte-checked `_site` artifact and release record | Site repository and CI | No deployment |
| 8. Live assurance | What is actually reachable now? | Deployed bytes and live evidence | Time-bounded operational observation | Hosting and evidence services | Unverified current state |

Levels 1 through 5 follow the published authority flow and fail-safe invariants. Levels 6 through 8 are the website and release projection implemented by this repository. (`guides/INTEGRATION.md:7-27`; `README.md:63-86`; `.github/workflows/deploy-pages.yml:19-58`)

## System Planes

The levels form a tower. Four planes connect them without changing their ownership.

### Authority plane

Authority flows downward through a closed policy schema, exact signature verification, device binding, monotonic sequence, validity window, local evaluation, and a narrow adapter handoff. The browser can inspect this flow, while operational decisions remain outside the browser. (`guides/INTEGRATION.md:29-53`; `runtime/policy/core.js:1-7`; `runtime/policy/core.js:438-475`; `runtime/policy/core.js:593-672`)

### Evidence plane

Receipts, Fleet audit records, checkpoints, resilience events, recorded pilots, and continuity envelopes describe decisions and system health. They are evidence about authority use. They are never authority for a new physical action. (`guides/INTEGRATION.md:67-68 "They never grant, broaden, or revoke permission."`; `runtime/simulator/contracts-core.js:148-164`; `continuity-evidence.js:198-295`)

Private Guardian heartbeats, Fleet snapshots, and Fleet transition events extend this plane with operational diagnosis. Their state classifications remain observational and cannot substitute for local policy, evidence, checkpoint, or lease rules. (`runtime/observability/guardian-fleet-state.js:159-194 "deriveGuardianStateUnchecked"`; `runtime/observability/guardian-fleet-state.js:286-359 "createGuardianHeartbeatGuard"`)

### Presentation plane

The simulator loads recorded receipts, optional Fleet evidence, local resilience timelines, a bounded live stream, and a signed continuity feed. Its visual controls select, replay, and verify evidence. They do not recompute the canonical operational decision. (`README.md:15-30`; `simulator/controller.js:849-870 "loadReceiptBundle"`; `simulator/controller.js:1205-1243 "loadPilotEvidence"`)

The presentation seams own their own mounting. `simulator.html` loads `ui/policy-roundtrip-panel.js` directly, and that UI module is the only thing that calls `bootstrapPolicyRoundTrip`; importing `runtime/policy/core.js` now has no DOM side effect. `staging-feed.js` likewise imports `parseStrictJSON` from the narrow `runtime/json/policy-json.js` seam rather than from the policy facade. (`simulator.html:375 "ui/policy-roundtrip-panel.js"`; `ui/policy-roundtrip-panel.js:5-6 "The UI seam owns mounting the panel."`; `staging-feed.js:1 "runtime/json/policy-json.js"`)

### Assurance plane

Schemas, exact validators, unit tests, browser acceptance, the public allowlist, release manifests, CI, and post-deployment checks establish different proof classes. Passing one class cannot be promoted into another. (`package.json:6-22 "release:manifest:v2"`; `scripts/build-site.mjs:10-19`; `scripts/generate-release-manifest-v2.mjs:101-130`; `SECURITY.md:51-62 "Passing software tests does not establish any of those properties."`)

## Stable Component Roles

| Role | Current surface | Owns | Must not own |
|---|---|---|---|
| Policy distributor | Creed Space Fleet integration | Protective policy resolution, signing, distribution, audit storage | Platform commands |
| Decision producer | Canonical Go Guardian described by the integration contract | Signature verification, replay and time checks, local evaluation, receipt production | Website presentation |
| Adapter | Platform-specific integration | Mapping a bounded result to an engineered safe response | Policy composition |
| Evidence publisher | `data/`, `schemas/`, continuity endpoint | Immutable recorded examples and bounded live proof | New operational permission |
| Browser verifier | `runtime/policy/core.js` and `runtime/simulator/contracts-core.js` behind the `policy-roundtrip.js` and `simulator-contracts.js` facades, `staging-feed.js`, `continuity-evidence.js` | Strict local parsing, validation, cryptographic checks, freshness checks | Canonical operational decisions |
| Simulator presenter | `simulator.js`, `simulator-fallback.js`, `simulator-world.js` | Evidence selection, visualization, fault playback, accessible fallback | Hidden decision tables that contradict receipts |
| Site publisher | `scripts/build-site.mjs`, `_site/`, Pages workflow | Exact public inventory and byte-preserving publication | Historical workspace material |
| Release sealer | `scripts/generate-release-manifest-v2.mjs` for new releases, `scripts/generate-release-manifest.js` for the historical v1 format, `release/` | Immutable release history and source-byte hashes | Claims of physical certification or live health |
| Guardian observer | Published heartbeat schema and `runtime/observability/guardian-fleet-state.js` | Private bounded report of one Guardian's state | Any permission change |
| Fleet observer | Published snapshot/event schemas and reference aggregation | Operational state, transitions, and privacy-safe aggregation | Local Guardian decision substitution |
| Agent control plane | `system/`, agent scripts, verification receipts | Task routing, proof planning, and candidate evidence | Publication or runtime authority |

These role boundaries compile the current integration guide, security boundary, module imports, build allowlist, and release generator. (`guides/INTEGRATION.md:3-14`; `SECURITY.md:21-36`; `scripts/build-site.mjs:10-19 "canonicalPublicPaths"`; `scripts/generate-release-manifest-v2.mjs:101-130`)

## Repository Roles and the Provenance Gap

This checkout is the public site repository. It contains static HTML, browser JavaScript, schemas, evidence copies, build tooling, release manifests, and Pages automation. It contains no Go source in its current tree. (`README.md:1-45`; `package.json:1-22`)

Brand source material lives in `design/brand-source/`. It records the descent of the shipped marks in `assets/` and sits outside the publication allowlist, so it never reaches the built artifact. (`design/brand-source/README.md:3-5 "outside the publication"`; `scripts/build-site.mjs:10-19 "canonicalPublicPaths"`)

The public instructions verify producer derivation rather than regenerating and copying. `npm run verify:producer` runs against an explicit clean producer checkout supplied through `BOUNDER_PRODUCER_ROOT` or `--producer-root`, re-derives the three published outputs, and compares the thirteen shared contracts byte for byte; its receipt is what manifest v2 imports as producer provenance. (`README.md:121-131 "The path is not discovered"`; `README.md:96`; `scripts/verify-producer-derivation.mjs:13-31`)

The system descriptor separately lists `../Bounder-from-org-agent-ergonomic` and `../Bounder-Drone` as local producer discovery candidates. They serve read-only orientation in `npm run inspect` only; the derivation gate never consults them and fails fast without an explicit root. (`system/bounder-system.v1.json:24-27`; `scripts/system-inspect.mjs:90-93 "local_discovery"`)

Historical manifest v1 generation calls Git against this repository root and requires every pinned website source byte to match the commit stored in `canonical_interlock`. Manifest v2 verifies the publisher commit separately and imports an exact producer statement from the producer-derivation receipt. (`scripts/generate-release-manifest.js:728-782`; `scripts/generate-release-manifest-v2.mjs:60-91`; `scripts/generate-release-manifest-v2.mjs:101-130`)

**Historical finding:** in manifest v1, `canonical_interlock` functions as website source provenance. It does not independently identify or reproduce the external Go decision producer. Manifest v2 corrects the role model for new releases while leaving every v1 byte unchanged. (`release/bounder-reference-v1.0.4.manifest.json:1-10`; `scripts/generate-release-manifest.js:776-782`; `scripts/generate-release-manifest-v2.mjs:101-130`)

The target provenance model must carry two identities:

1. **Producer provenance:** repository, immutable revision, clean tree, generator command, contract set, input hashes, and output hashes for the decision engine.
2. **Publisher provenance:** repository, immutable revision, build command, public inventory, and output hashes for the website.

Historical manifests remain immutable. Manifest v2 adds this distinction for new releases without rewriting prior records.

The Go producer identity is no longer open. Manifest v2 names it as the `decision_producer` role at private `NellInc/Bounder-from-org`, on `master`, at a full commit, and the system descriptor carries the same statement as a standing hold. What remains open is public reproducibility, not identity: regeneration still requires producer access or a future public mirror or reviewable source bundle. (`release/bounder-reference-v1.1.1.manifest.json:11-16 "decision_producer"`; `system/bounder-system.v1.json:1534 "confirmed at private NellInc/Bounder-from-org on master"`)

## Evidence State Model

Every evidence surface should expose one of these mutually exclusive states:

| State | Meaning | Permitted presentation |
|---|---|---|
| `UNAVAILABLE` | No valid evidence is present | Explain absence and preserve the safe fallback |
| `RECORDED_VERIFIED` | Immutable local evidence passed its contract | Show recorded proof with its producer identity |
| `LIVE_VERIFIED` | A live envelope passed origin, signature, contract, replay, and freshness checks | Show observation time and lease expiry |
| `LIVE_STALE` | Previously valid live evidence exceeded its freshness window | Fall back to recorded evidence and label staleness |
| `LIVE_INVALID` | Live evidence failed transport, signature, shape, identity, or ordering | Reject it and retain the local safe state |
| `AUTHORITY_HELD` | Valid evidence describes a policy or continuity state that cannot grant current permission | Show the reason for hold without converting evidence into authority |

This vocabulary consolidates states already represented by the continuity lease, staging fallback, receipt readiness, policy validity, and simulator fail-closed behavior. (`continuity-evidence.js:417-503`; `staging-feed.js:414-463`; `runtime/policy/core.js:977-995`; `simulator-fallback.js:59-82`)

## Cross-Layer Invariants

1. Policy bytes are verified before parsing can influence authority. (`guides/INTEGRATION.md:9-12`)
2. A stale, replayed, malformed, foreign, or unverified policy grants no new permission. (`guides/INTEGRATION.md:94-97 "Signature failure preserves the last verified unexpired policy and never broadens authority."`)
3. Evidence failure cannot broaden a decision. (`SECURITY.md:32-36`)
4. Browser interaction cannot mint an operational receipt. (`guides/INTEGRATION.md:59-63 "The browser does not create authority or mint a deployment receipt."`)
5. Simulator controls remain disabled until their own required evidence is ready. (`simulator/controller.js:1623-1636 "setScenarioControlsEnabled"`; `simulator/controller.js:1645-1660 "Receipt fixture unavailable"`)
6. Recorded, live, source, deployment, physical, and human assurance remain separately labelled. (`SECURITY.md:51-62 "Passing software tests does not establish any of those properties."`)
7. Public artifacts come only from the explicit allowlist and are checked byte for byte after assembly. (`scripts/build-site.mjs:10-19 "canonicalPublicPaths"`; `scripts/build-site.mjs:350-362`)
8. A release record identifies both the producer lineage and publisher lineage before it claims derivation from the canonical engine. This is the target rule introduced by this design.
9. Heartbeat loss can change Fleet observation but cannot broaden or revoke local authority by itself. (`runtime/observability/guardian-fleet-state.js:286-302 "classifyValidatedGuardianHeartbeat"`; `guides/INTEGRATION.md:67-71 "They never grant, broaden, or revoke permission."`)
10. Public continuity can be projected only from a complete healthy privacy-safe aggregate. (`runtime/observability/guardian-fleet-state.js:541-576 "projectPublicContinuity"`)

## Working If

This architecture is working when an agent can answer, from one navigation path, who owns each decision, which artifact crosses each boundary, what proof validates it, what that proof cannot establish, and which exact command supplies the next stronger proof.

## Provenance

- Sources consulted: `README.md`, `guides/INTEGRATION.md`, `SECURITY.md`, `package.json`, `policy-roundtrip.js`, `simulator-contracts.js`, `simulator.js`, `simulator-fallback.js`, `staging-feed.js`, `continuity-evidence.js`, `scripts/build-site.mjs`, `scripts/generate-release-manifest.js`, `scripts/generate-release-manifest-v2.mjs`, `scripts/verify-producer-derivation.mjs`, `scripts/system-inspect.mjs`, `system/bounder-system.v1.json`, `ui/policy-roundtrip-panel.js`, `design/brand-source/README.md`, `.github/workflows/deploy-pages.yml`, `.github/workflows/receipt-drift.yml`, `release/bounder-reference-v1.0.4.manifest.json`
- Last verified against sources: 2026-09-03

## See Also

- [[bounder:seams/evidence-provenance]]
- [[bounder:flows/agent-operating-loop]]
- [[bounder:systems/site-architecture]]
- [[bounder:systems/runtime-observability]]
- [[bounder:domain/physical-interlock]]
