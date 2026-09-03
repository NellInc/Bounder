# Security policy and safety boundary

## Supported surface

The supported surface in this repository is the canonical root website, its
browser simulator, published schemas and evidence fixtures, vendored Three.js
runtime, and GitHub Pages automation. The `docs/` tree is a preserved historical
snapshot and is not production-supported. Bounder is simulation-only: this
repository does not provide a production control service or a supported hardware
adapter.

## Reporting

Please report suspected vulnerabilities through GitHub's private vulnerability
reporting for [`NellInc/Bounder`](https://github.com/NellInc/Bounder/security/advisories/new).
Do not test against public infrastructure, third-party aircraft, or devices you
do not control.

Include the affected revision, entry point, expected trust boundary, reproduction steps that do not endanger people or property, and suggested containment if known.

## Threat model summary

Protected assets include the integrity of published evidence, policy examples,
schemas, release manifests, the simulator's fail-closed decisions, visitor
privacy, and the distinction between simulation evidence and operational proof.

Primary threats include tampered evidence, replayed or expired policy examples,
unexpected cross-origin data, compromised dependencies or deployment automation,
unsafe file uploads to the local verifier, and claims that overstate what the
simulation demonstrates.

Critical controls include exact Ed25519 payload verification, pinned evidence
keys and hashes, strict schemas, sequence and expiry checks, same-origin runtime
fixtures, bounded cross-origin continuity fetching, fail-closed UI states,
self-hosted runtime dependencies, immutable release manifests, and an allowlisted
deployment artifact.

Every published page also carries a `Content-Security-Policy` `<meta>` element
with a `default-src 'self'` fallback, `object-src 'none'`, `style-src 'self'`,
and a `script-src` that allows each inline script by its own SHA-256 hash rather
than by `'unsafe-inline'`. `tests/page-security.test.js` asserts those
directives, recomputes every inline-script hash, rejects stale hashes and
reintroduced inline handlers or style attributes, and requires the configured
continuity-feed origin to match the origin `connect-src` permits.

A meta policy is the only enforcement route available here, because GitHub Pages
cannot emit response headers. Directives that a meta policy cannot carry —
notably `frame-ancestors` and `report-to` — are therefore not delivered, so this
repository does not claim clickjacking protection or CSP violation reporting.

## Explicit non-guarantees

This repository has no current evidence of certification, production deployment, flight testing, current Raspberry Pi or Pixhawk compatibility, radio-link resilience, or compliance with a specific aviation regime. Passing software tests does not establish any of those properties.

The browser structurally validates the recorded Fleet audit payloads, hashes,
signature encodings, and key identifier, but the published Fleet fixture omits
the audit public key and therefore cannot authenticate those signatures. The
separate golden policy vector is cryptographically verified. Continuity replay
protection is local to the current page process rather than a durable,
cross-client high-water mark. The version 1 receipt signature also does not bind
the accompanying unsigned request provenance, although the verifier re-evaluates
that request against the signed policy before displaying a result.

## Security gates

Do not connect this reference site or its simulator to live hardware. A physical
deployment requires a separately reviewed implementation, hazard analysis,
device-specific safe states, hardware-in-the-loop testing, operational controls,
and applicable regulatory approval.
