# Bounder llms.txt release 1.2.7

## Contract
Goal: seal the public llms.txt addition using the established source-A/manifest-B procedure.
Authority: parent task explicitly authorizes local machine gates, isolated pinned producer derivation and release sealing. No push, deployment, tag or remote mutation.
Scope: llms metadata, publication allowlist/routing, version/changelog/security expiry, immutable historical-manifest pin, and required provenance documentation.
Invariants: simulation-only claims, unchanged producer bytes, immutable historical manifests, exact allowlisted build.
Proof: clean pinned producer on fetched origin/master, full canonical npm run verify, exact source and receipt identities, manifest schema/inventory verification, focused seal regression, clean final tree.
Non-goals: physical safety validation, live deployment and dependency updates.

## Plan
1. Prepare 1.2.7 source, correct prior release label and renew security expiry.
2. Validate and commit source A.
3. Derive from producer ad57979201dad3396ca5f77cb02a535b9a57e094 and run full canonical verify.
4. Generate new manifest and commit B, preserving all historical bytes.
5. Verify final inventory/seal and return source, seal and receipt identities.

## Deviations
Root approved a bounded host-wait adjustment after reviewing both traces: initial iframe height polling 60s and final touch-azimuth polling 120s. Preserve numerical assertions and existing 90s/240s total budgets; revert the unproven DOM-measurement patch. Original traces preserved outside the checkout. No runtime changes.
