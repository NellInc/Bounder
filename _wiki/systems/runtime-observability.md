# Runtime Reliability and Fleet Observability

<!-- wiki:type = system -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-08-31 -->
<!-- wiki:updated = 2026-08-31 -->
<!-- wiki:status = active -->

## Summary

Bounder's observability reference gives Guardian heartbeats, Fleet snapshots, Fleet transition events, and the existing public continuity proof one coherent state model. It is a simulation and integration contract. Deployed Guardian behavior, Fleet capacity, hardware performance, and physical safety remain unverified until the confirmed external owners implement and measure it. (`runtime/observability/guardian-fleet-state.js:3-30`; `system/bounder-system.v1.json:456-470`)

## Authority Separation

Heartbeats are signed observations. Fleet can classify a Guardian as healthy, degraded, held, recovering, or unreachable. That classification never grants, broadens, or revokes a physical permission. The local Guardian continues to derive authority from verified policy, fresh evidence, checkpoint floors, and continuity leases. (`runtime/observability/guardian-fleet-state.js:163-185`; `guides/INTEGRATION.md:70-78`)

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

All four observability schemas enter the public build through the recursive `schemas` allowlist. Release v1.0.4 predates them and does not pin their bytes. `npm run inspect` reports this distinction directly. They require a future provenance-v2 release after producer identity is resolved; the historical manifest remains unchanged. (`scripts/build-site.mjs:10-19`; `release/bounder-reference-v1.0.4.manifest.json:1-172`; `scripts/system-inspect.mjs:103-145`)

**Working if:** a new public schema appears in the built artifact and inspection simultaneously reports it as unpinned until a future authorized release seals it.

## Guardian State Derivation

The reference derives state in this order:

1. Checkpoint rollback, unverified policy, expired policy, or expired continuity lease produces `held`.
2. A declared restart or checkpoint restoration produces `recovering`.
3. Evidence lag, audit backlog, resource pressure, or partial connectivity produces `degraded`.
4. A structurally valid observation without those conditions produces `healthy`.
5. Fleet classifies a missing or expired observation as `unreachable`.

The heartbeat's declared state and reason must equal the result derived at generation time. Fleet reevaluates signed policy expiry, continuity-lease expiry, and evidence age at observation time, so a still-valid heartbeat cannot preserve a stale healthy classification. A Guardian cannot claim healthy while its own fields prove a hold or degradation. (`runtime/observability/guardian-fleet-state.js:159-194`; `runtime/observability/guardian-fleet-state.js:204-297`)

## Ordering and Restart Safety

The replay guard tracks each Guardian's Fleet identity, active boot epoch, retired boot epochs, heartbeat sequence, observation time, policy sequence, and checkpoint sequence. It rejects duplicate or reordered heartbeats, policy rollback, checkpoint rollback, and reuse of a retired boot epoch. Failed validation never advances a floor. (`runtime/observability/guardian-fleet-state.js:298-346`)

Boot history is bounded. Exhaustion fails closed and requires an explicit persistence or rotation design from the deployed owner.

**Working if:** replaying any accepted heartbeat or retired boot epoch fails while a later valid heartbeat still advances from the last accepted state.

## Fleet Aggregation and Public Projection

Aggregation starts with an expected Guardian inventory. It validates every observation, rejects unknown or duplicate Guardians and platform disagreement, accounts for missing and expired observations, and emits only counts and maxima. (`runtime/observability/guardian-fleet-state.js:369-457`)

The public projection is deliberately narrower. It requires exactly 100 expected and observed Guardians, one completed evaluation per Guardian for the cycle, complete health, zero decision failures, zero queued audits, and a nonempty count for every published platform cohort. It exposes only the fields already accepted by the public continuity verifier. (`runtime/observability/guardian-fleet-state.js:526-562`; `continuity-evidence.js:198-239`)

**Working if:** any degraded, held, recovering, unreachable, incomplete, failed, or audit-backlogged snapshot refuses public projection.

## Transition Events and Heartbeat Cost

Events are emitted for connection, degradation, hold, recovery, unreachability, restart, policy advance, and checkpoint advance. Repeated identical state emits no event. Each event identifier is the SHA-256 digest of its canonical event body, and the signed envelope protects the exact transmitted bytes. (`runtime/observability/guardian-fleet-state.js:564-668`; `runtime/observability/guardian-fleet-state.js:727-768`)

Healthy Guardians report every 30 seconds, extending to 60 seconds after ten stable observations. Degraded, held, and recovering Guardians report every 5 seconds. A transition is immediate. Deterministic jitter is bounded to ten percent, and the largest scheduled delay remains below the 90-second validity window. (`runtime/observability/guardian-fleet-state.js:17-31`; `runtime/observability/guardian-fleet-state.js:670-696`)

## Testing and Performance Proof

`npm run test:observability` covers exact schemas, state derivation, loss, delay, duplication, reordering, skew, restart, rollback, partial rollout, lease expiry, public projection, events, scheduling, signatures, and strict JSON.

`npm run benchmark:observability` warms the maximum 10,000-Guardian reference corpus, measures three complete aggregations, checks median process CPU consumption against the reference budget, records monotonic wall time as a diagnostic, and checks heartbeat, snapshot, and event byte budgets. Process CPU time isolates algorithmic cost from unrelated host scheduling pressure; wall time remains visible without becoming a false regression gate. Its receipt explicitly excludes production capacity, decision latency, and hardware performance. (`scripts/benchmark-observability.mjs:60-139`)

`npm run check:changed -- --paths runtime/observability/guardian-fleet-state.js` derives the runtime proof route without spending build or browser resources. A telemetry-schema path adds publication build and browser proof because those contracts are public. (`system/bounder-system.v1.json:1031-1102`; `scripts/lib/system-model.mjs:211-238`)

## Deployment Handoff

The website repository owns these published contracts, the pure reference model, and their tests. The final Guardian producer and Creed Space Fleet backend own integration. Their canonical repository identities and deployment path remain unresolved, so this implementation does not modify the observed external checkout or claim live benefit.

The deployment gate requires:

1. Confirmed producer and Fleet owners at immutable revisions.
2. Equivalent Go and backend validators generated from or tested against these contracts.
3. Persisted replay and boot-epoch floors.
4. Device-key enrollment, rotation, revocation, and custody review.
5. Load, soak, partition, restart, and rollback measurements in the target environment.
6. A separate physical safety and human approval process.

## Provenance

- Sources consulted: runtime observability modules, public schemas, existing continuity verifier, integration guide, system descriptor, benchmark, and deterministic tests
- Last verified against sources: 2026-08-31

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:flows/agent-operating-loop]]
- [[bounder:seams/evidence-provenance]]
- [[bounder:domain/physical-interlock]]
