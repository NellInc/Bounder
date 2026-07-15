import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const expectedScenarios = [
  "safe", "civilian", "friendly", "protected", "humanitarian",
  "surrender", "incapacitated", "identification", "proportionality", "human_authorization",
  "altitude", "weather", "window", "link", "replay"
];

test("receipt bundle is complete, versioned, and fail-safe", async () => {
  const bundle = JSON.parse(await readFile(new URL("data/bounder-receipts.v1.json", root), "utf8"));
  assert.equal(bundle.version, "bounder-receipt-bundle/v1");
  assert.equal(bundle.engine, "bounder-io/interlock");
  assert.deepEqual(bundle.receipts.map(({ scenario }) => scenario), expectedScenarios);
  assert.equal(new Set(bundle.receipts.map(({ scenario }) => scenario)).size, expectedScenarios.length);
  for (const receipt of bundle.receipts) {
    assert.equal(receipt.version, "bounder-receipt/v1");
    assert.match(receipt.policy_hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(receipt.adapter.command_sent, false);
    assert.equal(typeof receipt.signature_verified, "boolean");
    assert.ok(receipt.reason.length > 0);
  }
  assert.equal(bundle.receipts.find(({ scenario }) => scenario === "safe").allowed, true);
  assert.equal(bundle.receipts.filter(({ allowed }) => !allowed).length, 14);
  for (const scenario of ["surrender", "incapacitated", "identification", "proportionality", "human_authorization"]) {
    const receipt = bundle.receipts.find((candidate) => candidate.scenario === scenario);
    assert.equal(receipt.action, "intercept");
    assert.equal(receipt.allowed, false);
    assert.equal(receipt.adapter.command_authorized, false);
  }
});

test("simulator consumes same-origin receipts and vendored Three.js", async () => {
  const source = await readFile(new URL("simulator.js", root), "utf8");
  const html = await readFile(new URL("simulator.html", root), "utf8");
  assert.match(source, /fetch\("\.\/data\/bounder-receipts\.v1\.json"/);
  assert.doesNotMatch(source, /const scenarios\s*=/);
  assert.doesNotMatch(source, /esm\.sh|unpkg\.com|jsdelivr\.net/);
  assert.match(html, /vendor\/three\/three\.module\.min\.js/);
  assert.doesNotMatch(html, /esm\.sh|unpkg\.com|jsdelivr\.net/);
  await readFile(new URL("vendor/three/LICENSE", root), "utf8");
  await readFile(new URL("vendor/three/three.core.min.js", root), "utf8");
});

test("fleet evidence covers every simulated guardian and stays protective", async () => {
  const evidence = JSON.parse(await readFile(new URL("data/bounder-fleet-evidence.v1.json", root), "utf8"));
  assert.equal(evidence.version, "bounder-fleet-evidence/v1");
  assert.equal(evidence.fleet_id, "relief-fleet");
  assert.equal(evidence.summary.devices, 16);
  assert.equal(evidence.summary.passed, 16);
  assert.equal(evidence.summary.allowed + evidence.summary.blocked, 16);
  assert.equal(new Set(evidence.devices.map(({ device_id }) => device_id)).size, 16);
  for (const device of evidence.devices) {
    assert.equal(device.passed, true);
    assert.equal(device.fleet_audit.action_type, "physical_interlock");
    assert.match(device.fleet_audit.input_hash, /^[0-9a-f]{64}$/);
    assert.ok(device.fleet_audit.certificate.signature.length > 0);
    assert.deepEqual(JSON.parse(device.fleet_audit.certificate.payload), device.receipt);
    assert.ok(["loiter", "rtl", "land", "intercept"].includes(device.receipt.action));
    if (device.receipt.action === "intercept") assert.equal(device.receipt.allowed, false);
  }
  assert.equal(evidence.lab.mode, "real-fleet-postgresql");
  assert.equal(evidence.lab.enrolled_devices, 16);
  assert.equal(evidence.lab.persisted_audits, 74);
  assert.equal(evidence.lab.signed_audits, 74);
  assert.equal(evidence.lab.stages.length, 14);
  assert.ok(evidence.lab.stages.every(({ passed }) => passed));
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /"target"|"weapon"|"engage"/i);
});

test("fleet resilience evidence covers temporal, transport, trust, and restart faults", async () => {
  const evidence = JSON.parse(await readFile(new URL("data/bounder-fleet-evidence.v1.json", root), "utf8"));
  assert.equal(evidence.resilience.version, "bounder-resilience-evidence/v1");
  assert.equal(evidence.resilience.mode, "deterministic-live-replay");
  assert.equal(evidence.resilience.scenarios.length, 12);
  const scenarios = new Map(evidence.resilience.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const id of ["network-partition", "audit-outage", "corrupted-envelope", "clock-rollback", "guardian-restart", "key-revocation", "stale-evidence", "partial-rollout", "fleet-revocation", "offline-expiry"]) {
    assert.ok(scenarios.has(id), `missing ${id}`);
  }
  for (const scenario of scenarios.values()) {
    assert.ok(scenario.events.length >= 3);
    assert.deepEqual([...scenario.events].sort((left, right) => left.at_ms - right.at_ms), scenario.events);
    assert.equal(scenario.events.at(-1).code, "signed_receipt");
    assert.ok(scenario.safe_response.length > 0);
    assert.ok(scenario.proof.length > 0);
  }
  assert.equal(scenarios.get("clock-rollback").expected_code, "clock_rollback");
  assert.equal(scenarios.get("guardian-restart").expected_code, "policy_replay");
  assert.equal(scenarios.get("key-revocation").expected_code, "unknown_key");
  await readFile(new URL("schemas/bounder-resilience-evidence.v1.schema.json", root), "utf8");
});
