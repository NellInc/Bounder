import { PLATFORMS } from "../../runtime/observability/guardian-fleet-state.js";

export const TEST_NOW_MS = Date.parse("2026-08-31T12:00:00.000Z");

export function makeHeartbeat({
  index = 0,
  nowMs = TEST_NOW_MS,
  guardianId = `bounder-${String(index).padStart(3, "0")}`,
  platform = PLATFORMS[index % PLATFORMS.length],
  bootId = `boot-${index}`,
  sequence = 1,
  policySequence = 42,
  checkpointSequence = 42,
  state = "healthy",
  reason = "none"
} = {}) {
  return {
    version: "creedspace-bounder-guardian-heartbeat/v1",
    visibility: "fleet-private",
    fleet_id: "relief-fleet",
    guardian_id: guardianId,
    platform,
    boot_id: bootId,
    sequence,
    generated_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + 60_000).toISOString(),
    state,
    reason,
    policy: {
      policy_id: `policy-${guardianId}`,
      digest: `sha256:${index.toString(16).padStart(64, "0")}`,
      sequence: policySequence,
      expires_at: new Date(nowMs + 300_000).toISOString(),
      verified: true
    },
    checkpoint: {
      sequence: checkpointSequence,
      persisted_at: new Date(nowMs - 1_000).toISOString(),
      rollback_detected: false
    },
    continuity_lease_expires_at: new Date(nowMs + 120_000).toISOString(),
    evidence: { freshest_at: new Date(nowMs - 5_000).toISOString(), required_max_age_ms: 30_000 },
    decisions: {
      window_ms: 60_000,
      evaluated: 10,
      allowed: 8,
      held: 2,
      failures: 0,
      latency_ms: { p50: 1, p95: 3, p99: 5, max: 7 }
    },
    audit: { queued: 0, oldest_queued_age_ms: 0 },
    resources: { cpu_percent: 25, memory_percent: 30, network_tx_bytes: 2048, network_rx_bytes: 4096 }
  };
}

export function makeExpectedGuardians(count) {
  return Array.from({ length: count }, (_, index) => ({
    guardian_id: `bounder-${String(index).padStart(3, "0")}`,
    platform: PLATFORMS[index % PLATFORMS.length]
  }));
}

export function makeFleet(count, nowMs = TEST_NOW_MS) {
  return {
    expectedGuardians: makeExpectedGuardians(count),
    heartbeats: Array.from({ length: count }, (_, index) => makeHeartbeat({ index, nowMs }))
  };
}

export function setOperationalState(heartbeat, state, reason) {
  heartbeat.state = state;
  heartbeat.reason = reason;
  const generatedAt = Date.parse(heartbeat.generated_at);
  if (reason === "audit_backlog") heartbeat.audit = { queued: 100, oldest_queued_age_ms: 1 };
  if (reason === "resource_pressure") heartbeat.resources.cpu_percent = 90;
  if (reason === "evidence_lag") heartbeat.evidence.freshest_at = new Date(generatedAt - heartbeat.evidence.required_max_age_ms - 1).toISOString();
  if (reason === "policy_expired") heartbeat.policy.expires_at = heartbeat.generated_at;
  if (reason === "policy_unverified") heartbeat.policy.verified = false;
  if (reason === "continuity_lease_expired") heartbeat.continuity_lease_expires_at = heartbeat.generated_at;
  if (reason === "rollback_detected") heartbeat.checkpoint.rollback_detected = true;
  return heartbeat;
}
