import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stable browser entries are small composition facades", async () => {
  const [policy, contracts, simulator] = await Promise.all([
    readFile(new URL("../policy-roundtrip.js", import.meta.url), "utf8"),
    readFile(new URL("../simulator-contracts.js", import.meta.url), "utf8"),
    readFile(new URL("../simulator.js", import.meta.url), "utf8")
  ]);
  assert.ok(policy.length < 1024);
  assert.ok(contracts.length < 1024);
  assert.ok(simulator.length < 512);
  assert.match(policy, /runtime\/policy\/core\.js/);
  assert.match(contracts, /runtime\/simulator\/contracts-core\.js/);
  assert.match(simulator, /simulator\/controller\.js/);
});

test("narrow contract and transport seams expose only their declared responsibilities", async () => {
  const [receipts, fleet, resilience, transport, policy, policyJSON, encoding, bounded, evaluator, roundtrip, panel] = await Promise.all([
    import("../runtime/receipts/contracts.js"),
    import("../runtime/fleet/contracts.js"),
    import("../runtime/resilience/contracts.js"),
    import("../runtime/transport/simulator-json.js"),
    import("../runtime/policy/contracts.js"),
    import("../runtime/json/policy-json.js"),
    import("../runtime/crypto/encoding.js"),
    import("../runtime/transport/bounded-json.js"),
    import("../runtime/policy/evaluator.js"),
    import("../runtime/policy/roundtrip.js"),
    import("../ui/policy-roundtrip-panel.js")
  ]);
  assert.deepEqual(Object.keys(receipts).sort(), ["SIMULATOR_RULES", "SIMULATOR_SCENARIOS", "validateReceiptBundle"]);
  assert.deepEqual(Object.keys(fleet).sort(), ["FLEET_AUDIT_AUTHENTICATION", "RECORDED_GUARDIAN_ALIASES", "deriveFleetSummary", "resolveFleetGuardianAliases", "validateFleetEvidence"]);
  assert.deepEqual(Object.keys(resilience).sort(), ["MAX_RESILIENCE_EVENT_CHARACTERS", "RESILIENCE_CONTRACTS", "createResilienceStreamSequence", "resolveAffectedGuardianIDs", "resolveResilienceStreamURL", "validateResilienceStreamEvent"]);
  assert.deepEqual(Object.keys(transport).sort(), ["MAX_FLEET_EVIDENCE_BYTES", "MAX_RECEIPT_BUNDLE_BYTES", "MAX_SIMULATOR_STREAM_CHUNKS", "SIMULATOR_FETCH_TIMEOUT_MS", "fetchSimulatorJSON", "parseSimulatorJSON", "readBoundedJSONResponse"]);
  assert.equal(typeof policy.validatePolicy, "function");
  assert.equal(Object.hasOwn(policy, "bootstrapPolicyRoundTrip"), false);
  assert.deepEqual(Object.keys(policyJSON).sort(), ["MAX_VECTOR_BYTES", "parseStrictJSON"]);
  assert.deepEqual(Object.keys(encoding).sort(), ["TRUSTED_AUDIT_KEY", "TRUSTED_FLEET_KEY", "decodeBase64", "sha256Hex"]);
  assert.deepEqual(Object.keys(bounded).sort(), ["FETCH_TIMEOUT_MS", "fetchBoundedJSON"]);
  assert.deepEqual(Object.keys(evaluator), ["evaluatePolicyRequest"]);
  assert.deepEqual(Object.keys(roundtrip).sort(), ["sameJSONValue", "validateRoundTripEvidence"]);
  assert.deepEqual(Object.keys(panel).sort(), ["bootstrapPolicyRoundTrip", "classifyAuthority", "createLatestRequestGate"]);
});
