# Integrating Bounder with Creed Space Fleet

Bounder is the local Guardian for embodied movement and physical-action boundaries. Creed Space Fleet governs and distributes policy. A platform adapter owns the safest physical response.

This project is simulation-only. The contract is suitable for software integration and assurance work, not a claim of certified deployment safety.

## Authority flow

1. Creed Space Fleet resolves organization, team, mission, and device rules into a `creedspace-bounder-policy/v1` payload.
2. Fleet signs the exact UTF-8 payload bytes in a `creedspace-bounder-envelope/v1` envelope. Consumers verify those bytes without parsing and reserializing them first.
3. The local Guardian checks the Ed25519 signature, trusted key identifier, subject binding, monotonic sequence, validity window, and policy schema.
4. Bounder evaluates the requested action against the verified policy, current platform state, and fresh evidence.
5. The device adapter receives only the bounded result and chooses the safest platform-specific command.
6. Bounder emits a signed decision receipt. Fleet stores that evidence without changing the local decision if the audit channel is unavailable.

```text
Creed Space Fleet
  policy composition
        |
        v
signed envelope  --->  Bounder Guardian  --->  platform adapter  --->  simulated action
                            |                       |
                            +---- signed receipt ---+
                                      |
                                      v
                              Fleet audit record
```

## Published contracts

| Contract | Purpose |
|---|---|
| [`creedspace-bounder-policy-v1.schema.json`](../schemas/creedspace-bounder-policy-v1.schema.json) | Device-bound policy projection |
| [`creedspace-bounder-envelope-v1.schema.json`](../schemas/creedspace-bounder-envelope-v1.schema.json) | Exact-byte Ed25519 envelope |
| [`creedspace-bounder-profile-v1.schema.json`](../schemas/creedspace-bounder-profile-v1.schema.json) | Reusable physical-safety constraints |
| [`creedspace-bounder-checkpoint-v1.schema.json`](../schemas/creedspace-bounder-checkpoint-v1.schema.json) | Monotonic restart and rollback floor |
| [`bounder.receipt.v1.schema.json`](../schemas/bounder.receipt.v1.schema.json) | Local decision receipt |
| [`bounder.receipt-bundle.v1.schema.json`](../schemas/bounder.receipt-bundle.v1.schema.json) | Deterministic simulator evidence bundle |
| [`creedspace-bounder-golden-v1.json`](../data/creedspace-bounder-golden-v1.json) | Cross-language signed policy vector |
| [`creedspace-bounder-roundtrip-v1.json`](../data/creedspace-bounder-roundtrip-v1.json) | Signed Go receipt and Fleet audit for the exact golden policy sequence |
| [`creedspace-bounder-roundtrip-v1.schema.json`](../schemas/creedspace-bounder-roundtrip-v1.schema.json) | Round-trip evidence and signed audit contract |
| [`creedspace-bounder-guardian-heartbeat-v1.schema.json`](../schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json) | Private per-Guardian operational observation |
| [`creedspace-bounder-fleet-snapshot-v1.schema.json`](../schemas/creedspace-bounder-fleet-snapshot-v1.schema.json) | Privacy-bounded Fleet aggregate |
| [`creedspace-bounder-fleet-event-v1.schema.json`](../schemas/creedspace-bounder-fleet-event-v1.schema.json) | Meaningful Fleet state transition |
| [`creedspace-bounder-telemetry-envelope-v1.schema.json`](../schemas/creedspace-bounder-telemetry-envelope-v1.schema.json) | Exact-byte private telemetry signature envelope |

## Browser verification laboratory

The simulator’s contract panel accepts the published vector or a local compatible JSON file. Inspection is entirely local:

1. The file is capped at 128 KiB.
2. Base64 payload, signature, and public-key dimensions are checked.
3. Web Crypto verifies Ed25519 over the decoded payload bytes.
4. The signed payload is decoded as strict UTF-8 JSON and validated against the policy contract.
5. The exact policy payload digest, subject, Fleet, policy ID, and sequence are matched to the recorded Go evaluation.
6. The returned audit receipt payload, SHA-256 input hash, and Ed25519 certificate are verified locally.
7. Expired or not-yet-valid policy remains held even when its signature is authentic.

The browser does not create authority or mint a deployment receipt. Canonical
decisions and derived evidence come from the Go interlock in the private
[`NellInc/Bounder-from-org`](https://github.com/NellInc/Bounder-from-org)
producer repository. The public site republishes byte-identical contracts and
verifies deterministic outputs from an exact clean producer commit.

## Guardian and Fleet observability

Heartbeats, Fleet snapshots, and transition events describe operational state.
They never grant, broaden, or revoke permission. A missed heartbeat changes the
Fleet classification to unreachable; the Guardian continues to derive local
authority only from its verified policy, evidence freshness, checkpoint floor,
and continuity lease.

Detailed telemetry is Fleet-private. The public continuity projection contains
only aggregate counts and is emitted only from a complete, fresh, healthy
100-Guardian snapshot with zero decision failures and no audit backlog. The
reference state model and performance budgets are software integration proof;
deployed Guardian timing, Fleet capacity, and physical safety remain unverified.

## Platform adapters

| Platform | Typical bounded state change | Local evidence | Safe adapter responses |
|---|---|---|---|
| Aircraft | takeoff, route segment, altitude change | position, altitude, battery, weather, link | hold, loiter, return, land |
| Ground robot | enter zone, cross doorway, change speed | map pose, proximity, identity, load | stop, slow, retreat, park |
| Autonomous boat | enter channel, approach berth, change speed | GNSS, chart zone, traffic, weather | hold station, slow, turn away |
| Warehouse vehicle | cross aisle, lift load, enter human area | localization, pedestrian distance, load state | brake, lower, wait, reroute |
| Inspection platform | approach asset, energize tool, enter exclusion area | permit, tool state, personnel clearance | inhibit, retract, isolate |
| Fixed machinery | move axis, open valve, energize process | guards, lockout state, pressure, operator key | interlock, stop, vent, isolate |

An adapter should be narrow, deterministic, separately tested, and fail safe when its input is missing, stale, malformed, or outside its declared capability.

## Fail-safe invariants

1. No verified current policy means no new permission.
2. A replayed sequence cannot replace a newer accepted sequence.
3. Signature failure preserves the last verified unexpired policy and never broadens authority.
4. Audit delivery failure cannot change the local decision.
5. Expiry ends cached authority while offline.
6. Evidence-only rules cannot become actuator authority.
7. Fleet rollback floors survive Guardian restart.

## Validation

```bash
npm test
npm run test:browser
npm run verify
BOUNDER_PRODUCER_ROOT=../Bounder-from-org-agent-ergonomic npm run verify:producer
npx --yes impeccable@3.2.1 detect .
```

The producer-derivation gate regenerates public fixtures, checks every shared
schema byte, verifies the clean producer revision, and emits a machine-readable
receipt. Recorded Fleet laboratory and staging-pilot files remain observations;
they are never relabelled as deterministic producer outputs.
