# Runtime Reliability and Fleet Observability

<!-- wiki:type = system -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-08-31 -->
<!-- wiki:updated = 2026-09-03 -->
<!-- wiki:status = active -->

## Summary

Bounder's observability reference gives Guardian heartbeats, Fleet snapshots, Fleet transition events, and the existing public continuity proof one coherent state model. It is a simulation and integration contract. Deployed Guardian behavior, Fleet capacity, hardware performance, and physical safety remain unverified until the confirmed external owners implement and measure it. (`runtime/observability/guardian-fleet-state.js:17-31 "simulation-reference-observability-only"`; `system/bounder-system.v1.json:1533-1537 "Do not present reference observability budgets as deployed Guardian or Fleet performance."`)

## Authority Separation

Heartbeats are signed observations. Fleet can classify a Guardian as healthy, degraded, held, recovering, or unreachable. That classification never grants, broadens, or revokes a physical permission. The local Guardian continues to derive authority from verified policy, fresh evidence, checkpoint floors, and continuity leases. (`runtime/observability/guardian-fleet-state.js:159-194 "deriveGuardianStateUnchecked"`; `guides/INTEGRATION.md:67-71 "They never grant, broaden, or revoke permission."`)

Network loss therefore has two separate consequences:

1. Fleet observation becomes `unreachable` after the heartbeat expires.
2. Guardian authority changes only when its local policy, evidence, checkpoint, or continuity rule requires a hold.

**Working if:** heartbeat loss changes Fleet observation while producing no new allowed decision.

## Contract Family

| Contract | Visibility | Purpose | Privacy boundary |
|---|---|---|---|
| `creedspace-bounder-telemetry-envelope/v1` | Private transport | Ed25519 over exact payload bytes with kind and key binding | Contains an encoded private payload |
| `creedspace-bounder-guardian-heartbeat/v1` | Fleet private | One Guardian boot, sequence, authority inputs, decision summary, audit backlog, resources, state, and reason | Contains Guardian identity |
| `creedspace-bounder-fleet-snapshot/v1` | Fleet private aggregate | Counts, cohorts, sequence ranges, latency maxima, audit state, completeness, and health | Contains no Guardian identity |
| `creedspace-bounder-fleet-event/v1` | Fleet private | Content-addressed meaningful state, boot, policy, checkpoint, or reachability transition | Contains Guardian identity |
| `bounder-continuity-evidence/v1` | Public aggregate | Complete healthy 100-Guardian continuity proof | Contains no private diagnostic detail |

The schemas close every object to unknown fields and bound identities, counters, timestamps, and encoded payload size. (`schemas/creedspace-bounder-telemetry-envelope-v1.schema.json:1-41`; `schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json:1-122`; `schemas/creedspace-bounder-fleet-snapshot-v1.schema.json:1-126`; `schemas/creedspace-bounder-fleet-event-v1.schema.json:1-51`)

All four observability schemas enter the public build through the recursive `schemas` allowlist. Release v1.0.4 predated them and did not pin their bytes. Manifest v2 pins all four from v1.1.0 onward, both as decision-producer contract inputs and as publisher files, and names the private decision producer explicitly, so the earlier hold on producer identity is closed. Historical manifests remain byte-immutable. (`scripts/build-site.mjs:10-19 "canonicalPublicPaths"`; `release/bounder-reference-v1.0.4.manifest.json:1-172`; `release/bounder-reference-v1.1.1.manifest.json:11-16 "decision_producer"`; `release/bounder-reference-v1.1.1.manifest.json:232-265`; `release/bounder-reference-v1.1.1.manifest.json:582-615`)

`npm run inspect` compares the public schema inventory against the manifest for the *current* `VERSION`, not against the newest sealed manifest. During a release cycle whose manifest is not yet sealed it therefore reports every public schema as unpinned; that is the mechanism working, not a regression. (`scripts/system-inspect.mjs:121-140 "unpinnedPublicSchemas"`)

**Working if:** any public schema added after the last sealed release appears in the built artifact and is reported as unpinned until the next authorized release seals it.

Three contract details are now tighter than the original publication. The `identity` pattern in the heartbeat, snapshot, and event schemas is anchored end to end, so an identifier can no longer smuggle a leading, trailing, or embedded line terminator past a bare `\S` match. `expected_guardians` takes a `positive` definition with a minimum of 1, because a snapshot that expects no Guardian describes no fleet. (`schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json:91 "identity"`; `schemas/creedspace-bounder-fleet-event-v1.schema.json:41 "identity"`; `schemas/creedspace-bounder-fleet-snapshot-v1.schema.json:107-109 "positive"`; `schemas/creedspace-bounder-fleet-snapshot-v1.schema.json:18 "expected_guardians"`)

These four schemas are shared contracts that the private decision producer must carry byte for byte. Any change here must land in the producer in lockstep, or `npm run verify:producer` fails the contract-parity comparison. (`scripts/verify-producer-derivation.mjs:13-27 "SHARED_CONTRACTS"`)

Signed telemetry is parsed by the same strict parser as signed policy, reached through the narrow `runtime/json/policy-json.js` seam, so a duplicate object key or a non-UTF-8 byte fails identically on both paths and the payload byte limit is applied once. (`runtime/observability/guardian-fleet-state.js:773-779 "parseStrictJSON"`; `runtime/json/policy-json.js:1 "parseStrictJSON"`)

## Guardian State Derivation

The reference derives state in this order:

1. Checkpoint rollback, unverified policy, expired policy, or expired continuity lease produces `held`.
2. A declared restart or checkpoint restoration produces `recovering`.
3. Evidence lag, audit backlog, resource pressure, or partial connectivity produces `degraded`.
4. A structurally valid observation without those conditions produces `healthy`.
5. Fleet classifies a missing or expired observation as `unreachable`.

The heartbeat's declared state and reason must equal the result derived at generation time. Fleet reevaluates signed policy expiry, continuity-lease expiry, and evidence age at observation time, so a still-valid heartbeat cannot preserve a stale healthy classification. A Guardian cannot claim healthy while its own fields prove a hold or degradation. (`runtime/observability/guardian-fleet-state.js:159-194 "deriveGuardianStateUnchecked"`; `runtime/observability/guardian-fleet-state.js:204-302 "classifyValidatedGuardianHeartbeat"`)

## Ordering and Restart Safety

The replay guard tracks each Guardian's Fleet identity, active boot epoch, retired boot epochs, heartbeat sequence, observation time, policy sequence, and checkpoint sequence. It rejects duplicate or reordered heartbeats, policy rollback, checkpoint rollback, and reuse of a retired boot epoch. Failed validation never advances a floor. (`runtime/observability/guardian-fleet-state.js:303-359 "createGuardianHeartbeatGuard"`)

Boot history is bounded. Exhaustion fails closed and requires an explicit persistence or rotation design from the deployed owner.

**Working if:** replaying any accepted heartbeat or retired boot epoch fails while a later valid heartbeat still advances from the last accepted state.

## Fleet Aggregation and Public Projection

Aggregation starts with an expected Guardian inventory. It validates every observation, rejects unknown or duplicate Guardians and platform disagreement, accounts for missing and expired observations, and emits only counts and maxima. (`runtime/observability/guardian-fleet-state.js:379-470 "aggregateFleetSnapshot"`)

The public projection is deliberately narrower. It requires exactly 100 expected and observed Guardians, one completed evaluation per Guardian for the cycle, complete health, zero decision failures, zero queued audits, and a nonempty count for every published platform cohort. It exposes only the fields already accepted by the public continuity verifier. (`runtime/observability/guardian-fleet-state.js:541-576 "projectPublicContinuity"`; `continuity-evidence.js:198-239`)

Sequence ranges carry separate floors. A policy sequence starts at 1, but checkpoint sequence 0 is a legal observation: a Guardian that has never taken a checkpoint is not a malformed one. Only a snapshot with no observed Guardian at all must report a zeroed range. (`runtime/observability/guardian-fleet-state.js:506-515 "checkpoint"`)

**Working if:** any degraded, held, recovering, unreachable, incomplete, failed, or audit-backlogged snapshot refuses public projection.

## Transition Events and Heartbeat Cost

Events are emitted for connection, degradation, hold, recovery, unreachability, restart, policy advance, and checkpoint advance. Repeated identical state emits no event. A first-contact heartbeat that is already held, degraded, or expired emits its state event alongside `guardian_connected`, so the Fleet never records a connection without recording the state it connected in. Each event identifier is the SHA-256 digest of its canonical event body, and the signed envelope protects the exact transmitted bytes. (`runtime/observability/guardian-fleet-state.js:589-657 "makeFleetEvent"`; `runtime/observability/guardian-fleet-state.js:748-790 "verifyTelemetryEnvelope"`)

Healthy Guardians report every 30 seconds, extending to 60 seconds after ten stable observations. Degraded, held, and recovering Guardians report every 5 seconds. A transition is immediate. Deterministic jitter is bounded to ten percent, and the largest scheduled delay remains below the 90-second validity window. (`runtime/observability/guardian-fleet-state.js:17-31 "DEFAULT_OBSERVABILITY_BUDGETS"`; `runtime/observability/guardian-fleet-state.js:691-713 "planHeartbeatDelay"`)

## Testing and Performance Proof

`npm run test:observability` covers exact schemas, state derivation, loss, delay, duplication, reordering, skew, restart, rollback, partial rollout, lease expiry, public projection, events, scheduling, signatures, and strict JSON.

`npm run benchmark:observability` warms the maximum 10,000-Guardian reference corpus, measures three complete aggregations, checks median process CPU consumption against the reference budget, records monotonic wall time as a diagnostic, and checks heartbeat, snapshot, and event byte budgets. Process CPU time isolates algorithmic cost from unrelated host scheduling pressure; wall time remains visible without becoming a false regression gate. Its receipt explicitly excludes production capacity, decision latency, and hardware performance. (`scripts/benchmark-observability.mjs:62-70 "runObservabilityBenchmark"`; `scripts/benchmark-observability.mjs:136-139 "does_not_establish"`)

`npm run check:changed -- --paths runtime/observability/guardian-fleet-state.js` derives the runtime proof route without spending build or browser resources. A telemetry-schema path adds publication build and browser proof because those contracts are public. (`system/bounder-system.v1.json:1144-1167 "observability_runtime"`; `scripts/lib/system-model.mjs:220-242 "planForPaths"`)

## Deployment Handoff

The website repository owns these published contracts, the pure reference model, and their tests. The final Guardian producer and Creed Space Fleet backend own integration. The decision producer is now identified — private `NellInc/Bounder-from-org` on `master` — but the Fleet backend owner and the deployed heartbeat integration are still unverified, and no deployment path is established, so this implementation does not modify the observed external checkout or claim live benefit. (`release/bounder-reference-v1.1.1.manifest.json:11-16 "decision_producer"`; `system/bounder-system.v1.json:1535 "The Fleet backend owner and deployed Guardian heartbeat integration remain unverified."`)

The deployment gate requires:

1. Confirmed producer and Fleet owners at immutable revisions.
2. Equivalent Go and backend validators generated from or tested against these contracts.
3. Persisted replay and boot-epoch floors.
4. Device-key enrollment, rotation, revocation, and custody review.
5. Load, soak, partition, restart, and rollback measurements in the target environment.
6. A separate physical safety and human approval process.

## Provenance

- Sources consulted: runtime observability modules, public schemas, existing continuity verifier, integration guide, system descriptor, benchmark, and deterministic tests
- Last verified against sources: 2026-09-03

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:flows/agent-operating-loop]]
- [[bounder:seams/evidence-provenance]]
- [[bounder:domain/physical-interlock]]
