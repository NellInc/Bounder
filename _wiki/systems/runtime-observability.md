# Runtime Reliability and Fleet Observability

<!-- wiki:type = system -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-08-31 -->
<!-- wiki:updated = 2026-09-26 -->
<!-- wiki:status = active -->

## Summary

Bounder's observability reference gives Guardian heartbeats, Fleet snapshots, Fleet transition events, and a public continuity projection one coherent state model. The deployed staging continuity feed that the homepage verifies is produced independently of this model and does not fit its budgets; see the freshness bounds below. It is a simulation and integration contract. Deployed Guardian behavior, Fleet capacity, hardware performance, and physical safety remain unverified until the confirmed external owners implement and measure it. (`runtime/observability/guardian-fleet-state.js:17-31 "simulation-reference-observability-only"`; `system/bounder-system.v1.json:1585 "Do not present reference observability budgets as deployed Guardian or Fleet performance."`)

## Authority Separation

Heartbeats are signed observations. Fleet can classify a Guardian as healthy, degraded, held, recovering, or unreachable. That classification never grants, broadens, or revokes a physical permission. The local Guardian continues to derive authority from verified policy, fresh evidence, checkpoint floors, and continuity leases. (`runtime/observability/guardian-fleet-state.js:165-204 "deriveGuardianStateUnchecked"`; `guides/INTEGRATION.md:133 "They never grant, broaden, or revoke permission."`)

Network loss therefore has two separate consequences:

1. Fleet observation becomes `unreachable` after the heartbeat expires.
2. Guardian authority changes only when its local policy, evidence, checkpoint, or continuity rule requires a hold.

**Working if:** heartbeat loss changes Fleet observation while producing no new allowed decision.

## Contract Family

| Contract | Visibility | Purpose | Privacy boundary |
|---|---|---|---|
| `creedspace-bounder-telemetry-envelope/v1` | Private transport | Ed25519 over exact payload bytes with kind and key-id binding; the verifier also binds the key to one subject | Contains an encoded private payload |
| `creedspace-bounder-guardian-heartbeat/v1` | Fleet private | One Guardian boot, sequence, authority inputs, decision summary, audit backlog, resources, state, and reason | Contains Guardian identity |
| `creedspace-bounder-fleet-snapshot/v1` | Fleet private aggregate | Counts, cohorts, sequence ranges, latency maxima, audit state, completeness, and health | Contains no Guardian identity |
| `creedspace-bounder-fleet-event/v1` | Fleet private | Content-addressed meaningful state, boot, policy, checkpoint, or reachability transition | Contains Guardian identity |
| `bounder-continuity-evidence/v1` | Public aggregate | Complete healthy 100-Guardian continuity proof | Contains no private diagnostic detail |

The schemas close every object to unknown fields and bound identities, counters, timestamps, and encoded payload size. (`schemas/creedspace-bounder-telemetry-envelope-v1.schema.json:1-41`; `schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json:1-122`; `schemas/creedspace-bounder-fleet-snapshot-v1.schema.json:1-126`; `schemas/creedspace-bounder-fleet-event-v1.schema.json:1-51`)

All four observability schemas enter the public build through the recursive `schemas` allowlist. Release v1.0.4 predated them and did not pin their bytes. Manifest v2 pins all four from v1.1.0 onward, both as decision-producer contract inputs and as publisher files, and names the private decision producer explicitly, so the earlier hold on producer identity is closed. Historical manifests remain byte-immutable. (`scripts/build-site.mjs:10-19 "canonicalPublicPaths"`; `release/bounder-reference-v1.0.4.manifest.json:1-172`; `release/bounder-reference-v1.1.1.manifest.json:11-16 "decision_producer"`; `release/bounder-reference-v1.1.1.manifest.json:232-265`; `release/bounder-reference-v1.1.1.manifest.json:582-615`)

`npm run inspect` compares the public schema inventory against the manifest for the *current* `VERSION`, not against the newest sealed manifest. During a release cycle whose manifest is not yet sealed it therefore reports every public schema as unpinned; that is the mechanism working, not a regression. (`scripts/system-inspect.mjs:121-140 "unpinnedPublicSchemas"`)

**Working if:** any public schema added after the last sealed release appears in the built artifact and is reported as unpinned until the next authorized release seals it.

Three contract details are now tighter than the original publication. The telemetry envelope's `public_key_id` is not yet one of them: its schema pattern is still the unanchored `\S`, while the runtime applies the anchored identity check, so the schema accepts ids the verifier refuses until the producer publishes the anchored pattern. (`schemas/creedspace-bounder-telemetry-envelope-v1.schema.json:38 "pattern"`) The `identity` pattern in the heartbeat, snapshot, and event schemas is anchored end to end, so an identifier can no longer smuggle a leading, trailing, or embedded line terminator past a bare `\S` match. `expected_guardians` takes a `positive` definition with a minimum of 1, because a snapshot that expects no Guardian describes no fleet. (`schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json:91 "identity"`; `schemas/creedspace-bounder-fleet-event-v1.schema.json:41 "identity"`; `schemas/creedspace-bounder-fleet-snapshot-v1.schema.json:107-109 "positive"`; `schemas/creedspace-bounder-fleet-snapshot-v1.schema.json:18 "expected_guardians"`)

These four schemas are shared contracts that the private decision producer must carry byte for byte. Any change here must land in the producer in lockstep, or `npm run verify:producer` fails the contract-parity comparison. (`scripts/verify-producer-derivation.mjs:13-27 "SHARED_CONTRACTS"`)

Signed telemetry is parsed by the same strict parser as signed policy, reached through the narrow `runtime/json/policy-json.js` seam, so a duplicate object key or a non-UTF-8 byte fails identically on both paths and the payload byte limit is applied once. (`runtime/observability/guardian-fleet-state.js:960-966 "parseStrictJSON"`; `runtime/json/policy-json.js:17 "parseStrictJSON"`)

## Guardian State Derivation

The reference derives state in this order:

1. Checkpoint rollback, unverified policy, expired policy, or expired continuity lease produces `held`.
2. A declared restart or checkpoint restoration produces `recovering`.
3. Evidence lag, audit backlog, resource pressure, or partial connectivity produces `degraded`.
4. A structurally valid observation without those conditions produces `healthy`.
5. Fleet classifies a missing or expired observation as `unreachable`.

The heartbeat's declared state and reason must equal the result derived at generation time. Fleet re-checks the absolute deadlines at observation time: signed policy expiry, continuity-lease expiry, and heartbeat liveness. A still-valid heartbeat therefore cannot preserve a healthy classification past a lapsed policy or lease. Evidence age is different. It is a rolling Guardian-local reading, and Fleet cannot see evidence refreshed after the heartbeat, so Fleet judges evidence lag as the Guardian declared it at `generated_at`. Re-ageing it at observation time would mark every healthy Guardian degraded between heartbeats whenever its evidence bound is shorter than its reporting interval. A Guardian whose evidence goes stale reports at once, because a state change schedules an immediate heartbeat, and heartbeat expiry caps any remaining staleness. A Guardian cannot claim healthy while its own fields prove a hold or degradation. (`runtime/observability/guardian-fleet-state.js:165-204 "deriveGuardianStateUnchecked"`; `runtime/observability/guardian-fleet-state.js:214-326 "classifyValidatedGuardianHeartbeat"`)

Liveness is measured from Fleet's own receive time as well as the Guardian's clock: a heartbeat stops counting at the earlier of its declared `expires_at` and its receive time plus the validity window. A Guardian clock running ahead, within the accepted five-minute skew, therefore cannot stretch its own reachability beyond one validity window. The receive time can only shorten liveness. (`runtime/observability/guardian-fleet-state.js:296-326 "heartbeatLivenessExpiry"`)

## Ordering and Restart Safety

The replay guard tracks each Guardian's Fleet identity, active boot epoch, retired boot epochs, heartbeat sequence, generation and receive times, policy sequence, and checkpoint sequence. It rejects duplicate or reordered heartbeats, policy rollback, checkpoint rollback, and reuse of a retired boot epoch. Failed validation never advances a floor. Within one boot the signed heartbeat sequence is the replay defence; a `generated_at` that steps back under a higher sequence is a corrected Guardian clock, counted as a `clock_regressions` diagnostic rather than locking the Guardian out. Across a boot change, time ordering stays strict. (`runtime/observability/guardian-fleet-state.js:328-408 "createGuardianHeartbeatGuard"`)

The guard accepts either a heartbeat or the frozen result of telemetry verification, and in the second case re-checks the key's subject binding before any floor moves. Signed telemetry binds each key to one subject: a Guardian key signs only its own heartbeats and events, and only a Fleet aggregator key signs snapshots. Without that binding, a key enrolled for one Guardian could sign heartbeats for another and raise its sequence floors until its genuine heartbeats were refused. (`runtime/observability/guardian-fleet-state.js:896-930 "validateKeyBinding"`; `runtime/observability/guardian-fleet-state.js:931-981 "keyBindings"`)

A Guardian that leaves the expected inventory can be retired from the guard, which releases its capacity. The guard keeps no tombstone: a retired id re-entering aggregation is refused by the inventory check, and its key's subject binding is revoked with the device. (`runtime/observability/guardian-fleet-state.js:385-392 "retire(guardianId)"`)

Boot history is bounded. Exhaustion fails closed and requires an explicit persistence or rotation design from the deployed owner.

**Working if:** replaying any accepted heartbeat or retired boot epoch fails while a later valid heartbeat still advances from the last accepted state.

## Fleet Aggregation and Public Projection

Aggregation starts with an expected Guardian inventory. It validates every observation, rejects unknown or duplicate Guardians and platform disagreement, accounts for missing and expired observations, and emits only counts and maxima. A snapshot expires at the first deadline that would change any summarised Guardian's classification: its liveness, its signed policy expiry, or its continuity lease. (`runtime/observability/guardian-fleet-state.js:444-592 "aggregateFleetSnapshot"`)

Aggregation has two modes. The strict mode, `aggregateFleetSnapshot`, fails the whole cycle closed on any contract violation, so its callers pass only guard-accepted, inventory-matched heartbeats. The quarantining mode, `aggregateFleetObservations`, sets aside a heartbeat that fails validation, names an unknown Guardian or the wrong Fleet or platform, or duplicates another heartbeat. That Guardian counts as missing, so the snapshot cannot be complete or healthy, and the Fleet-private `rejected` list records each quarantined heartbeat outside the snapshot. (`runtime/observability/guardian-fleet-state.js:575-592 "aggregateFleetObservations"`)

The public projection is deliberately narrower. It requires exactly 100 expected and observed Guardians, exactly one completed evaluation per Guardian for the cycle, complete health, zero decision failures, zero queued audits, and a nonempty count for every published platform cohort. The snapshot carries only fleet-wide sums, so the per-Guardian count is derived from the same heartbeats by `projectPublicContinuityFromHeartbeats` and must be supplied explicitly to `projectPublicContinuity`; without it the projection is refused. `signed_audits` counts one signed audit per published platform cohort (six), not one per Guardian. The projection exposes only the fields already accepted by the public continuity verifier. (`runtime/observability/guardian-fleet-state.js:664-735 "projectPublicContinuity"`; `continuity-evidence.js:84-126 "validateContinuityEvidence"`)

Three freshness bounds apply, and they are not the same bound. The reference projection inherits the snapshot's lease, at most the 90-second heartbeat validity window. The deployed public continuity feed is produced independently of this reference and signs its own, longer lease; this repository does not derive it. The browser accepts any signed lease of up to 30 minutes. (`runtime/observability/guardian-fleet-state.js:594-662 "heartbeat_validity_ms"`; `continuity-evidence.js:12 "MAX_VALIDITY_MS"`; `guides/INTEGRATION.md:144-150 "issued a proof about every five minutes"`)

The staging feed could not be emitted by `projectPublicContinuity`. Envelopes fetched from the live feed and verified with the pinned key on 26 September 2026 were generated about every five minutes, each with a 900-second lease and a `cycle_duration_ms` of roughly 108,000 to 114,000. The reference snapshot validator refuses a lease longer than the 90-second heartbeat validity and a cycle longer than that same window, so the reference model would reject both. That observation came from the launch-readiness audit and is a snapshot of the feed on that date; the homepage monitor's refresh schedule assumes the same cadence. (`continuity-evidence.js:481-484 "roughly every five minutes with a 15-minute lease"`) Aligning the two would need either a separate public-projection budget in the reference model or a staging producer that runs inside the reference budgets; neither is claimed here. (`runtime/observability/guardian-fleet-state.js:607-608 "Fleet snapshot validity window is invalid"`; `runtime/observability/guardian-fleet-state.js:655 "Fleet cycle duration exceeds the observability window"`)

Sequence ranges carry separate floors. A policy sequence starts at 1, but checkpoint sequence 0 is a legal observation: a Guardian that has never taken a checkpoint is not a malformed one. Only a snapshot with no observed Guardian at all must report a zeroed range. (`runtime/observability/guardian-fleet-state.js:629-638 "checkpoint"`)

**Working if:** any degraded, held, recovering, unreachable, incomplete, failed, or audit-backlogged snapshot refuses public projection.

## Transition Events and Heartbeat Cost

Events are emitted for connection, degradation, hold, recovery, unreachability, restart, policy advance, and checkpoint advance. Repeated identical state emits no event. A first-contact heartbeat that is already held, degraded, or expired emits its state event alongside `guardian_connected`, so the Fleet never records a connection without recording the state it connected in. Each event identifier is the SHA-256 digest of its canonical event body, and the signed envelope protects the exact transmitted bytes. (`runtime/observability/guardian-fleet-state.js:738-808 "makeFleetEvent"`; `runtime/observability/guardian-fleet-state.js:931-981 "verifyTelemetryEnvelope"`)

Healthy Guardians report every 30 seconds, extending to 40 seconds after ten stable observations. Degraded, held, and recovering Guardians report every 5 seconds. A transition is immediate. Deterministic jitter is bounded to ten percent. Two of the largest scheduled delays, 88 seconds, stay inside the 90-second validity window, so one lost report never marks a stable Guardian unreachable; the budget validator refuses any configuration that cannot survive one loss. (`runtime/observability/guardian-fleet-state.js:17-31 "DEFAULT_OBSERVABILITY_BUDGETS"`; `runtime/observability/guardian-fleet-state.js:153-161 "one lost report"`; `runtime/observability/guardian-fleet-state.js:843-864 "planHeartbeatDelay"`)

## Testing and Performance Proof

`npm run test:observability` covers exact schemas, state derivation, loss, delay, duplication, reordering, skew and receive-time liveness, restart, rollback, partial rollout, lease expiry, snapshot deadlines, quarantine, public projection, events, scheduling, signatures, key-to-subject binding, and strict JSON.

`npm run benchmark:observability` warms the maximum 10,000-Guardian reference corpus, measures three complete aggregations, checks median process CPU consumption against the reference budget, records monotonic wall time as a diagnostic, and checks heartbeat, snapshot, and event byte budgets. Process CPU time isolates algorithmic cost from unrelated host scheduling pressure; wall time remains visible without becoming a false regression gate. Its receipt explicitly excludes production capacity, decision latency, and hardware performance. (`scripts/benchmark-observability.mjs:62-70 "runObservabilityBenchmark"`; `scripts/benchmark-observability.mjs:136-139 "does_not_establish"`)

`npm run check:changed -- --paths runtime/observability/guardian-fleet-state.js` derives the runtime proof route without spending build or browser resources. A telemetry-schema path adds publication build and browser proof because those contracts are public. (`system/bounder-system.v1.json:1165 "observability_runtime"`; `scripts/lib/system-model.mjs:220-242 "planForPaths"`)

## Deployment Handoff

The website repository owns these published contracts, the pure reference model, and their tests. The final Guardian producer and Creed Space Fleet backend own integration. The decision producer is now identified — private `NellInc/Bounder-from-org` on `master` — but the Fleet backend owner and the deployed heartbeat integration are still unverified, and no deployment path is established, so this implementation does not modify the observed external checkout or claim live benefit. (`release/bounder-reference-v1.1.1.manifest.json:11-16 "decision_producer"`; `system/bounder-system.v1.json:1584 "The Fleet backend owner and deployed Guardian heartbeat integration remain unverified."`)

The deployment gate requires:

1. Confirmed producer and Fleet owners at immutable revisions.
2. Equivalent Go and backend validators generated from or tested against these contracts.
3. Persisted replay and boot-epoch floors.
4. Device-key enrollment, rotation, revocation, and custody review.
5. Load, soak, partition, restart, and rollback measurements in the target environment.
6. A separate physical safety and human approval process.

## Provenance

- Sources consulted: runtime observability modules, public schemas, existing continuity verifier, integration guide, system descriptor, benchmark, and deterministic tests
- Last verified against sources: 2026-09-26

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:flows/agent-operating-loop]]
- [[bounder:seams/evidence-provenance]]
- [[bounder:domain/physical-interlock]]
