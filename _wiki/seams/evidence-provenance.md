# Evidence and Provenance Seam

<!-- wiki:type = seam -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-08-31 -->
<!-- wiki:updated = 2026-09-03 -->
<!-- wiki:status = active -->

## Summary

The evidence seam connects governance, the Go decision producer, the browser verifier, the static publication pipeline, and live continuity reporting. Its purpose is to preserve artifact identity and proof meaning across every handoff. Historical manifest v1 records retain their original publisher-oriented `canonical_interlock` semantics. Manifest v2 and the producer-derivation receipt identify the private decision producer and public publisher separately. (`README.md:135-149 "Release manifest v2"`; `scripts/verify-producer-derivation.mjs:101-137`; `scripts/generate-release-manifest-v2.mjs:103-170`)

## Artifact Lineage

```text
governance sources
      |
      v
signed policy envelope
      |
      v
decision producer revision + generator inputs
      |
      v
receipt / Fleet evidence / contract outputs
      |
      v
website copy + browser validators
      |
      v
allowlisted publication artifact
      |
      v
deployed bytes + time-bounded live observations
```

The website’s published fixtures include deterministic receipts, Fleet evidence, a signed policy vector, a signed round-trip record, and schemas. (`README.md:26-32 "creedspace-bounder-roundtrip-v1.json"`) The browser verifies strict structures, bounded transports, selected signatures, relationships, and freshness according to the surface being inspected. (`guides/INTEGRATION.md:47-57 "Inspection is entirely local"`; `SECURITY.md:55-62 "cannot authenticate those signatures"`)

## Proof Lattice

Each row is a separate claim class. Evidence may move upward only through the named gate.

| Claim class | Minimum proof | Stronger proof | Does not establish |
|---|---|---|---|
| Source syntax and contract behavior | Focused unit tests | Complete per-file coverage gate | Browser integration or deployment |
| Browser behavior | Built `_site` plus Playwright acceptance | Rendered manual review of nondeterministic qualities | Producer derivation or physical safety |
| Public inventory integrity | Allowlist inspection and byte-equivalent build | Release manifest bound to publisher commit | Decision-engine provenance |
| Producer derivation | Clean producer revision, deterministic generator, exact input and output hashes | Independent clean-checkout regeneration | Deployment or live health |
| Cross-repository compatibility | Exact copies or an explicit compatibility profile plus shared corpus | Bidirectional contract suite at both revisions | Physical response correctness |
| Deployment parity | Live bytes match the sealed publication artifact | Repeated checks from independent networks | Current continuity health |
| Live continuity | Trusted origin, exact signature, identity, replay, health, and freshness checks | Independently monitored lease history | Hardware connection or certification |
| Physical safety | Device hazard analysis, safe-state design, hardware-in-the-loop tests, operational controls | Independent review and applicable certification | Established by any website gate |
| Human, legal, rights, or regulatory assurance | Named competent authority and review record | Current independent approval | Established by software tests |

The repository already separates software evidence from physical certification in its security boundary. (`SECURITY.md:51-62 "Passing software tests does not establish any of those properties."`; `SECURITY.md:64-69 "Do not connect this reference site or its simulator to live hardware."`) The target lattice extends that separation to producer, publisher, deployment, and live-operation claims.

## Identity Tuple

Every derived evidence set should carry this tuple:

```text
artifact identity
  contract:       stable name and version
  producer:       repository, revision, clean-tree status, generator
  inputs:         ordered path and SHA-256 inventory
  output:         path, bytes, SHA-256
  publisher:      repository and source revision
  build:          command, toolchain, public inventory digest
  observation:    origin, retrieval time, verification time, expiry
```

Fields that do not apply remain absent by schema, rather than receiving placeholder values. Every revision is immutable. Every digest identifies exact bytes.

## Contract Ownership

The private decision producer owns the semantic receipt, policy, checkpoint, resilience, and observability contracts because it creates the authoritative decisions. The website publishes byte-identical copies. Browser-only restrictions belong in separately named profiles or validators.

Recommended rules:

1. One `$id` plus version has one canonical byte representation.
2. A stricter browser fixture profile receives a distinct name and `$id`.
3. Exact copies use byte equality.
4. Compatible projections use a shared golden corpus and explicit transformation.
5. Any incompatible change requires a contract version change.
6. Evidence generation and publication both fail when ownership or compatibility is ambiguous.

The website has closed schemas and independent semantic validators. The producer exporter copies the canonical contracts and regenerates the three derived website artifacts from a clean immutable producer commit; the website verifier checks every declared hash and byte. (`schemas/bounder.receipt.v1.schema.json:1-20`; `runtime/simulator/contracts-core.js:464-559`; `scripts/verify-producer-derivation.mjs:101-137`)

## Release Provenance v2

Manifest v2 replaces the overloaded field for new releases with explicit records:

```json
{
  "publisher_source": {
    "repository": "...",
    "commit": "..."
  },
  "evidence_producers": [
    {
      "role": "decision_producer",
      "repository": "...",
      "commit": "...",
      "generator": "scripts/export-website-artifacts.py@1",
      "outputs": ["..."]
    }
  ],
  "files": ["..."]
}
```

The `role` string is load-bearing rather than illustrative: `scripts/lib/release-producer.mjs` resolves the producer by exactly `decision_producer`, so a manifest that names the role anything else is rejected by the drift workflow. (`scripts/lib/release-producer.mjs:10 "PRODUCER_ROLE"`)

The schema uses exact keys, bounded arrays and strings, safe paths, canonical timestamps, full commit identifiers, and lowercase SHA-256 digests. It separately records deployment and live observation as unverified in a local candidate. (`schemas/bounder-release-manifest-v2.schema.json:1-117`; `scripts/generate-release-manifest-v2.mjs:101-170`)

Historical manifests remain byte-immutable and retain their original semantics. The new format starts at a new manifest version.

## Cross-Repository Verification

The derivation gate performs this sequence:

1. Resolve an explicit producer checkout and require the expected repository identity, clean tree, and full commit.
2. Run the declared deterministic exporter outside the producer checkout.
3. Regenerate the receipt bundle, golden envelope, round-trip record, and producer Fleet fixture.
4. Compare every output byte and canonical contract byte with the website copy.
5. Run producer tests and website contract tests.
6. Emit a compact machine-readable result containing checked identities, hashes, commands, and exit status.

The workflow no longer pins the producer commit. It resolves it from the newest sealed manifest in `release/` through `scripts/lib/release-producer.mjs`, which requires a manifest v2 record and a full forty-character `decision_producer` commit, so a manifest bump moves the verified ref instead of leaving the gate attesting to a superseded tree. That resolution step reads only public repository files and therefore runs for fork pull requests too. The private read token is scoped to the single producer-checkout step rather than declared job-wide, so it never enters the environment of a step that executes pull-request-head code. Full regeneration runs only when the credential is present; runs without it label producer proof unavailable rather than comparing the website with itself. (`.github/workflows/receipt-drift.yml:60-66 "release-producer.mjs"`; `.github/workflows/receipt-drift.yml:62-72 "Scoped to the one step that consumes it."`; `.github/workflows/receipt-drift.yml:78-84 "Producer derivation is unverified in this run"`; `scripts/lib/release-producer.mjs:33-52 "resolveProducerCommit"`)

## Evidence Accretion

New work should improve future agent understanding through durable structures:

1. Put enduring behavior in a named invariant test.
2. Put surprising architectural reasons in a short decision record.
3. Put artifact lineage in machine-readable provenance.
4. Generate current status from source and test results.
5. Keep transient task narration out of canonical documents.
6. Preserve explicit residual risks and the exact gate that would close each one.

This makes the system accretive: each verified change adds a reusable fact, proof route, or machine-readable edge instead of adding prose that a future agent must rediscover or distrust.

## Working If

This seam is working when a receipt displayed in the browser can be traced mechanically to exact producer inputs and code, exact publisher source and build output, and an explicitly bounded live observation, with no claim silently crossing from one proof class into another.

## Provenance

- Sources consulted: `README.md`, `guides/INTEGRATION.md`, `SECURITY.md`, `schemas/bounder.receipt.v1.schema.json`, `simulator-contracts.js`, `scripts/generate-release-manifest.js`, `scripts/generate-release-manifest-v2.mjs`, `scripts/verify-producer-derivation.mjs`, `scripts/lib/release-producer.mjs`, `.github/workflows/receipt-drift.yml`
- Last verified against sources: 2026-09-03

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:flows/agent-operating-loop]]
- [[bounder:systems/site-architecture]]
