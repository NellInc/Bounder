# Integrating Bounder with Creed Space Fleet

Bounder is the local Guardian for embodied movement and physical-action boundaries — the component that asks whether a machine should move right now. Creed Space Fleet governs and distributes policy. A platform adapter owns the safest physical response.

This project is simulation-only. The contract is suitable for software integration and assurance work, not a claim of certified deployment safety.

## Authority flow

1. Creed Space Fleet resolves organisation, team, mission, and device rules into a `creedspace-bounder-policy/v1` payload.
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
| [`bounder-resilience-evidence.v1.schema.json`](../schemas/bounder-resilience-evidence.v1.schema.json) | Recorded fault-replay timeline shown in the simulator |
| [`bounder-evidence-provenance-v1.schema.json`](../schemas/bounder-evidence-provenance-v1.schema.json) | Producer evidence statement with generator, input and output hashes |
| [`bounder-release-manifest-v2.schema.json`](../schemas/bounder-release-manifest-v2.schema.json) | Sealed release manifest separating producer, publisher, build and observation claims |

### Manipulator profile preview

A second contract family is mirrored here as a preview. It describes contact-class
constraints for a manipulator interlock: what it may hold, approach, release into,
or pour into.

| File | Purpose |
|---|---|
| [`creedspace-bounder-manipulator-profile-v1.schema.json`](../schemas/creedspace-bounder-manipulator-profile-v1.schema.json) | Manipulator profile constraints |
| [`creedspace-bounder-manipulator-profile-v1.example.json`](../data/creedspace-bounder-manipulator-profile-v1.example.json) | Example profile |
| [`creedspace-bounder-manipulator-golden-v1.json`](../data/creedspace-bounder-manipulator-golden-v1.json) | Signed golden vector under the simulation Fleet key |

These files are copied from the private producer, but they are not yet part of
its evidence statement, so no producer-derivation run covers their bytes. New
release manifests record them as recorded observations with that limitation,
and the test suite pins their SHA-256 digests. The schema's `$id` has been
moved under `https://www.bounder.io/schemas/` here ahead of the producer's
copy, so this one schema is not yet byte-identical to its source. The golden
vector's signed payload declares `creedspace-bounder-manipulator-policy/v1`,
for which no schema is published yet, and its `policy_id` is not yet derived
from the policy body. The simulator's contract panel accepts only
`creedspace-bounder-golden/v1` vectors, so it rejects this one. Treat the family
as a draft for review, not as a contract to build against.

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
`NellInc/Bounder-from-org` producer repository, which is not publicly readable.
The public site republishes the shared contracts byte for byte and
verifies deterministic outputs from an exact clean producer commit.

## Developer contract walkthrough

Start with the [guided browser demo](https://www.bounder.io/simulator.html?tour=1), then inspect the published contracts above. This is a static verification laboratory. It publishes no policy-issuance, device-command, or Fleet ingestion HTTP API. Producer and backend integration requires a separately agreed private implementation; schema identifiers are contract names, not service endpoints.

### What crosses each boundary

- **Policy and envelope:** the policy schema defines subject, Fleet, monotonic sequence, validity, provenance, and constraints. The envelope carries base64 payload bytes, signature, algorithm, and signing-key ID. A structurally valid envelope alone proves no authority.
- **Profile and checkpoint:** a profile supplies reusable constraints; a checkpoint records restart and rollback floors. Neither substitutes for a verified current signed policy.
- **Receipt and round trip:** a receipt describes a decision. The round-trip fixture binds policy identity and exact payload digest to the recorded Go evaluation and signed Fleet audit. A matching recorded receipt is evidence of that evaluation, never a new device command.
- **Heartbeat and Fleet contracts:** telemetry envelopes authenticate observations; snapshots and events summarise operational state. They do not change local permission.

### Signed bytes and trust

Decode canonical base64 and verify Ed25519 against the exact decoded payload bytes. Do not parse, pretty-print, normalise, or reserialise the payload before signature verification. The browser pins its simulation Fleet key and key ID independently of the selected file; a file's self-declared public key is insufficient. After verification, strict UTF-8 JSON parsing rejects duplicate members and unsupported contract fields. Policy identity and validity are checked separately from signature authenticity.

### Valid and invalid examples

Use copies of the existing fixtures, leaving the published originals unchanged:

| Example | Expected result |
|---|---|
| Unmodified [golden vector](../data/creedspace-bounder-golden-v1.json) | Authentic simulation signature, subject `bounder-alpha`, Fleet `relief-fleet`, sequence `42`. Its historical validity window is 2026-07-13 12:00:00 UTC inclusive to 12:05:00 UTC exclusive; it is expired at today's clock. |
| Golden vector with one decoded payload byte changed and its original signature retained | Signature verification fails, even if the edited JSON is well formed. |
| Golden vector with a replacement public key or key ID | Untrusted-key rejection, including a valid self-signature made by a different key. |
| A signed payload containing duplicate JSON members, unsupported fields, or invalid validity ordering | Rejected by strict parsing or policy validation. A fresh valid signature cannot cure an invalid contract. |
| Unmodified [round-trip evidence](../data/creedspace-bounder-roundtrip-v1.json) matched with its golden vector | Recorded Go and Fleet audit evidence can be verified locally, independently of whether the historical policy is current. |
| Round-trip evidence with an unsigned request changed while keeping its signed allow receipt | Rejected when the request contradicts the bound evaluation. |

Executable positive and negative examples live in [`tests/policy-roundtrip.test.js`](https://github.com/NellInc/Bounder/blob/main/tests/policy-roundtrip.test.js). Run `node --test tests/policy-roundtrip.test.js` from the source checkout. Those tests use explicit fixture times to distinguish authenticity from current authority.

### Failure, expiry, and replay

A malformed file, unsupported signature capability, failed signature, contract mismatch, or unavailable evidence prevents a successful inspection; it supplies no permission. Browser error messages identify verification stages, rather than HTTP API error codes. At `not_before` a policy becomes current; at `expires_at` it is expired. Offline status cannot extend that window.

The Guardian integration must retain monotonic sequence and checkpoint floors: replayed or older policy cannot replace newer accepted authority, and an invalid update cannot broaden the last verified unexpired policy. Browser file inspection does not install policy, persist a Guardian replay floor, or demonstrate restart durability. Verify those guarantees in the producer and target adapter separately.

Selecting a JSON file reads its contents in the browser and does not upload it. The page may still fetch published reference evidence and its optional continuity feed. Local file inspection therefore describes the selected file's handling, not a promise that the whole page is network-free. The contact form is a separate Formspree submission channel.

## Guardian and Fleet observability

Heartbeats, Fleet snapshots, and transition events describe operational state.
They never grant, broaden, or revoke permission. A missed heartbeat changes the
Fleet classification to unreachable; the Guardian continues to derive local
authority only from its verified policy, evidence freshness, checkpoint floor,
and continuity lease.

Detailed telemetry is Fleet-private. Each telemetry signing key is bound to one
subject: a Guardian key signs only that Guardian's heartbeats and events, and
only the Fleet aggregator key signs snapshots. Aggregation either fails the
cycle closed on any invalid heartbeat or, in its quarantining form, counts that
Guardian as missing, so the snapshot cannot be healthy.

Fleet also judges liveness by its own clock. Every reference entry point that
classifies a heartbeat needs the time Fleet received it, which the replay guard
records and returns from `receiveTimes()`, and refuses to classify without it.
A heartbeat stops counting at the earlier of its declared expiry and its receive
time plus the 90-second validity window, so a Guardian clock running fast cannot
extend its own reachability.

In the reference model, the public continuity projection contains only
aggregate counts and is emitted only from a complete, healthy 100-Guardian
snapshot with one completed evaluation per Guardian, zero decision failures and
no audit backlog. Its lease is the snapshot's, at most the 90-second heartbeat
validity window. The deployed staging continuity feed is produced independently
of this reference model and signs its own longer lease: on 26 September 2026 it
issued a proof about every five minutes, each with a 15-minute lease and a
Fleet cycle of about 110 seconds. Browsers accept a signed lease of at most 30
minutes. The reference state model and performance budgets are software
integration proof; deployed Guardian timing, Fleet capacity, and physical
safety remain unverified.

## Platform adapters

| Platform | Typical bounded state change | Local evidence | Safe adapter responses |
|---|---|---|---|
| Aircraft | takeoff, route segment, altitude change | position, altitude, battery, weather, link | hold, loiter, return, land |
| Ground robot | enter zone, cross doorway, change speed | map pose, proximity, identity, load | stop, slow, retreat, park |
| Autonomous boat | enter channel, approach berth, change speed | GNSS, chart zone, traffic, weather | hold station, slow, turn away |
| Warehouse vehicle | cross aisle, lift load, enter human area | localisation, pedestrian distance, load state | brake, lower, wait, reroute |
| Inspection platform | approach asset, energise tool, enter exclusion area | permit, tool state, personnel clearance | inhibit, retract, isolate |
| Fixed machinery | move axis, open valve, energise process | guards, lockout state, pressure, operator key | interlock, stop, vent, isolate |

An adapter should be narrow, deterministic, separately tested, and fail safe. When its input is missing, stale, malformed, or beyond its declared capability, it does the safest thing available — not nothing.

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
BOUNDER_PRODUCER_ROOT=<path to a clean NellInc/Bounder-from-org checkout> npm run verify:producer
node_modules/.bin/impeccable detect .
```

The producer checkout path is not discovered: the gate fails fast unless
`BOUNDER_PRODUCER_ROOT` is set or `--producer-root` is passed.

The producer-derivation gate regenerates public fixtures, checks every shared
schema byte, verifies the clean producer revision, and emits a machine-readable
receipt. Recorded Fleet laboratory and staging-pilot files remain observations;
they are never relabelled as deterministic producer outputs.
