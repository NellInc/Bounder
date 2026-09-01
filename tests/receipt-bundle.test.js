import assert from "node:assert/strict";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = new URL("../", import.meta.url);
const schemaPaths = (await readdir(new URL("schemas/", root), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => `schemas/${entry.name}`)
  .sort();
const schemaIDs = {
  bundle: "https://www.bounder.io/schemas/bounder.receipt-bundle.v1.schema.json",
  checkpoint: "https://www.bounder.io/schemas/creedspace-bounder-checkpoint-v1.schema.json",
  envelope: "https://www.bounder.io/schemas/creedspace-bounder-envelope-v1.schema.json",
  policy: "https://www.bounder.io/schemas/creedspace-bounder-policy-v1.schema.json",
  profile: "https://www.bounder.io/schemas/creedspace-bounder-profile-v1.schema.json",
  receipt: "https://www.bounder.io/schemas/bounder.receipt.v1.schema.json",
  resilience: "https://www.bounder.io/schemas/bounder-resilience-evidence.v1.schema.json",
  roundTrip: "https://www.bounder.io/schemas/creedspace-bounder-roundtrip-v1.schema.json"
};

const [schemaDocuments, bundle, fleetEvidence, goldenVectorBytes, roundTrip] = await Promise.all([
  Promise.all(schemaPaths.map(async (path) => JSON.parse(await readFile(new URL(path, root), "utf8")))),
  readFile(new URL("data/bounder-receipts.v1.json", root), "utf8").then(JSON.parse),
  readFile(new URL("data/bounder-fleet-evidence.v1.json", root), "utf8").then(JSON.parse),
  readFile(new URL("data/creedspace-bounder-golden-v1.json", root)),
  readFile(new URL("data/creedspace-bounder-roundtrip-v1.json", root), "utf8").then(JSON.parse)
]);
const goldenVector = JSON.parse(goldenVectorBytes.toString("utf8"));
const policyBytes = Buffer.from(goldenVector.envelope.payload, "base64");
const policy = JSON.parse(policyBytes.toString("utf8"));
const derivedProfile = { version: "creedspace-bounder-profile/v1", ttl_seconds: 300, constraints: policy.constraints };
const derivedCheckpoint = {
  version: "bounder-fleet-checkpoint/v1",
  device_id: policy.subject,
  checkpoint_sequence: 1,
  policy_sequence_floor: policy.sequence,
  trusted_time_floor: policy.issued_at,
  receipt_sequence_floor: 0,
  last_receipt_hash: "",
  signing_key_id: goldenVector.envelope.public_key_id,
  signing_key_generation: 1,
  issued_at: policy.issued_at,
  expires_at: policy.expires_at,
  rollback_detected: false
};

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv, { mode: "full" });
for (const schema of schemaDocuments) ajv.addSchema(schema);
const validators = new Map(schemaDocuments.map((schema) => [schema.$id, ajv.getSchema(schema.$id)]));

const schemaErrorSummary = (errors) => (errors ?? [])
  .map(({ instancePath, keyword, message }) => `${instancePath || "/"} ${keyword}: ${message}`)
  .join("\n");

const assertSchemaValid = (schemaID, value, label) => {
  const validate = validators.get(schemaID);
  assert.equal(typeof validate, "function", `${label}: schema did not compile offline`);
  assert.equal(validate(value), true, `${label}: ${schemaErrorSummary(validate.errors)}`);
};

const assertSchemaInvalid = (schemaID, value, label, errorPattern) => {
  const validate = validators.get(schemaID);
  assert.equal(typeof validate, "function", `${label}: schema did not compile offline`);
  const valid = validate(value);
  const errors = schemaErrorSummary(validate.errors);
  assert.equal(valid, false, `${label}: invalid mutation passed its schema`);
  if (errorPattern) assert.match(errors, errorPattern, `${label}: unexpected validation errors\n${errors}`);
};

const mutate = (value, change) => {
  const copy = structuredClone(value);
  change(copy);
  return copy;
};

const collectSchemaRefs = (value, refs = []) => {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, refs);
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (key === "$ref") refs.push(nested);
      else collectSchemaRefs(nested, refs);
    }
  }
  return refs;
};

const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/;
const decodeCanonicalBase64 = (value, label) => {
  assert.match(value, canonicalBase64, `${label} is not canonical padded base64`);
  const decoded = Buffer.from(value, "base64");
  assert.equal(decoded.toString("base64"), value, `${label} changes when canonically encoded`);
  return decoded;
};

const rawEd25519PublicKey = (base64, label) => {
  const raw = decodeCanonicalBase64(base64, label);
  assert.equal(raw.length, 32, `${label} must decode to 32 bytes`);
  return createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
    format: "der",
    type: "spki"
  });
};

const parseCanonicalUTCNanoseconds = (value) => {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) throw new Error(`noncanonical UTC timestamp: ${value}`);
  const milliseconds = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(milliseconds)) throw new Error(`invalid UTC timestamp: ${value}`);
  return BigInt(milliseconds) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0") || "0");
};

const expectedReceiptSemantics = new Map([
  ["safe", { rule: "all", code: "allowed", action: "loiter", allowed: true, source: "bounder-io/interlock" }],
  ["civilian", { rule: "civilian", code: "civilian_proximity", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["civilian_distance_metres", 5] }],
  ["friendly", { rule: "friendly", code: "friendly_force_proximity", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["friendly_distance_metres", 10] }],
  ["protected", { rule: "protected", code: "protected_site", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["inside_protected_site", true] }],
  ["humanitarian", { rule: "humanitarian", code: "humanitarian_corridor_protected", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["inside_humanitarian_corridor", true] }],
  ["surrender", { rule: "surrender", code: "surrender_protected", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["surrender_observed", true] }],
  ["incapacitated", { rule: "incapacitated", code: "incapacitated_person_protected", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["incapacitated_observed", true] }],
  ["identification", { rule: "identification", code: "positive_identification_required", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["positive_identification", false] }],
  ["proportionality", { rule: "proportionality", code: "proportionality_unconfirmed", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["proportionality_satisfied", false] }],
  ["human_authorization", { rule: "authorization", code: "human_authorization_required", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["human_authorization_confirmed", false] }],
  ["altitude", { rule: "operating", code: "altitude_above_maximum", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["altitude_metres", 120] }],
  ["weather", { rule: "weather", code: "weather_outside_envelope", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["wind_speed_metres_per_second", 26] }],
  ["window", { rule: "operating", code: "operating_window_closed", action: "loiter", allowed: false, source: "bounder-io/interlock" }],
  ["link", { rule: "link", code: "transport_unavailable", action: "loiter", allowed: false, source: "bounder-io/adapter" }],
  ["replay", { rule: "authority", code: "policy_replay", action: "loiter", allowed: false, source: "bounder-io/interlock" }]
]);

const expectedResilience = new Map([
  ["network-partition", ["fleet_unreachable", "civilian_proximity"]],
  ["audit-outage", ["audit_unreachable", "civilian_proximity"]],
  ["corrupted-envelope", ["signature_corrupted", "invalid_signature"]],
  ["clock-rollback", ["time_rollback", "clock_rollback"]],
  ["guardian-restart", ["process_restart", "policy_replay"]],
  ["key-revocation", ["retired_key_used", "unknown_key"]],
  ["stale-evidence", ["evidence_aged_out", "evidence_stale"]],
  ["partial-rollout", ["mixed_policy_sequences", "civilian_proximity"]],
  ["fleet-revocation", ["policy_removed", "policy_unavailable"]],
  ["offline-expiry", ["cache_expired", "policy_expired"]],
  ["coherent-snapshot-rollback", ["snapshot_restored", "state_rollback_detected"]],
  ["continuity-lease-expiry", ["lease_expired", "continuity_lease_expired"]]
]);

const assertResilienceSemantics = (evidence) => {
  const ids = evidence.scenarios.map(({ id }) => id);
  assert.deepEqual(ids, [...expectedResilience.keys()], "resilience scenarios must remain in canonical order");
  for (const scenario of evidence.scenarios) {
    const [faultCode, decisionCode] = expectedResilience.get(scenario.id);
    assert.equal(scenario.expected_code, decisionCode, `${scenario.id} expected code`);
    assert.equal(scenario.events.length, 4, `${scenario.id} must contain exactly four events`);
    const [baseline, fault, decision, audit] = scenario.events;
    assert.deepEqual(
      [baseline.kind, baseline.status, baseline.code, fault.kind, fault.status, fault.code, decision.kind, decision.status, decision.code],
      ["baseline", "verified", "policy_active", "fault", "fault", faultCode, "decision", "held", decisionCode],
      `${scenario.id} event roles`
    );
    for (let index = 0; index < scenario.events.length; index += 1) {
      const event = scenario.events[index];
      if (index === 0 && event.at_ms !== 0) throw new Error(`${scenario.id} timeline must start at zero`);
      if (index > 0 && event.at_ms <= scenario.events[index - 1].at_ms) throw new Error(`${scenario.id} event times must strictly increase`);
      if (event.device_id !== scenario.affected_device) throw new Error(`${scenario.id} event device must match affected_device`);
      if (event.policy_sequence !== baseline.policy_sequence) throw new Error(`${scenario.id} policy sequence must remain consistent`);
    }
    const decisions = scenario.events.filter(({ kind }) => kind === "decision");
    assert.equal(decisions.length, 1, `${scenario.id} must contain exactly one decision event`);
    assert.equal(decisions[0].code, scenario.expected_code, `${scenario.id} decision contradicts expected_code`);
    assert.deepEqual(
      (({ kind, status, code }) => ({ kind, status, code }))(audit),
      { kind: "audit", status: "recorded", code: "signed_receipt" },
      `${scenario.id} must finish with a recorded signed receipt audit`
    );
  }
};

const assertPolicySemantics = (candidate) => {
  const issued = parseCanonicalUTCNanoseconds(candidate.issued_at);
  const notBefore = parseCanonicalUTCNanoseconds(candidate.not_before);
  const expires = parseCanonicalUTCNanoseconds(candidate.expires_at);
  if (issued > notBefore || notBefore >= expires) throw new Error("policy validity times are out of order");
  const sourceIDs = candidate.source_policies.map(({ id }) => id);
  if (new Set(sourceIDs).size !== sourceIDs.length) throw new Error("policy source IDs must be unique");
  const allowed = new Set(candidate.constraints.allowed_actions);
  for (const action of [...(candidate.constraints.rules_of_engagement_actions ?? []), ...(candidate.constraints.evidence_only_actions ?? [])]) {
    if (!allowed.has(action)) throw new Error("policy constrained actions must also be allowed actions");
  }
};

const assertCheckpointSemantics = (candidate) => {
  const trusted = parseCanonicalUTCNanoseconds(candidate.trusted_time_floor);
  const issued = parseCanonicalUTCNanoseconds(candidate.issued_at);
  const expires = parseCanonicalUTCNanoseconds(candidate.expires_at);
  if (trusted > issued || issued >= expires) throw new Error("checkpoint times are out of order");
};

const assertRoundTripRelations = (candidate) => {
  const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (candidate.source_vector_sha256 !== sha256(goldenVectorBytes)) throw new Error("round-trip source vector hash mismatch");
  if (candidate.source_payload_sha256 !== sha256(policyBytes)) throw new Error("round-trip source payload hash mismatch");
  if (candidate.generated_at !== candidate.receipt.evaluated_at) throw new Error("round-trip generation and receipt times differ");
  if (parseCanonicalUTCNanoseconds(candidate.request.evidence.verified_at) > parseCanonicalUTCNanoseconds(candidate.receipt.evaluated_at)) throw new Error("round-trip evidence comes from the future");
  if (candidate.receipt.device_id !== policy.subject || candidate.receipt.fleet_id !== policy.fleet_id || candidate.receipt.policy_id !== policy.policy_id || candidate.receipt.policy_sequence !== policy.sequence) throw new Error("round-trip receipt does not identify its source policy");
  if (candidate.receipt.signing_key_id !== goldenVector.envelope.public_key_id) throw new Error("round-trip receipt signing key does not match its source envelope");
  if (candidate.request.action !== candidate.receipt.action) throw new Error("round-trip request and receipt actions differ");
  if (candidate.fleet_audit.decision !== (candidate.receipt.allowed ? "allow" : "block")) throw new Error("round-trip audit decision contradicts its receipt");
  if (candidate.fleet_audit.rationale !== candidate.receipt.reason) throw new Error("round-trip audit rationale contradicts its receipt");
  if (candidate.fleet_audit.policy_version !== `${policy.version}#${policy.sequence}`) throw new Error("round-trip audit policy version mismatch");
  assert.deepEqual(candidate.fleet_audit.dimensions_triggered, candidate.receipt, "round-trip audit dimensions must mirror its receipt");

  const certificate = candidate.fleet_audit.certificate;
  assert.deepEqual(JSON.parse(certificate.payload), candidate.receipt, "round-trip certificate payload must mirror its receipt");
  if (candidate.fleet_audit.input_hash !== createHash("sha256").update(certificate.payload).digest("hex")) throw new Error("round-trip certificate payload hash mismatch");
  const signature = decodeCanonicalBase64(certificate.signature, "round-trip signature");
  assert.equal(signature.length, 64, "round-trip signature must decode to 64 bytes");
  if (!verifySignature(null, Buffer.from(certificate.payload), rawEd25519PublicKey(candidate.audit_public_key, "round-trip audit public key"), signature)) throw new Error("round-trip certificate signature verification failed");
};

test("dynamically inventoried schemas compile strictly offline and canonical fixtures validate", () => {
  assert.ok(schemaDocuments.length > 0, "schema inventory must not be empty");
  assert.equal(new Set(schemaDocuments.map(({ $id }) => $id)).size, schemaDocuments.length, "schema IDs must be unique");
  assert.equal(validators.size, schemaDocuments.length, "every inventoried schema must compile");
  for (const [name, schemaID] of Object.entries(schemaIDs)) assert.equal(typeof validators.get(schemaID), "function", `${name} schema is missing`);

  assertSchemaValid(schemaIDs.bundle, bundle, "receipt bundle");
  assertSchemaValid(schemaIDs.resilience, fleetEvidence.resilience, "resilience evidence");
  assertSchemaValid(schemaIDs.envelope, goldenVector.envelope, "signed policy envelope");
  assertSchemaValid(schemaIDs.policy, policy, "decoded policy payload");
  assertSchemaValid(schemaIDs.roundTrip, roundTrip, "signed round trip fixture");

  assertSchemaValid(schemaIDs.profile, derivedProfile, "policy-derived profile");
  assertSchemaValid(schemaIDs.checkpoint, derivedCheckpoint, "policy-derived checkpoint");
});

test("every public schema ID and resolved local reference maps to an existing canonical site path", async () => {
  const inventoriedPaths = new Set(schemaPaths);
  for (const schema of schemaDocuments) {
    const source = new URL(schema.$id);
    assert.equal(source.origin, "https://www.bounder.io", `${schema.$id} must use the canonical origin`);
    assert.match(source.pathname, /^\/schemas\/[^/]+\.schema\.json$/, `${schema.$id} must use the public schemas route`);
    const sourcePath = source.pathname.slice(1);
    assert.equal(inventoriedPaths.has(sourcePath), true, `${schema.$id} has no matching published file`);
    await readFile(new URL(sourcePath, root));

    for (const ref of collectSchemaRefs(schema)) {
      const resolved = new URL(ref, schema.$id);
      assert.equal(resolved.origin, "https://www.bounder.io", `${schema.$id} resolves ${ref} off the canonical origin`);
      const resolvedPath = resolved.pathname.slice(1);
      assert.equal(inventoriedPaths.has(resolvedPath), true, `${schema.$id} resolves ${ref} to missing ${resolved.pathname}`);
      await readFile(new URL(resolvedPath, root));
    }
  }
});

test("receipt schema rejects malformed, contradictory, and non-bounded bundles", () => {
  const cases = [
    ["unknown property", (value) => { value.receipts[0].unexpected_authority = true; }, /\/receipts\/0 additionalProperties/],
    ["invalid generated time", (value) => { value.generated_at = "tomorrow"; }, /\/generated_at (?:format|pattern)/],
    ["invalid state boundary", (value) => { value.receipts[1].state.battery_percent = 101; }, /\/battery_percent maximum/],
    ["unbounded altitude", (value) => { value.receipts[1].state.altitude_metres = 1000001; }, /\/altitude_metres maximum/],
    ["unknown action", (value) => { value.receipts[1].action = "launch_everything"; }, /\/action enum/],
    ["unsafe sequence", (value) => { value.receipts[0].sequence = Number.MAX_SAFE_INTEGER + 1; }, /\/sequence maximum/],
    ["oversized reason", (value) => { value.receipts[0].reason = "x".repeat(1025); }, /\/reason maxLength/],
    ["blank output", (value) => { value.receipts[0].adapter.output = "   "; }, /\/output pattern/],
    ["invalid policy hash", (value) => { value.receipts[0].policy_hash = `sha256:${"A".repeat(64)}`; }, /\/policy_hash pattern/],
    ["allow without authorization", (value) => { value.receipts[0].adapter.command_authorized = false; }, /\/command_authorized const/],
    ["deny with authorization", (value) => { value.receipts[1].adapter.command_authorized = true; }, /\/command_authorized const/],
    ["duplicate scenario", (value) => { value.receipts[value.receipts.length - 1] = structuredClone(value.receipts[0]); }, /\/receipts\/14\/scenario const/],
    ["reordered scenarios", (value) => { [value.receipts[0], value.receipts[1]] = [value.receipts[1], value.receipts[0]]; }, /\/receipts\/0\/scenario const/],
    ["unknown scenario", (value) => { value.receipts.at(-1).scenario = "unknown"; }, /\/scenario (?:enum|const)/],
    ["missing receipt", (value) => { value.receipts.pop(); }, /\/receipts minItems/],
    ["extra receipt", (value) => { value.receipts.push(structuredClone(value.receipts[0])); }, /\/receipts (?:maxItems|items)/]
  ];
  for (const [label, change, error] of cases) assertSchemaInvalid(schemaIDs.bundle, mutate(bundle, change), label, error);
});

test("receipt schema binds every scenario to its decision, source, trigger, and verified signature", () => {
  for (const [index, [scenario, expected]] of [...expectedReceiptSemantics].entries()) {
    const fieldMutations = [
      ["rule", "wrong_rule"],
      ["code", "wrong_code"],
      ["action", expected.action === "loiter" ? "land" : "loiter"],
      ["allowed", !expected.allowed],
      ["decision_source", expected.source === "bounder-io/interlock" ? "bounder-io/adapter" : "bounder-io/interlock"],
      ["signature_verified", false]
    ];
    for (const [field, replacement] of fieldMutations) {
      const candidate = mutate(bundle, (value) => { value.receipts[index][field] = replacement; });
      assertSchemaInvalid(schemaIDs.bundle, candidate, `${scenario} ${field}`, new RegExp(`/receipts/${index}.*(?:const|oneOf)`));
    }
    if (expected.state) {
      const [field, trigger] = expected.state;
      const replacement = typeof trigger === "boolean" ? !trigger : trigger + 1;
      const candidate = mutate(bundle, (value) => { value.receipts[index].state[field] = replacement; });
      assertSchemaInvalid(schemaIDs.bundle, candidate, `${scenario} state trigger`, new RegExp(`/receipts/${index}/state/${field} const`));
    }
  }
});

test("safe receipt schema pins every state dimension instead of trusting a mutable baseline", () => {
  const safe = bundle.receipts.find(({ scenario }) => scenario === "safe");
  for (const [field, original] of Object.entries(safe.state)) {
    const candidate = mutate(safe, (receipt) => {
      receipt.state[field] = typeof original === "boolean" ? !original : original + 1;
    });
    assertSchemaInvalid(
      schemaIDs.receipt,
      candidate,
      `safe ${field}`,
      new RegExp(`/state/${field} const`)
    );
  }
});

test("receipt fixture pins each decision, relevant state, authority, and evidence age", () => {
  assert.deepEqual(bundle.receipts.map(({ scenario }) => scenario), [...expectedReceiptSemantics.keys()]);
  const generatedAt = parseCanonicalUTCNanoseconds(bundle.generated_at);
  for (const receipt of bundle.receipts) {
    const expected = expectedReceiptSemantics.get(receipt.scenario);
    assert.deepEqual(
      (({ rule, code, action, allowed, decision_source: source }) => ({ rule, code, action, allowed, source }))(receipt),
      (({ rule, code, action, allowed, source }) => ({ rule, code, action, allowed, source }))(expected)
    );
    assert.equal(receipt.signature_verified, true);
    assert.equal(receipt.adapter.command_authorized, receipt.allowed);
    assert.equal(receipt.adapter.command_sent, false);
    if (expected.state) assert.equal(receipt.state[expected.state[0]], expected.state[1], `${receipt.scenario} state trigger`);

    const evaluatedAt = parseCanonicalUTCNanoseconds(receipt.evaluated_at);
    const verifiedAt = parseCanonicalUTCNanoseconds(receipt.evidence.verified_at);
    assert.ok(generatedAt >= evaluatedAt, `${receipt.scenario} cannot be evaluated after bundle generation`);
    assert.ok(evaluatedAt >= verifiedAt, `${receipt.scenario} evidence cannot come from the future`);
    assert.equal(evaluatedAt - verifiedAt, BigInt(receipt.evidence.age_seconds) * 1_000_000_000n, `${receipt.scenario} evidence age`);
  }
});

test("bundle time semantics reject future evaluations, future evidence, and false age claims", () => {
  const assertBundleTimes = (candidate) => {
    const generatedAt = parseCanonicalUTCNanoseconds(candidate.generated_at);
    for (const receipt of candidate.receipts) {
      const evaluatedAt = parseCanonicalUTCNanoseconds(receipt.evaluated_at);
      const verifiedAt = parseCanonicalUTCNanoseconds(receipt.evidence.verified_at);
      if (evaluatedAt > generatedAt) throw new Error(`${receipt.scenario} was evaluated after bundle generation`);
      if (verifiedAt > evaluatedAt) throw new Error(`${receipt.scenario} evidence comes from the future`);
      if (evaluatedAt - verifiedAt !== BigInt(receipt.evidence.age_seconds) * 1_000_000_000n) throw new Error(`${receipt.scenario} evidence age does not match its timestamps`);
    }
  };
  const cases = [
    ["evaluation after generation", (value) => { value.generated_at = "2026-07-13T11:59:59Z"; }, /safe was evaluated after bundle generation/],
    ["future evidence", (value) => { value.receipts[0].evidence.verified_at = "2026-07-13T12:00:00.000000001Z"; }, /safe evidence comes from the future/],
    ["false evidence age", (value) => { value.receipts[0].evidence.age_seconds = 29; }, /safe evidence age does not match its timestamps/]
  ];
  for (const [label, change, error] of cases) {
    const candidate = mutate(bundle, change);
    assertSchemaValid(schemaIDs.bundle, candidate, `${label} is structurally valid`);
    assert.throws(() => assertBundleTimes(candidate), error, label);
  }

  const precise = mutate(bundle, (value) => {
    value.generated_at = "2026-07-13T12:00:00.000000002Z";
    value.receipts[0].evaluated_at = "2026-07-13T12:00:00.000000001Z";
    value.receipts[0].evidence.verified_at = "2026-07-13T11:59:30.000000001Z";
  });
  assertSchemaValid(schemaIDs.bundle, precise, "nanosecond-precision UTC timestamps");
  assert.doesNotThrow(() => assertBundleTimes(precise));
});

test("independent timestamp schemas reject offsets, malformed forms, and impossible dates", () => {
  const cases = [
    [schemaIDs.bundle, bundle, (value) => { value.generated_at = "2026-07-13T13:00:00+01:00"; }, /\/generated_at pattern/],
    [schemaIDs.bundle, bundle, (value) => { value.receipts[0].evaluated_at = "2026-07-13t12:00:00z"; }, /\/evaluated_at pattern/],
    [schemaIDs.bundle, bundle, (value) => { value.receipts[0].evidence.verified_at = "2026-02-29T11:59:30Z"; }, /\/verified_at format/],
    [schemaIDs.policy, policy, (value) => { value.issued_at = "2026-07-13T13:00:00+01:00"; }, /\/issued_at pattern/],
    [schemaIDs.policy, policy, (value) => { value.not_before = "2026-07-13T12:00Z"; }, /\/not_before (?:format|pattern)/],
    [schemaIDs.policy, policy, (value) => { value.expires_at = "2026-02-30T12:05:00Z"; }, /\/expires_at format/],
    [schemaIDs.checkpoint, derivedCheckpoint, (value) => { value.trusted_time_floor = "2026-07-13T13:00:00+01:00"; }, /\/trusted_time_floor pattern/],
    [schemaIDs.checkpoint, derivedCheckpoint, (value) => { value.issued_at = "2026-07-13t12:00:00z"; }, /\/issued_at pattern/],
    [schemaIDs.checkpoint, derivedCheckpoint, (value) => { value.expires_at = "2026-02-30T12:05:00Z"; }, /\/expires_at format/],
    [schemaIDs.roundTrip, roundTrip, (value) => { value.generated_at = "2026-07-13T13:00:30+01:00"; }, /\/generated_at pattern/],
    [schemaIDs.roundTrip, roundTrip, (value) => { value.request.evidence.verified_at = "2026-02-30T12:00:25Z"; }, /\/verified_at format/],
    [schemaIDs.roundTrip, roundTrip, (value) => { value.receipt.evaluated_at = "2026-07-13t12:00:30z"; }, /\/evaluated_at pattern/]
  ];
  for (const [schemaID, fixture, change, error] of cases) assertSchemaInvalid(schemaID, mutate(fixture, change), "invalid canonical time", error);
});

test("every public UTC contract rejects year zero and admits the first supported year", () => {
  const cases = [
    [schemaIDs.bundle, bundle, (value, year) => { value.generated_at = `${year}-01-01T00:00:00Z`; }],
    [schemaIDs.receipt, bundle.receipts[0], (value, year) => { value.evaluated_at = `${year}-01-01T00:00:00Z`; }],
    [schemaIDs.policy, policy, (value, year) => { value.issued_at = `${year}-01-01T00:00:00Z`; }],
    [schemaIDs.checkpoint, derivedCheckpoint, (value, year) => { value.trusted_time_floor = `${year}-01-01T00:00:00Z`; }],
    [schemaIDs.roundTrip, roundTrip, (value, year) => { value.generated_at = `${year}-01-01T00:00:00Z`; }]
  ];
  for (const [schemaID, fixture, setYear] of cases) {
    assertSchemaInvalid(schemaID, mutate(fixture, (value) => setYear(value, "0000")), `${schemaID} year zero`, /pattern/);
    assertSchemaValid(schemaID, mutate(fixture, (value) => setYear(value, "0001")), `${schemaID} year one`);
  }
});

test("policy, profile, and checkpoint schemas enforce safe bounds and cross-field semantics", () => {
  assertPolicySemantics(policy);
  assertCheckpointSemantics(derivedCheckpoint);

  const policyCases = [
    ["unsafe sequence", (value) => { value.sequence = Number.MAX_SAFE_INTEGER + 1; }, /\/sequence maximum/],
    ["invalid policy hash", (value) => { value.policy_id = `sha256:${"A".repeat(64)}`; }, /\/policy_id pattern/],
    ["oversized subject", (value) => { value.subject = "x".repeat(256); }, /\/subject maxLength/],
    ["no sources", (value) => { value.source_policies = []; }, /\/source_policies minItems/],
    ["too many sources", (value) => { value.source_policies = Array.from({ length: 65 }, (_, index) => ({ id: `source-${index}`, version: "1", level: "agent" })); }, /\/source_policies maxItems/],
    ["oversized source ID", (value) => { value.source_policies[0].id = "x".repeat(256); }, /\/source_policies\/0\/id maxLength/],
    ["oversized source version", (value) => { value.source_policies[0].version = "x".repeat(65); }, /\/source_policies\/0\/version maxLength/],
    ["duplicate source object", (value) => { value.source_policies.push(structuredClone(value.source_policies[0])); }, /\/source_policies uniqueItems/]
  ];
  for (const [label, change, error] of policyCases) assertSchemaInvalid(schemaIDs.policy, mutate(policy, change), label, error);

  const duplicateSourceID = mutate(policy, (value) => {
    value.source_policies[1].id = value.source_policies[0].id;
    value.source_policies[1].version = "different";
  });
  assertSchemaValid(schemaIDs.policy, duplicateSourceID, "duplicate source IDs with distinct objects are structurally valid");
  assert.throws(() => assertPolicySemantics(duplicateSourceID), /policy source IDs must be unique/);

  for (const [label, change, error] of [
    ["policy activation before issue", (value) => { value.not_before = "2026-07-13T11:59:59Z"; }, /policy validity times are out of order/],
    ["zero policy validity", (value) => { value.expires_at = value.not_before; }, /policy validity times are out of order/],
    ["constrained action absent from allowed actions", (value) => { value.constraints.allowed_actions = ["land", "loiter", "rtl"]; }, /policy constrained actions must also be allowed actions/]
  ]) {
    const candidate = mutate(policy, change);
    assertSchemaValid(schemaIDs.policy, candidate, `${label} is structurally valid`);
    assert.throws(() => assertPolicySemantics(candidate), error);
  }

  for (const [label, change, error] of [
    ["profile TTL below floor", (value) => { value.ttl_seconds = 29; }, /\/ttl_seconds minimum/],
    ["duplicate allowed action", (value) => { value.constraints.allowed_actions.push(value.constraints.allowed_actions[0]); }, /\/allowed_actions uniqueItems/],
    ["unbounded altitude", (value) => { value.constraints.max_altitude_metres = 1000001; }, /\/max_altitude_metres maximum/],
    ["unbounded evidence age", (value) => { value.constraints.max_evidence_age_seconds = 604801; }, /\/max_evidence_age_seconds maximum/]
  ]) assertSchemaInvalid(schemaIDs.profile, mutate(derivedProfile, change), label, error);

  for (const [label, change, error] of [
    ["unsafe checkpoint sequence", (value) => { value.checkpoint_sequence = Number.MAX_SAFE_INTEGER + 1; }, /\/checkpoint_sequence maximum/],
    ["missing nonzero receipt hash", (value) => { value.receipt_sequence_floor = 1; }, /\/last_receipt_hash pattern/],
    ["unexpected initial receipt hash", (value) => { value.last_receipt_hash = "0".repeat(64); }, /\/last_receipt_hash const/],
    ["oversized signing key", (value) => { value.signing_key_id = "x".repeat(129); }, /\/signing_key_id maxLength/]
  ]) assertSchemaInvalid(schemaIDs.checkpoint, mutate(derivedCheckpoint, change), label, error);

  const badCheckpointTime = mutate(derivedCheckpoint, (value) => { value.trusted_time_floor = "2026-07-13T12:00:01Z"; });
  assertSchemaValid(schemaIDs.checkpoint, badCheckpointTime, "out-of-order checkpoint is structurally valid");
  assert.throws(() => assertCheckpointSemantics(badCheckpointTime), /checkpoint times are out of order/);
});

test("simulator consumes same-origin receipts and vendored Three.js", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("simulator/controller.js", root), "utf8"),
    readFile(new URL("simulator.html", root), "utf8")
  ]);
  assert.match(source, /fetchSimulatorJSON\("\.\/data\/bounder-receipts\.v1\.json"/);
  assert.doesNotMatch(source, /const scenarios\s*=/);
  assert.doesNotMatch(source, /esm\.sh|unpkg\.com|jsdelivr\.net/);
  assert.match(html, /vendor\/three\/three\.module\.min\.js/);
  assert.doesNotMatch(html, /esm\.sh|unpkg\.com|jsdelivr\.net/);
  await Promise.all([
    readFile(new URL("vendor/three/LICENSE", root), "utf8"),
    readFile(new URL("vendor/three/three.core.min.js", root), "utf8")
  ]);
});

test("fleet evidence hashes, summaries, and mirrored receipts are internally bound", () => {
  const derivedSummary = {
    devices: fleetEvidence.devices.length,
    allowed: fleetEvidence.devices.filter(({ receipt }) => receipt.allowed).length,
    blocked: fleetEvidence.devices.filter(({ receipt }) => !receipt.allowed).length,
    passed: fleetEvidence.devices.filter(({ passed }) => passed).length
  };
  assert.deepEqual(fleetEvidence.summary, derivedSummary);
  assert.equal(new Set(fleetEvidence.devices.map(({ device_id }) => device_id)).size, fleetEvidence.devices.length);

  for (const device of fleetEvidence.devices) {
    const { certificate } = device.fleet_audit;
    const payloadReceipt = JSON.parse(certificate.payload);
    assert.equal(device.passed, device.expected_code === device.receipt.code);
    assert.equal(device.fleet_audit.action_type, "physical_interlock");
    assert.equal(device.fleet_audit.decision, device.receipt.allowed ? "allow" : "block");
    assert.equal(device.expected_code, device.receipt.code);
    assert.deepEqual(device.fleet_audit.dimensions_triggered, device.receipt);
    assert.deepEqual(payloadReceipt, device.receipt);
    assert.equal(device.fleet_audit.input_hash, createHash("sha256").update(certificate.payload).digest("hex"));
    assert.equal(decodeCanonicalBase64(certificate.signature, `${device.device_id} signature`).length, 64);
    assert.equal(certificate.public_key_id, "bounder_lab_guardian");
    assert.ok(["loiter", "rtl", "land", "intercept"].includes(device.receipt.action));
    if (device.receipt.action === "intercept") assert.equal(device.receipt.allowed, false);
  }

  // The fixture supplies a key ID but no public key bytes. These length checks do
  // not authenticate the fleet signatures; that remains an explicit evidence gap.
  assert.equal(fleetEvidence.lab.mode, "real-fleet-postgresql");
  assert.equal(fleetEvidence.lab.enrolled_devices, fleetEvidence.devices.length);
  assert.equal(fleetEvidence.lab.persisted_audits, 74);
  assert.equal(fleetEvidence.lab.signed_audits, 74);
  assert.equal(fleetEvidence.lab.stages.length, 14);
  assert.ok(fleetEvidence.lab.stages.every(({ passed }) => passed));
  assert.doesNotMatch(JSON.stringify(fleetEvidence), /"target"|"weapon"|"engage"/i);
});

test("resilience evidence has exact unique scenarios and deterministic audit timelines", () => {
  assertResilienceSemantics(fleetEvidence.resilience);
  const resilienceSchema = schemaDocuments.find(({ $id }) => $id === schemaIDs.resilience);
  const scenarioContracts = resilienceSchema.properties.scenarios.prefixItems;
  assert.equal(scenarioContracts.length, fleetEvidence.resilience.scenarios.length);
  for (const [index, scenario] of fleetEvidence.resilience.scenarios.entries()) {
    const contract = scenarioContracts[index].allOf[1];
    assert.equal(contract.properties.id.const, scenario.id, `${scenario.id} schema identity`);
    assert.equal(contract.properties.affected_device.const, scenario.affected_device, `${scenario.id} schema scope`);
    assert.deepEqual(
      contract.properties.events.prefixItems.map(({ properties }) => properties.device_id.const),
      scenario.events.map(({ device_id }) => device_id),
      `${scenario.id} schema event scopes`
    );
  }
});

test("resilience schema and semantic checks reject bounded timeline corruptions", () => {
  const schemaCases = [
    ["missing scenario", (value) => { value.scenarios.pop(); }, /\/scenarios minItems/],
    ["extra scenario", (value) => { value.scenarios.push(structuredClone(value.scenarios[0])); }, /\/scenarios (?:maxItems|items)/],
    ["reordered scenarios", (value) => { [value.scenarios[0], value.scenarios[1]] = [value.scenarios[1], value.scenarios[0]]; }, /\/scenarios\/0\/id const/],
    ["negative time", (value) => { value.scenarios[0].events[1].at_ms = -1; }, /\/at_ms minimum/],
    ["beyond replay horizon", (value) => { value.scenarios[0].events.at(-1).at_ms = 60001; }, /\/at_ms maximum/],
    ["fractional time", (value) => { value.scenarios[0].events[1].at_ms = 1.5; }, /\/at_ms type/],
    ["wrong fault code", (value) => { value.scenarios[0].events[1].code = "wrong_fault"; }, /\/events\/1\/code const/],
    ["wrong decision code", (value) => { value.scenarios[0].events[2].code = "wrong_decision"; }, /\/events\/2\/code const/],
    ["wrong event role", (value) => { value.scenarios[0].events[1].kind = "decision"; }, /\/events\/1\/kind const/],
    ["coherently foreign affected scope", (value) => {
      value.scenarios[0].affected_device = "bounder-bravo";
      for (const event of value.scenarios[0].events) event.device_id = "bounder-bravo";
    }, /\/scenarios\/0\/(?:affected_device|events\/\d+\/device_id) const/],
    ["missing event field", (value) => { delete value.scenarios[0].events[0].message; }, /\/events\/0 required/],
    ["too many events", (value) => { value.scenarios[0].events.push(structuredClone(value.scenarios[0].events[0])); }, /\/events maxItems/],
    ["unsafe policy sequence", (value) => { value.scenarios[0].events[0].policy_sequence = Number.MAX_SAFE_INTEGER + 1; }, /\/policy_sequence maximum/],
    ["unknown event property", (value) => { value.scenarios[0].events[0].unexpected = true; }, /\/events\/0 additionalProperties/],
    ["oversized proof", (value) => { value.scenarios[0].proof = "x".repeat(2049); }, /\/proof maxLength/]
  ];
  for (const [label, change, error] of schemaCases) assertSchemaInvalid(schemaIDs.resilience, mutate(fleetEvidence.resilience, change), label, error);

  const boundary = mutate(fleetEvidence.resilience, (value) => { value.scenarios[0].events.at(-1).at_ms = 60000; });
  assertSchemaValid(schemaIDs.resilience, boundary, "60-second replay boundary");
  assert.doesNotThrow(() => assertResilienceSemantics(boundary));

  const semanticCases = [
    ["equal event times", (value) => { value.scenarios[0].events[1].at_ms = value.scenarios[0].events[0].at_ms; }, /network-partition event times must strictly increase/],
    ["foreign event device", (value) => { value.scenarios[0].events[1].device_id = "bounder-foreign"; }, /network-partition event device must match affected_device/],
    ["inconsistent sequence", (value) => { value.scenarios[0].events[1].policy_sequence += 1; }, /network-partition policy sequence must remain consistent/],
    ["non-audit ending", (value) => { value.scenarios[0].events.at(-1).kind = "fault"; }, /network-partition must finish with a recorded signed receipt audit/]
  ];
  for (const [label, change, error] of semanticCases) {
    assert.throws(() => assertResilienceSemantics(mutate(fleetEvidence.resilience, change)), error, label);
  }
});

test("signed schemas reject malformed and noncanonical base64 with wrong decoded lengths", () => {
  assert.equal(decodeCanonicalBase64(goldenVector.envelope.payload, "policy payload").equals(policyBytes), true);
  assert.equal(decodeCanonicalBase64(goldenVector.envelope.signature, "policy signature").length, 64);
  assert.equal(decodeCanonicalBase64(goldenVector.public_key, "policy public key").length, 32);

  const envelopeCases = [
    ["malformed payload", (value) => { value.payload = "!!!"; }],
    ["malformed signature", (value) => { value.signature = "!!!"; }],
    ["63-byte signature", (value) => { value.signature = Buffer.alloc(63).toString("base64"); }],
    ["noncanonical padding bits", (value) => { value.signature = `${value.signature.slice(0, 85)}B==`; }]
  ];
  for (const [label, change] of envelopeCases) assertSchemaInvalid(schemaIDs.envelope, mutate(goldenVector.envelope, change), label);

  const checkpointEnvelope = {
    payload: "{}",
    signature: Buffer.alloc(64).toString("base64"),
    public_key_id: "bounder_lab_guardian"
  };
  assertSchemaValid(schemaIDs.checkpoint, checkpointEnvelope, "checkpoint envelope");
  assert.equal(decodeCanonicalBase64(checkpointEnvelope.signature, "checkpoint signature").length, 64);
  for (const [label, change] of [
    ["checkpoint malformed signature", (value) => { value.signature = "!!!!"; }],
    ["checkpoint wrong signature length", (value) => { value.signature = Buffer.alloc(65).toString("base64"); }],
    ["checkpoint oversized key ID", (value) => { value.public_key_id = "x".repeat(129); }]
  ]) {
    assertSchemaInvalid(schemaIDs.checkpoint, mutate(checkpointEnvelope, change), label);
  }

  for (const [label, change] of [
    ["checkpoint unsafe integer", (value) => { value.checkpoint_sequence = Number.MAX_SAFE_INTEGER + 1; }],
    ["checkpoint missing receipt hash", (value) => { value.receipt_sequence_floor = 1; }],
    ["checkpoint unexpected initial hash", (value) => { value.last_receipt_hash = "0".repeat(64); }]
  ]) {
    assertSchemaInvalid(schemaIDs.checkpoint, mutate(derivedCheckpoint, change), label);
  }

  for (const [label, change, error] of [
    ["63-byte audit signature", (value) => { value.fleet_audit.certificate.signature = Buffer.alloc(63).toString("base64"); }, /\/signature minLength/],
    ["65-byte audit signature", (value) => { value.fleet_audit.certificate.signature = Buffer.alloc(65).toString("base64"); }, /\/signature pattern/],
    ["31-byte audit key", (value) => { value.audit_public_key = Buffer.alloc(31).toString("base64"); }, /\/audit_public_key pattern/],
    ["33-byte audit key", (value) => { value.audit_public_key = Buffer.alloc(33).toString("base64"); }, /\/audit_public_key pattern/],
    ["noncanonical audit key padding", (value) => { value.audit_public_key = `${value.audit_public_key.slice(0, 42)}B=`; }, /\/audit_public_key pattern/]
  ]) assertSchemaInvalid(schemaIDs.roundTrip, mutate(roundTrip, change), label, error);
});

test("published signatures verify and round-trip records remain relationally bound", () => {
  const envelopeSignature = decodeCanonicalBase64(goldenVector.envelope.signature, "policy signature");
  assert.equal(
    verifySignature(null, policyBytes, rawEd25519PublicKey(goldenVector.public_key, "policy public key"), envelopeSignature),
    true,
    "published policy signature must verify"
  );
  assertPolicySemantics(policy);
  assert.doesNotThrow(() => assertRoundTripRelations(roundTrip));

  const cases = [
    ["source vector hash", (value) => { value.source_vector_sha256 = `sha256:${"0".repeat(64)}`; }, /source vector hash mismatch/],
    ["source payload hash", (value) => { value.source_payload_sha256 = `sha256:${"0".repeat(64)}`; }, /source payload hash mismatch/],
    ["source policy sequence", (value) => { value.receipt.policy_sequence += 1; }, /receipt does not identify its source policy/],
    ["source signing key", (value) => { value.receipt.signing_key_id = "other-key"; }, /receipt signing key does not match its source envelope/],
    ["audit decision", (value) => { value.fleet_audit.decision = "block"; }, /audit decision contradicts its receipt/],
    ["audit dimensions", (value) => { value.fleet_audit.dimensions_triggered.reason = "different"; }, /round-trip audit dimensions must mirror its receipt/],
    ["certificate payload hash", (value) => { value.fleet_audit.input_hash = "0".repeat(64); }, /certificate payload hash mismatch/],
    ["generation time", (value) => { value.generated_at = "2026-07-13T12:00:31Z"; }, /generation and receipt times differ/],
    ["audit public key", (value) => { value.audit_public_key = Buffer.alloc(32).toString("base64"); }, /certificate signature verification failed/]
  ];
  for (const [label, change, error] of cases) {
    const candidate = mutate(roundTrip, change);
    assertSchemaValid(schemaIDs.roundTrip, candidate, `${label} mutation is structurally valid`);
    assert.throws(() => assertRoundTripRelations(candidate), error, label);
  }
});
