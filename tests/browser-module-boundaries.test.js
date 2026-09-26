import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

test("policy implementations form an acyclic graph and keep the compatibility facade inert", async () => {
  const coreURL = new URL("../runtime/policy/core.js", import.meta.url);
  const coreSource = await readFile(coreURL, "utf8");
  assert.ok(coreSource.length < 1600);
  assert.doesNotMatch(coreSource, /(?:const|function)\s+\w+\s*[=(]/);
  const visited = new Set();
  const visit = async (url, ancestors = new Set()) => {
    assert.equal(ancestors.has(url.href), false, `cyclic policy dependency: ${url.href}`);
    if (visited.has(url.href)) return;
    const source = await readFile(url, "utf8");
    const next = new Set([...ancestors, url.href]);
    for (const match of source.matchAll(/(?:import|export)\s+[\s\S]*?\bfrom\s+["']([^"']+)["']/g)) {
      const dependency = new URL(match[1], url);
      assert.notEqual(dependency.href, coreURL.href, "implementation must not import the compatibility facade");
      await visit(dependency, next);
    }
    visited.add(url.href);
  };
  await visit(coreURL);

  // Every runtime module, not only the policy graph, must import narrow seams directly: the
  // facade re-exports the UI policy panel, so importing it drags UI code into runtime contracts.
  const runtimeRoot = new URL("../runtime/", import.meta.url);
  const runtimeFiles = (await readdir(runtimeRoot, { recursive: true })).filter((path) => path.endsWith(".js"));
  assert.ok(runtimeFiles.length > 10);
  for (const path of runtimeFiles) {
    const url = new URL(path, runtimeRoot);
    if (url.href === coreURL.href) continue;
    const source = await readFile(url, "utf8");
    for (const match of source.matchAll(/(?:import|export)\s+[\s\S]*?\bfrom\s+["']([^"']+)["']/g)) {
      assert.notEqual(new URL(match[1], url).href, coreURL.href, `${path} must not import the compatibility facade`);
      assert.doesNotMatch(new URL(match[1], url).pathname, /\/ui\//, `${path} must not import UI modules`);
    }
  }
  const panel = await readFile(new URL("../ui/policy-panel.js", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /bootstrapPolicyRoundTrip\(document\)/);
  for (const [path, symbol] of [
    ["runtime/json/policy-json.js", "parseStrictJSON"],
    ["runtime/crypto/encoding.js", "decodeBase64"],
    ["runtime/transport/bounded-json.js", "fetchBoundedJSON"],
    ["runtime/policy/contracts.js", "verifyEnvelope"],
    ["runtime/policy/evaluator.js", "evaluatePolicyRequest"],
    ["runtime/policy/roundtrip.js", "validateRoundTripEvidence"]
  ]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`export const ${symbol} =`));
  }
});
