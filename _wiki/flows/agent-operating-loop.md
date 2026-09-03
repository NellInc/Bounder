# Agent Operating Loop

<!-- wiki:type = flow -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-08-31 -->
<!-- wiki:updated = 2026-09-03 -->
<!-- wiki:status = active -->

## Summary

An agent working on Bounder needs a low-cost path from intent to the smallest safe edit and the strongest relevant proof. This flow provides progressive disclosure, task routing, explicit state transitions, and accretive closeout. The system descriptor and agent commands select and explain the repository's unit, coverage, browser, design-lint, build, manifest, and documentation gates. (`system/bounder-system.v1.json:1-20`; `package.json:6-22 "release:manifest:v2"`; `README.md:63-86`)

## Thirty-Second Orientation

Read and inspect in this order:

1. `CLAUDE.md`: repository boundary, holds, release rules, and links into the system map.
2. `_wiki/index.md`: abstraction map and task routes.
3. `git status --short --branch`: branch and dirty ownership.
4. `VERSION` and `release/bounder-reference-v<VERSION>.manifest.json`: current release identity and pinned surfaces.
5. The one source page named by the task router below.

Stop broad exploration once the task surface, authority boundary, and proof route are known.

## Intent Router

| Intent | Read first | Primary surfaces | Minimum proof | Escalation trigger |
|---|---|---|---|---|
| Change public copy or layout | [[bounder:systems/site-architecture]] | Root HTML, `styles.css`, `simulator.css` | Relevant unit checks, `npm run build`, browser acceptance, Impeccable | Pinned public file changed, requiring release-aware handling |
| Change browser policy or evidence logic | [[bounder:seams/evidence-provenance]] | `policy-roundtrip.js`, `simulator-contracts.js`, `staging-feed.js`, `continuity-evidence.js` | Focused unit test, coverage gate, browser acceptance | Contract semantics or trust anchor changed |
| Change simulator state or presentation | [[bounder:systems/site-architecture]] | `simulator.js`, `simulator-fallback.js`, `simulator-world.js`, `simulator.html` | Focused unit test, route checks, browser acceptance, Impeccable | Decision semantics appear in presentation code |
| Refresh fixtures or schemas | [[bounder:seams/evidence-provenance]] | Producer checkout, `data/`, `schemas/` | Producer generation, exact hashes, both contract suites, drift gate | Producer identity or contract ownership is unresolved |
| Change publication tooling | [[bounder:systems/site-architecture]] | `scripts/build-site.mjs`, publication tests, Pages workflow | Publication unit suite, coverage, build, browser acceptance | Inventory or privilege boundary changes |
| Prepare a release | [[bounder:seams/evidence-provenance]] | All pinned paths, `VERSION`, `CHANGELOG.md`, `release/` | Full quality, build, manifest verification, size check | Producer and publisher provenance disagree |
| Change security claims or controls | `SECURITY.md` plus [[bounder:systems/system-architecture]] | Trust-boundary code, workflows, docs | Threat-specific regression plus all affected aggregate gates | Physical, credential, or deployment authority changes |
| Update internal architecture knowledge | `_wiki/index.md` and wiki schema | `_wiki/`, `_contprompts/`, `CLAUDE.md` | Citation, cross-link, and source-drift review | Public or release-pinned guidance also changes |
| Change heartbeat, Fleet state, or observability budgets | [[bounder:systems/runtime-observability]] | `runtime/observability/`, `runtime/json/`, observability tests | `npm run test:observability`, `npm run benchmark:observability`, coverage and docs | Deployed producer or Fleet integration is requested |
| Change a public telemetry schema | [[bounder:systems/runtime-observability]] | Four observability schemas and compatible reference validators | Observability tests and benchmark, coverage, build, browser, docs | Release pinning or producer contract adoption is requested |

The touched surfaces and current tests support these routes. (`README.md:9-45`; `tests/interface.test.js:13-101`; `tests/site-quality.test.js:55-84`; `tests/publication.test.js:80-113`)

## Control Loop

### 1. Observe

Capture branch, dirty paths, version, candidate manifest, relevant workflow state, and any owned process. Read exact files rather than summaries.

### 2. Orient

Classify the request by:

1. System level in the abstraction tower.
2. Authority owner.
3. Input and output contracts.
4. Evidence class needed for the final claim.
5. Release sensitivity of the touched paths.

### 3. Contract

Write a compact task contract before mutation:

```text
goal:
allowed surfaces:
invariants preserved:
non-goals:
proof required:
publication authority:
```

If the answer changes the architecture, resolve it before implementation. During execution, choose the conservative reversible path and record genuine deviations in the active contprompt.

### 4. Mutate

Prefer the smallest coherent diff. Keep parsing, contracts, transport, decision state, presentation, and publication concerns within their owning layer. Add generalized machinery only when repeated evidence shows the simpler path is insufficient.

### 5. Prove

Run the narrowest discriminating test first. Run the aggregate gate required by the final claim after the implementation stabilizes. A focused pass accelerates diagnosis; it cannot substitute for an aggregate release claim.

### 6. Seal

For release-sensitive work, freeze source bytes before manifest generation. A release uses a source commit followed by a manifest commit because the generator requires an existing source commit whose bytes match the pinned working tree. (`README.md:88-109 "Never amend source commit A"`; `scripts/generate-release-manifest-v2.mjs:101-130`)

### 7. Publish

Push, deploy, tag, or change external systems only with explicit publication authority. Verify live bytes and behavior separately from local source proof.

### 8. Accrete

Leave future agents one or more durable improvements:

1. A behavioral regression test for a new invariant.
2. A machine-readable provenance edge for a derived artifact.
3. A short design decision for a surprising constraint.
4. A corrected task route or proof command.
5. A named residual risk with its closing gate.

Do not add a session diary. Git already records ordinary changes.

## Current Command Surface

| Command | Current meaning | Claim supported |
|---|---|---|
| `npm test` | First-party unit suite | Tested source behavior without coverage-floor claim |
| `npm run test:coverage` | All selected first-party sources plus per-file floors | Aggregate unit behavior and configured coverage |
| `npm run test:browser` | Builds isolated `_site`, serves it, runs Chromium acceptance | Browser behavior of the assembled artifact |
| `npm run build` | Recursively assembles and byte-checks the public allowlist | Local publication artifact integrity |
| `npm run quality` | Coverage, browser acceptance, and deterministic design lint | Current aggregate local quality surface |
| `npm run release:manifest:v2` | Seals a release candidate from an existing publisher commit plus producer and verification receipts (`--publisher-commit`, `--producer-receipt`, `--verification-receipt`) | Publisher integrity and producer derivation at a pinned commit |
| `npm run system:check` | Validates the system descriptor, references, paths, command surface, and budgets | Executable control-model integrity |
| `npm run inspect` | Reports repository, release, producer-discovery, contract, budget, and hold state | Read-only orientation snapshot |
| `npm run check:changed` | Maps changed paths to components, boundaries, tests, and proof classes | Minimum sufficient verification plan |
| `npm run docs:check` | Resolves wiki links and citations, index coverage, freshness markers, and explicit claim holds; a citation written as `path:N-M "exact fragment"` additionally fails unless that fragment is inside the cited range | Internal knowledge integrity |
| `npm run test:observability` | Runs deterministic heartbeat and Fleet state contracts and faults | Reference runtime-observability behavior |
| `npm run benchmark:observability` | Checks 10,000-Guardian aggregation and payload budgets | Local reference observability cost only |
| `npm run verify` | Runs canonical ordered phases and writes an ignored machine receipt | Candidate-specific local proof classes |

The scripts and Playwright server configuration define these meanings. (`package.json:6-22 "release:manifest:v2"`; `playwright.config.js:17-22`)

`npm run release:manifest` still exists and still runs `scripts/generate-release-manifest.js`, the v1 generator whose `canonical_interlock` field describes website source provenance rather than decision-engine provenance. It is retained only because historical v1 manifests must stay byte-immutable and remain under test. Do not use it to seal a new release. (`package.json:12 "release:manifest"`; `tests/release-manifest.test.js:8-20 "generateReleaseManifest"`)

`npm run docs:check` supports an opt-in anchored citation form: a quoted exact fragment may follow a citation's line range, as in `README.md:1 "# Bounder website"`. The fragment then becomes load-bearing — the check fails if the cited range stops containing it — which is the only defence this repository has against silent citation drift when a cited file is edited. Prefer it wherever the supporting text is short and stable. Pages under `_wiki/generated/` are exempt from the `wiki:updated` freshness marker, because they are compiled from the descriptor and byte-compared by `npm run system:generate --check` rather than dated by hand. (`scripts/docs-check.mjs:7-9 "opts a citation into a"`; `scripts/docs-check.mjs:47-50 "an anchor absent from that range"`; `scripts/docs-check.mjs:71-80 "generated/"`)

Unit suites write their receipts into scratch directories rather than into the working tree, so a test run never leaves evidence in `artifacts/` that reads like a genuine verification. (`tests/agent-commands.test.js:253-259 "bounder-verify-cli-receipts-"`)

Reproducible simulator findings from outside the team arrive through `.github/ISSUE_TEMPLATE/operator-demo.yml`, which frames them as reports about recorded reference evidence and browser presentation rather than about deployed Guardian hardware. (`.github/ISSUE_TEMPLATE/operator-demo.yml:1-9 "Operator demonstration finding"`)

That template and `design/**` are covered by the `repository_provenance` impact rule, whose only command is `docs_check`: neither ships in any artifact, so the sole thing that can be wrong about them is a documentation citation. Changing either needs no build, browser, or release proof. (`system/bounder-system.v1.json:1497-1521 "repository_provenance"`)

## Target Command Surface

The implementation plan should converge on these agent-facing commands:

| Command | Purpose | Output contract |
|---|---|---|
| `npm run inspect` | Read-only snapshot of repository, release, provenance, and gate state | Concise human text plus `--json` |
| `npm run check:changed` | Derive affected components and minimum tests from changed paths | Ordered command plan plus reasons |
| `npm run verify` | One canonical local aggregate gate | Stable phase names, exit codes, durations, artifact paths |
| `npm run verify:release` | Release candidate proof including provenance and manifest semantics | Candidate identity plus every passed or failed proof class |
| `npm run verify:live` | Compare sealed artifact and approved behavioral markers with deployment | Retrieval time, origin, hashes, and freshness |
| `npm run evidence:refresh` | Reproduce evidence from an explicit producer revision into a staging directory | Producer identity, inputs, outputs, and diff summary |
| `npm run docs:check` | Check wiki links, citations, freshness, and generated sections | Exact stale or broken references |

All inspection commands are read only. Mutation commands stage into owned temporary paths, validate before promotion, and return the recovery location on ambiguous failure, following the existing build and manifest safety pattern. (`scripts/build-site.mjs:365-520`; `scripts/generate-release-manifest.js:806-928`; `scripts/build-site.mjs:540-600 "sweepOrphanedScratch"`)

## Cost Controls

1. Use path impact to avoid irrelevant aggregate gates during diagnosis.
2. Preserve one authoritative aggregate command so final proof is never assembled from memory.
3. Reuse deterministic fixtures for ordinary work; use live services only for the claim that requires them.
4. Emit structured summaries and keep full logs on disk.
5. Cache immutable dependencies and browser binaries in CI, while never caching trust decisions or live freshness.
6. Stop after the required proof passes unless new evidence exposes a material defect.
7. After two equivalent inconclusive or failed attempts, gather discriminating evidence or change strategy.

## Stop Conditions

Stop mutation and surface the state when:

1. Producer identity is ambiguous for a provenance-bearing release.
2. A source change would rewrite a historical manifest.
3. A browser or evidence component begins to mint operational authority.
4. A required proof depends on hardware, certification, rights, or human review that is absent.
5. Dirty work ownership is unclear.
6. A live or deployment action lacks explicit authorization.

## Working If

This operating loop is working when a fresh agent can select the correct files and proof route in under two minutes, make no authority-category error, run no irrelevant full gate during initial diagnosis, and leave a machine-checkable improvement that reduces the next agent’s search cost.

## Provenance

- Sources consulted: `CLAUDE.md`, `README.md`, `package.json`, `playwright.config.js`, `scripts/build-site.mjs`, `scripts/docs-check.mjs`, `scripts/generate-release-manifest.js`, `scripts/generate-release-manifest-v2.mjs`, `tests/agent-commands.test.js`, `tests/interface.test.js`, `tests/site-quality.test.js`, `tests/publication.test.js`, `.github/ISSUE_TEMPLATE/operator-demo.yml`
- Last verified against sources: 2026-09-03

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:seams/evidence-provenance]]
- [[bounder:systems/site-architecture]]
- [[bounder:systems/runtime-observability]]
