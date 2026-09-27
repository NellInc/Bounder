# Evidence and Provenance Seam

<!-- wiki:type = seam -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-08-31 -->
<!-- wiki:updated = 2026-09-27 -->
<!-- wiki:status = active -->

## Summary

The evidence seam connects governance, the Go decision producer, the browser verifier, the static publication pipeline, and live continuity reporting. Its purpose is to preserve artifact identity and proof meaning across every handoff. Historical manifest v1 records retain their original publisher-oriented `canonical_interlock` semantics. Manifest v2 and the producer-derivation receipt identify the private decision producer and public publisher separately. (`README.md:182-195 "Release manifest v2"`; `scripts/verify-producer-derivation.mjs:104-140`; `scripts/generate-release-manifest-v2.mjs:175-257 "buildManifestV2"`)

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

The website’s published fixtures include deterministic receipts, Fleet evidence, a signed policy vector, a signed round-trip record, the mirrored manipulator preview, and schemas. (`README.md:41-47 "creedspace-bounder-roundtrip-v1.json"`; `README.md:49 "Mirrored preview of the manipulator profile contract"`) The browser verifies strict structures, bounded transports, selected signatures, relationships, and freshness according to the surface being inspected. (`guides/INTEGRATION.md:74-84 "Inspection is entirely local"`; `SECURITY.md:47-54 "cannot authenticate those signatures"`)

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

The repository already separates software evidence from physical certification in its security boundary. (`SECURITY.md:43-45 "Passing software tests does not establish any of those properties."`; `SECURITY.md:56-58 "Do not connect this reference site or its simulator to live hardware."`) The target lattice extends that separation to producer, publisher, deployment, and live-operation claims.

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

The private decision producer owns the semantic receipt, policy, checkpoint, resilience, and observability contracts because it creates the authoritative decisions. The website publishes byte-identical copies of the thirteen shared contracts; the manipulator preview below is the one published schema that is not yet byte-identical to its producer copy. Browser-only restrictions belong in separately named profiles or validators.

Recommended rules:

1. One `$id` plus version has one canonical byte representation.
2. A stricter browser fixture profile receives a distinct name and `$id`.
3. Exact copies use byte equality.
4. Compatible projections use a shared golden corpus and explicit transformation.
5. Any incompatible change requires a contract version change.
6. Evidence generation and publication both fail when ownership or compatibility is ambiguous.

### Mirrored manipulator preview

One contract family is published without producer derivation. The manipulator profile schema, its example profile and a signed golden vector are copied from the private producer, which does not yet list them in its evidence statement, so no derivation run covers their bytes. The schema's `$id` was moved under `https://www.bounder.io/schemas/` in this repository ahead of the producer, so that one schema is not yet byte-identical to its source, which breaks recommended rule 3 until the producer adopts the same bytes. Two compensating controls hold meanwhile: new release manifests record each of the three files as a recorded observation with an explicit limitation, and a unit test pins all three SHA-256 digests, so a re-keyed or re-signed vector cannot pass by carrying its own public key. The golden vector declares `creedspace-bounder-manipulator-golden/v1`, which the browser's policy verifier rejects, and no schema is published for its signed `creedspace-bounder-manipulator-policy/v1` payload. The family is not registered as a descriptor artifact: every artifact entry describes a producer-derived output, and registration follows producer adoption. (`scripts/generate-release-manifest-v2.mjs:41-46 "no producer derivation covers these bytes"`; `tests/receipt-bundle.test.js:107-112 "mirrored manipulator contract bytes match the pinned mirror"`; `runtime/policy/contracts.js:154 "unsupported vector version"`; `guides/INTEGRATION.md:50-72 "Manipulator profile preview"`)

The website has closed schemas and independent semantic validators. The producer exporter copies the canonical contracts and regenerates the three derived website artifacts from a clean immutable producer commit; the website verifier checks every declared hash and byte. (`schemas/bounder.receipt.v1.schema.json:1-20`; `runtime/simulator/contracts-core.js:464-559`; `scripts/verify-producer-derivation.mjs:104-140`)

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

The schema uses exact keys, bounded arrays and strings, safe paths, canonical timestamps, full commit identifiers, and lowercase SHA-256 digests. It separately records deployment and live observation as unverified in a local candidate. (`schemas/bounder-release-manifest-v2.schema.json:1-117`; `scripts/generate-release-manifest-v2.mjs:243-244 "live_observation"`)

Historical manifests remain byte-immutable and retain their original semantics. The new format starts at a new manifest version.

`public_inventory_sha256` is the SHA-256 of `JSON.stringify(files)` plus a newline, taken over the `files` array exactly as the manifest records it; a verifier hashes the recorded array and never re-sorts it. Manifests v1.1.0 to v1.2.2 recorded `files` in ICU `en` collation. From v1.2.4, the first manifest generated after that change, `files` is in UTF-16 code-unit order, which any language can reproduce from a tree. (`scripts/generate-release-manifest-v2.mjs:35-40 "public_inventory_sha256 is sha256"`)

### Release status

Every version from 1.0.0 to 1.2.2, and 1.2.4, has a sealed manifest in `release/`. Version 1.2.3 was deployed from its source commit without a sealed manifest; its changes were carried into 1.2.4. Version 1.2.5 was deployed from its source commits without a sealed manifest; its changes are carried into 1.2.6. Version 1.2.6 is the current unsealed source candidate. Git tags stop at v1.1.1; tagging v1.1.2 to v1.2.2 at their seal commits needs publication authority. The changelog names each sealing manifest, and a unit test refuses a changelog that calls a sealed release unsealed, except the current `VERSION`, whose commit-A heading must stand at its own seal commit B. (`CHANGELOG.md:3 "(source candidate, unsealed)"`; `CHANGELOG.md:29 "## 1.2.5"`; `CHANGELOG.md:110 "published without a sealed manifest"`; `CHANGELOG.md:64 "bounder-reference-v1.2.4.manifest.json"`; `tests/release-manifest.test.js:1022-1067 "the changelog never calls a sealed release unsealed"`)

## Cross-Repository Verification

The derivation gate performs this sequence:

1. Resolve an explicit producer checkout and require the expected repository identity, clean tree, and full commit.
2. Run the declared deterministic exporter outside the producer checkout.
3. Regenerate the receipt bundle, golden envelope, round-trip record, and producer Fleet fixture.
4. Compare every output byte and canonical contract byte with the website copy.
5. Run producer tests and website contract tests.
6. Emit a compact machine-readable result containing checked identities, hashes, commands, and exit status.

The workflow no longer pins the producer commit. It resolves it from the newest sealed manifest in `release/` through `scripts/lib/release-producer.mjs`, which requires a manifest v2 record and a full forty-character `decision_producer` commit, so a manifest bump moves the verified ref instead of leaving the gate attesting to a superseded tree. That resolution step reads only public repository files and therefore runs for fork pull requests too. The private read token is passed only to the producer-checkout step rather than declared job-wide, so it never enters the environment of a step that executes pull-request-head code, and that checkout sets `persist-credentials: false`, so the token is not left in the producer tree's Git configuration either. Full regeneration runs only when the credential is present; runs without it raise a warning annotation and a job-summary note that producer derivation is unverified, rather than comparing the website with itself or passing silently. (`.github/workflows/receipt-drift.yml:66-72 "release-producer.mjs"`; `.github/workflows/receipt-drift.yml:77-85 "Passed to this checkout only."`; `.github/workflows/receipt-drift.yml:90-96 "Producer derivation is unverified in this run"`; `scripts/lib/release-producer.mjs:33-52 "resolveProducerCommit"`)

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
- Also consulted: `CHANGELOG.md`, `release/`, `tests/receipt-bundle.test.js`, `tests/release-manifest.test.js`, `runtime/policy/contracts.js`
- Last verified against sources: 2026-09-26

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:flows/agent-operating-loop]]
- [[bounder:systems/site-architecture]]
