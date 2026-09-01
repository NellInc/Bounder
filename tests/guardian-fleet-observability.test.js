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
  aggregateFleetSnapshot,
  classifyGuardianHeartbeat,
  createGuardianHeartbeatGuard,
  deriveFleetEvents,
  deriveGuardianOperationalState,
  parseObservabilityTimestamp,
  planHeartbeatDelay,
  projectPublicContinuity,
  validateFleetEvent,
  validateFleetSnapshot,
  validateGuardianHeartbeat,
  validateObservabilityBudgets,
  verifyTelemetryEnvelope
} from "../runtime/observability/guardian-fleet-state.js";
import { DuplicateJsonMemberError, parseUniqueJson, rejectDuplicateJsonMembers } from "../runtime/json/strict-json.js";
import { makeFleet, makeHeartbeat, setOperationalState, TEST_NOW_MS } from "./helpers/observability-fixtures.js";

const clone = structuredClone;

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
  const [event] = await deriveFleetEvents({ currentHeartbeat: heartbeat, observedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
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
  assert.deepEqual(classifyGuardianHeartbeat(expired, { nowMs: TEST_NOW_MS }), { state: "unreachable", reason: "heartbeat_expired" });
  assert.deepEqual(classifyGuardianHeartbeat(null, { nowMs: TEST_NOW_MS }), { state: "unreachable", reason: "missing_heartbeat" });

  const agingEvidence = makeHeartbeat();
  assert.deepEqual(classifyGuardianHeartbeat(agingEvidence, { nowMs: TEST_NOW_MS + 31_000 }), { state: "degraded", reason: "evidence_lag" });
  const expiringLease = makeHeartbeat();
  expiringLease.continuity_lease_expires_at = new Date(TEST_NOW_MS + 20_000).toISOString();
  assert.deepEqual(classifyGuardianHeartbeat(expiringLease, { nowMs: TEST_NOW_MS + 21_000 }), { state: "held", reason: "continuity_lease_expired" });
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

  const missing = aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats: fleet.heartbeats.slice(0, 5), nowMs: TEST_NOW_MS });
  assert.equal(missing.complete, false);
  assert.equal(missing.states.unreachable, 1);
  assert.equal(missing.reason_counts.missing_heartbeat, 1);

  const expiredHeartbeat = makeHeartbeat({ index: 0, nowMs: TEST_NOW_MS - 61_000 });
  const expired = aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: [fleet.expectedGuardians[0]], heartbeats: [expiredHeartbeat], nowMs: TEST_NOW_MS });
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

  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats: [...fleet.heartbeats, fleet.heartbeats[0]], nowMs: TEST_NOW_MS }), /collection is invalid|duplicate/);
  const foreign = makeHeartbeat({ guardianId: "foreign" });
  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats: [foreign], nowMs: TEST_NOW_MS }), /unknown Guardian/);
  const wrongPlatform = clone(fleet.heartbeats[0]);
  wrongPlatform.platform = "ground";
  assert.throws(() => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians: fleet.expectedGuardians, heartbeats: [wrongPlatform], nowMs: TEST_NOW_MS }), /platform/);
});

test("public projection accepts only a complete healthy 100-Guardian aggregate and remains compatible with the existing verifier", () => {
  const fleet = makeFleet(100);
  for (const heartbeat of fleet.heartbeats) {
    heartbeat.decisions.evaluated = 1;
    heartbeat.decisions.allowed = 1;
    heartbeat.decisions.held = 0;
  }
  const snapshot = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...fleet, nowMs: TEST_NOW_MS });
  const projected = projectPublicContinuity(snapshot, { nowMs: TEST_NOW_MS });
  assert.equal(projected.device_count, 100);
  assert.equal(projected.healthy, true);
  assert.equal(projected.policies_verified, 100);
  for (const privateField of ["guardian_id", "boot_id", "audit", "resources"]) assert.equal(Object.hasOwn(projected, privateField), false);
  assert.deepEqual(validateContinuityEvidence(projected, TEST_NOW_MS), projected);

  const degradedFleet = makeFleet(100);
  setOperationalState(degradedFleet.heartbeats[0], "degraded", "partial_connectivity");
  const degraded = aggregateFleetSnapshot({ fleetId: "relief-fleet", ...degradedFleet, nowMs: TEST_NOW_MS });
  assert.throws(() => projectPublicContinuity(degraded, { nowMs: TEST_NOW_MS }), /complete healthy/);
  assert.throws(() => projectPublicContinuity(aggregateFleetSnapshot({ fleetId: "relief-fleet", ...makeFleet(6), nowMs: TEST_NOW_MS }), { nowMs: TEST_NOW_MS }), /100-Guardian/);
  assert.throws(() => projectPublicContinuity(snapshot, { nowMs: TEST_NOW_MS, mode: "simulation" }), /mode/);
});

test("Fleet events are deterministic, transition-only, private, and content-addressed", async () => {
  const first = makeHeartbeat();
  const connected = await deriveFleetEvents({ currentHeartbeat: first, observedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.equal(connected.length, 1);
  assert.equal(connected[0].event_type, "guardian_connected");
  assert.match(connected[0].event_id, /^sha256:/);
  assert.equal(validateFleetEvent(connected[0]).visibility, "fleet-private");

  const advanced = makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2, policySequence: 43, checkpointSequence: 43 });
  const changes = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: advanced, observedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto });
  assert.deepEqual(changes.map(({ event_type }) => event_type), ["policy_advanced", "checkpoint_advanced"]);
  const repeat = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2 }), observedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto });
  assert.deepEqual(repeat, []);

  const degraded = setOperationalState(makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 2 }), "degraded", "partial_connectivity");
  const degradedEvents = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: degraded, observedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto });
  assert.equal(degradedEvents[0].event_type, "guardian_degraded");
  const unreachable = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: null, observedAtMs: TEST_NOW_MS + 61_000, cryptoImpl: webcrypto });
  assert.equal(unreachable[0].event_type, "guardian_unreachable");
  assert.equal(unreachable[0].reason, "heartbeat_expired");
  const noRepeat = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: null, previousObservedState: "unreachable", observedAtMs: TEST_NOW_MS + 61_000, cryptoImpl: webcrypto });
  assert.deepEqual(noRepeat, []);

  const restarted = setOperationalState(makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, bootId: "new-boot", sequence: 1 }), "recovering", "guardian_restart");
  const restartEvents = await deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: restarted, observedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto });
  assert.deepEqual(restartEvents.map(({ event_type }) => event_type), ["guardian_restarted", "guardian_recovering"]);

  const reordered = makeHeartbeat({ nowMs: TEST_NOW_MS + 1_000, sequence: 1 });
  await assert.rejects(
    () => deriveFleetEvents({ previousHeartbeat: first, currentHeartbeat: reordered, observedAtMs: TEST_NOW_MS + 1_000, cryptoImpl: webcrypto }),
    /replayed, reordered, or rolled back/
  );
});

test("adaptive scheduling is bounded, immediate on transition, and faster for attention states", () => {
  assert.equal(planHeartbeatDelay({ state: "healthy", stateChanged: true }), 0);
  assert.equal(planHeartbeatDelay({ state: "healthy", consecutiveHealthy: 0, jitterUnit: 0 }), 30_000);
  assert.equal(planHeartbeatDelay({ state: "healthy", consecutiveHealthy: 10, jitterUnit: 0 }), 60_000);
  assert.equal(planHeartbeatDelay({ state: "healthy", consecutiveHealthy: 10, jitterUnit: 1 }), 66_000);
  assert.equal(planHeartbeatDelay({ state: "healthy", consecutiveHealthy: 10, jitterUnit: -1 }), 54_000);
  for (const state of ["degraded", "held", "recovering"]) assert.equal(planHeartbeatDelay({ state, jitterUnit: 0 }), 5_000);
  assert.throws(() => planHeartbeatDelay({ state: "unreachable" }), /state/);
  assert.throws(() => planHeartbeatDelay({ state: "healthy", jitterUnit: 2 }), /jitter/);
  assert.throws(() => validateObservabilityBudgets({ stable_interval_ms: 90_000 }), /outlive/);
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
  const verified = await verifyTelemetryEnvelope({ envelope, publicKeys: { "guardian-test-key": publicKey }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  assert.equal(verified.payload.guardian_id, heartbeat.guardian_id);
  assert.equal(verified.public_key_id, "guardian-test-key");

  const mutableEnvelope = clone(envelope);
  const pendingVerification = verifyTelemetryEnvelope({ envelope: mutableEnvelope, publicKeys: { "guardian-test-key": publicKey }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  mutableEnvelope.public_key_id = "changed-after-verification-started";
  assert.equal((await pendingVerification).public_key_id, "guardian-test-key");

  const tampered = clone(envelope);
  const bytes = Buffer.from(tampered.payload, "base64");
  bytes[bytes.length - 2] ^= 1;
  tampered.payload = bytes.toString("base64");
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope: tampered, publicKeys: { "guardian-test-key": publicKey }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /signature/);
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope, publicKeys: {}, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /unknown/);

  const wrongKind = await signPayload(JSON.stringify(heartbeat), FLEET_SNAPSHOT_VERSION);
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope: wrongKind, publicKeys: { "guardian-test-key": publicKey }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /kind does not match/);
  const duplicateSource = JSON.stringify(heartbeat).replace('{"version"', '{"version":"duplicate","version"');
  const duplicate = await signPayload(duplicateSource);
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope: duplicate, publicKeys: { "guardian-test-key": publicKey }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /duplicate/);

  const [event] = await deriveFleetEvents({ currentHeartbeat: heartbeat, observedAtMs: TEST_NOW_MS, cryptoImpl: webcrypto });
  const eventEnvelope = await signPayload(JSON.stringify(event), FLEET_EVENT_VERSION);
  assert.equal((await verifyTelemetryEnvelope({ envelope: eventEnvelope, publicKeys: new Map([["guardian-test-key", publicKey]]), nowMs: TEST_NOW_MS, cryptoImpl: webcrypto })).payload.event_id, event.event_id);
  const badEvent = clone(event);
  badEvent.event_id = `sha256:${"0".repeat(64)}`;
  const badEventEnvelope = await signPayload(JSON.stringify(badEvent), FLEET_EVENT_VERSION);
  await assert.rejects(() => verifyTelemetryEnvelope({ envelope: badEventEnvelope, publicKeys: { "guardian-test-key": publicKey }, nowMs: TEST_NOW_MS, cryptoImpl: webcrypto }), /event id/);
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
    ["delay", () => classifyGuardianHeartbeat(base, { nowMs: TEST_NOW_MS + 61_000 }), { state: "unreachable", reason: "heartbeat_expired" }],
    ["duplication", () => guard.accept(base, TEST_NOW_MS), /replayed/],
    ["reordering", () => guard.accept(makeHeartbeat({ nowMs: TEST_NOW_MS - 1_000, sequence: 2 }), TEST_NOW_MS), /replayed|reordered/],
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
