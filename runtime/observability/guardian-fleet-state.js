import { DuplicateJsonMemberError, parseUniqueJson } from "../json/strict-json.js";

export const HEARTBEAT_VERSION = "creedspace-bounder-guardian-heartbeat/v1";
export const FLEET_SNAPSHOT_VERSION = "creedspace-bounder-fleet-snapshot/v1";
export const FLEET_EVENT_VERSION = "creedspace-bounder-fleet-event/v1";
export const TELEMETRY_ENVELOPE_VERSION = "creedspace-bounder-telemetry-envelope/v1";

export const GUARDIAN_STATES = Object.freeze(["healthy", "degraded", "held", "recovering"]);
export const FLEET_STATES = Object.freeze([...GUARDIAN_STATES, "unreachable"]);
export const PLATFORMS = Object.freeze(["aerial", "ground", "marine", "warehouse", "inspection", "fixed_machinery"]);
export const OPERATIONAL_REASONS = Object.freeze([
  "none", "audit_backlog", "resource_pressure", "evidence_lag", "partial_connectivity",
  "policy_expired", "policy_unverified", "continuity_lease_expired", "rollback_detected",
  "guardian_restart", "checkpoint_restore", "heartbeat_expired", "missing_heartbeat"
]);

export const DEFAULT_OBSERVABILITY_BUDGETS = Object.freeze({
  scope: "simulation-reference-observability-only",
  heartbeat_max_bytes: 16_384,
  event_max_bytes: 8_192,
  snapshot_max_bytes: 262_144,
  fleet_max_guardians: 10_000,
  heartbeat_validity_ms: 90_000,
  healthy_interval_ms: 30_000,
  stable_interval_ms: 60_000,
  attention_interval_ms: 5_000,
  jitter_fraction: 0.1,
  audit_backlog_count: 100,
  audit_backlog_age_ms: 60_000,
  resource_pressure_percent: 90,
  aggregation_10000_max_ms: 2_000
});

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_BOOT_HISTORY = 64;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const IDENTITY = /^\S(?:.{0,253}\S)?$/u;
const BOOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

const HEARTBEAT_KEYS = Object.freeze([
  "version", "visibility", "fleet_id", "guardian_id", "platform", "boot_id", "sequence",
  "generated_at", "expires_at", "state", "reason", "policy", "checkpoint",
  "continuity_lease_expires_at", "evidence", "decisions", "audit", "resources"
]);
const SNAPSHOT_KEYS = Object.freeze([
  "version", "visibility", "fleet_id", "generated_at", "expires_at", "expected_guardians",
  "observed_guardians", "states", "platform_counts", "reason_counts", "policy_sequences",
  "checkpoint_sequences", "decisions", "audit", "cycle_duration_ms", "complete", "healthy"
]);
const EVENT_KEYS = Object.freeze([
  "version", "visibility", "event_id", "event_type", "fleet_id", "guardian_id", "boot_id",
  "observed_at", "from_state", "to_state", "reason", "heartbeat_sequence", "policy_sequence",
  "checkpoint_sequence"
]);

const STATE_REASONS = Object.freeze({
  healthy: Object.freeze(["none"]),
  degraded: Object.freeze(["audit_backlog", "resource_pressure", "evidence_lag", "partial_connectivity"]),
  held: Object.freeze(["policy_expired", "policy_unverified", "continuity_lease_expired", "rollback_detected"]),
  recovering: Object.freeze(["guardian_restart", "checkpoint_restore"]),
  unreachable: Object.freeze(["heartbeat_expired", "missing_heartbeat"])
});

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function safeClone(value, label) {
  try {
    return structuredClone(value);
  } catch {
    throw new Error(`${label} is not cloneable`);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function assertIdentity(value, label) {
  if (typeof value !== "string" || value.length > 255 || !IDENTITY.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function assertBootId(value, label = "boot id") {
  if (typeof value !== "string" || !BOOT_ID.test(value)) throw new Error(`${label} is invalid`);
}

function assertSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} is invalid`);
}

function safeAdd(left, right, label) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds the safe integer range`);
  return value;
}

export function parseObservabilityTimestamp(value, label = "timestamp") {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) throw new Error(`${label} is invalid`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label} is invalid`);
  }
  const milliseconds = Date.parse(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}.${fraction.padEnd(3, "0").slice(0, 3) || "000"}Z`);
  if (!Number.isSafeInteger(milliseconds)) throw new Error(`${label} is invalid`);
  return milliseconds;
}

function encodedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function validateObservabilityBudgets(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("observability budgets are invalid");
  const budgets = { ...DEFAULT_OBSERVABILITY_BUDGETS, ...overrides };
  if (budgets.scope !== DEFAULT_OBSERVABILITY_BUDGETS.scope) throw new Error("observability budget scope is invalid");
  for (const key of [
    "heartbeat_max_bytes", "event_max_bytes", "snapshot_max_bytes", "fleet_max_guardians",
    "heartbeat_validity_ms", "healthy_interval_ms", "stable_interval_ms", "attention_interval_ms",
    "audit_backlog_count", "audit_backlog_age_ms", "aggregation_10000_max_ms"
  ]) assertSafeInteger(budgets[key], `observability budget ${key}`, 1);
  if (typeof budgets.jitter_fraction !== "number" || budgets.jitter_fraction < 0 || budgets.jitter_fraction > 0.25) {
    throw new Error("observability jitter budget is invalid");
  }
  if (typeof budgets.resource_pressure_percent !== "number" || budgets.resource_pressure_percent < 50 || budgets.resource_pressure_percent > 100) {
    throw new Error("observability resource-pressure budget is invalid");
  }
  if (!(budgets.attention_interval_ms <= budgets.healthy_interval_ms && budgets.healthy_interval_ms <= budgets.stable_interval_ms)) {
    throw new Error("observability heartbeat intervals are inconsistent");
  }
  if (Math.ceil(budgets.stable_interval_ms * (1 + budgets.jitter_fraction)) >= budgets.heartbeat_validity_ms) {
    throw new Error("observability heartbeat interval can outlive its validity window");
  }
  return Object.freeze(budgets);
}

function deriveGuardianStateUnchecked(heartbeat, atMs, budgets) {
  if (heartbeat.checkpoint.rollback_detected) return Object.freeze({ state: "held", reason: "rollback_detected" });
  if (!heartbeat.policy.verified) return Object.freeze({ state: "held", reason: "policy_unverified" });
  if (parseObservabilityTimestamp(heartbeat.policy.expires_at, "policy expiry") <= atMs) {
    return Object.freeze({ state: "held", reason: "policy_expired" });
  }
  if (parseObservabilityTimestamp(heartbeat.continuity_lease_expires_at, "continuity lease expiry") <= atMs) {
    return Object.freeze({ state: "held", reason: "continuity_lease_expired" });
  }
  if (STATE_REASONS.recovering.includes(heartbeat.reason)) {
    return Object.freeze({ state: "recovering", reason: heartbeat.reason });
  }
  const evidenceAge = atMs - parseObservabilityTimestamp(heartbeat.evidence.freshest_at, "freshest evidence time");
  if (evidenceAge > heartbeat.evidence.required_max_age_ms) {
    return Object.freeze({ state: "degraded", reason: "evidence_lag" });
  }
  if (heartbeat.audit.queued >= budgets.audit_backlog_count || heartbeat.audit.oldest_queued_age_ms >= budgets.audit_backlog_age_ms) {
    return Object.freeze({ state: "degraded", reason: "audit_backlog" });
  }
  if (heartbeat.resources.cpu_percent >= budgets.resource_pressure_percent || heartbeat.resources.memory_percent >= budgets.resource_pressure_percent) {
    return Object.freeze({ state: "degraded", reason: "resource_pressure" });
  }
  if (heartbeat.reason === "partial_connectivity") {
    return Object.freeze({ state: "degraded", reason: "partial_connectivity" });
  }
  return Object.freeze({ state: "healthy", reason: "none" });
}

export function deriveGuardianOperationalState(heartbeat, {
  atMs = parseObservabilityTimestamp(heartbeat?.generated_at, "heartbeat generated_at"),
  budgets: budgetOverrides = {}
} = {}) {
  if (!Number.isSafeInteger(atMs)) throw new Error("Guardian state clock is invalid");
  const budgets = validateObservabilityBudgets(budgetOverrides);
  return deriveGuardianStateUnchecked(heartbeat, atMs, budgets);
}

function validateLatency(value, label) {
  exactKeys(value, ["p50", "p95", "p99", "max"], label);
  for (const key of ["p50", "p95", "p99", "max"]) assertSafeInteger(value[key], `${label} ${key}`);
  if (!(value.p50 <= value.p95 && value.p95 <= value.p99 && value.p99 <= value.max)) {
    throw new Error(`${label} quantiles are inconsistent`);
  }
}

export function validateGuardianHeartbeat(heartbeat, {
  nowMs = Date.now(),
  allowExpired = false,
  budgets: budgetOverrides = {}
} = {}) {
  if (!Number.isSafeInteger(nowMs)) throw new Error("heartbeat clock is invalid");
  const budgets = validateObservabilityBudgets(budgetOverrides);
  const snapshot = safeClone(heartbeat, "heartbeat");
  exactKeys(snapshot, HEARTBEAT_KEYS, "heartbeat");
  if (encodedBytes(snapshot) > budgets.heartbeat_max_bytes) throw new Error("heartbeat exceeds its byte budget");
  if (snapshot.version !== HEARTBEAT_VERSION || snapshot.visibility !== "fleet-private") throw new Error("heartbeat metadata is invalid");
  assertIdentity(snapshot.fleet_id, "heartbeat fleet id");
  assertIdentity(snapshot.guardian_id, "heartbeat Guardian id");
  if (!PLATFORMS.includes(snapshot.platform)) throw new Error("heartbeat platform is invalid");
  assertBootId(snapshot.boot_id);
  assertSafeInteger(snapshot.sequence, "heartbeat sequence", 1);

  const generatedAt = parseObservabilityTimestamp(snapshot.generated_at, "heartbeat generated_at");
  const expiresAt = parseObservabilityTimestamp(snapshot.expires_at, "heartbeat expires_at");
  if (generatedAt > nowMs + MAX_FUTURE_SKEW_MS || expiresAt <= generatedAt || expiresAt - generatedAt > budgets.heartbeat_validity_ms) {
    throw new Error("heartbeat validity window is invalid");
  }
  if (!allowExpired && expiresAt <= nowMs) throw new Error("heartbeat is expired");

  exactKeys(snapshot.policy, ["policy_id", "digest", "sequence", "expires_at", "verified"], "heartbeat policy");
  assertIdentity(snapshot.policy.policy_id, "heartbeat policy id");
  if (typeof snapshot.policy.digest !== "string" || !SHA256.test(snapshot.policy.digest)) throw new Error("heartbeat policy digest is invalid");
  assertSafeInteger(snapshot.policy.sequence, "heartbeat policy sequence", 1);
  parseObservabilityTimestamp(snapshot.policy.expires_at, "heartbeat policy expires_at");
  if (typeof snapshot.policy.verified !== "boolean") throw new Error("heartbeat policy verification state is invalid");

  exactKeys(snapshot.checkpoint, ["sequence", "persisted_at", "rollback_detected"], "heartbeat checkpoint");
  assertSafeInteger(snapshot.checkpoint.sequence, "heartbeat checkpoint sequence");
  const checkpointAt = parseObservabilityTimestamp(snapshot.checkpoint.persisted_at, "heartbeat checkpoint persisted_at");
  if (checkpointAt > generatedAt) throw new Error("heartbeat checkpoint is from the future");
  if (typeof snapshot.checkpoint.rollback_detected !== "boolean") throw new Error("heartbeat checkpoint rollback state is invalid");

  parseObservabilityTimestamp(snapshot.continuity_lease_expires_at, "heartbeat continuity lease expiry");
  exactKeys(snapshot.evidence, ["freshest_at", "required_max_age_ms"], "heartbeat evidence");
  const evidenceAt = parseObservabilityTimestamp(snapshot.evidence.freshest_at, "heartbeat evidence freshest_at");
  if (evidenceAt > generatedAt) throw new Error("heartbeat evidence is from the future");
  assertSafeInteger(snapshot.evidence.required_max_age_ms, "heartbeat evidence maximum age", 1);
  if (snapshot.evidence.required_max_age_ms > 3_600_000) throw new Error("heartbeat evidence maximum age is too large");

  exactKeys(snapshot.decisions, ["window_ms", "evaluated", "allowed", "held", "failures", "latency_ms"], "heartbeat decisions");
  assertSafeInteger(snapshot.decisions.window_ms, "heartbeat decision window", 1);
  if (snapshot.decisions.window_ms > 86_400_000) throw new Error("heartbeat decision window is too large");
  for (const key of ["evaluated", "allowed", "held", "failures"]) assertSafeInteger(snapshot.decisions[key], `heartbeat decision ${key}`);
  if (safeAdd(snapshot.decisions.allowed, snapshot.decisions.held, "heartbeat decision totals") !== snapshot.decisions.evaluated) {
    throw new Error("heartbeat decision totals are inconsistent");
  }
  if (snapshot.decisions.failures > snapshot.decisions.held) throw new Error("heartbeat decision failure count is inconsistent");
  validateLatency(snapshot.decisions.latency_ms, "heartbeat decision latency");
  if (snapshot.decisions.evaluated === 0 && Object.values(snapshot.decisions.latency_ms).some((value) => value !== 0)) {
    throw new Error("heartbeat has latency without evaluated decisions");
  }

  exactKeys(snapshot.audit, ["queued", "oldest_queued_age_ms"], "heartbeat audit");
  assertSafeInteger(snapshot.audit.queued, "heartbeat audit queue");
  assertSafeInteger(snapshot.audit.oldest_queued_age_ms, "heartbeat oldest audit age");
  if ((snapshot.audit.queued === 0) !== (snapshot.audit.oldest_queued_age_ms === 0)) {
    throw new Error("heartbeat audit backlog is inconsistent");
  }

  exactKeys(snapshot.resources, ["cpu_percent", "memory_percent", "network_tx_bytes", "network_rx_bytes"], "heartbeat resources");
  for (const key of ["cpu_percent", "memory_percent"]) {
    if (typeof snapshot.resources[key] !== "number" || !Number.isFinite(snapshot.resources[key]) || snapshot.resources[key] < 0 || snapshot.resources[key] > 100) {
      throw new Error(`heartbeat resource ${key} is invalid`);
    }
  }
  for (const key of ["network_tx_bytes", "network_rx_bytes"]) assertSafeInteger(snapshot.resources[key], `heartbeat resource ${key}`);

  if (!GUARDIAN_STATES.includes(snapshot.state) || !STATE_REASONS[snapshot.state].includes(snapshot.reason)) {
    throw new Error("heartbeat state and reason are inconsistent");
  }
  const derived = deriveGuardianStateUnchecked(snapshot, generatedAt, budgets);
  if (snapshot.state !== derived.state || snapshot.reason !== derived.reason) {
    throw new Error(`heartbeat operational state is inconsistent; expected ${derived.state}/${derived.reason}`);
  }
  return deepFreeze(snapshot);
}

export function classifyGuardianHeartbeat(heartbeat, {
  nowMs = Date.now(),
  budgets: budgetOverrides = {}
} = {}) {
  if (heartbeat === null || heartbeat === undefined) return Object.freeze({ state: "unreachable", reason: "missing_heartbeat" });
  const budgets = validateObservabilityBudgets(budgetOverrides);
  const validated = validateGuardianHeartbeat(heartbeat, { nowMs, allowExpired: true, budgets });
  return classifyValidatedGuardianHeartbeat(validated, nowMs, budgets);
}

function classifyValidatedGuardianHeartbeat(validated, nowMs, budgets) {
  if (parseObservabilityTimestamp(validated.expires_at, "heartbeat expires_at") <= nowMs) {
    return Object.freeze({ state: "unreachable", reason: "heartbeat_expired" });
  }
  return deriveGuardianStateUnchecked(validated, nowMs, budgets);
}

export function createGuardianHeartbeatGuard({
  budgets: budgetOverrides = {},
  maxBootHistory = MAX_BOOT_HISTORY
} = {}) {
  const budgets = validateObservabilityBudgets(budgetOverrides);
  assertSafeInteger(maxBootHistory, "heartbeat boot history limit", 1);
  if (maxBootHistory > 1024) throw new Error("heartbeat boot history limit is too large");
  const guardians = new Map();

  return Object.freeze({
    accept(heartbeat, nowMs = Date.now()) {
      const validated = validateGuardianHeartbeat(heartbeat, { nowMs, budgets });
      const previous = guardians.get(validated.guardian_id);
      const generatedAt = parseObservabilityTimestamp(validated.generated_at, "heartbeat generated_at");
      if (!previous && guardians.size >= budgets.fleet_max_guardians) throw new Error("Guardian heartbeat guard capacity is exhausted");
      if (previous) {
        if (validated.fleet_id !== previous.fleetId) throw new Error("Guardian heartbeat changed Fleet identity");
        if (validated.policy.sequence < previous.policySequence) throw new Error("Guardian heartbeat policy sequence rolled back");
        if (validated.checkpoint.sequence < previous.checkpointSequence) throw new Error("Guardian heartbeat checkpoint sequence rolled back");
        if (generatedAt <= previous.generatedAt) throw new Error("Guardian heartbeat time was replayed or reordered");
        if (validated.boot_id === previous.bootId) {
          if (validated.sequence <= previous.sequence) throw new Error("Guardian heartbeat sequence was replayed or reordered");
        } else {
          if (previous.retiredBoots.has(validated.boot_id)) throw new Error("Guardian heartbeat boot epoch was replayed");
          if (previous.retiredBoots.size >= maxBootHistory) throw new Error("Guardian heartbeat boot history is exhausted");
        }
      }

      const retiredBoots = new Set(previous?.retiredBoots || []);
      if (previous && validated.boot_id !== previous.bootId) retiredBoots.add(previous.bootId);
      guardians.set(validated.guardian_id, {
        fleetId: validated.fleet_id,
        bootId: validated.boot_id,
        retiredBoots,
        sequence: validated.sequence,
        generatedAt,
        policySequence: validated.policy.sequence,
        checkpointSequence: validated.checkpoint.sequence
      });
      return validated;
    },
    state(guardianId) {
      const value = guardians.get(guardianId);
      if (!value) return null;
      return deepFreeze({
        fleet_id: value.fleetId,
        boot_id: value.bootId,
        retired_boot_ids: [...value.retiredBoots],
        sequence: value.sequence,
        generated_at_ms: value.generatedAt,
        policy_sequence: value.policySequence,
        checkpoint_sequence: value.checkpointSequence
      });
    }
  });
}

function emptyCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function assertExpectedGuardian(value) {
  exactKeys(value, ["guardian_id", "platform"], "expected Guardian");
  assertIdentity(value.guardian_id, "expected Guardian id");
  if (!PLATFORMS.includes(value.platform)) throw new Error("expected Guardian platform is invalid");
}

function updateRange(range, value) {
  if (range.minimum === 0 || value < range.minimum) range.minimum = value;
  if (value > range.maximum) range.maximum = value;
}

export function aggregateFleetSnapshot({
  fleetId,
  expectedGuardians,
  heartbeats,
  nowMs = Date.now(),
  cycleStartedAtMs = nowMs,
  budgets: budgetOverrides = {}
}) {
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(cycleStartedAtMs) || cycleStartedAtMs > nowMs) {
    throw new Error("Fleet snapshot clock is invalid");
  }
  assertIdentity(fleetId, "Fleet snapshot id");
  const budgets = validateObservabilityBudgets(budgetOverrides);
  if (!Array.isArray(expectedGuardians) || expectedGuardians.length === 0 || expectedGuardians.length > budgets.fleet_max_guardians) {
    throw new Error("expected Guardian inventory is invalid");
  }
  if (!Array.isArray(heartbeats) || heartbeats.length > expectedGuardians.length) throw new Error("Fleet heartbeat collection is invalid");

  const expectedById = new Map();
  const platformCounts = emptyCounts(PLATFORMS);
  for (const expected of expectedGuardians) {
    assertExpectedGuardian(expected);
    if (expectedById.has(expected.guardian_id)) throw new Error("expected Guardian inventory has duplicate ids");
    expectedById.set(expected.guardian_id, expected.platform);
    platformCounts[expected.platform] += 1;
  }

  const heartbeatById = new Map();
  for (const heartbeat of heartbeats) {
    const validated = validateGuardianHeartbeat(heartbeat, { nowMs, allowExpired: true, budgets });
    if (validated.fleet_id !== fleetId) throw new Error("Fleet heartbeat has the wrong Fleet identity");
    if (!expectedById.has(validated.guardian_id)) throw new Error("Fleet heartbeat is from an unknown Guardian");
    if (expectedById.get(validated.guardian_id) !== validated.platform) throw new Error("Fleet heartbeat platform does not match inventory");
    if (heartbeatById.has(validated.guardian_id)) throw new Error("Fleet heartbeat collection has duplicate Guardian ids");
    heartbeatById.set(validated.guardian_id, validated);
  }

  const states = emptyCounts(FLEET_STATES);
  const reasonCounts = emptyCounts(OPERATIONAL_REASONS);
  const policySequences = { minimum: 0, maximum: 0 };
  const checkpointSequences = { minimum: 0, maximum: 0 };
  const decisions = { evaluated: 0, allowed: 0, held: 0, failures: 0, latency_ms: { p50_max: 0, p95_max: 0, p99_max: 0, max: 0 } };
  const audit = { queued: 0, oldest_queued_age_ms: 0 };
  let earliestExpiry = nowMs + budgets.heartbeat_validity_ms;

  for (const guardianId of expectedById.keys()) {
    const heartbeat = heartbeatById.get(guardianId);
    const classification = heartbeat
      ? classifyValidatedGuardianHeartbeat(heartbeat, nowMs, budgets)
      : Object.freeze({ state: "unreachable", reason: "missing_heartbeat" });
    states[classification.state] += 1;
    reasonCounts[classification.reason] += 1;
    if (!heartbeat) continue;
    const heartbeatExpiry = parseObservabilityTimestamp(heartbeat.expires_at, "heartbeat expires_at");
    if (heartbeatExpiry > nowMs) earliestExpiry = Math.min(earliestExpiry, heartbeatExpiry);
    updateRange(policySequences, heartbeat.policy.sequence);
    updateRange(checkpointSequences, heartbeat.checkpoint.sequence);
    for (const key of ["evaluated", "allowed", "held", "failures"]) {
      decisions[key] = safeAdd(decisions[key], heartbeat.decisions[key], `Fleet decision ${key}`);
    }
    decisions.latency_ms.p50_max = Math.max(decisions.latency_ms.p50_max, heartbeat.decisions.latency_ms.p50);
    decisions.latency_ms.p95_max = Math.max(decisions.latency_ms.p95_max, heartbeat.decisions.latency_ms.p95);
    decisions.latency_ms.p99_max = Math.max(decisions.latency_ms.p99_max, heartbeat.decisions.latency_ms.p99);
    decisions.latency_ms.max = Math.max(decisions.latency_ms.max, heartbeat.decisions.latency_ms.max);
    audit.queued = safeAdd(audit.queued, heartbeat.audit.queued, "Fleet audit queue");
    audit.oldest_queued_age_ms = Math.max(audit.oldest_queued_age_ms, heartbeat.audit.oldest_queued_age_ms);
  }

  const complete = heartbeatById.size === expectedById.size;
  const healthy = complete && states.healthy === expectedById.size && decisions.failures === 0;
  const snapshot = {
    version: FLEET_SNAPSHOT_VERSION,
    visibility: "fleet-private-aggregate",
    fleet_id: fleetId,
    generated_at: new Date(nowMs).toISOString(),
    expires_at: new Date(Math.max(nowMs + 1, earliestExpiry)).toISOString(),
    expected_guardians: expectedById.size,
    observed_guardians: heartbeatById.size,
    states,
    platform_counts: platformCounts,
    reason_counts: reasonCounts,
    policy_sequences: policySequences,
    checkpoint_sequences: checkpointSequences,
    decisions,
    audit,
    cycle_duration_ms: nowMs - cycleStartedAtMs,
    complete,
    healthy
  };
  return validateFleetSnapshot(snapshot, { nowMs, budgets });
}

export function validateFleetSnapshot(value, {
  nowMs = Date.now(),
  budgets: budgetOverrides = {}
} = {}) {
  if (!Number.isSafeInteger(nowMs)) throw new Error("Fleet snapshot clock is invalid");
  const budgets = validateObservabilityBudgets(budgetOverrides);
  const snapshot = safeClone(value, "Fleet snapshot");
  exactKeys(snapshot, SNAPSHOT_KEYS, "Fleet snapshot");
  if (encodedBytes(snapshot) > budgets.snapshot_max_bytes) throw new Error("Fleet snapshot exceeds its byte budget");
  if (snapshot.version !== FLEET_SNAPSHOT_VERSION || snapshot.visibility !== "fleet-private-aggregate") throw new Error("Fleet snapshot metadata is invalid");
  assertIdentity(snapshot.fleet_id, "Fleet snapshot id");
  const generatedAt = parseObservabilityTimestamp(snapshot.generated_at, "Fleet snapshot generated_at");
  const expiresAt = parseObservabilityTimestamp(snapshot.expires_at, "Fleet snapshot expires_at");
  if (generatedAt > nowMs + MAX_FUTURE_SKEW_MS || expiresAt <= nowMs || expiresAt <= generatedAt || expiresAt - generatedAt > budgets.heartbeat_validity_ms) {
    throw new Error("Fleet snapshot validity window is invalid");
  }
  assertSafeInteger(snapshot.expected_guardians, "Fleet expected Guardian count", 1);
  assertSafeInteger(snapshot.observed_guardians, "Fleet observed Guardian count");
  if (snapshot.expected_guardians > budgets.fleet_max_guardians || snapshot.observed_guardians > snapshot.expected_guardians) {
    throw new Error("Fleet Guardian counts are invalid");
  }
  exactKeys(snapshot.states, FLEET_STATES, "Fleet state counts");
  exactKeys(snapshot.platform_counts, PLATFORMS, "Fleet platform counts");
  exactKeys(snapshot.reason_counts, OPERATIONAL_REASONS, "Fleet reason counts");
  for (const group of [snapshot.states, snapshot.platform_counts, snapshot.reason_counts]) {
    for (const [key, count] of Object.entries(group)) assertSafeInteger(count, `Fleet count ${key}`);
  }
  const sum = (values, label) => values.reduce((total, value) => safeAdd(total, value, label), 0);
  if (sum(Object.values(snapshot.states), "Fleet state counts") !== snapshot.expected_guardians) throw new Error("Fleet state counts are inconsistent");
  if (sum(Object.values(snapshot.platform_counts), "Fleet platform counts") !== snapshot.expected_guardians) throw new Error("Fleet platform counts are inconsistent");
  if (sum(Object.values(snapshot.reason_counts), "Fleet reason counts") !== snapshot.expected_guardians) throw new Error("Fleet reason counts are inconsistent");
  for (const state of FLEET_STATES) {
    const reasonTotal = STATE_REASONS[state].reduce((total, reason) => safeAdd(total, snapshot.reason_counts[reason], `Fleet ${state} reason counts`), 0);
    if (reasonTotal !== snapshot.states[state]) throw new Error(`Fleet ${state} reason counts are inconsistent`);
  }
  for (const [label, range] of [["policy", snapshot.policy_sequences], ["checkpoint", snapshot.checkpoint_sequences]]) {
    exactKeys(range, ["minimum", "maximum"], `Fleet ${label} sequence range`);
    assertSafeInteger(range.minimum, `Fleet ${label} minimum sequence`);
    assertSafeInteger(range.maximum, `Fleet ${label} maximum sequence`);
    if (range.minimum > range.maximum || (snapshot.observed_guardians === 0) !== (range.maximum === 0)) {
      throw new Error(`Fleet ${label} sequence range is inconsistent`);
    }
  }
  exactKeys(snapshot.decisions, ["evaluated", "allowed", "held", "failures", "latency_ms"], "Fleet decisions");
  for (const key of ["evaluated", "allowed", "held", "failures"]) assertSafeInteger(snapshot.decisions[key], `Fleet decision ${key}`);
  if (safeAdd(snapshot.decisions.allowed, snapshot.decisions.held, "Fleet decision totals") !== snapshot.decisions.evaluated || snapshot.decisions.failures > snapshot.decisions.held) {
    throw new Error("Fleet decision totals are inconsistent");
  }
  exactKeys(snapshot.decisions.latency_ms, ["p50_max", "p95_max", "p99_max", "max"], "Fleet decision latency");
  for (const key of ["p50_max", "p95_max", "p99_max", "max"]) assertSafeInteger(snapshot.decisions.latency_ms[key], `Fleet decision latency ${key}`);
  if (!(snapshot.decisions.latency_ms.p50_max <= snapshot.decisions.latency_ms.p95_max && snapshot.decisions.latency_ms.p95_max <= snapshot.decisions.latency_ms.p99_max && snapshot.decisions.latency_ms.p99_max <= snapshot.decisions.latency_ms.max)) {
    throw new Error("Fleet decision latency is inconsistent");
  }
  exactKeys(snapshot.audit, ["queued", "oldest_queued_age_ms"], "Fleet audit");
  assertSafeInteger(snapshot.audit.queued, "Fleet audit queue");
  assertSafeInteger(snapshot.audit.oldest_queued_age_ms, "Fleet oldest audit age");
  if ((snapshot.audit.queued === 0) !== (snapshot.audit.oldest_queued_age_ms === 0)) throw new Error("Fleet audit backlog is inconsistent");
  assertSafeInteger(snapshot.cycle_duration_ms, "Fleet cycle duration");
  if (snapshot.cycle_duration_ms > budgets.heartbeat_validity_ms) throw new Error("Fleet cycle duration exceeds the observability window");
  if (typeof snapshot.complete !== "boolean" || snapshot.complete !== (snapshot.observed_guardians === snapshot.expected_guardians)) {
    throw new Error("Fleet completeness state is inconsistent");
  }
  const expectedHealthy = snapshot.complete && snapshot.states.healthy === snapshot.expected_guardians && snapshot.decisions.failures === 0;
  if (typeof snapshot.healthy !== "boolean" || snapshot.healthy !== expectedHealthy) throw new Error("Fleet health state is inconsistent");
  return deepFreeze(snapshot);
}

export function projectPublicContinuity(snapshot, {
  nowMs = Date.now(),
  mode = "real-fleet-postgresql",
  signedAudits = PLATFORMS.length,
  budgets: budgetOverrides = {}
} = {}) {
  const validated = validateFleetSnapshot(snapshot, { nowMs, budgets: budgetOverrides });
  if (mode !== "real-fleet-postgresql") throw new Error("public continuity mode is invalid");
  if (!validated.complete || !validated.healthy || validated.expected_guardians !== 100 || validated.observed_guardians !== 100) {
    throw new Error("Fleet snapshot does not prove a complete healthy 100-Guardian cycle");
  }
  if (validated.audit.queued !== 0 || validated.decisions.failures !== 0 || validated.decisions.evaluated !== validated.expected_guardians || Object.values(validated.platform_counts).some((count) => count < 1)) {
    throw new Error("Fleet snapshot is not eligible for public continuity projection");
  }
  assertSafeInteger(signedAudits, "public signed-audit count", 1);
  if (signedAudits !== PLATFORMS.length) throw new Error("public signed-audit count is inconsistent");
  return deepFreeze({
    version: "bounder-continuity-evidence/v1",
    fleet_id: validated.fleet_id,
    mode,
    generated_at: validated.generated_at,
    expires_at: validated.expires_at,
    healthy: true,
    device_count: validated.expected_guardians,
    platform_counts: { ...validated.platform_counts },
    policies_verified: validated.observed_guardians,
    checkpoints_verified: validated.observed_guardians,
    evaluated: validated.decisions.evaluated,
    allowed: validated.decisions.allowed,
    held: validated.decisions.held,
    signed_audits: signedAudits,
    failure_count: validated.decisions.failures,
    cycle_duration_ms: validated.cycle_duration_ms
  });
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error("Web Crypto is unavailable");
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function eventTypeForState(state, previousState) {
  if (state === "unreachable") return "guardian_unreachable";
  if (state === "degraded") return "guardian_degraded";
  if (state === "held") return "guardian_held";
  if (state === "recovering") return "guardian_recovering";
  if (state === "healthy" && previousState && previousState !== "healthy") return "guardian_recovered";
  return "guardian_connected";
}

async function makeFleetEvent({ eventType, fromState, classification, heartbeat, observedAtMs, cryptoImpl }) {
  const body = {
    version: FLEET_EVENT_VERSION,
    visibility: "fleet-private",
    event_type: eventType,
    fleet_id: heartbeat.fleet_id,
    guardian_id: heartbeat.guardian_id,
    boot_id: heartbeat.boot_id,
    observed_at: new Date(observedAtMs).toISOString(),
    from_state: fromState,
    to_state: classification.state,
    reason: classification.reason,
    heartbeat_sequence: heartbeat.sequence,
    policy_sequence: heartbeat.policy.sequence,
    checkpoint_sequence: heartbeat.checkpoint.sequence
  };
  const event = { ...body, event_id: `sha256:${await sha256Hex(stableJson(body), cryptoImpl)}` };
  return validateFleetEvent(event);
}

export async function deriveFleetEvents({
  previousHeartbeat = null,
  currentHeartbeat = null,
  previousObservedState = null,
  observedAtMs = Date.now(),
  budgets: budgetOverrides = {},
  cryptoImpl = globalThis.crypto
} = {}) {
  if (!Number.isSafeInteger(observedAtMs)) throw new Error("Fleet event clock is invalid");
  const budgets = validateObservabilityBudgets(budgetOverrides);
  if (!previousHeartbeat && !currentHeartbeat) return Object.freeze([]);
  const previous = previousHeartbeat ? validateGuardianHeartbeat(previousHeartbeat, { nowMs: observedAtMs, allowExpired: true, budgets }) : null;
  const current = currentHeartbeat ? validateGuardianHeartbeat(currentHeartbeat, { nowMs: observedAtMs, allowExpired: true, budgets }) : null;
  const heartbeat = current || previous;
  if (previous && current && (previous.guardian_id !== current.guardian_id || previous.fleet_id !== current.fleet_id)) {
    throw new Error("Fleet event heartbeats do not identify the same Guardian");
  }
  if (previous && current) {
    const previousAt = parseObservabilityTimestamp(previous.generated_at, "previous heartbeat generated_at");
    const currentAt = parseObservabilityTimestamp(current.generated_at, "current heartbeat generated_at");
    if (currentAt <= previousAt || current.policy.sequence < previous.policy.sequence || current.checkpoint.sequence < previous.checkpoint.sequence || (current.boot_id === previous.boot_id && current.sequence <= previous.sequence)) {
      throw new Error("Fleet event heartbeats are replayed, reordered, or rolled back");
    }
  }
  const fromState = previousObservedState || previous?.state || null;
  if (fromState !== null && !FLEET_STATES.includes(fromState)) throw new Error("previous Fleet state is invalid");
  const classification = classifyValidatedGuardianHeartbeat(current || previous, observedAtMs, budgets);
  const eventTypes = [];
  if (!previous) eventTypes.push("guardian_connected");
  else {
    if (current && previous.boot_id !== current.boot_id) eventTypes.push("guardian_restarted");
    if (classification.state !== fromState) eventTypes.push(eventTypeForState(classification.state, fromState));
    if (current && current.policy.sequence > previous.policy.sequence) eventTypes.push("policy_advanced");
    if (current && current.checkpoint.sequence > previous.checkpoint.sequence) eventTypes.push("checkpoint_advanced");
  }
  const events = [];
  for (const eventType of [...new Set(eventTypes)]) {
    events.push(await makeFleetEvent({ eventType, fromState, classification, heartbeat, observedAtMs, cryptoImpl }));
  }
  return Object.freeze(events);
}

export function validateFleetEvent(value, { budgets: budgetOverrides = {} } = {}) {
  const budgets = validateObservabilityBudgets(budgetOverrides);
  const event = safeClone(value, "Fleet event");
  exactKeys(event, EVENT_KEYS, "Fleet event");
  if (encodedBytes(event) > budgets.event_max_bytes) throw new Error("Fleet event exceeds its byte budget");
  if (event.version !== FLEET_EVENT_VERSION || event.visibility !== "fleet-private" || !SHA256.test(event.event_id)) {
    throw new Error("Fleet event metadata is invalid");
  }
  const eventTypes = [
    "guardian_connected", "guardian_degraded", "guardian_held", "guardian_recovering",
    "guardian_recovered", "guardian_unreachable", "guardian_restarted", "policy_advanced", "checkpoint_advanced"
  ];
  if (!eventTypes.includes(event.event_type)) throw new Error("Fleet event type is invalid");
  assertIdentity(event.fleet_id, "Fleet event Fleet id");
  assertIdentity(event.guardian_id, "Fleet event Guardian id");
  assertBootId(event.boot_id, "Fleet event boot id");
  parseObservabilityTimestamp(event.observed_at, "Fleet event observed_at");
  if (event.from_state !== null && !FLEET_STATES.includes(event.from_state)) throw new Error("Fleet event prior state is invalid");
  if (!FLEET_STATES.includes(event.to_state) || !STATE_REASONS[event.to_state].includes(event.reason)) {
    throw new Error("Fleet event state and reason are inconsistent");
  }
  const requiredState = {
    guardian_degraded: "degraded",
    guardian_held: "held",
    guardian_recovering: "recovering",
    guardian_recovered: "healthy",
    guardian_unreachable: "unreachable"
  }[event.event_type];
  if (requiredState && event.to_state !== requiredState) throw new Error("Fleet event type and target state are inconsistent");
  for (const key of ["heartbeat_sequence", "policy_sequence", "checkpoint_sequence"]) assertSafeInteger(event[key], `Fleet event ${key}`);
  return deepFreeze(event);
}

export function planHeartbeatDelay({
  state,
  consecutiveHealthy = 0,
  stateChanged = false,
  jitterUnit = 0,
  budgets: budgetOverrides = {}
}) {
  const budgets = validateObservabilityBudgets(budgetOverrides);
  if (!GUARDIAN_STATES.includes(state)) throw new Error("heartbeat schedule state is invalid");
  assertSafeInteger(consecutiveHealthy, "consecutive healthy heartbeat count");
  if (typeof stateChanged !== "boolean") throw new Error("heartbeat state-change flag is invalid");
  if (typeof jitterUnit !== "number" || !Number.isFinite(jitterUnit) || jitterUnit < -1 || jitterUnit > 1) {
    throw new Error("heartbeat jitter input is invalid");
  }
  if (stateChanged) return 0;
  const base = state === "healthy"
    ? (consecutiveHealthy >= 10 ? budgets.stable_interval_ms : budgets.healthy_interval_ms)
    : budgets.attention_interval_ms;
  const delay = Math.round(base * (1 + jitterUnit * budgets.jitter_fraction));
  if (delay >= budgets.heartbeat_validity_ms) throw new Error("heartbeat schedule exceeds the validity window");
  return delay;
}

function decodeCanonicalBase64(value, label, maxBytes) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || value.length > 4 * Math.ceil(maxBytes / 3)) {
    throw new Error(`${label} is not canonical base64`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${label} is not canonical base64`);
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`${label} is not canonical base64`);
  }
  if (btoa(binary) !== value) throw new Error(`${label} is not canonical base64`);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > maxBytes) throw new Error(`${label} is too large`);
  return bytes;
}

function telemetryPayloadLimit(kind, budgets) {
  if (kind === HEARTBEAT_VERSION) return budgets.heartbeat_max_bytes;
  if (kind === FLEET_SNAPSHOT_VERSION) return budgets.snapshot_max_bytes;
  if (kind === FLEET_EVENT_VERSION) return budgets.event_max_bytes;
  throw new Error("telemetry payload kind is invalid");
}

async function importVerificationKey(value, cryptoImpl) {
  if (typeof CryptoKey !== "undefined" && value instanceof CryptoKey) return value;
  let bytes;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else throw new Error("telemetry verification key is invalid");
  if (bytes.byteLength !== 32) throw new Error("telemetry verification key is invalid");
  return cryptoImpl.subtle.importKey("raw", bytes, { name: "Ed25519" }, false, ["verify"]);
}

export async function verifyTelemetryEnvelope({
  envelope,
  publicKeys,
  nowMs = Date.now(),
  budgets: budgetOverrides = {},
  cryptoImpl = globalThis.crypto
}) {
  if (!Number.isSafeInteger(nowMs) || !cryptoImpl?.subtle) throw new Error("telemetry verification environment is invalid");
  const budgets = validateObservabilityBudgets(budgetOverrides);
  const snapshot = safeClone(envelope, "telemetry envelope");
  exactKeys(snapshot, ["envelope_version", "algorithm", "payload_kind", "payload", "signature", "public_key_id"], "telemetry envelope");
  if (snapshot.envelope_version !== TELEMETRY_ENVELOPE_VERSION || snapshot.algorithm !== "Ed25519") {
    throw new Error("telemetry envelope metadata is invalid");
  }
  assertIdentity(snapshot.public_key_id, "telemetry public key id");
  const keyValue = publicKeys instanceof Map ? publicKeys.get(snapshot.public_key_id) : publicKeys?.[snapshot.public_key_id];
  if (!keyValue) throw new Error("telemetry public key id is unknown");
  const payloadBytes = decodeCanonicalBase64(snapshot.payload, "telemetry payload", telemetryPayloadLimit(snapshot.payload_kind, budgets));
  const signatureBytes = decodeCanonicalBase64(snapshot.signature, "telemetry signature", 64);
  if (signatureBytes.byteLength !== 64) throw new Error("telemetry signature is invalid");
  const key = await importVerificationKey(keyValue, cryptoImpl);
  if (!await cryptoImpl.subtle.verify({ name: "Ed25519" }, key, signatureBytes, payloadBytes)) {
    throw new Error("telemetry signature is invalid");
  }
  let payload;
  try {
    payload = parseUniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch (error) {
    if (error instanceof DuplicateJsonMemberError) throw new Error("telemetry payload contains duplicate JSON fields");
    throw new Error("telemetry payload is not strict UTF-8 JSON");
  }
  if (payload?.version !== snapshot.payload_kind) throw new Error("telemetry envelope kind does not match its signed payload");
  let validated;
  if (payload.version === HEARTBEAT_VERSION) validated = validateGuardianHeartbeat(payload, { nowMs, budgets });
  else if (payload.version === FLEET_SNAPSHOT_VERSION) validated = validateFleetSnapshot(payload, { nowMs, budgets });
  else if (payload.version === FLEET_EVENT_VERSION) {
    validated = validateFleetEvent(payload, { budgets });
    const { event_id: _eventId, ...body } = validated;
    const expectedId = `sha256:${await sha256Hex(stableJson(body), cryptoImpl)}`;
    if (validated.event_id !== expectedId) throw new Error("Fleet event id does not match its payload");
  } else throw new Error("telemetry payload version is invalid");
  return deepFreeze({ payload: validated, public_key_id: snapshot.public_key_id });
}
