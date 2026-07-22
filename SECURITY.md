# Security policy and safety boundary

## Supported surface

The signed policy core, METTLE verifier, Go server, and hardware-independent Python safety module receive best-effort security maintenance. Historical browser assets and disabled prototype servers are retained for research and are not production-supported.

## Reporting

Please report suspected vulnerabilities privately to the repository owner. Do not test against public infrastructure, third-party aircraft, or devices you do not control.

Include the affected revision, entry point, expected trust boundary, reproduction steps that do not endanger people or property, and suggested containment if known.

## Threat model summary

Protected assets include physical safety, device authority, geofence integrity, policy keys, device tokens, operator accounts, telemetry privacy, and audit integrity.

Primary adversaries include an unauthenticated network client, a malicious website targeting a signed-in browser, a stolen device token, a compromised policy service, a replaying intermediary, an overprivileged user, and an operator making an unsafe configuration choice.

Critical controls include exact JWT algorithms, short expiry, origin restrictions, per-device authentication, owner scoping, command allowlists, signed short-lived policies, sequence replay protection, pinned evidence keys, local sensor constraints, and device-specific safe states. The complete repository threat model is in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Explicit non-guarantees

This repository has no current evidence of certification, production deployment, flight testing, current Raspberry Pi or Pixhawk compatibility, radio-link resilience, or compliance with a specific aviation regime. Passing software tests does not establish any of those properties.

## Security gates

No live hardware connection should occur until the hardware gates in [`docs/LEGACY_STATUS.md`](docs/LEGACY_STATUS.md) are complete and independently reviewed.
