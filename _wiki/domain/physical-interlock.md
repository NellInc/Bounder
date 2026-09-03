# Physical Interlock Domain

<!-- wiki:type = domain -->
<!-- wiki:scope = bounder -->
<!-- wiki:created = 2026-05-23 -->
<!-- wiki:updated = 2026-09-03 -->
<!-- wiki:status = active -->

## Summary

Bounder is an open reference architecture for local, auditable physical interlocks between verified digital policy and device-safe action. Creed Space Fleet governs and distributes typed policy, a local Guardian verifies and evaluates it, and a device adapter owns the safest platform-specific response. The public project remains simulation-only. (`README.md:3-5`; `guides/INTEGRATION.md:1-14`)

## Domain Problem

The system addresses the last decision boundary before a requested digital action changes physical state. It evaluates signed authority, current policy, local state, and fresh evidence immediately before that transition. (`index.html:318-323 "a small, inspectable gate for that boundary"`; `guides/INTEGRATION.md:9-14`)

The pattern covers aircraft, ground robots, autonomous boats, warehouse vehicles, inspection platforms, and fixed machinery. Each class supplies different local evidence and requires a separately engineered safe response. (`guides/INTEGRATION.md:81-88 "Fixed machinery"`)

## Domain Questions

1. Who issued the authority?
2. Is the signature authentic over the exact intended bytes?
3. Is the policy current, monotonic, and bound to this subject?
4. Does the requested action belong to the closed permitted vocabulary?
5. Does fresh local evidence satisfy every active constraint?
6. Which safe response is valid for this platform when permission is absent?
7. What receipt proves the decision without becoming new authority?

The published contracts encode issuer, subject, sequence, validity, actions, constraints, evidence, decision, and audit relationships. (`schemas/creedspace-bounder-policy-v1.schema.json:1-96`; `schemas/bounder.receipt.v1.schema.json:1-120`; `schemas/creedspace-bounder-roundtrip-v1.schema.json:1-120`)

## Domain Invariants

1. Missing verified current policy means no new permission. (`guides/INTEGRATION.md:94 "No verified current policy means no new permission."`)
2. A replayed sequence cannot replace a newer accepted sequence. (`guides/INTEGRATION.md:95 "A replayed sequence cannot replace a newer accepted sequence."`)
3. Network or audit failure cannot broaden local authority. (`guides/INTEGRATION.md:96-97 "Audit delivery failure cannot change the local decision."`)
4. Expiry ends cached authority. (`guides/INTEGRATION.md:98 "Expiry ends cached authority while offline."`)
5. Evidence-only rules cannot authorize an actuator. (`guides/INTEGRATION.md:99 "Evidence-only rules cannot become actuator authority."`)
6. The adapter owns platform-specific safe response and fails safely on missing, stale, malformed, or unsupported input. (`guides/INTEGRATION.md:90 "An adapter should be narrow, deterministic, separately tested, and fail safe"`)
7. Software evidence never implies certification, production deployment, hardware compatibility, or regulatory compliance. (`SECURITY.md:51-53 "Passing software tests does not establish any of those properties."`)

## Domain Vocabulary

| Term | Meaning |
|---|---|
| Policy | Closed, typed protective constraints for one device and validity window |
| Envelope | Exact policy bytes plus signature algorithm, signature, and key identifier |
| Guardian | Local verifier and evaluator at the physical decision boundary |
| Decision | Bounded allow or hold result for one requested action and state snapshot |
| Adapter | Device-specific mapper from a bounded result to an engineered safe transition |
| Receipt | Immutable evidence describing the evaluated request, policy identity, state, and disposition |
| Checkpoint | Signed monotonic floor used to expose rollback across restarts |
| Continuity lease | Bounded offline window during which cached authority can remain current |
| Evidence-only action | A scenario recorded for audit whose result cannot authorize an actuator |

These meanings compile the integration contract and published schemas. (`guides/INTEGRATION.md:29-45`; `guides/INTEGRATION.md:92-100 "Fleet rollback floors survive Guardian restart."`; `schemas/creedspace-bounder-checkpoint-v1.schema.json:1-120`; `schemas/bounder.receipt.v1.schema.json:1-120`)

## Explicit Boundary

The website is a verification laboratory and public projection. It can validate and display recorded or bounded live evidence. It contains no production control service or supported hardware adapter. (`SECURITY.md:3-10`; `guides/INTEGRATION.md:47-57 "Inspection is entirely local"`)

## Working If

The domain model is working when the same stable terms describe policy authoring, local evaluation, adapter behavior, receipts, simulator states, release evidence, and limitations without letting presentation or audit concepts inherit actuator authority.

## Provenance

- Sources consulted: `README.md`, `index.html`, `guides/INTEGRATION.md`, `SECURITY.md`, published JSON Schemas
- Last verified against sources: 2026-09-03

## See Also

- [[bounder:systems/system-architecture]]
- [[bounder:seams/evidence-provenance]]
- [[bounder:systems/site-architecture]]
