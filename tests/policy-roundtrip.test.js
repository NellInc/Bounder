import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TRUSTED_AUDIT_KEY,
  TRUSTED_FLEET_KEY,
  bootstrapPolicyRoundTrip,
  classifyAuthority,
  createLatestRequestGate,
  decodeBase64,
  evaluatePolicyRequest,
  fetchBoundedJSON,
  parseStrictJSON,
  sha256Hex,
  validatePolicy,
  validateProfile,
  validateRoundTripEvidence,
  verifyEnvelope
} from "../policy-roundtrip.js";

const root = new URL("../", import.meta.url);
const encoder = new TextEncoder();
const vectorBytes = new Uint8Array(await readFile(new URL("data/creedspace-bounder-golden-v1.json", root)));
const evidenceBytes = new Uint8Array(await readFile(new URL("data/creedspace-bounder-roundtrip-v1.json", root)));
const vectorFixture = parseStrictJSON(vectorBytes, "published vector fixture");
const evidenceFixture = parseStrictJSON(evidenceBytes, "round-trip evidence fixture");
const clone = (value) => structuredClone(value);
const base64 = (bytes) => Buffer.from(bytes).toString("base64");
const verifiedFixture = () => verifyEnvelope(clone(vectorFixture));
const evidenceOptions = async (overrides = {}) => {
  const verified = await verifiedFixture();
  return {
    policy: verified.policy,
    payloadBytes: verified.payloadBytes,
    vectorBytes,
    envelope: verified.envelope,
    ...overrides
  };
};
const responseAt = (url, body, { status = 200, headers = { "content-type": "application/json" } } = {}) => {
  const response = new Response(body, { status, headers });
  Object.defineProperty(response, "url", { value: url });
  return response;
};
const readerResponseAt = (url, reader) => ({
  ok: true,
  status: 200,
  url,
  headers: new Headers({ "content-type": "application/json" }),
  body: { getReader: () => reader }
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test("published vector verifies only as the pinned Fleet authority and remains held at expiry", async () => {
  const verified = await verifiedFixture();
  assert.equal(verified.envelope.public_key_id, TRUSTED_FLEET_KEY.id);
  assert.equal(vectorFixture.public_key, TRUSTED_FLEET_KEY.base64);
  assert.equal(verified.payloadSha256, "sha256:a60933967e4571a6edd83c6b5236078f8070a99cc3a27d90435db98d80dbb2c5");
  assert.equal(verified.policy.subject, "bounder-alpha");
  assert.equal(verified.policy.fleet_id, "relief-fleet");
  assert.equal(verified.policy.sequence, 42);
  assert.equal(classifyAuthority(verified.validity, verified.validity.notBefore - 1), "not-yet-valid");
  assert.equal(classifyAuthority(verified.validity, verified.validity.notBefore), "current");
  assert.equal(classifyAuthority(verified.validity, verified.validity.expiresAt - 1), "current");
  assert.equal(classifyAuthority(verified.validity, verified.validity.expiresAt), "expired");
});

test("a valid attacker self-signature cannot substitute its key or key ID", async () => {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const payload = decodeBase64(vectorFixture.envelope.payload, "fixture payload");
  const attacker = clone(vectorFixture);
  attacker.public_key = base64(new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", pair.publicKey)));
  attacker.envelope.signature = base64(new Uint8Array(await globalThis.crypto.subtle.sign("Ed25519", pair.privateKey, payload)));
  attacker.envelope.public_key_id = TRUSTED_FLEET_KEY.id;
  await assert.rejects(verifyEnvelope(attacker), /untrusted Fleet public key/);

  const wrongID = clone(vectorFixture);
  wrongID.envelope.public_key_id = "attacker-fleet-key";
  await assert.rejects(verifyEnvelope(wrongID), /untrusted Fleet signing key ID/);

  const tampered = clone(vectorFixture);
  const tamperedPayload = decodeBase64(tampered.envelope.payload, "fixture payload");
  tamperedPayload[0] ^= 1;
  tampered.envelope.payload = base64(tamperedPayload);
  await assert.rejects(verifyEnvelope(tampered), /signature verification failed/);
});

test("base64 decoding accepts only canonical padded encodings within the byte bound", () => {
  assert.deepEqual([...decodeBase64("Zg==", "sample", { maxBytes: 1 })], [102]);
  for (const value of ["Zg", "Zg==\n", "Zh==", "====", "Z===", "Zm9v"]) {
    assert.throws(() => decodeBase64(value, "sample", { maxBytes: 2 }), /canonical base64/);
  }
});

test("strict JSON rejects duplicates, rounded decimals, underflow, malformed UTF-8, and excessive nesting", () => {
  assert.deepEqual(parseStrictJSON(String.raw`{"a":1,"\u0062":2,"decimal":0.1,"scaled":25.0,"exponent":1e2}`), {
    a: 1, b: 2, decimal: 0.1, scaled: 25, exponent: 100
  });
  for (const source of [
    String.raw`{"a":1,"a":2}`,
    String.raw`{"a":1,"\u0061":2}`,
    String.raw`{"outer":{"x":1,"x":2}}`,
    String.raw`{"number":9007199254740993}`,
    String.raw`{"number":9007199254740990.5}`,
    String.raw`{"number":0.99999999999999999}`,
    String.raw`{"number":1e-324}`,
    String.raw`"\uD800"`,
    `${"[".repeat(66)}0${"]".repeat(66)}`
  ]) assert.throws(() => parseStrictJSON(source), /duplicate|unsafe|lossy|underflow|surrogate|nesting/);
  assert.throws(() => parseStrictJSON(Uint8Array.of(0xc3, 0x28)), /UTF-8/);
  assert.throws(() => parseStrictJSON(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d)), /strict JSON/);
});

test("v1 policy and profile validators match the published closed and bounded contracts", async (t) => {
  const { policy } = await verifiedFixture();
  assert.doesNotThrow(() => validatePolicy(policy));
  assert.doesNotThrow(() => validateProfile({ version: "creedspace-bounder-profile/v1", ttl_seconds: 30, constraints: policy.constraints }));

  const cases = [
    ["unknown policy field", (value) => { value.unexpected = true; }, /unsupported fields/],
    ["wrong issuer", (value) => { value.issuer = "example.invalid"; }, /issuer/],
    ["unsafe sequence", (value) => { value.sequence = Number.MAX_SAFE_INTEGER + 1; }, /sequence/],
    ["unknown constraint", (value) => { value.constraints.fail_open = true; }, /unsupported fields/],
    ["duplicate action", (value) => { value.constraints.allowed_actions.push("land"); }, /allowed actions/],
    ["offset timestamp", (value) => { value.not_before = "2026-07-13T13:00:00+01:00"; }, /strict RFC3339/],
    ["over-precise timestamp", (value) => { value.not_before = "2026-07-13T12:00:00.0000000001Z"; }, /strict RFC3339/],
    ["impossible calendar date", (value) => { value.expires_at = "2026-02-30T12:05:00Z"; }, /calendar time/],
    ["issuance after activation", (value) => { value.issued_at = "2026-07-13T12:00:01Z"; }, /out of order/],
    ["zero validity interval", (value) => { value.expires_at = value.not_before; }, /out of order/],
    ["duplicate source policy ID with altered provenance", (value) => {
      const duplicate = clone(value.source_policies[0]);
      duplicate.version = `${duplicate.version}-substitute`;
      value.source_policies.push(duplicate);
    }, /duplicate ID/],
    ["too many source policies", (value) => { value.source_policies = Array.from({ length: 65 }, (_, i) => ({ id: `source-${i}`, version: "1", level: "team" })); }, /exceeds/],
    ["long source version", (value) => { value.source_policies[0].version = "v".repeat(65); }, /version/],
    ["schema-excess altitude", (value) => { value.constraints.max_altitude_metres = 1_000_001; }, /altitude/],
    ["unallowlisted ROE action", (value) => { value.constraints.allowed_actions = ["loiter"]; }, /allowlisted/],
    ["unallowlisted evidence-only action", (value) => { value.constraints.allowed_actions = ["loiter"]; value.constraints.rules_of_engagement_actions = []; }, /allowlisted/]
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, () => {
      const candidate = clone(policy);
      mutate(candidate);
      assert.throws(() => validatePolicy(candidate), pattern);
    });
  }

  const openProfile = { version: "creedspace-bounder-profile/v1", ttl_seconds: 30, constraints: clone(policy.constraints), extra: true };
  assert.throws(() => validateProfile(openProfile), /unsupported fields/);
  assert.throws(
    () => validateProfile({ version: "creedspace-bounder-profile/v1", ttl_seconds: 29, constraints: policy.constraints }),
    /profile TTL/
  );
});

test("validity ordering and authority classification retain nanosecond precision", async () => {
  const { policy } = await verifiedFixture();
  const precise = clone(policy);
  precise.issued_at = "2026-07-13T12:00:00.000000001Z";
  precise.not_before = "2026-07-13T12:00:00.000000002Z";
  precise.expires_at = "2026-07-13T12:00:00.000000003Z";
  const validity = validatePolicy(precise);
  assert.equal(classifyAuthority(validity, precise.issued_at), "not-yet-valid");
  assert.equal(classifyAuthority(validity, precise.not_before), "current");
  assert.equal(classifyAuthority(validity, precise.expires_at), "expired");
  precise.expires_at = precise.not_before;
  assert.throws(() => validatePolicy(precise), /out of order/);
});

test("the deterministic policy evaluator enforces global boundaries and exact evidence freshness", async (t) => {
  const { policy } = await verifiedFixture();
  const evaluatedAt = evidenceFixture.receipt.evaluated_at;
  const cases = [
    ["Mettle tier", (r) => { r.evidence.mettle_tier = "silver"; }, "assurance_below_minimum"],
    ["evidence at exact freshness", (r) => { r.evidence.verified_at = "2026-07-13T12:00:00Z"; }, "allowed"],
    ["evidence beyond freshness", (r) => { r.evidence.verified_at = "2026-07-13T11:59:59.999999999Z"; }, "evidence_stale"],
    ["future evidence within tolerance", (r) => { r.evidence.verified_at = "2026-07-13T12:01:30Z"; }, "allowed"],
    ["future evidence beyond tolerance", (r) => { r.evidence.verified_at = "2026-07-13T12:01:30.000000001Z"; }, "evidence_stale"],
    ["GPS", (r) => { r.state.gps_fix = false; }, "gps_required"],
    ["exclusion zone", (r) => { r.state.inside_exclusion_zone = true; }, "inside_exclusion_zone"],
    ["battery exact minimum", (r) => { r.state.battery_percent = 25; }, "allowed"],
    ["battery below minimum", (r) => { r.state.battery_percent = 24.999; }, "battery_below_minimum"],
    ["altitude exact maximum", (r) => { r.state.altitude_metres = 120; }, "allowed"],
    ["altitude above maximum", (r) => { r.state.altitude_metres = 120.001; }, "altitude_above_maximum"],
    ["civilian exact minimum", (r) => { r.state.civilian_distance_metres = 150; }, "allowed"],
    ["civilian below minimum", (r) => { r.state.civilian_distance_metres = 149.999; }, "civilian_proximity"],
    ["friendly exact minimum", (r) => { r.state.friendly_distance_metres = 75; }, "allowed"],
    ["friendly below minimum", (r) => { r.state.friendly_distance_metres = 74.999; }, "friendly_force_proximity"],
    ["protected site", (r) => { r.state.inside_protected_site = true; }, "protected_site"],
    ["humanitarian corridor", (r) => { r.state.inside_humanitarian_corridor = true; }, "humanitarian_corridor_protected"],
    ["wind exact maximum", (r) => { r.state.wind_speed_metres_per_second = 12; }, "allowed"],
    ["wind above maximum", (r) => { r.state.wind_speed_metres_per_second = 12.001; }, "weather_outside_envelope"],
    ["visibility exact minimum", (r) => { r.state.visibility_metres = 500; }, "allowed"],
    ["visibility below minimum", (r) => { r.state.visibility_metres = 499.999; }, "weather_outside_envelope"]
  ];
  for (const [name, mutate, expectedCode] of cases) {
    await t.test(name, () => {
      const request = clone(evidenceFixture.request);
      mutate(request);
      assert.equal(evaluatePolicyRequest(policy, request, evaluatedAt).code, expectedCode);
    });
  }
});

test("rules-of-engagement safeguards and evidence-only actions are applied only to their signed scope", async (t) => {
  const { policy } = await verifiedFixture();
  const safe = clone(evidenceFixture.request);
  safe.action = "intercept";
  Object.assign(safe.state, {
    positive_identification: true,
    proportionality_satisfied: true,
    surrender_observed: false,
    incapacitated_observed: false,
    human_authorization_confirmed: true
  });
  const cases = [
    ["surrender", (r) => { r.state.surrender_observed = true; }, "surrender_protected"],
    ["incapacitation", (r) => { r.state.incapacitated_observed = true; }, "incapacitated_person_protected"],
    ["positive identification", (r) => { r.state.positive_identification = false; }, "positive_identification_required"],
    ["proportionality", (r) => { r.state.proportionality_satisfied = false; }, "proportionality_unconfirmed"],
    ["human authorization", (r) => { r.state.human_authorization_confirmed = false; }, "human_authorization_required"]
  ];
  for (const [name, mutate, code] of cases) {
    await t.test(name, () => {
      const request = clone(safe);
      mutate(request);
      assert.equal(evaluatePolicyRequest(policy, request, evidenceFixture.receipt.evaluated_at).code, code);
    });
  }
  assert.equal(evaluatePolicyRequest(policy, safe, evidenceFixture.receipt.evaluated_at).code, "evidence_only_no_actuation");
  assert.equal(evaluatePolicyRequest(policy, evidenceFixture.request, evidenceFixture.receipt.evaluated_at).code, "allowed");
});

test("published round-trip evidence verifies order-independently as a deep-frozen snapshot", async () => {
  const evidence = clone(evidenceFixture);
  evidence.receipt = Object.fromEntries(Object.entries(evidence.receipt).reverse());
  const recorded = await validateRoundTripEvidence(evidence, await evidenceOptions());
  assert.deepEqual(recorded, evidence);
  assert.notEqual(recorded, evidence);
  assert.equal(Object.isFrozen(recorded), true);
  assert.equal(Object.isFrozen(recorded.request.state), true);
  assert.equal(Object.isFrozen(recorded.fleet_audit.certificate), true);
  assert.throws(() => { recorded.receipt.code = "attacker"; }, TypeError);
  assert.equal(recorded.receipt.code, "allowed");
  assert.equal(recorded.fleet_audit.certificate.public_key_id, TRUSTED_AUDIT_KEY.id);
});

test("verified inputs are snapshotted before cryptographic awaits and returned policy bytes cannot corrupt the result", async () => {
  const gate = deferred();
  const started = deferred();
  const native = globalThis.crypto.subtle;
  const cryptoImpl = {
    subtle: {
      digest: (...args) => native.digest(...args),
      importKey: (...args) => native.importKey(...args),
      verify: async (...args) => {
        started.resolve();
        await gate.promise;
        return native.verify(...args);
      }
    }
  };
  const vector = clone(vectorFixture);
  const pending = verifyEnvelope(vector, { cryptoImpl });
  await started.promise;
  vector.envelope.public_key_id = "attacker-after-check";
  vector.envelope.payload = "e30=";
  gate.resolve();
  const verified = await pending;
  assert.equal(verified.envelope.public_key_id, TRUSTED_FLEET_KEY.id);
  assert.equal(verified.policy.subject, "bounder-alpha");
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.policy.constraints), true);
  assert.throws(() => { verified.policy.constraints.allowed_actions.push("attacker"); }, TypeError);
  const exposedBytes = verified.payloadBytes;
  exposedBytes[0] ^= 1;
  assert.notEqual(verified.payloadBytes[0], exposedBytes[0]);
});

test("round-trip validation snapshots evidence before a suspended audit verification", async () => {
  const options = await evidenceOptions();
  const gate = deferred();
  const started = deferred();
  const native = globalThis.crypto.subtle;
  options.cryptoImpl = {
    subtle: {
      digest: (...args) => native.digest(...args),
      importKey: (...args) => native.importKey(...args),
      verify: async (...args) => {
        started.resolve();
        await gate.promise;
        return native.verify(...args);
      }
    }
  };
  const evidence = clone(evidenceFixture);
  const pending = validateRoundTripEvidence(evidence, options);
  await started.promise;
  evidence.receipt.allowed = false;
  evidence.receipt.code = "attacker_after_check";
  evidence.request.state.gps_fix = false;
  gate.resolve();
  const recorded = await pending;
  assert.equal(recorded.receipt.allowed, true);
  assert.equal(recorded.request.state.gps_fix, true);
});

test("unsigned request substitutions cannot contradict a still-valid signed allow receipt", async (t) => {
  const options = await evidenceOptions();
  const cases = [
    ["Mettle", (value) => { value.request.evidence.mettle_tier = "bronze"; }],
    ["freshness", (value) => { value.request.evidence.verified_at = "2026-07-13T11:59:59.999999999Z"; }],
    ["GPS", (value) => { value.request.state.gps_fix = false; }],
    ["exclusion", (value) => { value.request.state.inside_exclusion_zone = true; }],
    ["battery", (value) => { value.request.state.battery_percent = 0; }],
    ["altitude", (value) => { value.request.state.altitude_metres = 10_000; }],
    ["civilian", (value) => { value.request.state.civilian_distance_metres = 0; }],
    ["friendly", (value) => { value.request.state.friendly_distance_metres = 0; }],
    ["protected", (value) => { value.request.state.inside_protected_site = true; }],
    ["humanitarian", (value) => { value.request.state.inside_humanitarian_corridor = true; }],
    ["wind", (value) => { value.request.state.wind_speed_metres_per_second = 100; }],
    ["visibility", (value) => { value.request.state.visibility_metres = 0; }]
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const evidence = clone(evidenceFixture);
      mutate(evidence);
      await assert.rejects(validateRoundTripEvidence(evidence, options), /contradicts the signed policy evaluation/);
    });
  }
});

test("round-trip evidence rejects malformed, schema-excess, or disconnected fields", async (t) => {
  const cases = [
    ["unsafe receipt sequence", (value) => { value.receipt.policy_sequence = Number.MAX_SAFE_INTEGER + 1; }, /invalid number|policy sequence/],
    ["request and receipt disagreement", (value) => { value.request.action = "land"; }, /request action/],
    ["unknown Mettle tier", (value) => { value.request.evidence.mettle_tier = "copper"; }, /Mettle tier/],
    ["schema-excess state", (value) => { value.request.state.visibility_metres = 10_000_001; }, /visibility/],
    ["malformed receipt code", (value) => { value.receipt.code = "ALLOWED!"; }, /code/],
    ["audit decision disagreement", (value) => { value.fleet_audit.decision = "block"; }, /decision semantics/],
    ["duplicate certificate key", (value) => {
      value.fleet_audit.certificate.payload = value.fleet_audit.certificate.payload.replace(
        '{"version":',
        '{"version":"bounder-creedspace-receipt/v1","version":'
      );
    }, /duplicate object key/],
    ["unknown evidence field", (value) => { value.ignored = true; }, /unsupported fields/]
  ];
  const options = await evidenceOptions();
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, async () => {
      const candidate = clone(evidenceFixture);
      mutate(candidate);
      await assert.rejects(validateRoundTripEvidence(candidate, options), pattern);
    });
  }
});

test("a valid attacker audit signature cannot substitute the pinned audit key", async () => {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const evidence = clone(evidenceFixture);
  const payload = encoder.encode(evidence.fleet_audit.certificate.payload);
  evidence.audit_public_key = base64(new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", pair.publicKey)));
  evidence.fleet_audit.certificate.signature = base64(
    new Uint8Array(await globalThis.crypto.subtle.sign("Ed25519", pair.privateKey, payload))
  );
  evidence.fleet_audit.certificate.public_key_id = TRUSTED_AUDIT_KEY.id;
  await assert.rejects(validateRoundTripEvidence(evidence, await evidenceOptions()), /untrusted round-trip audit public key/);

  const wrongID = clone(evidenceFixture);
  wrongID.fleet_audit.certificate.public_key_id = "attacker-audit-key";
  await assert.rejects(validateRoundTripEvidence(wrongID, await evidenceOptions()), /untrusted round-trip audit key ID/);

  const tampered = clone(evidenceFixture);
  const signature = decodeBase64(tampered.fleet_audit.certificate.signature, "fixture audit signature");
  signature[0] ^= 1;
  tampered.fleet_audit.certificate.signature = base64(signature);
  await assert.rejects(validateRoundTripEvidence(tampered, await evidenceOptions()), /audit receipt verification failed/);
});

test("round-trip matching binds policy objects, signed payload bytes, and exact source vector bytes", async () => {
  const differentlySerialized = new Uint8Array(vectorBytes.byteLength + 1);
  differentlySerialized.set(vectorBytes);
  differentlySerialized[differentlySerialized.length - 1] = 0x20;
  const options = await evidenceOptions({ vectorBytes: differentlySerialized });
  assert.equal(await validateRoundTripEvidence(clone(evidenceFixture), options), undefined);

  const arbitraryVector = encoder.encode('{"attacker":"not the verified vector"}');
  const substituted = clone(evidenceFixture);
  substituted.source_vector_sha256 = `sha256:${await sha256Hex(arbitraryVector)}`;
  await assert.rejects(
    validateRoundTripEvidence(substituted, await evidenceOptions({ vectorBytes: arbitraryVector })),
    /source vector/
  );

  const omitted = clone(evidenceFixture);
  omitted.source_vector_sha256 = `sha256:${"0".repeat(64)}`;
  assert.equal(
    await validateRoundTripEvidence(omitted, await evidenceOptions({ vectorBytes: undefined })),
    undefined,
    "an unchecked source-vector claim cannot produce matched evidence"
  );

  const disconnected = await evidenceOptions();
  disconnected.policy = clone(disconnected.policy);
  disconnected.policy.subject = "attacker-subject";
  await assert.rejects(validateRoundTripEvidence(clone(evidenceFixture), disconnected), /disconnected from its signed payload/);

  const unsigned = await evidenceOptions();
  unsigned.envelope = clone(unsigned.envelope);
  unsigned.envelope.signature = base64(new Uint8Array(64));
  await assert.rejects(
    validateRoundTripEvidence(clone(evidenceFixture), unsigned),
    /Fleet envelope signature verification failed/
  );
});

test("bounded JSON fetch enforces exact URL, origin, MIME, immutable output, and cumulative stream bounds", async () => {
  const url = "https://www.bounder.io/fixture";
  const chunks = [encoder.encode('{"ok":'), encoder.encode("true}")];
  let requestOptions;
  const fetched = await fetchBoundedJSON(url, {
    maxBytes: 32,
    timeoutMs: 100,
    description: "fixture",
    fetchImpl: async (requested, options) => {
      assert.equal(requested, url);
      requestOptions = options;
      return responseAt(url, new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        }
      }));
    }
  });
  assert.deepEqual(fetched.value, { ok: true });
  assert.equal(Object.isFrozen(fetched), true);
  assert.equal(Object.isFrozen(fetched.value), true);
  const exposed = fetched.bytes;
  exposed[0] ^= 1;
  assert.notEqual(fetched.bytes[0], exposed[0]);
  assert.equal(new TextDecoder().decode(fetched.bytes), '{"ok":true}');
  assert.equal(requestOptions.cache, "no-cache");
  assert.equal(requestOptions.credentials, "same-origin");
  assert.equal(requestOptions.redirect, "error");
  assert.equal(requestOptions.signal instanceof AbortSignal, true);

  let cancelled = false;
  await assert.rejects(
    fetchBoundedJSON("https://www.bounder.io/oversize", {
      maxBytes: 5,
      timeoutMs: 100,
      description: "oversize fixture",
      fetchImpl: async (requested) => responseAt(requested, new ReadableStream({
        pull(controller) {
          controller.enqueue(encoder.encode("123"));
        },
        cancel() {
          cancelled = true;
        }
      }))
    }),
    /exceeds the 5-byte limit/
  );
  assert.equal(cancelled, true);

  await assert.rejects(
    fetchBoundedJSON(url, { fetchImpl: async () => responseAt(url, "{}", { headers: { "content-type": "text/html" } }) }),
    /application\/json/
  );
  await assert.rejects(
    fetchBoundedJSON(url, { fetchImpl: async () => responseAt("https://attacker.example/fixture", "{}") }),
    /URL or origin/
  );
  await assert.rejects(
    fetchBoundedJSON(url, { expectedOrigin: "https://attacker.example", fetchImpl: async () => responseAt(url, "{}") }),
    /URL or origin/
  );
});

test("bounded JSON fetch avoids pre-aborted transport and rejects later abort promptly", async () => {
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  let preAbortedFetches = 0;
  await assert.rejects(
    fetchBoundedJSON("https://www.bounder.io/stalled", {
      signal: alreadyAborted.signal,
      fetchImpl: () => {
        preAbortedFetches += 1;
        return new Promise(() => {});
      }
    }),
    /JSON request was aborted/
  );
  assert.equal(preAbortedFetches, 0);

  const controller = new AbortController();
  const pending = fetchBoundedJSON("https://www.bounder.io/stalled", {
    timeoutMs: 1_000,
    description: "abort fixture",
    signal: controller.signal,
    fetchImpl: () => new Promise(() => {})
  });
  controller.abort();
  await Promise.race([
    assert.rejects(pending, /abort fixture was aborted/),
    new Promise((_, reject) => setTimeout(() => reject(new Error("external abort was not prompt")), 100))
  ]);
});

test("bounded JSON fetch times out even when the transport ignores abort", async () => {
  const url = "https://www.bounder.io/stalled";
  const cases = [
    ["transport ignores abort", () => new Promise(() => {})],
    ["reader cancellation throws synchronously", async () => readerResponseAt(url, {
      read: () => new Promise(() => {}),
      cancel() { throw new Error("synchronous cancellation failure"); },
      releaseLock() {}
    })],
    ["reader cancellation never settles", async () => readerResponseAt(url, {
      read: () => new Promise(() => {}),
      cancel: () => new Promise(() => {}),
      releaseLock() {}
    })]
  ];
  for (const [name, fetchImpl] of cases) {
    await Promise.race([
      assert.rejects(
        fetchBoundedJSON(url, { timeoutMs: 5, description: "stalled fixture", fetchImpl }),
        /stalled fixture timed out/,
        name
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} defeated the deadline`)), 100))
    ]);
  }

  const lateTransport = deferred();
  let bodyCancellations = 0;
  let readerAcquisitions = 0;
  const latePending = fetchBoundedJSON(url, {
    timeoutMs: 5,
    description: "late fixture",
    fetchImpl: () => lateTransport.promise
  });
  await assert.rejects(latePending, /late fixture timed out/);
  lateTransport.resolve({
    ok: true,
    status: 200,
    url,
    headers: new Headers({ "content-type": "application/json" }),
    body: {
      cancel() {
        bodyCancellations += 1;
        return new Promise(() => {});
      },
      getReader() {
        readerAcquisitions += 1;
        throw new Error("late response reader must not be acquired");
      }
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bodyCancellations, 1, "the late response body must be released without awaiting hostile cancellation");
  assert.equal(readerAcquisitions, 0);
});

test("bounded JSON fetch requires stream progress and caps chunk count independently of bytes", async () => {
  const url = "https://www.bounder.io/chunks";
  let emptyReads = 0;
  await Promise.race([
    assert.rejects(
      fetchBoundedJSON(url, {
        maxBytes: 1,
        timeoutMs: 100,
        description: "empty-chunk fixture",
        fetchImpl: async () => readerResponseAt(url, {
          async read() {
            emptyReads += 1;
            return { done: false, value: new Uint8Array() };
          },
          cancel: () => new Promise(() => {}),
          releaseLock() {}
        })
      }),
      /returned an empty response chunk/
    ),
    new Promise((_, reject) => setTimeout(() => reject(new Error("empty-chunk cancellation blocked rejection")), 100))
  ]);
  assert.equal(emptyReads, 1);

  const chunkedResponse = (spaceChunks) => {
    let reads = 0;
    return readerResponseAt(url, {
      async read() {
        reads += 1;
        if (reads <= spaceChunks) return { done: false, value: Uint8Array.of(0x20) };
        if (reads === spaceChunks + 1) return { done: false, value: Uint8Array.of(0x30) };
        return { done: true, value: undefined };
      },
      cancel() {},
      releaseLock() {}
    });
  };
  const boundary = await fetchBoundedJSON(url, {
    maxBytes: 4096,
    timeoutMs: 100,
    description: "chunk-boundary fixture",
    fetchImpl: async () => chunkedResponse(4095)
  });
  assert.equal(boundary.value, 0);
  await assert.rejects(
    fetchBoundedJSON(url, {
      maxBytes: 4097,
      timeoutMs: 100,
      description: "chunk-storm fixture",
      fetchImpl: async () => chunkedResponse(4096)
    }),
    /exceeds the 4096-chunk limit/
  );
});

test("latest-request gate aborts and invalidates every stale inspection", () => {
  const gate = createLatestRequestGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.signal.aborted, false);
  assert.equal(second.isCurrent(), true);
  gate.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);
});

const fakePolicyPanel = () => {
  const makeText = () => ({ textContent: "" });
  const statusLabel = makeText();
  const statusMessage = makeText();
  const status = {
    dataset: {},
    querySelector(selector) {
      return selector === "span" ? statusLabel : statusMessage;
    }
  };
  const fields = Object.fromEntries(
    ["issuer", "subject", "fleet", "sequence", "key", "policy", "digest", "receipt"].map((key) => [key, { dataset: { policyField: key }, textContent: "" }])
  );
  const steps = Object.fromEntries(
    ["envelope", "signature", "policy", "receipt"].map((key) => {
      const small = makeText();
      return [key, { dataset: { policyStep: key }, querySelector: () => small, small }];
    })
  );
  const sampleButton = { disabled: false, addEventListener() {} };
  const fileInput = { files: [], value: "", addEventListener() {} };
  const panel = {
    querySelector(selector) {
      if (selector === "[data-policy-action='sample']") return sampleButton;
      if (selector === "[data-policy-file]") return fileInput;
      if (selector === "[data-policy-status]") return status;
      return undefined;
    },
    querySelectorAll(selector) {
      if (selector === "[data-policy-field]") return Object.values(fields);
      if (selector === "[data-policy-step]") return Object.values(steps);
      return [];
    }
  };
  return {
    root: { querySelector: (selector) => selector === "[data-policy-roundtrip]" ? panel : undefined },
    status,
    fields,
    sampleButton
  };
};

test("a stale async inspection cannot overwrite newer authority or UI state", async () => {
  const ui = fakePolicyPanel();
  const firstValidation = deferred();
  const firstValidationStarted = deferred();
  let loadNumber = 0;
  const verified = (run) => ({
    envelope: { public_key_id: `key-${run}` },
    payloadBytes: encoder.encode(`payload-${run}`),
    policy: {
      issuer: `issuer-${run}`,
      subject: `subject-${run}`,
      fleet_id: `fleet-${run}`,
      sequence: run,
      policy_id: `policy-${run}`,
      constraints: { allowed_actions: ["loiter"] },
      source_policies: [{ id: "source", version: "1", level: "team" }]
    },
    payloadSha256: `digest-${run}`,
    validity: { notBeforeNanoseconds: 0n, expiresAtNanoseconds: 2_000_000n }
  });
  const fetchJSON = async (url) => {
    if (url.includes("golden")) {
      loadNumber += 1;
      return { bytes: encoder.encode(`{"run":${loadNumber}}`) };
    }
    return { value: {} };
  };
  const validateEvidence = async (_evidence, options) => {
    const run = options.policy.sequence;
    if (run === 1) {
      firstValidationStarted.resolve();
      await firstValidation.promise;
    }
    return { receipt: { code: `receipt-${run}`, device_id: `subject-${run}`, policy_sequence: run } };
  };
  const controller = bootstrapPolicyRoundTrip(ui.root, {
    fetchJSON,
    verifyVector: async (vector) => verified(vector.run),
    validateEvidence,
    now: () => 0
  });

  const first = controller.loadPublishedExample();
  await firstValidationStarted.promise;
  const second = controller.loadPublishedExample();
  await second;
  assert.equal(ui.fields.subject.textContent, "subject-2");
  assert.equal(ui.fields.receipt.textContent, "receipt-2 · subject-2 · policy sequence 2");
  assert.equal(ui.status.dataset.state, "verified");
  firstValidation.resolve();
  await first;
  assert.equal(ui.fields.subject.textContent, "subject-2");
  assert.equal(ui.fields.receipt.textContent, "receipt-2 · subject-2 · policy sequence 2");
  assert.equal(ui.sampleButton.disabled, false);
  controller.cancel();
});
