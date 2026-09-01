---
title: Bounder agent ergonomic system
created: 2026-08-31
status: completed-local
stepsCompleted: 8
verification_criteria:
  - "A fresh agent can identify the owning component, authority boundary, edit surface, and proof route for a representative task in under two minutes"
  - "Every governed component declares an owner, inputs, outputs, failure state, source paths, test paths, and proof class in one validated system descriptor"
  - "No two published schemas share one versioned identity while differing byte-for-byte or semantically without an explicit projection contract"
  - "Every published derived evidence artifact reproduces byte-for-byte from a clean immutable producer revision and declared generator"
  - "A future release record identifies decision-producer provenance and website-publisher provenance separately, while all historical manifests remain byte-immutable"
  - "Changed-path planning selects every required gate in a committed impact corpus and does not run irrelevant aggregate gates during diagnosis"
  - "One canonical verification command emits a machine-readable receipt with candidate identity, commands, durations, results, and artifact hashes"
  - "Documentation checks resolve every wiki link and source citation, and reject stale canonical-repository or proof-authority claims"
  - "Guardian heartbeat, Fleet snapshot, and Fleet transition contracts are exact, bounded, sequenced, expiring, privacy-labelled, and executable as a deterministic state model"
  - "Fleet loss, delay, duplication, reordering, clock skew, restart, rollback, partial rollout, and lease expiry have deterministic virtual-time regressions"
  - "Operational heartbeats remain observational, while policy, evidence, checkpoint, and continuity-lease rules remain the only modeled authority inputs"
  - "Reference observability performance budgets are machine checked and explicitly separated from unmeasured Guardian decision-engine performance"
  - "Existing unit coverage, browser acceptance, build, design lint, release-history, and security gates remain green"
---

# Agent-Ergonomic Bounder System

## Purpose

Turn Bounder from a set of individually rigorous parts into a legible control system for both human and agent collaborators. The target system must minimize rediscovery, make authority and proof boundaries impossible to confuse, select the least expensive sufficient validation, and cause every verified change to reduce the cost of the next one.

The design is optimized for five measurable properties:

1. **Discoverability:** the next relevant source and command are obvious from the current task.
2. **State legibility:** source, release, deployment, evidence, and live state are distinct and inspectable.
3. **Control safety:** every mutating action has an owner, bounded surface, precondition, rollback behavior, and authority gate.
4. **Proof quality:** every final claim names the proof class it actually satisfies and the stronger classes it does not.
5. **Knowledge accretion:** new work leaves durable tests, provenance edges, decisions, or task routes instead of narrative residue.

**Working if:** a new agent performs less broad search, runs fewer irrelevant commands, makes no authority-category error, and produces a stronger machine-checkable handoff than the one it received.

## Adversarial Pre-Check

### Goal versus initial framing

The goal is system coherence, not more documentation. More prose without executable links would increase context cost and drift. The design therefore uses one canonical machine descriptor, a small compiled wiki, generated inspection views, and proof receipts. Each representation has one job.

### Current strengths to preserve

1. Browser inputs already use strict, bounded, fail-closed validators. (`policy-roundtrip.js`; `simulator-contracts.js`; `staging-feed.js`; `continuity-evidence.js`)
2. Unit coverage uses per-file floors and browser acceptance runs against an isolated built artifact. (`package.json`; `playwright.config.js`)
3. Publication uses an explicit allowlist and byte-equivalent promotion. (`scripts/build-site.mjs`)
4. Release generation preserves historical manifests and defends against filesystem and ownership races. (`scripts/generate-release-manifest.js`)
5. Pages verification is unprivileged and precedes the narrowly privileged deploy job. (`.github/workflows/deploy-pages.yml`)

### Material mismatches found

1. **Repository identity collapse:** the public site repository is `NellInc/Bounder`. The local decision-engine checkout uses remote `NellInc/Bounder-from-org`, with the Go implementation on `master`. The engine remote’s `main` branch is an unrelated historical website line. The public site documentation instead says the Go implementation and website live in `NellInc/Bounder`. (`README.md:82-105`; observed local Git refs on 2026-08-31)
2. **Provenance role collapse:** current manifests store a site-repository commit as `canonical_interlock`. The generator verifies pinned website files against that local commit. The drift workflow then retrieves evidence from the same site commit. This establishes publisher-source integrity, not independent Go-producer derivation. (`scripts/generate-release-manifest.js:715-804`; `.github/workflows/receipt-drift.yml:40-87`; `release/bounder-reference-v1.0.4.manifest.json`)
3. **Contract ownership drift:** current website evidence vectors match the engine checkout, while at least the receipt and receipt-bundle schemas differ byte-for-byte between the website and the engine’s `origin/master`. The same versioned contract cannot remain silently divergent. (Observed exact SHA-256 comparison on 2026-08-31)
4. **Guidance drift:** internal guidance previously described a pure static site with no build system and referenced a removed footer workflow and obsolete font tokens. Release acceptance actually depends on the Node allowlist build, and current CSS uses system font tokens. (`CLAUDE.md` before this design; `scripts/build-site.mjs`; `styles.css`)
5. **Context concentration:** three browser modules combine contracts, transport, evaluation, orchestration, and presentation across roughly 45 to 75 KiB each. They are behaviorally tested, but their abstraction boundaries are expensive for an agent to load and modify safely. (`policy-roundtrip.js`; `simulator-contracts.js`; `simulator.js`)
6. **Proof selection is implicit:** the repository has strong commands but no single map from changed paths and intended claim to the least expensive sufficient checks. (`package.json`; `README.md:46-80`)
7. **Public continuity is too coarse for operations:** the live proof accepts only a complete healthy 100-Guardian cycle with zero failures. This is intentionally strict public assurance, but it cannot identify a degraded cohort, checkpoint lag, policy drift, audit backlog, or an unreachable Guardian. (`continuity-evidence.js:198-239`)
8. **Operational observability has no canonical contract here:** the external Go checkout contains policy sync, local Guardian evaluation, audit submission, and aggregate continuity generation, but no versioned per-Guardian heartbeat or Fleet transition contract in the observed tree. The checkout is behind its remote and contains unrelated local work, so this programme must not mutate it until producer identity and ownership are resolved. (Observed `../Bounder-Drone` Git and source state on 2026-08-31)

### Scope corrections

This programme will not:

1. Rewrite historical manifests.
2. Claim hardware, certification, deployment, or human assurance from software evidence.
3. Force an immediate monorepo migration.
4. Add a generalized orchestration framework before the narrow descriptor and scripts prove useful.
5. Change live infrastructure, repository visibility, repository names, tags, or release state without fresh explicit authority.
6. Copy the historical `docs/` site into the active architecture.

## Architecture Decision

### Choose a federated system with one control model

Keep the decision producer and public publisher modular. Link them through an explicit versioned system descriptor, immutable revisions, deterministic generators, shared contracts, and cross-repository proof. Do not rely on ambient sibling directory names or prose conventions.

This is preferred over an immediate monorepo because it preserves current history and release boundaries, avoids a large path migration, and still gives agents one coherent system graph. A future monorepo remains possible because the descriptor binds roles rather than hardcoding a physical repository layout.

### One registry, several compiled views

```text
system/bounder-system.v1.json       canonical machine control model
             |
             +--> npm run inspect             current state view
             +--> npm run check:changed       task and proof plan
             +--> npm run verify              aggregate execution
             +--> wiki validation             architecture drift checks
             +--> CI path selection           authoritative gates
             +--> release provenance          producer and publisher lineage

_wiki/                                 human and agent conceptual synthesis
CLAUDE.md                              thirty-second routing and holds
README.md                              public project and contributor entry
verification receipts                 candidate-specific machine evidence
```

The JSON descriptor is canonical for component identity, role ownership, paths, commands, and proof relationships. The wiki is canonical for explanatory synthesis and design rationale. Generated outputs never become manually edited truth.

## Target Abstraction Tower

| Level | Stable abstraction | Owned artifact | Control decision | Evidence |
|---|---|---|---|---|
| 0 | Physical safety outcome | Hazard analysis and adapter safe-state contract | Which transitions are acceptable | Human review, HIL, operational approval |
| 1 | Governance intent | Creed Space policy sources | Which protective conditions apply | Policy version and authorship |
| 2 | Machine authority | Signed device-bound policy envelope | Is authority authentic and current | Signature, subject, sequence, validity |
| 3 | Local decision | Guardian evaluator | Does the request satisfy current constraints | Deterministic receipt |
| 4 | Physical response | Device adapter | Which safe platform transition follows | Adapter record and hardware evidence |
| 5 | Evidence | Receipt, audit, checkpoint, resilience, continuity | What happened and under which inputs | Signed or immutable artifact |
| 6 | Verification and presentation | Browser validators and simulator | What can be established locally | Verification result with explicit limits |
| 7 | Publication | Site build and release seal | Which exact bytes are public | Publisher revision, build receipt, manifest |
| 8 | Live observation | Pages and continuity endpoint | What is reachable and fresh now | Retrieval, signature, parity, and lease |

Every lower transition may preserve or narrow authority. No transition may broaden it. Evidence and presentation never become actuator authority.

## Canonical System Descriptor

Create `system/bounder-system.v1.json` and `system/bounder-system.v1.schema.json`.

### Required top-level fields

```text
schema_version
system_id
roles
components
artifacts
commands
proof_classes
impact_rules
documentation
budgets
```

### Role record

Each role declares:

```text
id
responsibility
repository
default_ref
local_discovery
authority_owned
authority_forbidden
```

Initial roles:

1. `policy_distributor`
2. `decision_producer`
3. `platform_adapter`
4. `evidence_publisher`
5. `browser_verifier`
6. `simulator_presenter`
7. `site_publisher`
8. `release_sealer`
9. `live_evidence_service`
10. `guardian_observer`
11. `fleet_observer`

### Component record

Every component declares:

```text
id
role
purpose
source_paths
test_paths
inputs
outputs
failure_state
mutates
network
secrets
proof_classes
depends_on
```

Reject cycles except explicitly declared observation feedback. Reject overlapping ownership unless the descriptor names one owner and the other role as a consumer.

### Artifact record

Every derived or published artifact declares:

```text
id
contract
producer_component
generator
input_inventory
output_paths
canonical_owner
publication_paths
verification
```

### Proof class record

Each proof class declares:

```text
id
claim_supported
required_commands
required_artifacts
expires_after
does_not_establish
```

Initial classes:

1. `source_behavior`
2. `browser_behavior`
3. `publisher_integrity`
4. `producer_derivation`
5. `cross_repository_compatibility`
6. `deployment_parity`
7. `live_continuity`
8. `runtime_observability`
9. `observability_performance`
10. `physical_safety`
11. `human_legal_regulatory`

## Agent Command Design

### `npm run inspect`

Read only. It reports:

1. Site repository, branch, HEAD, upstream relation, and dirty paths.
2. Version and current release manifest identity.
3. Producer repository discovery, remote identity, selected revision, and cleanliness.
4. Schema identity collisions and website versus producer hash status.
5. Current public inventory and generated artifact state.
6. Available toolchains and browser binary state.
7. Known holds and the next safe command.

Support `--json`. Human output must remain under roughly 80 lines unless `--verbose` is supplied.

### `npm run check:changed`

Read only. It maps a Git diff or explicit path list to:

1. Affected components.
2. Authority boundaries crossed.
3. Release-pinned status.
4. Minimum discriminating tests.
5. Aggregate gates required for the intended claim.
6. Documentation or provenance records requiring refresh.

Support `--base`, `--paths`, `--claim`, and `--json`.

### `npm run verify`

One canonical local aggregate gate. It runs named phases in dependency order and writes a verification receipt only after capturing every result.

```text
descriptor
contracts
unit-coverage
publication-build
browser
design-lint
documentation
```

Individual phases remain callable for diagnosis.

### `npm run verify:release`

Adds:

1. Clean candidate checks.
2. Producer regeneration in an isolated checkout.
3. Contract byte and semantic parity.
4. Publisher provenance.
5. Historical manifest integrity.
6. Future manifest validation.
7. Staged and recent-history file-size checks.

It creates no commit, tag, push, or deployment.

### `npm run evidence:refresh`

Requires an explicit producer repository and full revision. It generates into an owned staging directory, validates all outputs, prints the exact diff, and promotes only after every check passes. It never edits the producer checkout or infers a revision from a branch name.

### `npm run verify:live`

Read only unless a future authenticated probe explicitly requires authorization. It verifies:

1. `www` and apex behavior.
2. Live bytes against the sealed publisher artifact.
3. Canonical metadata and custom 404 behavior.
4. Approved behavioral markers.
5. Continuity signature, identity, health, replay order, and freshness.

It outputs observation time and expiry. Live evidence is never cached as current truth after expiry.

### `npm run docs:check`

Checks:

1. Wiki link resolution.
2. File and line citation existence.
3. Index coverage.
4. Append-only log ordering.
5. Active-page freshness.
6. Canonical repository claims against the descriptor.
7. Command names against `package.json`.
8. Generated sections against their sources.

## Verification Receipt

Write candidate receipts under ignored `artifacts/verification/`. A release may copy the final receipt into a versioned, manifest-pinned location.

```json
{
  "version": "bounder-verification/v1",
  "candidate": {
    "publisher_commit": "full SHA",
    "producer_commits": ["full SHA"],
    "dirty": false
  },
  "started_at": "canonical UTC",
  "finished_at": "canonical UTC",
  "environment": {
    "platform": "...",
    "toolchains": {}
  },
  "phases": [
    {
      "id": "unit-coverage",
      "command": ["npm", "run", "test:coverage"],
      "exit_code": 0,
      "duration_ms": 0,
      "log_sha256": "..."
    }
  ],
  "artifacts": [],
  "claims": [],
  "unverified": []
}
```

The receipt records proof. It does not grant publication authority.

## Provenance v2

### Preserve history

All `bounder-reference-v1.x.x.manifest.json` files remain byte-immutable. Their existing `canonical_interlock` field retains its historical meaning.

### Future shape

Create a new release-manifest schema with explicit roles:

```text
release_version
manifest_version
license
generated_at
publisher_source
evidence_producers[]
build
files[]
verification_receipt
```

`publisher_source` names the public-site repository and exact source commit.

Each `evidence_producers[]` entry names:

```text
role
repository
commit
generator
toolchain
inputs[]
outputs[]
```

No field may use a mutable branch as provenance. A branch may appear only as advisory discovery metadata beside the full commit.

## Runtime Reliability and Fleet Observability

### Authority and observation split

Operational telemetry describes Guardian and Fleet state. It never grants, broadens, or revokes permission. Local policy validity, evidence freshness, checkpoint floors, and continuity leases remain the modeled authority inputs. A missed heartbeat causes the Fleet observer to classify a Guardian as unreachable; the Guardian's local authority changes only through its own fail-safe rules.

**Working if:** deleting, delaying, duplicating, or reordering every heartbeat cannot produce a new allowed decision, while Fleet state still converges to an accurate degraded or unreachable classification.

### Contract family

Publish four exact JSON Schema contracts:

1. `creedspace-bounder-telemetry-envelope/v1`: Ed25519 over exact payload bytes, with an explicit message kind and key identifier.
2. `creedspace-bounder-guardian-heartbeat/v1`: private per-Guardian observation with boot epoch, monotonic sequence, policy and checkpoint high-water marks, authority lease dates, decision latency, audit backlog, resource pressure, and one operational state.
3. `creedspace-bounder-fleet-snapshot/v1`: private aggregate state with counts, platform cohorts, policy and checkpoint ranges, performance summaries, and failure-reason counts, without Guardian identifiers.
4. `creedspace-bounder-fleet-event/v1`: private transition event emitted only for meaningful state, boot, policy, checkpoint, or reachability changes.

The existing `bounder-continuity-evidence/v1` remains the privacy-safe public all-green projection. It may be emitted only from a complete, fresh, zero-failure snapshot. Detailed heartbeats and events never enter the public website artifact as data.

**Working if:** the public projection contains no Guardian identifier or private diagnostic detail, and any non-healthy, stale, incomplete, or internally inconsistent input refuses projection.

### Fleet state model

Use the mutually exclusive operational states `healthy`, `degraded`, `held`, `recovering`, and Fleet-derived `unreachable`. Operational reasons are closed enums. Validate state and reason consistency, validity windows, monotonic heartbeat order, non-regressing policy and checkpoint floors, and boot-epoch replay.

**Working if:** the same ordered heartbeat corpus always yields the same final Fleet snapshot and events, and every reordered, duplicated, replayed, expired, or rollback corpus fails closed or produces the specified degraded state.

### Resource policy

Healthy stable Guardians use a bounded adaptive interval with deterministic jitter. Degraded, held, and recovering Guardians report more frequently. State transitions emit events immediately. Payloads, fleet size, counters, and validity windows are bounded before aggregation.

Reference budgets apply only to the observability implementation in this repository. They do not establish production Guardian latency, hardware suitability, or Fleet capacity.

**Working if:** one committed benchmark corpus checks payload size, one-pass aggregation, and schedule bounds without presenting those numbers as decision-engine performance.

### Shared derivation

The system descriptor owns component relationships, impact rules, commands, proof classes, and reference budgets. The same state vocabulary feeds schemas, runtime validation, tests, inspection, changed-path planning, and documentation checks.

**Working if:** adding an observability component or contract without its owner, test route, proof class, and impact rule makes descriptor validation fail.

### Producer statement

The decision engine generates `bounder-evidence-provenance/v1` beside its outputs. It includes exact producer revision, clean status, generator version, input hashes, output hashes, and contract hashes. The website refresh command verifies this statement before promotion.

### Contract convergence

1. Inventory every shared `$id`, version string, fixture version, and validator.
2. Diff website and producer copies byte-for-byte and semantically.
3. For each divergence, decide whether it is drift or an intentional projection.
4. Port valid hardening into the canonical owner.
5. Publish byte-identical canonical schemas.
6. Give any intentional projection a different `$id`, name, and transformation test.
7. Add a clean-checkout cross-repository corpus test.

**Working if:** the site cannot pass a release gate by comparing a contract or fixture only with another copy inside the site repository.

## Module Boundary Plan

Decompose only after the descriptor, impact map, and baseline verification receipt exist. Preserve current facade filenames until consumers migrate.

### Policy round trip

```text
policy-roundtrip.js                  compatibility facade and bootstrap
runtime/json/strict-json.js          duplicate-safe parsing and snapshots
runtime/crypto/encoding.js           canonical base64 and digest helpers
runtime/transport/bounded-json.js    origin, MIME, timeout, byte and chunk limits
runtime/policy/contracts.js          profile, policy, envelope validation
runtime/policy/evaluator.js          deterministic local evaluation
runtime/policy/roundtrip.js          receipt and audit relationship checks
ui/policy-roundtrip-panel.js         DOM state and latest-request arbitration
```

### Simulator contracts

```text
simulator-contracts.js               compatibility facade
runtime/receipts/contracts.js        receipt and bundle validation
runtime/fleet/contracts.js           pilot and Fleet evidence validation
runtime/resilience/contracts.js      scenario, stream, alias, and URL rules
```

### Simulator presentation

```text
simulator.js                         composition root
simulator/scene.js                   Three.js world and renderer lifecycle
simulator/decision-view.js           receipt and rule presentation
simulator/fleet-view.js              Fleet projection
simulator/resilience-controller.js   event playback and safe fallback
simulator/operator-tour.js           guided evidence flow
simulator/lifecycle.js               visibility, focus, resize, and WebGL loss
```

Rules:

1. Parsing and validation modules have no DOM access.
2. Presentation modules never recompute allow or hold decisions.
3. Transport modules return bytes or validated immutable values, never UI state.
4. Facades preserve external imports during migration.
5. Each extracted module receives focused tests before the original code is removed.
6. No generic utility module accepts unrelated responsibilities.
7. Split one bounded concern per commit, then run the aggregate gate.

## Knowledge Accretion Model

### Truth hierarchy

```text
code, schemas, fixtures, and Git state
             |
             v
validated system descriptor
             |
             v
compiled wiki and generated inspection
             |
             v
CLAUDE routing and public README
```

When layers disagree, repair the compiled layer or surface an intentional tension. Do not patch code to preserve stale prose.

### Durable contributions

Every completed change should add the smallest applicable durable artifact:

1. A regression test for a behavior or invariant.
2. A descriptor edge for a new component or dependency.
3. A provenance record for a generated artifact.
4. A decision record for a surprising architectural choice.
5. A wiki update for cross-component synthesis.
6. A residual risk with a named closing gate.

Ordinary file lists, test counts, and session narratives remain in Git or verification receipts.

### Decision records

Create `_wiki/decisions/` only when the first implementation choice is both durable and non-obvious. Use a short template:

```text
context
decision
alternatives
consequences
reversal trigger
working if
provenance
```

## Phased Implementation

### Phase 0: Freeze the baseline and resolve identities

1. Record current site HEAD, version, manifest, tests, public inventory, and schema hashes.
2. Confirm the intended canonical decision-producer repository. The observed candidate is `NellInc/Bounder-from-org` on `master`; its `main` is an unrelated historical website branch.
3. Decide whether the producer repository will remain private, become public, or receive a stable public mirror. Public reproducibility requires an accessible immutable source or an equivalently reviewable source bundle.
4. Name the site role `publisher` and the Go role `decision_producer` everywhere.
5. Record the schema divergence inventory.

Gate: no public copy, manifest semantics, repository visibility, or release changes before the identity decision is recorded.

### Phase 1: Install the machine control model

1. Add the system descriptor and schema.
2. Add exhaustive descriptor validation tests.
3. Add a committed test corpus for valid and invalid component graphs and impact rules.
4. Make `CLAUDE.md` and wiki routes point to descriptor-backed concepts.

Gate: every current component and command is represented, with no ownership ambiguity.

### Phase 2: Add read-only agent controls

1. Implement `inspect`.
2. Implement `check:changed`.
3. Implement `docs:check`.
4. Add stable JSON outputs and compact human rendering.

Gate: representative task fixtures produce the expected components and proof plan.

### Phase 3: Unify verification

1. Implement the phase runner and verification receipt.
2. Retain existing npm commands as direct diagnostic entry points.
3. Add signal handling, explicit timeouts, log hashes, and owned temporary directories.
4. Update CI to call the canonical phase runner.

Gate: local and CI phase results agree on the same candidate and artifact hashes.

### Phase 4: Repair contract ownership and evidence derivation

1. Compare all website and producer contracts and fixtures.
2. Port valid strictness to the canonical contract owner.
3. Make shared contracts byte-identical.
4. Add producer statements and isolated evidence refresh.
5. Replace the self-comparison drift gate with producer regeneration.

Gate: a clean producer revision regenerates every published derived artifact byte-for-byte.

### Phase 5: Introduce provenance v2

1. Add the new manifest schema and generator.
2. Register old manifests as immutable v1 history.
3. Add explicit producer and publisher identities.
4. Add release and live verification commands.
5. Update public documentation to describe the real repository topology and proof limits.

Gate: the next release candidate proves producer derivation, publisher integrity, browser behavior, and deployment parity as distinct classes.

### Phase 6: Install runtime reliability and Fleet observability

1. Add the telemetry envelope, Guardian heartbeat, Fleet snapshot, and Fleet event schemas.
2. Add a pure reference state model, monotonic replay guard, aggregation, private/public projection, transition event derivation, and adaptive schedule.
3. Add deterministic virtual-time fault tests and a bounded benchmark corpus.
4. Register observability components, artifacts, impact rules, commands, proof classes, and budgets in the system descriptor.
5. Document the deployment handoff to the confirmed Guardian producer and Fleet backend without mutating either unresolved external owner.

Gate: every local contract and state invariant passes, the public projection refuses degraded input, and the reference budgets pass. Actual deployed Guardian and Fleet improvement remains unverified until the canonical external owners implement and measure the contracts.

### Phase 7: Decompose browser modules

1. Extract strict JSON and transport primitives.
2. Extract policy contracts and evaluation.
3. Extract receipt, Fleet, and resilience contracts.
4. Extract simulator controllers and views.
5. Remove compatibility facades only after all consumers migrate.

Gate: behavior, coverage floors, browser acceptance, and public bytes change only where intentionally approved.

### Phase 8: Close the agent loop

1. Generate contributor task routes from the descriptor.
2. Generate CI path filters from the same impact rules.
3. Add a repository health summary to `inspect`, not a manually edited status file.
4. Measure orientation time, check-plan precision, aggregate gate duration, and provenance completeness.
5. Tune only from observed cost or error data.

Gate: one registry drives local planning, CI selection, documentation validation, and release evidence without duplicated manual maps.

## Validation Matrix

| Changed surface | Focused check | Required aggregate proof | Additional hold |
|---|---|---|---|
| Wiki or agent routing | `npm run docs:check` | Descriptor tests | None if no public pinned file changes |
| Descriptor or impact rules | Descriptor suite and task corpus | `npm run verify` | Review ownership and proof-class diff |
| Strict parser or transport | Focused unit file | Coverage plus browser | Security review for broadened origin or size policy |
| Policy evaluator | Policy unit suite and golden corpus | Coverage plus browser plus producer compatibility | No presentation-derived authority |
| Receipt or shared schema | Both repository contract suites | Full verify plus clean producer regeneration | Version or projection decision |
| Simulator view | Focused browser scenario | Browser plus Impeccable | Decision source remains receipt-driven |
| Build allowlist | Publication unit suite | Full verify | Public inventory review |
| Release generator | Manifest unit suite | `verify:release` | Historical bytes unchanged |
| Continuity trust anchor | Signature and lease tests | Full verify plus authorized live observation | Key custody and rotation record |
| Public copy about proof | Docs check | Browser acceptance | Claim-class review |

## Resource Budget

1. Orientation reads one routing file, one wiki page, and machine inspection output.
2. Diagnostic work runs focused checks selected by the impact graph.
3. Aggregate work runs one canonical gate once the diff stabilizes.
4. Immutable fixtures replace live calls unless live state is the claim.
5. Full logs remain on disk; the console receives phase summaries and failures.
6. CI caches immutable dependencies and browser binaries, never authority, freshness, or trust decisions.
7. The descriptor remains bounded. Add a field only when a command, proof, or decision consumes it.

## Completion Definition

The programme is complete when:

1. The descriptor validates and represents the entire current system.
2. Agent commands derive from the descriptor rather than duplicated path lists.
3. Documentation routes and citations pass their own gate.
4. Shared contracts have one explicit owner and no silent same-version divergence.
5. Evidence is reproducible from a clean immutable producer revision.
6. Release provenance distinguishes producer, publisher, deployment, and live observation.
7. The large browser modules have bounded, testable ownership seams.
8. Guardian heartbeat and Fleet state contracts have deterministic replay, expiry, projection, fault, and resource-budget proof.
9. The complete current test, coverage, browser, design, build, security, and release-history gates pass.
10. No external publication action has occurred without explicit authority.
11. Residual deployment, physical, certification, human, legal, and regulatory gaps remain explicitly unverified.

## Deviations

| Date | Phase | Discovery | Conservative choice | Review needed |
|---|---|---|---|---|
| 2026-08-31 | Design | Historical v1 manifests identify the website commit through `canonical_interlock`, while the Go decision producer is a separate repository | Preserve every historical byte and introduce manifest v2 with separate producer and publisher identities | None for local sealing; public independent regeneration still requires producer access or a reviewable source bundle |
| 2026-08-31 | Phase 0 | The pre-existing `../Bounder-Drone` checkout is dirty and behind its remote, while `NellInc/Bounder-from-org` on `master` is the confirmed private producer | Leave the dirty checkout untouched and create `/Users/nellwatson/Documents/GitHub/Bounder-from-org-agent-ergonomic` as an isolated clean producer clone | Merge or publish the producer branch only with separate authority |
| 2026-08-31 | Phase 4 | Website and producer schemas shared versioned identities while differing in bytes and strictness | Converge 13 shared schemas on the stronger website contracts, add producer contract tests, and require exact byte parity | None for the local cross-repository proof |
| 2026-08-31 | Phase 4 | Fresh Go binaries on this macOS host can pause at `_dyld_start`, making a generator that also runs the complete producer test suite exceed its proof timeout | Keep evidence export deterministic and bounded; run producer tests as their own gate rather than hiding them inside generation | Diagnose host loader latency separately if producer verification becomes operationally frequent |
| 2026-08-31 | Phase 4 | The public 16-Guardian Fleet laboratory is a recorded observation and differs intentionally from the producer's deterministic 100-device Fleet fixture | Regenerate only the three declared producer outputs and preserve the laboratory and staging files as recorded observations | Any future derivation must use a new explicit artifact role and generator |
| 2026-09-01 | Phase 7 | Moving each large behavior core into many files in one pass would create broad dependency rewiring without changing behavior | Establish stable composition facades and narrow responsibility seams, keep the proven cores internal, and stop once boundary, coverage, build, and browser gates establish the migration | Deeper internal extraction requires observed edit-cost evidence or a behavior change that benefits from it |
| 2026-09-01 | Phase 8 | Local and CI path routing would drift if encoded separately | Generate the human task route and CI impact corpus from the same validated descriptor and make stale output fail closed | None |
| 2026-09-01 | Closure | The exact verifier ran while host load exceeded 45 and failed a wall-clock aggregation budget even though the aggregation consumed about 770 ms of process CPU | Gate reference algorithmic cost on process CPU time and record monotonic wall time as a diagnostic, preserving visibility without converting unrelated scheduler pressure into a code failure | Production wall-time capacity still requires a controlled deployed benchmark |

## Implementation Status

1. Phase 0 is complete locally: the public publisher and private decision producer have distinct repository roles, default refs, exact immutable commits, and discovery paths. The private producer's public reproducibility gap remains explicit.
2. Phases 1 through 3 are complete locally: one validated descriptor drives inspection, changed-path planning, documentation checks, aggregate verification, and machine receipts.
3. Phase 4 is complete locally across both repositories: the producer exports a hash-bound provenance statement, 13 shared contracts are byte-identical, three published derived artifacts regenerate exactly, and the drift workflow no longer compares the publisher with itself.
4. Phase 5 is complete locally: manifest v2 preserves historical manifests and separates producer, publisher, build, deployment, live observation, and recorded-observation claims. The two-commit seal is the final local release operation.
5. Phase 6 is complete as a reference implementation: exact telemetry contracts, deterministic Fleet state, replay and rollback guards, privacy-safe projection, transition events, adaptive heartbeat scheduling, virtual-time fault tests, and a bounded reference benchmark are implemented. Deployment into a Guardian or Fleet backend remains external and unverified.
6. Phase 7 is complete at the stable ownership boundary: public entry points are small composition facades, narrow modules name policy, transport, crypto, receipt, Fleet, resilience, UI, and simulator responsibilities, and proven behavior cores remain internal behind those APIs.
7. Phase 8 is complete locally: generated task routes, generated CI impact data, focused verification, and inspection health metrics derive from the descriptor.
8. Historical manifests remain byte-immutable. No tag, push, deployment, live mutation, or publication action is authorized or performed by this programme.

## Local Closure State

The implementation is complete when the two local release commits are present and the exact source candidate has a successful aggregate verification receipt. External closure remains deliberately separate:

1. Producer branch publication or merge requires repository authority.
2. Site branch publication, tag, Pages deployment, and live-byte verification require publication authority.
3. Fleet backend and deployed Guardian adoption require their confirmed owners.
4. Hardware safety, certification, human, legal, rights, and regulatory review require their own evidence and accountable reviewers.

**Working if:** a fresh agent can identify the producer, publisher, authority boundary, affected components, minimum proof route, current receipts, and remaining external holds from one inspection command and one linked wiki page, while heartbeat failure can degrade Fleet classification without changing local decision authority.
