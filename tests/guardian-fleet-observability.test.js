import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { validateContinuityEvidence } from "../continuity-evidence.js";
import {
  DEFAULT_OBSERVABILITY_BUDGETS,
  FLEET_EVENT_VERSION,
  FLEET_SNAPSHOT_VERSION,
  HEARTBEAT_VERSION,
  TELEMETRY_ENVELOPE_VERSION,
  aggregateFleetObservations,
  aggregateFleetSnapshot,
  classifyGuardianHeartbeat,
  createGuardianHeartbeatGuard,
  deriveFleetEvents,
  deriveGuardianOperationalState,
  parseObservabilityTimestamp,
  planHeartbeatDelay,
  projectPublicContinuity,
  projectPublicContinuityFromHeartbeats,
  validateFleetEvent,
  validateFleetSnapshot,
  validateGuardianHeartbeat,
  validateObservabilityBudgets,
  verifyTelemetryEnvelope
} from "../runtime/observability/guardian-fleet-state.js";
import { DuplicateJsonMemberError, parseUniqueJson, rejectDuplicateJsonMembers } from "../runtime/json/strict-json.js";
import { makeExpectedGuardians, makeFleet, makeHeartbeat, receivedAt, setOperationalState, TEST_NOW_MS } from "./helpers/observability-fixtures.js";

const clone = structuredClone;
const guardianBinding = (guardianId = "bounder-000", fleetId = "relief-fleet") => ({ fleet_id: fleetId, guardian_id: guardianId });

test("published observability schemas accept canonical private contracts and reject leakage or extension", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const names = [
    "creedspace-bounder-guardian-heartbeat-v1.schema.json",
    "creedspace-bounder-fleet-snapshot-v1.schema.json",
    "creedspace-bounder-fleet-event-v1.schema.json",
    "creedspace-bounder-telemetry-envelope-v1.schema.json"
  ];
  const schemas = await Promise.all(names.map(async (name) => JSON.parse(await readFile(new URL(`../schemas/${name}`, import.meta.url), "utf8"))));
  const validators = Object.fromEntries(schemas.map((schema) => [schema.$id.split("/").at(-1), ajv.compile(schema)]));
  const heartbeat = makeHeartbeat();
  const fleet = makeFleet(6);
  const snapshot = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...fleet, nowMs: TEST_NOW_MS });
  const [event] = await deriveFleetEvents({ currentHeartbeat: heartbeat, observedAtMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  const envelope = {
    envelope_version: TELEMETRY_ENVELOPE_VERSION,
    algorithm: "Ed25519",
    payload_kind: HEARTBEAT_VERSION,
    payload: Buffer.from(JSON.stringify(heartbeat)).toString("base64"),
    signature: Buffer.alloc(64).toString("base64"),
    public_key_id: "guardian-test-key"
  };
  assert.equal(validators[names[0]](heartbeat), true, JSON.stringify(validators[names[0]].errors));
  assert.equal(validators[names[1]](snapshot), true, JSON.stringify(validators[names[1]].errors));
  assert.equal(validators[names[2]](event), true, JSON.stringify(validators[names[2]].errors));
  assert.equal(validators[names[3]](envelope), true, JSON.stringify(validators[names[3]].errors));

  const leaked = clone(snapshot);
  leaked.guardian_ids = ["bounder-000"];
  assert.equal(validators[names[1]](leaked), false);
  const extended = clone(heartbeat);
  extended.command = "takeoff";
  assert.equal(validators[names[0]](extended), false);
});

test("heartbeat validation derives one exact operational state and preserves immutable input semantics", () => {
  const healthy = validateGuardianHeartbeat(makeHeartbeat(), { nowMs: TEST_NOW_MS });
  assert.equal(healthy.state, "healthy");
  assert.equal(Object.isFrozen(healthy), true);
  assert.equal(Object.isFrozen(healthy.policy), true);
  assert.deepEqual(deriveGuardianOperationalState(healthy), { state: "healthy", reason: "none" });

  const cases = [
    ["degraded", "audit_backlog"],
    ["degraded", "resource_pressure"],
    ["degraded", "evidence_lag"],
    ["degraded", "partial_connectivity"],
    ["held", "policy_expired"],
    ["held", "policy_unverified"],
    ["held", "continuity_lease_expired"],
    ["held", "rollback_detected"],
    ["recovering", "guardian_restart"],
    ["recovering", "checkpoint_restore"]
  ];
  for (const [state, reason] of cases) {
    const heartbeat = setOperationalState(makeHeartbeat(), state, reason);
    const validated = validateGuardianHeartbeat(heartbeat, { nowMs: TEST_NOW_MS });
    assert.deepEqual(deriveGuardianOperationalState(validated), { state, reason }, reason);
  }

  const dishonest = makeHeartbeat();
  dishonest.state = "degraded";
  dishonest.reason = "resource_pressure";
  assert.throws(() => validateGuardianHeartbeat(dishonest, { nowMs: TEST_NOW_MS }), /expected healthy\/none/);
  const expired = makeHeartbeat();
  expired.expires_at = new Date(TEST_NOW_MS - 1).toISOString();
  expired.generated_at = new Date(TEST_NOW_MS - 60_001).toISOString();
  expired.checkpoint.persisted_at = new Date(TEST_NOW_MS - 61_001).toISOString();
  expired.evidence.freshest_at = new Date(TEST_NOW_MS - 65_001).toISOString();
  assert.throws(() => validateGuardianHeartbeat(expired, { nowMs: TEST_NOW_MS }), /expired/);
  assert.deepEqual(classifyGuardianHeartbeat(expired, { nowMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS - 60_001 }), { state: "unreachable", reason: "heartbeat_expired" });
  assert.deepEqual(classifyGuardianHeartbeat(null, { nowMs: TEST_NOW_MS }), { state: "unreachable", reason: "missing_heartbeat" });

  // Evidence age is judged as the Guardian declared it at generated_at. Fleet cannot see evidence
  // refreshed after the heartbeat, so re-aging it at observation time would flap every cycle.
  const agingEvidence = makeHeartbeat();
  assert.deepEqual(classifyGuardianHeartbeat(agingEvidence, { nowMs: TEST_NOW_MS + 31_000 , receivedAtMs: TEST_NOW_MS }), { state: "healthy", reason: "none" });
  const lagging = setOperationalState(makeHeartbeat(), "degraded", "evidence_lag");
  assert.deepEqual(classifyGuardianHeartbeat(lagging, { nowMs: TEST_NOW_MS + 1_000 , receivedAtMs: TEST_NOW_MS }), { state: "degraded", reason: "evidence_lag" });
  const expiringPolicy = makeHeartbeat();
  expiringPolicy.policy.expires_at = new Date(TEST_NOW_MS + 10_000).toISOString();
  assert.deepEqual(classifyGuardianHeartbeat(expiringPolicy, { nowMs: TEST_NOW_MS + 10_000 , receivedAtMs: TEST_NOW_MS }), { state: "held", reason: "policy_expired" });
  const expiringLease = makeHeartbeat();
  expiringLease.continuity_lease_expires_at = new Date(TEST_NOW_MS + 20_000).toISOString();
  assert.deepEqual(classifyGuardianHeartbeat(expiringLease, { nowMs: TEST_NOW_MS + 21_000 , receivedAtMs: TEST_NOW_MS }), { state: "held", reason: "continuity_lease_expired" });
});

test("heartbeat validation rejects malformed shape, time, identity, counters, latency, backlog, and resource state", () => {
  const cases = [
    ["extra field", (value) => { value.extra = true; }, /fields/],
    ["metadata", (value) => { value.visibility = "public"; }, /metadata/],
    ["fleet identity", (value) => { value.fleet_id = " "; }, /fleet id/],
    ["platform", (value) => { value.platform = "space"; }, /platform/],
    ["boot id", (value) => { value.boot_id = " bad"; }, /boot id/],
    ["sequence", (value) => { value.sequence = 0; }, /sequence/],
    ["future", (value) => { value.generated_at = new Date(TEST_NOW_MS + 600_000).toISOString(); value.expires_at = new Date(TEST_NOW_MS + 620_000).toISOString(); }, /validity/],
    ["long validity", (value) => { value.expires_at = new Date(TEST_NOW_MS + 100_000).toISOString(); }, /validity/],
    ["policy digest", (value) => { value.policy.digest = "sha256:no"; }, /digest/],
    ["future checkpoint", (value) => { value.checkpoint.persisted_at = new Date(TEST_NOW_MS + 1).toISOString(); }, /checkpoint.*future/],
    ["future evidence", (value) => { value.evidence.freshest_at = new Date(TEST_NOW_MS + 1).toISOString(); }, /evidence.*future/],
    ["decision total", (value) => { value.decisions.allowed += 1; }, /decision totals/],
    ["failure total", (value) => { value.decisions.failures = 3; }, /failure count/],
    ["latency order", (value) => { value.decisions.latency_ms.p50 = 6; }, /quantiles/],
    ["latency without decisions", (value) => { value.decisions.evaluated = 0; value.decisions.allowed = 0; value.decisions.held = 0; }, /latency without/],
    ["audit", (value) => { value.audit.queued = 1; }, /backlog/],
    ["resource", (value) => { value.resources.cpu_percent = 101; }, /cpu_percent/],
    ["reason", (value) => { value.reason = "audit_backlog"; }, /state and reason/]
  ];
  for (const [name, mutate, pattern] of cases) {
    const heartbeat = makeHeartbeat();
    mutate(heartbeat);
    assert.throws(() => validateGuardianHeartbeat(heartbeat, { nowMs: TEST_NOW_MS }), pattern, name);
  }
  const huge = makeHeartbeat();
  huge.guardian_id = "x".repeat(250);
  assert.throws(() => validateGuardianHeartbeat(huge, { nowMs: TEST_NOW_MS, budgets: { heartbeat_max_bytes: 100 } }), /byte budget/);
});

test("monotonic guard rejects duplicate, reordered, rollback, and retired-boot replay without corrupting its floor", () => {
  const guard = createGuardianHeartbeatGuard();
  const first = makeHeartbeat();
  guard.accept(first, TEST_NOW_MS);
  assert.throws(() => guard.accept(first, TEST_NOW_MS), /replayed or reordered/);

  const policyRollback = makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2, policySequence: 41 });
  assert.throws(() => guard.accept(policyRollback, TEST_NOW_MS + 1_000), /policy sequence rolled back/);
  const checkpointRollback = makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2, checkpointSequence: 41 });
  assert.throws(() => guard.accept(checkpointRollback, TEST_NOW_MS + 1_000), /checkpoint sequence rolled back/);
  const valid = makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2 });
  guard.accept(valid, TEST_NOW_MS + 1_000);

  const restarted = setOperationalState(makeHeartbeat({ nowMs: TEST_NOW_MS + 2_000, bootId: "boot-new", sequence: 1 }), "recovering", "guardian_restart");
  guard.accept(restarted, TEST_NOW_MS + 2_000);
  assert.equal(guard.state(first.guardian_id).boot_id, "boot-new");
  assert.deepEqual(guard.state(first.guardian_id).retired_boot_ids, ["boot-0"]);
  const replayedBoot = makeHeartbeat({ nowMs: TEST_NOW_MS + 3_000, bootId: "boot-0", sequence: 3 });
  assert.throws(() => guard.accept(replayedBoot, TEST_NOW_MS + 3_000), /boot epoch was replayed/);
  assert.equal(guard.state("unknown"), null);

  const capacityGuard = createGuardianHeartbeatGuard({ budgets: { fleet_max_guardians: 1 } });
  capacityGuard.accept(makeHeartbeat({ guardianId: "capacity-0" }), TEST_NOW_MS);
  assert.throws(
    () => capacityGuard.accept(makeHeartbeat({ guardianId: "capacity-1" }), TEST_NOW_MS),
    /capacity is exhausted/
  );
});

test("Fleet aggregation classifies loss and expiry, preserves privacy, and rejects inventory inconsistencies", () => {
  const fleet = makeFleet(6);
  const snapshot = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...fleet, nowMs: TEST_NOW_MS, cycleStartedAtMs: TEST_NOW_MS - 10 });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.healthy, true);
  assert.equal(snapshot.states.healthy, 6);
  assert.equal(snapshot.decisions.evaluated, 60);
  assert.equal(snapshot.cycle_duration_ms, 10);
  assert.doesNotMatch(JSON.stringify(snapshot), /bounder-000/);
  assert.deepEqual(validateFleetSnapshot(snapshot, { nowMs: TEST_NOW_MS }), snapshot);

  const missing = aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats: fleet.heartbeats.slice(0, 5), receivedAtMs: fleet.receivedAtMs, nowMs: TEST_NOW_MS });
  assert.equal(missing.complete, false);
  assert.equal(missing.states.unreachable, 1);
  assert.equal(missing.reason_counts.missing_heartbeat, 1);

  const expiredHeartbeat = makeHeartbeat({ index: 0, nowMs: TEST_NOW_MS - 61_000 });
  const expired = aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: [fleet.expectedGuardians[0]], heartbeats: [expiredHeartbeat], receivedAtMs: receivedAt([expiredHeartbeat]), nowMs: TEST_NOW_MS });
  assert.equal(expired.states.unreachable, 1);
  assert.equal(expired.reason_counts.heartbeat_expired, 1);

  const expiredSnapshot = clone(snapshot);
  expiredSnapshot.generated_at = new Date(TEST_NOW_MS - 30_000).toISOString();
  expiredSnapshot.expires_at = new Date(TEST_NOW_MS - 1).toISOString();
  assert.throws(() => validateFleetSnapshot(expiredSnapshot, { nowMs: TEST_NOW_MS }), /validity window/);
  const dishonestReasons = clone(snapshot);
  dishonestReasons.reason_counts.none -= 1;
  dishonestReasons.reason_counts.resource_pressure += 1;
  assert.throws(() => validateFleetSnapshot(dishonestReasons, { nowMs: TEST_NOW_MS }), /reason counts are inconsistent/);

  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats: [...fleet.heartbeats, fleet.heartbeats[0]], receivedAtMs: fleet.receivedAtMs, nowMs: TEST_NOW_MS }), /collection is invalid|duplicate/);
  const foreign = makeHeartbeat({ guardianId: "foreign" });
  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats: [foreign], receivedAtMs: receivedAt([foreign]), nowMs: TEST_NOW_MS }), /unknown Guardian/);
  const wrongPlatform = clone(fleet.heartbeats[0]);
  wrongPlatform.platform = "ground";
  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats: [wrongPlatform], receivedAtMs: fleet.receivedAtMs, nowMs: TEST_NOW_MS }), /platform/);
});

const oneEvaluationEach = (fleet) => {
  for (const heartbeat of fleet.heartbeats) {
    heartbeat.decisions.evaluated = 1;
    heartbeat.decisions.allowed = 1;
    heartbeat.decisions.held = 0;
  }
  return fleet;
};

test("public projection accepts only a complete healthy 100-Guardian aggregate and remains compatible with the existing verifier", () => {
  const fleet = oneEvaluationEach(makeFleet(100));
  const snapshot = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...fleet, nowMs: TEST_NOW_MS });
  const projected = projectPublicContinuityFromHeartbeats({ fleetId: "relief-fleet", ...fleet, nowMs: TEST_NOW_MS });
  assert.deepEqual(projectPublicContinuity(snapshot, { nowMs: TEST_NOW_MS, guardiansEvaluated: 100 }), projected);
  assert.equal(projected.device_count, 100);
  assert.equal(projected.healthy, true);
  assert.equal(projected.policies_verified, 100);
  for (const privateField of ["guardian_id", "boot_id", "audit", "resources"]) assert.equal(Object.hasOwn(projected, privateField), false);
  assert.deepEqual(validateContinuityEvidence(projected, TEST_NOW_MS), projected);

  const degradedFleet = makeFleet(100);
  setOperationalState(degradedFleet.heartbeats[0], "degraded", "partial_connectivity");
  const degraded = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...degradedFleet, nowMs: TEST_NOW_MS });
  assert.throws(() => projectPublicContinuity(degraded, { nowMs: TEST_NOW_MS, guardiansEvaluated: 100 }), /complete healthy/);
  assert.throws(() => projectPublicContinuity(aggregateFleetSnapshot({ fleetId: "relief-fleet", ...makeFleet(6), nowMs: TEST_NOW_MS }), { nowMs: TEST_NOW_MS, guardiansEvaluated: 6 }), /100-Guardian/);
  assert.throws(() => projectPublicContinuity(snapshot, { nowMs: TEST_NOW_MS, mode: "simulation", guardiansEvaluated: 100 }), /mode/);
});

test("public projection requires one completed evaluation per Guardian, not only a matching fleet-wide sum", () => {
  const fleet = oneEvaluationEach(makeFleet(100));
  const snapshot = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...fleet, nowMs: TEST_NOW_MS });
  for (const guardiansEvaluated of [undefined, 99, 101, "100", 100.5]) {
    assert.throws(() => projectPublicContinuity(snapshot, { nowMs: TEST_NOW_MS, guardiansEvaluated }), /one completed evaluation per Guardian/, String(guardiansEvaluated));
  }

  // Half the Fleet evaluated twice and half not at all: the sum is still 100.
  const uneven = oneEvaluationEach(makeFleet(100));
  uneven.heartbeats.forEach((heartbeat, index) => {
    const evaluated = index < 50 ? 2 : 0;
    heartbeat.decisions.evaluated = evaluated;
    heartbeat.decisions.allowed = evaluated;
    if (evaluated === 0) heartbeat.decisions.latency_ms = { p50: 0, p95: 0, p99: 0, max: 0 };
  });
  const unevenSnapshot = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...uneven, nowMs: TEST_NOW_MS });
  assert.equal(unevenSnapshot.decisions.evaluated, 100);
  assert.equal(unevenSnapshot.healthy, true);
  assert.throws(() => projectPublicContinuityFromHeartbeats({ fleetId: "relief-fleet", ...uneven, nowMs: TEST_NOW_MS }), /one completed evaluation per Guardian/);
});

test("a healthy Fleet stays healthy between heartbeats even when evidence must be fresher than the heartbeat interval", async () => {
  const fleet = oneEvaluationEach(makeFleet(100));
  for (const heartbeat of fleet.heartbeats) {
    heartbeat.evidence = { freshest_at: new Date(TEST_NOW_MS - 1_000).toISOString(), required_max_age_ms: 5_000 };
  }
  const later = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...fleet, nowMs: TEST_NOW_MS + 10_000 });
  assert.equal(later.states.healthy, 100);
  assert.equal(later.healthy, true);
  assert.equal(projectPublicContinuityFromHeartbeats({ fleetId: "relief-fleet", ...fleet, nowMs: TEST_NOW_MS + 10_000 }).healthy, true);

  const first = fleet.heartbeats[0];
  const connected = await deriveFleetEvents({ currentHeartbeat: first, observedAtMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  const between = await deriveFleetEvents({ previousHeartbeat: first, previousObservedState: "healthy", observedAtMs: TEST_NOW_MS + 10_000, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.deepEqual(connected.map(({ event_type }) => event_type), ["guardian_connected"]);
  assert.deepEqual(between, [], "no degraded/recovered pair between two healthy heartbeats");
});

test("a Fleet snapshot expires at the first policy, lease, or liveness deadline it summarises", () => {
  const fleet = oneEvaluationEach(makeFleet(100));
  for (const heartbeat of fleet.heartbeats) heartbeat.policy.expires_at = new Date(TEST_NOW_MS + 10_000).toISOString();
  const snapshot = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...fleet, nowMs: TEST_NOW_MS });
  assert.equal(snapshot.healthy, true);
  assert.equal(snapshot.expires_at, new Date(TEST_NOW_MS + 10_000).toISOString());
  assert.throws(() => projectPublicContinuity(snapshot, { nowMs: TEST_NOW_MS + 50_000, guardiansEvaluated: 100 }), /validity window/);
  assert.throws(() => projectPublicContinuity(snapshot, { nowMs: TEST_NOW_MS + 10_000, guardiansEvaluated: 100 }), /validity window/);

  const leased = makeFleet(6);
  leased.heartbeats[3].continuity_lease_expires_at = new Date(TEST_NOW_MS + 7_000).toISOString();
  assert.equal(aggregateFleetSnapshot({ fleetId: "relief-fleet", ...leased, nowMs: TEST_NOW_MS }).expires_at, new Date(TEST_NOW_MS + 7_000).toISOString());

  const received = makeFleet(6);
  const receivedAtMs = { ...Object.fromEntries(received.receivedAtMs), "bounder-002": TEST_NOW_MS - 50_000 };
  assert.equal(
    aggregateFleetSnapshot({ fleetId: "relief-fleet", ...received, nowMs: TEST_NOW_MS, receivedAtMs }).expires_at,
    new Date(TEST_NOW_MS + 40_000).toISOString()
  );
});

test("quarantining aggregation sets aside bad heartbeats per Guardian and fails the cycle closed instead of aborting it", () => {
  const fleet = makeFleet(6);
  const longWindow = clone(fleet.heartbeats[1]);
  longWindow.expires_at = new Date(TEST_NOW_MS + 120_000).toISOString();
  const foreign = makeHeartbeat({ guardianId: "foreign" });
  const heartbeats = [fleet.heartbeats[0], longWindow, fleet.heartbeats[2], fleet.heartbeats[2], fleet.heartbeats[3], foreign];
  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats, receivedAtMs: fleet.receivedAtMs, nowMs: TEST_NOW_MS }), /validity window/);

  const { snapshot, rejected } = aggregateFleetObservations({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats, receivedAtMs: fleet.receivedAtMs, nowMs: TEST_NOW_MS });
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.healthy, false);
  assert.equal(snapshot.observed_guardians, 2, "Guardians 0 and 3 remain observed");
  assert.equal(snapshot.states.unreachable, 4);
  assert.equal(snapshot.reason_counts.missing_heartbeat, 4);
  // Every copy of the duplicated Guardian is listed, including the first one it initially accepted.
  assert.deepEqual(rejected.map(({ index, guardian_id }) => [index, guardian_id]), [[1, "bounder-001"], [2, "bounder-002"], [3, "bounder-002"], [5, "foreign"]]);
  assert.match(rejected[0].reason, /validity window/);
  assert.match(rejected[1].reason, /duplicate/);
  assert.match(rejected[2].reason, /duplicate/);
  assert.match(rejected[3].reason, /unknown Guardian/);
  const triplicate = aggregateFleetObservations({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats: [fleet.heartbeats[4], fleet.heartbeats[4], fleet.heartbeats[4]], receivedAtMs: fleet.receivedAtMs, nowMs: TEST_NOW_MS });
  assert.deepEqual(triplicate.rejected.map(({ index }) => index), [0, 1, 2], "the first copy is listed once");
  assert.doesNotMatch(JSON.stringify(snapshot), /bounder-00|foreign/);
  assert.equal(Object.isFrozen(rejected[0]), true);

  const junk = aggregateFleetObservations({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians.slice(0, 1), heartbeats: [null], receivedAtMs: new Map(), nowMs: TEST_NOW_MS });
  assert.deepEqual(junk.rejected.map(({ guardian_id }) => guardian_id), [null]);
  assert.throws(() => aggregateFleetObservations({ fleetId: "relief-fleet", expectedGuardians: [], heartbeats: [], receivedAtMs: new Map(), nowMs: TEST_NOW_MS }), /inventory is invalid/);
});

test("Fleet events are deterministic, transition-only, private, and content-addressed", async () => {
  const first = makeHeartbeat();
  const connected = await deriveFleetEvents({ currentHeartbeat: first, observedAtMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.equal(connected.length, 1);
  assert.equal(connected[0].event_type, "guardian_connected");
  assert.match(connected[0].event_id, /^sha256:/);
  assert.equal(validateFleetEvent(connected[0]).visibility, "fleet-private");

  const advanced = makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2, policySequence: 43, checkpointSequence: 43 });
  const changes = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: advanced, observedAtMs: TEST_NOW_MS + 1_000, receivedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto });
  assert.deepEqual(changes.map(({ event_type }) => event_type), ["policy_advanced", "checkpoint_advanced"]);
  const repeat = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2 }), observedAtMs: TEST_NOW_MS + 1_000, receivedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto });
  assert.deepEqual(repeat, []);

  const degraded = setOperationalState(makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2 }), "degraded", "partial_connectivity");
  const degradedEvents = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: degraded, observedAtMs: TEST_NOW_MS + 1_000, receivedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto });
  assert.equal(degradedEvents[0].event_type, "guardian_degraded");
  const unreachable = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: null, observedAtMs: TEST_NOW_MS + 61_000, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.equal(unreachable[0].event_type, "guardian_unreachable");
  assert.equal(unreachable[0].reason, "heartbeat_expired");
  const noRepeat = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: null, previousObservedState: "unreachable", observedAtMs: TEST_NOW_MS + 61_000, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.deepEqual(noRepeat, []);

  const restarted = setOperationalState(makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, bootId: "new-boot", sequence: 1 }), "recovering", "guardian_restart");
  const restartEvents = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: restarted, observedAtMs: TEST_NOW_MS + 1_000, receivedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto });
  assert.deepEqual(restartEvents.map(({ event_type }) => event_type), ["guardian_restarted", "guardian_recovering"]);

  const reordered = makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 1 });
  await assert.rejects(
    () => deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: reordered, observedAtMs: TEST_NOW_MS + 1_000, receivedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto }),
    /replayed, reordered, or rolled back/
  );
});

test("adaptive scheduling is bounded, immediate on transition, and faster for attention states", () => {
  assert.equal(planHeartbeatDelay({ state: "healthy", stateChanged: true }), 0);
  assert.equal(planHeartbeatDelay({ state: "healthy", consecutiveHealthy: 0, jitterUnit: 0 }), 30_000);
  assert.equal(planHeartbeatDelay({ state: "healthy", consecutiveHealthy: 10, jitterUnit: 0 }), 40_000);
  assert.equal(planHeartbeatDelay({ state: "healthy", consecutiveHealthy: 10, jitterUnit: 1 }), 44_000);
  assert.equal(planHeartbeatDelay({ state: "healthy", consecutiveHealthy: 10, jitterUnit: -1 }), 36_000);
  for (const state of ["degraded", "held", "recovering"]) assert.equal(planHeartbeatDelay({ state, jitterUnit: 0 }), 5_000);
  assert.throws(() => planHeartbeatDelay({ state: "unreachable" }), /state/);
  assert.throws(() => planHeartbeatDelay({ state: "healthy", jitterUnit: 2 }), /jitter/);
  assert.throws(() => validateObservabilityBudgets({ stable_interval_ms: 90_000 }), /outlive/);
  // A stable Guardian must survive one lost report: two maximal delays stay inside validity.
  const { stable_interval_ms: stable, jitter_fraction: jitter, heartbeat_validity_ms: validity } = DEFAULT_OBSERVABILITY_BUDGETS;
  assert.ok(2 * Math.ceil(stable * (1 + jitter)) < validity);
  assert.throws(() => validateObservabilityBudgets({ stable_interval_ms: 60_000 }), /one lost report/);
  assert.doesNotThrow(() => validateObservabilityBudgets({ stable_interval_ms: 60_000, heartbeat_validity_ms: 150_000 }));

  const lastReceived = makeHeartbeat();
  lastReceived.expires_at = new Date(TEST_NOW_MS + validity).toISOString();
  const longest = planHeartbeatDelay({ state: "healthy", consecutiveHealthy: 10, jitterUnit: 1 });
  // The next report is lost; the one after it lands at 2 × the longest delay.
  assert.equal(classifyGuardianHeartbeat(lastReceived, { nowMs: TEST_NOW_MS + 2 * longest , receivedAtMs: TEST_NOW_MS }).state, "healthy");
});

test("signed telemetry verifies exact bytes, key identity, payload kind, event id, and strict JSON", async () => {
  const keyPair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", keyPair.publicKey));
  const signPayload = async (payloadSource, payloadKind = HEARTBEAT_VERSION) => {
    const payloadBytes = new TextEncoder().encode(payloadSource);
    const signature = await webcrypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, payloadBytes);
    return {
      envelope_version: TELEMETRY_ENVELOPE_VERSION,
      algorithm: "Ed25519",
      payload_kind: payloadKind,
      payload: Buffer.from(payloadBytes).toString("base64"),
      signature: Buffer.from(signature).toString("base64"),
      public_key_id: "guardian-test-key"
    };
  };
  const heartbeat = makeHeartbeat();
  const envelope = await signPayload(JSON.stringify(heartbeat));
  const verified = await verifyTelemetryEnvelope({ envelope, publicKeys: { "guardian-test-key": publicKey }, keyBindings: { "guardian-test-key": guardianBinding() }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.equal(verified.payload.guardian_id, heartbeat.guardian_id);
  assert.equal(verified.public_key_id, "guardian-test-key");

  const mutableEnvelope = clone(envelope);
  const pendingVerification = verifyTelemetryEnvelope({ envelope: mutableEnvelope, publicKeys: { "guardian-test-key": publicKey }, keyBindings: { "guardian-test-key": guardianBinding() }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  mutableEnvelope.public_key_id = "changed-after-verification-started";
  assert.equal((await pendingVerification).public_key_id, "guardian-test-key");

  const tampered = clone(envelope);
  const bytes = Buffer.from(tampered.payload, "base64");
  bytes[bytes.length - 2] ^= 1;
  tampered.payload = bytes.toString("base64");
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope: tampered, publicKeys: { "guardian-test-key": publicKey }, keyBindings: { "guardian-test-key": guardianBinding() }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /signature/);
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope, publicKeys: {}, keyBindings: { "guardian-test-key": guardianBinding() }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /unknown/);

  const wrongKind = await signPayload(JSON.stringify(heartbeat), FLEET_SNAPSHOT_VERSION);
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope: wrongKind, publicKeys: { "guardian-test-key": publicKey }, keyBindings: { "guardian-test-key": guardianBinding() }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /kind does not match/);
  const duplicateSource = JSON.stringify(heartbeat).replace('{"version"', '{"version":"duplicate","version"');
  const duplicate = await signPayload(duplicateSource);
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope: duplicate, publicKeys: { "guardian-test-key": publicKey }, keyBindings: { "guardian-test-key": guardianBinding() }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /duplicate/);

  const [event] = await deriveFleetEvents({ currentHeartbeat: heartbeat, observedAtMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  const eventEnvelope = await signPayload(JSON.stringify(event), FLEET_EVENT_VERSION);
  assert.equal((await verifyTelemetryEnvelope({ envelope: eventEnvelope, publicKeys: new Map([["guardian-test-key", publicKey]]), keyBindings: new Map([["guardian-test-key", guardianBinding()]]), nowMs: TEST_NOW_MS, cryptoImpl: webcrypto })).payload.event_id, event.event_id);
  const badEvent = clone(event);
  badEvent.event_id = `sha256:${"0".repeat(64)}`;
  const badEventEnvelope = await signPayload(JSON.stringify(badEvent), FLEET_EVENT_VERSION);
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope: badEventEnvelope, publicKeys: { "guardian-test-key": publicKey }, keyBindings: { "guardian-test-key": guardianBinding() }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /event id/);
});

test("strict JSON parser rejects duplicates, malformed input, excessive depth, and non-string input", () => {
  assert.deepEqual(parseUniqueJson('{"a":1,"nested":{"b":2}}'), { a: 1, nested: { b: 2 } });
  assert.deepEqual(parseUniqueJson(' { "emptyObject": {}, "emptyArray": [], "array": [true, false, null, -1.5e+2], "escaped": "\\u0061\\n" } '), {
    emptyObject: {}, emptyArray: [], array: [true, false, null, -150], escaped: "a\n"
  });
  assert.throws(() => parseUniqueJson('{"a":1,"a":2}'), DuplicateJsonMemberError);
  assert.throws(() => parseUniqueJson('{"a":]'), SyntaxError);
  for (const source of ['{"a" 1}', '{"a":1', '{"a":1 "b":2}', '[1 2]', '[1,]', '"unterminated', '"\\q"', '"\\u00xz"', 'tru', '1 2']) {
    assert.throws(() => parseUniqueJson(source), SyntaxError, source);
  }
  assert.throws(() => rejectDuplicateJsonMembers("[[[[]]]]", 2), SyntaxError);
  assert.throws(() => rejectDuplicateJsonMembers(null), /must be a string/);
  assert.throws(() => rejectDuplicateJsonMembers("{}", 0), /maximum depth/);
  assert.throws(() => rejectDuplicateJsonMembers("{}", 257), /maximum depth/);
  assert.equal(parseObservabilityTimestamp("2024-02-29T12:00:00.123456789Z"), Date.parse("2024-02-29T12:00:00.123Z"));
  assert.throws(() => parseObservabilityTimestamp("2023-02-29T12:00:00Z"), /invalid/);
});

test("virtual-time fault corpus covers loss, delay, duplication, reordering, skew, restart, rollback, partial rollout, and lease expiry", () => {
  const guard = createGuardianHeartbeatGuard();
  const base = makeHeartbeat();
  guard.accept(base, TEST_NOW_MS);
  const faults = [
    ["loss", () => classifyGuardianHeartbeat(null, { nowMs: TEST_NOW_MS }), { state: "unreachable", reason: "missing_heartbeat" }],
    ["delay", () => classifyGuardianHeartbeat(base, { nowMs: TEST_NOW_MS + 61_000 , receivedAtMs: TEST_NOW_MS }), { state: "unreachable", reason: "heartbeat_expired" }],
    ["duplication", () => guard.accept(base, TEST_NOW_MS), /replayed/],
    ["reordering", () => guard.accept(makeHeartbeat({ nowMs: TEST_NOW_MS - 1_000, sequence: 1 }), TEST_NOW_MS), /replayed|reordered/],
    ["clock skew", () => validateGuardianHeartbeat(makeHeartbeat({ nowMs: TEST_NOW_MS + 600_000 }), { nowMs: TEST_NOW_MS }), /validity/],
    ["rollback", () => guard.accept(makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2, checkpointSequence: 41 }), TEST_NOW_MS + 1_000), /rolled back/],
    ["partial rollout", () => aggregateFleetSnapshot({ fleetId: "relief-fleet", ...makeFleet(6), heartbeats: makeFleet(6).heartbeats.slice(0, 3), nowMs: TEST_NOW_MS }).states.unreachable, 3]
  ];
  for (const [name, operation, expected] of faults) {
    if (expected instanceof RegExp) assert.throws(operation, expected, name);
    else assert.deepEqual(operation(), expected, name);
  }
  const restart = setOperationalState(makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, bootId: "restart", sequence: 1 }), "recovering", "guardian_restart");
  assert.equal(validateGuardianHeartbeat(restart, { nowMs: TEST_NOW_MS + 1_000 }).state, "recovering");
  const lease = setOperationalState(makeHeartbeat(), "held", "continuity_lease_expired");
  assert.equal(validateGuardianHeartbeat(lease, { nowMs: TEST_NOW_MS }).state, "held");
});

test("checkpoint sequence 0 is a legal observation, not an 'unset' sentinel", () => {
  const aggregate = (checkpointSequences) => {
    const heartbeats = checkpointSequences.map((checkpointSequence, index) => makeHeartbeat({ index, checkpointSequence }));
    return aggregateFleetSnapshot({
      fleetId: "relief-fleet",
      expectedGuardians: makeExpectedGuardians(checkpointSequences.length),
      heartbeats,
      receivedAtMs: receivedAt(heartbeats),
      nowMs: TEST_NOW_MS
    });
  };

  assert.deepEqual(aggregate([0, 0]).checkpoint_sequences, { minimum: 0, maximum: 0 });
  assert.deepEqual(aggregate([0, 5]).checkpoint_sequences, { minimum: 0, maximum: 5 });
  assert.deepEqual(aggregate([5, 0]).checkpoint_sequences, { minimum: 0, maximum: 5 });
  assert.deepEqual(aggregate([3, 5]).checkpoint_sequences, { minimum: 3, maximum: 5 });
  assert.deepEqual(aggregate([0, 0]).policy_sequences, { minimum: 42, maximum: 42 });

  const unobserved = aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: makeExpectedGuardians(2), heartbeats: [], receivedAtMs: new Map(), nowMs: TEST_NOW_MS });
  assert.equal(unobserved.observed_guardians, 0);
  assert.equal(unobserved.states.unreachable, 2);
  assert.deepEqual(unobserved.checkpoint_sequences, { minimum: 0, maximum: 0 });
  assert.deepEqual(unobserved.policy_sequences, { minimum: 0, maximum: 0 });

  const withRange = (range, key = "checkpoint_sequences") => {
    const snapshot = clone(aggregate([0, 5]));
    snapshot[key] = range;
    return snapshot;
  };
  assert.throws(() => validateFleetSnapshot(withRange({ minimum: 6, maximum: 5 }), { nowMs: TEST_NOW_MS }), /checkpoint sequence range/);
  assert.throws(() => validateFleetSnapshot(withRange({ minimum: 0, maximum: 0 }, "policy_sequences"), { nowMs: TEST_NOW_MS }), /policy sequence range/);
  const emptySnapshot = clone(unobserved);
  emptySnapshot.checkpoint_sequences = { minimum: 0, maximum: 3 };
  assert.throws(() => validateFleetSnapshot(emptySnapshot, { nowMs: TEST_NOW_MS }), /checkpoint sequence range/);
});

test("checkpoint rollback detection survives a zero-valued baseline", async () => {
  const guard = createGuardianHeartbeatGuard();
  guard.accept(makeHeartbeat({ checkpointSequence: 0 }), TEST_NOW_MS);
  assert.equal(guard.state("bounder-000").checkpoint_sequence, 0);
  guard.accept(makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2, checkpointSequence: 5 }), TEST_NOW_MS + 1_000);
  assert.throws(
    () => guard.accept(makeHeartbeat({ nowMs: TEST_NOW_MS + 2_000, sequence: 3, checkpointSequence: 0 }), TEST_NOW_MS + 2_000),
    /checkpoint sequence rolled back/
  );

  const advanced = makeHeartbeat({ checkpointSequence: 5 });
  const rolledBack = makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2, checkpointSequence: 0 });
  await assert.rejects(
    () => deriveFleetEvents({ previousHeartbeat: advanced, currentHeartbeat: rolledBack, observedAtMs: TEST_NOW_MS + 1_000, receivedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto }),
    /replayed, reordered, or rolled back/
  );
  const advancedFromZero = await deriveFleetEvents({
    previousHeartbeat: makeHeartbeat({ checkpointSequence: 0 }),
    currentHeartbeat: makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2, checkpointSequence: 1 }),
    observedAtMs: TEST_NOW_MS + 1_000,
    receivedAtMs: TEST_NOW_MS + 1_000,
    cryptoImpl: webcrypto
  });
  assert.deepEqual(advancedFromZero.map(({ event_type }) => event_type), ["checkpoint_advanced"]);
});

test("a Guardian that is already held at first contact emits its state, not only a connection", async () => {
  const held = setOperationalState(makeHeartbeat(), "held", "rollback_detected");
  const firstContact = await deriveFleetEvents({ currentHeartbeat: held, observedAtMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.deepEqual(firstContact.map(({ event_type }) => event_type), ["guardian_connected", "guardian_held"]);
  assert.equal(firstContact[1].from_state, null);
  assert.equal(firstContact[1].to_state, "held");
  assert.equal(firstContact[1].reason, "rollback_detected");

  const unverified = setOperationalState(makeHeartbeat(), "held", "policy_unverified");
  const unverifiedEvents = await deriveFleetEvents({ currentHeartbeat: unverified, observedAtMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.deepEqual(unverifiedEvents.map(({ event_type }) => event_type), ["guardian_connected", "guardian_held"]);

  const healthy = await deriveFleetEvents({ currentHeartbeat: makeHeartbeat(), observedAtMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.deepEqual(healthy.map(({ event_type }) => event_type), ["guardian_connected"]);

  const resumed = await deriveFleetEvents({ currentHeartbeat: held, previousObservedState: "unreachable", observedAtMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.deepEqual(resumed.map(({ event_type }) => event_type), ["guardian_connected", "guardian_held"]);
  assert.equal(resumed[1].from_state, "unreachable");
});

test("published identity pattern accepts exactly what the runtime validator accepts", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json", import.meta.url), "utf8"));
  const identityPattern = new RegExp(schema.$defs.identity.pattern, "u");
  const { minLength, maxLength } = schema.$defs.identity;
  const schemaAccepts = (value) => value.length >= minLength && value.length <= maxLength && identityPattern.test(value);
  const runtimeAccepts = (value) => {
    const heartbeat = makeHeartbeat();
    heartbeat.guardian_id = value;
    try {
      validateGuardianHeartbeat(heartbeat, { nowMs: TEST_NOW_MS });
      return true;
    } catch (error) {
      return !/Guardian id is invalid/.test(error.message);
    }
  };
  for (const value of [
    "bounder-000", " bounder-000", "bounder-000 ", "a", " ", "a\nb", "a\rb", "a\u2028b", "a\u2029b",
    "a\tb", "a b", "a\u00a0b", "a".repeat(255), "a".repeat(256)
  ]) {
    assert.equal(schemaAccepts(value), runtimeAccepts(value), JSON.stringify(value));
  }

  const snapshotSchema = JSON.parse(await readFile(new URL("../schemas/creedspace-bounder-fleet-snapshot-v1.schema.json", import.meta.url), "utf8"));
  const eventSchema = JSON.parse(await readFile(new URL("../schemas/creedspace-bounder-fleet-event-v1.schema.json", import.meta.url), "utf8"));
  assert.equal(snapshotSchema.$defs.identity.pattern, schema.$defs.identity.pattern);
  assert.equal(eventSchema.$defs.identity.pattern, schema.$defs.identity.pattern);
  assert.deepEqual(snapshotSchema.properties.expected_guardians, { $ref: "#/$defs/positive" });
  assert.equal(snapshotSchema.$defs.positive.minimum, 1);
  assert.throws(() => validateFleetSnapshot({ ...aggregateFleetSnapshot({ fleetId: "relief-fleet", ...makeFleet(2), nowMs: TEST_NOW_MS }), expected_guardians: 0 }, { nowMs: TEST_NOW_MS }), /expected Guardian count/);
});

test("signed telemetry parses payload bytes with the signed-policy parser", async () => {
  const keyPair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", keyPair.publicKey));
  const publicKeys = { "guardian-test-key": publicKey };
  const keyBindings = { "guardian-test-key": guardianBinding() };
  const signPayload = async (payloadSource, publicKeyId = "guardian-test-key") => {
    const payloadBytes = new TextEncoder().encode(payloadSource);
    const signature = await webcrypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, payloadBytes);
    return {
      envelope_version: TELEMETRY_ENVELOPE_VERSION,
      algorithm: "Ed25519",
      payload_kind: HEARTBEAT_VERSION,
      payload: Buffer.from(payloadBytes).toString("base64"),
      signature: Buffer.from(signature).toString("base64"),
      public_key_id: publicKeyId
    };
  };
  const canonical = JSON.stringify(makeHeartbeat());
  const canonicalEnvelope = await signPayload(canonical);
  assert.equal((await verifyTelemetryEnvelope({ envelope: canonicalEnvelope, publicKeys, keyBindings, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto })).payload.sequence, 1);

  // Both payloads are accepted by the weaker duplicate-only parser: the first rounds to a safe
  // integer the signed bytes never stated, the second carries a lone surrogate that `\S` matches.
  const lossySequence = canonical.replace('"sequence":1,', '"sequence":9007199254740990.6,');
  assert.deepEqual(parseUniqueJson(lossySequence).sequence, 9007199254740991);
  const lossyEnvelope = await signPayload(lossySequence);
  await assert.rejects(
    () => verifyTelemetryEnvelope({ envelope: lossyEnvelope, publicKeys, keyBindings, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }),
    /telemetry payload is not strict UTF-8 JSON/
  );

  const loneSurrogate = canonical.replace('"guardian_id":"bounder-000"', '"guardian_id":"bounder-\\ud800"');
  assert.equal(parseUniqueJson(loneSurrogate).guardian_id, "bounder-\ud800");
  const loneSurrogateEnvelope = await signPayload(loneSurrogate);
  await assert.rejects(
    () => verifyTelemetryEnvelope({ envelope: loneSurrogateEnvelope, publicKeys, keyBindings, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }),
    /telemetry payload is not strict UTF-8 JSON/
  );

  const duplicate = canonical.replace('{"version"', '{"version":"duplicate","version"');
  const duplicateEnvelope = await signPayload(duplicate);
  await assert.rejects(
    () => verifyTelemetryEnvelope({ envelope: duplicateEnvelope, publicKeys, keyBindings, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }),
    /telemetry payload contains duplicate JSON fields/
  );

  const longKeyId = "k".repeat(129);
  const longKeyEnvelope = await signPayload(canonical, longKeyId);
  await assert.rejects(
    () => verifyTelemetryEnvelope({ envelope: longKeyEnvelope, publicKeys: { [longKeyId]: publicKey }, keyBindings: { [longKeyId]: guardianBinding() }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }),
    /telemetry public key id is invalid/
  );
  const maximalKeyId = "k".repeat(128);
  const maximalKeyEnvelope = await signPayload(canonical, maximalKeyId);
  assert.equal(
    (await verifyTelemetryEnvelope({ envelope: maximalKeyEnvelope, publicKeys: { [maximalKeyId]: publicKey }, keyBindings: { [maximalKeyId]: guardianBinding() }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto })).public_key_id,
    maximalKeyId
  );
});

test("liveness is bounded by Fleet receive time, and a corrected Guardian clock is not locked out", async () => {
  // A heartbeat dated 299 s ahead of Fleet's clock is inside the accepted skew.
  const skewed = makeHeartbeat({ nowMs: TEST_NOW_MS + 299_000 });
  const guard = createGuardianHeartbeatGuard();
  guard.accept(skewed, TEST_NOW_MS);
  assert.equal(guard.state("bounder-000").received_at_ms, TEST_NOW_MS);

  // Declared expiry alone would keep it reachable for about six minutes, so Fleet-side entry points
  // refuse to classify without a receive time; with one, liveness is capped at 90 s.
  assert.throws(() => classifyGuardianHeartbeat(skewed, { nowMs: TEST_NOW_MS + 330_000 }), /receive time is required/);
  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: makeExpectedGuardians(1), heartbeats: [skewed], nowMs: TEST_NOW_MS + 1_000 }), /receive times are required/);
  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: makeExpectedGuardians(1), heartbeats: [skewed], receivedAtMs: [], nowMs: TEST_NOW_MS + 1_000 }), /receive times are required/);
  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: makeExpectedGuardians(1), heartbeats: [skewed], receivedAtMs: new Map(), nowMs: TEST_NOW_MS + 1_000 }), /receive time is required/);
  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: makeExpectedGuardians(1), heartbeats: [skewed], receivedAtMs: Object.create({ "bounder-000": TEST_NOW_MS }), nowMs: TEST_NOW_MS + 1_000 }), /receive time is required/);
  const unreceived = aggregateFleetObservations({ fleetId: "relief-fleet", expectedGuardians: makeExpectedGuardians(1), heartbeats: [skewed], receivedAtMs: new Map(), nowMs: TEST_NOW_MS + 1_000 });
  assert.equal(unreceived.snapshot.reason_counts.missing_heartbeat, 1);
  assert.equal(unreceived.snapshot.healthy, false);
  assert.match(unreceived.rejected[0].reason, /receive time is required/);
  await assert.rejects(() => deriveFleetEvents({ currentHeartbeat: skewed, observedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto }), /receive time is required/);
  assert.deepEqual(await deriveFleetEvents({ observedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto }), []);
  assert.deepEqual(guard.receiveTimes(), new Map([["bounder-000", TEST_NOW_MS]]));
  assert.deepEqual(
    classifyGuardianHeartbeat(skewed, { nowMs: TEST_NOW_MS + 90_000, receivedAtMs: TEST_NOW_MS }),
    { state: "unreachable", reason: "heartbeat_expired" }
  );
  assert.equal(classifyGuardianHeartbeat(skewed, { nowMs: TEST_NOW_MS + 89_999, receivedAtMs: TEST_NOW_MS }).state, "healthy");
  assert.throws(() => classifyGuardianHeartbeat(skewed, { nowMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS + 1 }), /receive time is invalid/);
  const skewedFleet = aggregateFleetSnapshot({
    fleetId: "relief-fleet",
    expectedGuardians: makeExpectedGuardians(1),
    heartbeats: [skewed],
    nowMs: TEST_NOW_MS + 95_000,
    receivedAtMs: guard.receiveTimes()
  });
  assert.equal(skewedFleet.reason_counts.heartbeat_expired, 1);
  const lost = await deriveFleetEvents({ previousHeartbeat: skewed, previousObservedState: "healthy", observedAtMs: TEST_NOW_MS + 95_000, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.deepEqual(lost.map(({ event_type }) => event_type), ["guardian_unreachable"]);

  // After the clock is corrected, the next signed sequence of the same boot is accepted and the
  // regression is recorded as a diagnostic. A lower or repeated sequence is still refused.
  const corrected = setOperationalState(makeHeartbeat({ nowMs: TEST_NOW_MS + 30_000, sequence: 2 }), "held", "rollback_detected");
  assert.equal(guard.accept(corrected, TEST_NOW_MS + 30_000).state, "held");
  assert.equal(guard.state("bounder-000").clock_regressions, 1);
  assert.equal(guard.state("bounder-000").generated_at_ms, TEST_NOW_MS + 30_000);
  assert.throws(() => guard.accept(makeHeartbeat({ nowMs: TEST_NOW_MS + 31_000, sequence: 2 }), TEST_NOW_MS + 31_000), /sequence was replayed or reordered/);
  const correctedEvents = await deriveFleetEvents({ previousHeartbeat: skewed, currentHeartbeat: corrected, previousObservedState: "healthy", observedAtMs: TEST_NOW_MS + 30_000, receivedAtMs: TEST_NOW_MS + 30_000, cryptoImpl: webcrypto });
  assert.deepEqual(correctedEvents.map(({ event_type }) => event_type), ["guardian_held"]);

  // Across a boot change, time ordering stays strict.
  const newBootEarlier = setOperationalState(makeHeartbeat({ nowMs: TEST_NOW_MS + 29_000, bootId: "boot-1b", sequence: 1 }), "recovering", "guardian_restart");
  assert.throws(() => guard.accept(newBootEarlier, TEST_NOW_MS + 31_000), /time was replayed or reordered/);
});

test("the heartbeat guard can retire a Guardian that left the inventory and so release its capacity", () => {
  const guard = createGuardianHeartbeatGuard({ budgets: { fleet_max_guardians: 1 } });
  guard.accept(makeHeartbeat({ guardianId: "capacity-0" }), TEST_NOW_MS);
  assert.throws(() => guard.accept(makeHeartbeat({ guardianId: "capacity-1" }), TEST_NOW_MS), /capacity is exhausted/);
  assert.equal(guard.retire("capacity-0"), true);
  assert.equal(guard.state("capacity-0"), null);
  assert.equal(guard.retire("capacity-0"), false);
  assert.throws(() => guard.retire(" "), /retired Guardian id is invalid/);
  guard.accept(makeHeartbeat({ guardianId: "capacity-1" }), TEST_NOW_MS);
  assert.equal(guard.state("capacity-1").sequence, 1);
  // A retired id re-entering aggregation is refused by the inventory, not by the guard.
  assert.throws(() => aggregateFleetSnapshot({
    fleetId: "relief-fleet",
    expectedGuardians: [{ guardian_id: "capacity-1", platform: "aerial" }],
    heartbeats: [makeHeartbeat({ guardianId: "capacity-0" })],
    receivedAtMs: guard.receiveTimes(),
    nowMs: TEST_NOW_MS
  }), /unknown Guardian/);
});

test("telemetry signing keys are bound to one Guardian or to the Fleet aggregator", async () => {
  const keyPair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", keyPair.publicKey));
  const sign = async (payload, publicKeyId) => {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const signature = await webcrypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, payloadBytes);
    return {
      envelope_version: TELEMETRY_ENVELOPE_VERSION,
      algorithm: "Ed25519",
      payload_kind: payload.version,
      payload: Buffer.from(payloadBytes).toString("base64"),
      signature: Buffer.from(signature).toString("base64"),
      public_key_id: publicKeyId
    };
  };
  const publicKeys = { "key-a": publicKey, "key-b": publicKey, "fleet-key": publicKey };
  const keyBindings = {
    "key-a": guardianBinding("bounder-000"),
    "key-b": guardianBinding("bounder-001"),
    "fleet-key": { fleet_id: "relief-fleet", role: "fleet-aggregator" }
  };
  const verify = (envelope, bindings = keyBindings) => verifyTelemetryEnvelope({ envelope, publicKeys, keyBindings: bindings, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto });

  // Key A signs a heartbeat for Guardian B with maximal floors: refused before any guard sees it.
  const forged = makeHeartbeat({ index: 1, policySequence: Number.MAX_SAFE_INTEGER, checkpointSequence: Number.MAX_SAFE_INTEGER });
  await assert.rejects(async () => verify(await sign(forged, "key-a")), /not bound to the payload subject/);
  await assert.rejects(async () => verify(await sign(makeHeartbeat(), "fleet-key")), /not bound to the payload subject/);
  const otherFleet = makeHeartbeat();
  otherFleet.fleet_id = "other-fleet";
  await assert.rejects(async () => verify(await sign(otherFleet, "key-a")), /not bound to the payload subject/);

  // Snapshots only from the aggregator key; events from the Guardian itself or the aggregator.
  const snapshot = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...makeFleet(6), nowMs: TEST_NOW_MS });
  assert.equal((await verify(await sign(snapshot, "fleet-key"))).payload.fleet_id, "relief-fleet");
  await assert.rejects(async () => verify(await sign(snapshot, "key-a")), /not bound to the payload subject/);
  const [event] = await deriveFleetEvents({ currentHeartbeat: makeHeartbeat({ index: 1 }), observedAtMs: TEST_NOW_MS, receivedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.equal((await verify(await sign(event, "key-b"))).payload.guardian_id, "bounder-001");
  assert.equal((await verify(await sign(event, "fleet-key"))).payload.guardian_id, "bounder-001");
  await assert.rejects(async () => verify(await sign(event, "key-a")), /not bound to the payload subject/);

  // Missing or malformed bindings fail closed; key ids never resolve through the prototype chain.
  const genuine = await sign(makeHeartbeat(), "key-a");
  await assert.rejects(() => verify(genuine, null), /no subject binding/);
  await assert.rejects(() => verify(genuine, { "key-a": { fleet_id: "relief-fleet" } }), /binding is invalid/);
  await assert.rejects(() => verify(genuine, { "key-a": { fleet_id: "relief-fleet", role: "operator" } }), /binding role is invalid/);
  for (const inherited of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    await assert.rejects(
      () => verifyTelemetryEnvelope({ envelope: { ...genuine, public_key_id: inherited }, publicKeys: {}, keyBindings: {}, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }),
      /telemetry public key id is unknown/,
      inherited
    );
  }

  // The guard accepts the verified result directly and re-checks its binding.
  const guard = createGuardianHeartbeatGuard();
  const verified = await verify(genuine);
  assert.deepEqual(verified.binding, guardianBinding("bounder-000"));
  assert.equal(guard.accept(verified, TEST_NOW_MS).guardian_id, "bounder-000");
  const verifiedSnapshot = await verify(await sign(snapshot, "fleet-key"));
  assert.throws(() => guard.accept(verifiedSnapshot, TEST_NOW_MS), /not a Guardian heartbeat/);
});
