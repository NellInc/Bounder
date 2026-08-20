import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPilotEvidence, validatePilotEvidence } from "../staging-feed.js";

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_LIVE_AGE_MS = 15 * 60 * 1000;
const TEST_CRYPTO = globalThis.crypto ?? webcrypto;
const root = new URL("../", import.meta.url);
const pilot = JSON.parse(await readFile(new URL("data/bounder-staging-pilot.v1.json", root), "utf8"));
const pilotPayload = JSON.stringify(pilot);
const pilotBytes = new TextEncoder().encode(pilotPayload);
const pilotIntegrity = `sha256:${createHash("sha256").update(pilotPayload).digest("hex")}`;
const fallbackURL = "https://www.bounder.io/data/bounder-staging-pilot.v1.json";
const liveNow = () => Date.parse(pilot.generated_at) + 60_000;

const byteResponse = (bytes, { status = 200, contentType = "application/json", contentLength } = {}) => {
  const headers = {};
  if (contentType !== null) headers["content-type"] = contentType;
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  return new Response(bytes, { status, headers });
};
const response = (value, options) => byteResponse(new TextEncoder().encode(JSON.stringify(value)), options);
const clonePilot = () => structuredClone(pilot);
const mirrorReceipt = (evidence, index, changes) => {
  Object.assign(evidence.devices[index].receipt, changes);
  Object.assign(evidence.devices[index].fleet_audit.dimensions_triggered, changes);
  evidence.devices[index].fleet_audit.input_hash = createHash("sha256")
    .update(JSON.stringify(evidence.devices[index].fleet_audit.dimensions_triggered))
    .digest("hex");
};
const policyDeviceIndex = () => pilot.devices.findIndex(({ receipt }) => receipt.allowed);
const blockedDeviceIndex = () => pilot.devices.findIndex(({ receipt }) => !receipt.allowed && receipt.code !== "policy_unavailable");
const unavailableDeviceIndex = () => pilot.devices.findIndex(({ receipt }) => receipt.code === "policy_unavailable");

const buildEvidence = (count) => {
  const template = pilot.devices[policyDeviceIndex()];
  const evidence = clonePilot();
  evidence.devices = Array.from({ length: count }, (_, index) => {
    const device = structuredClone(template);
    device.device_id = `edge-${String(index + 1).padStart(3, "0")}`;
    device.receipt.device_id = device.device_id;
    device.fleet_audit.dimensions_triggered.device_id = device.device_id;
    device.fleet_audit.input_hash = createHash("sha256").update(JSON.stringify(device.receipt)).digest("hex");
    return device;
  });
  evidence.summary = {
    devices: count,
    allowed: count,
    blocked: 0,
    passed: count,
    platform_counts: {
      aerial: count,
      ground: 0,
      marine: 0,
      warehouse: 0,
      inspection: 0,
      fixed_machinery: 0
    }
  };
  return evidence;
};

const loadRecorded = (fetchImpl, options = {}) =>
  loadPilotEvidence({ fallbackURL, fetchImpl, cryptoImpl: TEST_CRYPTO, ...options });

const assertInvalid = async (cases) => {
  for (const { name, mutate, pattern } of cases) {
    const evidence = clonePilot();
    mutate(evidence);
    await assert.rejects(validatePilotEvidence(evidence, { cryptoImpl: TEST_CRYPTO }), pattern, name);
  }
};

test("the recorded pilot is exact, balanced, and binds every audit hash to the exact mirrored receipt bytes", async () => {
  const hashedPayloads = [];
  const cryptoImpl = {
    subtle: {
      digest: async (algorithm, bytes) => {
        hashedPayloads.push(new TextDecoder().decode(bytes));
        return TEST_CRYPTO.subtle.digest(algorithm, bytes);
      }
    }
  };
  assert.deepEqual(await validatePilotEvidence(pilot, { cryptoImpl }), pilot);
  assert.equal(hashedPayloads.length, pilot.devices.length);
  assert.equal(pilot.summary.devices, 100);
  const maximumEvaluatedAt = Math.max(...pilot.devices.map(({ receipt }) => Date.parse(receipt.evaluated_at)));
  assert.equal(Date.parse(pilot.generated_at), maximumEvaluatedAt, "snapshot time covers every receipt evaluation");
  assert.deepEqual(pilot.summary.platform_counts, {
    aerial: 17,
    fixed_machinery: 16,
    ground: 17,
    inspection: 16,
    marine: 17,
    warehouse: 17
  });
  for (const device of pilot.devices) {
    const auditPayload = JSON.stringify(device.fleet_audit.dimensions_triggered);
    assert.equal(auditPayload, JSON.stringify(device.receipt), device.device_id);
    assert.equal(hashedPayloads.shift(), auditPayload, device.device_id);
    const actualHash = createHash("sha256").update(auditPayload).digest("hex");
    assert.equal(device.fleet_audit.input_hash, actualHash, device.device_id);
  }
});

test("summary and provenance boundaries accept 1 and 500 devices and reject malformed contracts", async () => {
  await assert.doesNotReject(validatePilotEvidence(buildEvidence(1), { cryptoImpl: TEST_CRYPTO }));
  await assert.doesNotReject(validatePilotEvidence(buildEvidence(500), { cryptoImpl: TEST_CRYPTO }));
  await assert.rejects(
    validatePilotEvidence({ uncloneable: () => {} }, { cryptoImpl: TEST_CRYPTO }),
    /not cloneable JSON data/
  );

  const fractional = buildEvidence(1);
  fractional.generated_at = "2024-02-29T23:59:59.123456+05:30";
  mirrorReceipt(fractional, 0, { evaluated_at: "2024-02-29T18:29:59.1Z" });
  await assert.doesNotReject(validatePilotEvidence(fractional, { cryptoImpl: TEST_CRYPTO }));

  await assertInvalid([
    { name: "wrong evidence version", mutate: (value) => { value.version = "bounder-fleet-evidence/v2"; }, pattern: /metadata/ },
    { name: "wrong fleet identity", mutate: (value) => { value.fleet_id = "other-fleet"; }, pattern: /metadata/ },
    { name: "wrong policy profile", mutate: (value) => { value.policy_profile = "attacker-policy/v1"; }, pattern: /metadata/ },
    { name: "nonprimitive generated time", mutate: (value) => { value.generated_at = 0; }, pattern: /metadata/ },
    { name: "impossible generated date", mutate: (value) => { value.generated_at = "2023-02-29T12:00:00Z"; }, pattern: /metadata/ },
    { name: "out of range generated time", mutate: (value) => { value.generated_at = "2024-02-29T24:00:00Z"; }, pattern: /metadata/ },
    { name: "zero devices", mutate: (value) => { value.summary.devices = 0; }, pattern: /summary/ },
    { name: "more than 500 devices", mutate: (value) => { value.summary.devices = 501; }, pattern: /summary/ },
    { name: "fractional summary", mutate: (value) => { value.summary.allowed += 0.5; }, pattern: /summary/ },
    { name: "device count mismatch", mutate: (value) => { value.devices.pop(); }, pattern: /summary/ },
    { name: "extra platform", mutate: (value) => { value.summary.platform_counts.unknown = 0; }, pattern: /summary/ },
    { name: "wrong platform total", mutate: (value) => { value.summary.platform_counts.aerial += 1; }, pattern: /platform counts/ }
  ]);
});

test("device and policy semantic tables reject malformed or contradictory evidence", async () => {
  const allowedIndex = policyDeviceIndex();
  const blockedIndex = blockedDeviceIndex();
  const unavailableIndex = unavailableDeviceIndex();
  await assertInvalid([
    { name: "null device", mutate: (value) => { value.devices[0] = null; }, pattern: /Guardian evidence/ },
    { name: "empty device identity", mutate: (value) => { value.devices[0].device_id = ""; }, pattern: /Guardian evidence/ },
    { name: "overlong device identity", mutate: (value) => { value.devices[0].device_id = "x".repeat(256); }, pattern: /Guardian evidence/ },
    { name: "unknown platform", mutate: (value) => { value.devices[0].platform_class = "orbital"; }, pattern: /Guardian evidence/ },
    { name: "missing action", mutate: (value) => { delete value.devices[0].receipt.action; delete value.devices[0].fleet_audit.dimensions_triggered.action; }, pattern: /Guardian evidence/ },
    { name: "unnormalized action", mutate: (value) => { mirrorReceipt(value, 0, { action: "Return Home" }); }, pattern: /Guardian evidence/ },
    { name: "unnormalized code", mutate: (value) => { mirrorReceipt(value, blockedIndex, { code: "Unsafe-Code" }); value.devices[blockedIndex].expected_code = "Unsafe-Code"; }, pattern: /Guardian evidence/ },
    { name: "blank reason", mutate: (value) => { mirrorReceipt(value, 0, { reason: " " }); value.devices[0].fleet_audit.rationale = " "; }, pattern: /Guardian evidence/ },
    { name: "block labelled allowed", mutate: (value) => { mirrorReceipt(value, blockedIndex, { code: "allowed" }); value.devices[blockedIndex].expected_code = "allowed"; }, pattern: /Guardian evidence/ },
    { name: "allow labelled denied", mutate: (value) => { mirrorReceipt(value, allowedIndex, { code: "new_safe_denial" }); value.devices[allowedIndex].expected_code = "new_safe_denial"; }, pattern: /Guardian evidence/ },
    { name: "numeric evaluated time", mutate: (value) => { mirrorReceipt(value, 0, { evaluated_at: 0 }); }, pattern: /Guardian evidence/ },
    { name: "impossible evaluated date", mutate: (value) => { mirrorReceipt(value, 0, { evaluated_at: "2026-02-30T12:00:00Z" }); }, pattern: /Guardian evidence/ },
    { name: "audit mirror version drift", mutate: (value) => { value.devices[0].fleet_audit.dimensions_triggered.version = "evil/v9"; }, pattern: /audit evidence/ },
    { name: "bad policy digest", mutate: (value) => { mirrorReceipt(value, allowedIndex, { policy_id: "sha256:nope" }); }, pattern: /policy evidence/ },
    { name: "zero policy sequence", mutate: (value) => { mirrorReceipt(value, allowedIndex, { policy_sequence: 0 }); value.devices[allowedIndex].fleet_audit.policy_version = "creedspace-bounder-policy/v1#0"; }, pattern: /policy evidence/ },
    { name: "fractional policy sequence", mutate: (value) => { mirrorReceipt(value, allowedIndex, { policy_sequence: 1.5 }); value.devices[allowedIndex].fleet_audit.policy_version = "creedspace-bounder-policy/v1#1.5"; }, pattern: /policy evidence/ },
    { name: "unsafe policy sequence", mutate: (value) => { mirrorReceipt(value, allowedIndex, { policy_sequence: Number.MAX_SAFE_INTEGER + 1 }); value.devices[allowedIndex].fleet_audit.policy_version = `creedspace-bounder-policy/v1#${Number.MAX_SAFE_INTEGER + 1}`; }, pattern: /policy evidence/ },
    { name: "blank signing key", mutate: (value) => { mirrorReceipt(value, allowedIndex, { signing_key_id: "" }); }, pattern: /policy evidence/ },
    { name: "wrong policy audit version", mutate: (value) => { value.devices[allowedIndex].fleet_audit.policy_version = "creedspace-bounder-policy/v1#999"; }, pattern: /policy evidence/ },
    { name: "unavailable policy leaks policy id", mutate: (value) => { mirrorReceipt(value, unavailableIndex, { policy_id: `sha256:${"0".repeat(64)}` }); }, pattern: /unavailable-policy/ }
  ]);

  const extensible = clonePilot();
  mirrorReceipt(extensible, blockedIndex, { code: "new_safe_denial" });
  extensible.devices[blockedIndex].expected_code = "new_safe_denial";
  extensible.devices[0].update_error = "optional replay diagnostic";
  await assert.doesNotReject(validatePilotEvidence(extensible, { cryptoImpl: TEST_CRYPTO }));

  const maximumSequence = clonePilot();
  mirrorReceipt(maximumSequence, allowedIndex, { policy_sequence: Number.MAX_SAFE_INTEGER });
  maximumSequence.devices[allowedIndex].fleet_audit.policy_version = `creedspace-bounder-policy/v1#${Number.MAX_SAFE_INTEGER}`;
  await assert.doesNotReject(validatePilotEvidence(maximumSequence, { cryptoImpl: TEST_CRYPTO }));

  const maximumIdentity = clonePilot();
  const deviceID = "x".repeat(255);
  maximumIdentity.devices[0].device_id = deviceID;
  mirrorReceipt(maximumIdentity, 0, { device_id: deviceID });
  await assert.doesNotReject(validatePilotEvidence(maximumIdentity, { cryptoImpl: TEST_CRYPTO }));
});

test("receipt chronology, hash binding, and intercept authority fail closed", async () => {
  await assertInvalid([
    {
      name: "receipt evaluated after the evidence snapshot",
      mutate: (value) => { mirrorReceipt(value, 0, { evaluated_at: "2026-07-13T12:06:00.000000001+00:00" }); },
      pattern: /Guardian evidence/
    },
    {
      name: "well-shaped but stale audit hash",
      mutate: (value) => { mirrorReceipt(value, 0, { reason: "a correctly mirrored mutation" }); value.devices[0].fleet_audit.rationale = "a correctly mirrored mutation"; value.devices[0].fleet_audit.input_hash = "0".repeat(64); },
      pattern: /input hash/
    },
    {
      name: "allowed intercept",
      mutate: (value) => {
        const index = value.devices.findIndex(({ receipt }) => receipt.action === "intercept" && !receipt.allowed);
        mirrorReceipt(value, index, { allowed: true, code: "allowed" });
        value.devices[index].expected_code = "allowed";
        value.devices[index].passed = true;
        value.devices[index].fleet_audit.decision = "allow";
        value.summary.allowed += 1;
        value.summary.blocked -= 1;
      },
      pattern: /Guardian evidence/
    }
  ]);

  await assert.rejects(
    validatePilotEvidence(buildEvidence(1), { cryptoImpl: {} }),
    /audit hash verification is unavailable/
  );
});

test("async hash validation snapshots and freezes evidence before yielding", async () => {
  const mutable = buildEvidence(1);
  let releaseDigest;
  let announceDigest;
  const digestEntered = new Promise((resolve) => { announceDigest = resolve; });
  const digestGate = new Promise((resolve) => { releaseDigest = resolve; });
  const cryptoImpl = {
    subtle: {
      digest: async (algorithm, bytes) => {
        announceDigest();
        await digestGate;
        return TEST_CRYPTO.subtle.digest(algorithm, bytes);
      }
    }
  };

  const validation = validatePilotEvidence(mutable, { cryptoImpl });
  await digestEntered;
  mirrorReceipt(mutable, 0, { action: "intercept", allowed: true, code: "allowed" });
  releaseDigest();
  const validated = await validation;

  assert.notEqual(validated, mutable);
  assert.equal(validated.devices[0].receipt.action, "loiter");
  assert.equal(validated.devices[0].receipt.allowed, true);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.devices[0].receipt), true);
  assert.throws(() => { validated.devices[0].receipt.action = "intercept"; }, TypeError);
});

test("cross-record corruption and exact-shape drift are rejected without assuming global policy sequence ordering", async () => {
  await assertInvalid([
    {
      name: "duplicate device identity",
      mutate: (value) => {
        value.devices[1].device_id = value.devices[0].device_id;
        mirrorReceipt(value, 1, { device_id: value.devices[0].device_id });
      },
      pattern: /duplicated/
    },
    { name: "audit field drift", mutate: (value) => { value.devices[0].fleet_audit.dimensions_triggered.code = "tampered"; }, pattern: /audit evidence/ },
    { name: "pass flag drift", mutate: (value) => { value.devices[0].passed = false; }, pattern: /pass evidence/ },
    { name: "summary total drift", mutate: (value) => { value.summary.allowed += 1; value.summary.blocked -= 1; }, pattern: /summary totals/ },
    { name: "unknown evidence field", mutate: (value) => { value.untrusted = true; }, pattern: /metadata/ },
    { name: "unknown device field", mutate: (value) => { value.devices[0].untrusted = true; }, pattern: /Guardian evidence/ },
    {
      name: "unknown mirrored receipt field",
      mutate: (value) => {
        value.devices[0].receipt.untrusted = true;
        value.devices[0].fleet_audit.dimensions_triggered.untrusted = true;
        value.devices[0].fleet_audit.input_hash = createHash("sha256")
          .update(JSON.stringify(value.devices[0].fleet_audit.dimensions_triggered)).digest("hex");
      },
      pattern: /policy evidence/
    }
  ]);
});

test("trusted URL boundaries include IPv6 loopback and reject host lookalikes", async () => {
  for (const configuredURL of [
    "https://bounder.io/pilot.json",
    "https://staging.bounder.io/pilot.json",
    "https://creed.space/pilot.json",
    "https://staging.creed.space/pilot.json",
    "http://localhost/pilot.json",
    "http://127.0.0.1/pilot.json",
    "http://[::1]/pilot.json"
  ]) {
    const result = await loadPilotEvidence({
      configuredURL,
      configuredIntegrity: pilotIntegrity,
      fetchImpl: async () => response(pilot),
      cryptoImpl: TEST_CRYPTO,
      now: liveNow
    });
    assert.equal(result.source, "live", configuredURL);
  }

  for (const configuredURL of [
    "https://example.com/pilot.json",
    "https://evilbounder.io/pilot.json",
    "https://bounder.io.evil.test/pilot.json",
    "http://bounder.io/pilot.json",
    "https://user@bounder.io/pilot.json",
    "https://bounder.io/pilot.json#fragment",
    42,
    null
  ]) {
    let calls = 0;
    const result = await loadPilotEvidence({
      configuredURL,
      configuredIntegrity: pilotIntegrity,
      fallbackURL,
      cryptoImpl: TEST_CRYPTO,
      fetchImpl: async () => { calls += 1; return response(pilot); }
    });
    assert.equal(result.source, "recorded", String(configuredURL));
    assert.match(result.warning, /Live feed unavailable/, String(configuredURL));
    assert.equal(calls, 1, String(configuredURL));
  }

  const malformedPinOption = await loadPilotEvidence({
    configuredURL: "https://staging.creed.space/pilot.json",
    configuredIntegrity: 42,
    fallbackURL,
    cryptoImpl: TEST_CRYPTO,
    now: liveNow,
    fetchImpl: async () => response(pilot)
  });
  assert.equal(malformedPinOption.source, "recorded");
  assert.match(malformedPinOption.warning, /integrity pin is invalid/);

  for (const invalidFallback of [42, "", "https://example.com/pilot.json"]) {
    await assert.rejects(
      loadPilotEvidence({ fallbackURL: invalidFallback, fetchImpl: async () => response(pilot), cryptoImpl: TEST_CRYPTO }),
      /URL is invalid|Bounder or Creed Space host/,
      String(invalidFallback)
    );
  }
});

test("JSON media type matching is exact while allowing parameters", async () => {
  for (const contentType of ["application/json", "application/json; charset=utf-8", "Application/JSON ; Charset=UTF-8"]) {
    const result = await loadRecorded(async () => response(pilot, { contentType }));
    assert.equal(result.source, "recorded", contentType);
  }
  for (const contentType of ["application/jsonp", "text/application/json-ish", "application/problem+json", "text/html", null]) {
    await assert.rejects(
      loadRecorded(async () => response(pilot, { contentType })),
      /did not return JSON/,
      String(contentType)
    );
  }
});

test("live evidence freshness is clock-injected, boundary-exact, and does not invalidate the recorded fallback", async () => {
  const liveURL = "https://staging.creed.space/live.json";
  const generatedAt = Date.parse(pilot.generated_at);
  const oldestEvaluatedAt = Math.min(...pilot.devices.map(({ receipt }) => Date.parse(receipt.evaluated_at)));
  const fetchImpl = async () => response(pilot);

  const atBoundary = await loadPilotEvidence({
    configuredURL: liveURL,
    configuredIntegrity: pilotIntegrity,
    fallbackURL,
    fetchImpl,
    cryptoImpl: TEST_CRYPTO,
    now: () => oldestEvaluatedAt + MAX_LIVE_AGE_MS
  });
  assert.equal(atBoundary.source, "live");

  const stale = await loadPilotEvidence({
    configuredURL: liveURL,
    configuredIntegrity: pilotIntegrity,
    fallbackURL,
    fetchImpl,
    cryptoImpl: TEST_CRYPTO,
    now: () => oldestEvaluatedAt + MAX_LIVE_AGE_MS + 1
  });
  assert.equal(stale.source, "recorded");
  assert.match(stale.warning, /outside the live freshness window/);
  assert.equal(stale.evidence.generated_at, pilot.generated_at, "the recorded fixture is not freshness-gated");

  const future = await loadPilotEvidence({
    configuredURL: liveURL,
    configuredIntegrity: pilotIntegrity,
    fallbackURL,
    fetchImpl,
    cryptoImpl: TEST_CRYPTO,
    now: () => generatedAt - 1
  });
  assert.equal(future.source, "recorded");
  assert.match(future.warning, /outside the live freshness window/);

  for (const maxLiveAgeMs of [-1, 0.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1000"]) {
    await assert.rejects(
      loadPilotEvidence({
        configuredURL: liveURL,
        configuredIntegrity: pilotIntegrity,
        fallbackURL,
        fetchImpl,
        cryptoImpl: TEST_CRYPTO,
        now: liveNow,
        maxLiveAgeMs
      }),
      /freshness limit is invalid/,
      String(maxLiveAgeMs)
    );
  }
  for (const now of [() => Number.NaN, () => 0.5, () => { throw new Error("clock failed"); }, "now"]) {
    await assert.rejects(
      loadPilotEvidence({ configuredURL: liveURL, configuredIntegrity: pilotIntegrity, fetchImpl, cryptoImpl: TEST_CRYPTO, now }),
      /clock is invalid/
    );
  }
});

test("live freshness is sampled after verification and bounds every receipt", async () => {
  const liveURL = "https://staging.creed.space/live.json";
  const oldestEvaluatedAt = Math.min(...pilot.devices.map(({ receipt }) => Date.parse(receipt.evaluated_at)));
  let digestCalls = 0;
  let clockCalls = 0;
  const cryptoImpl = {
    subtle: {
      digest: async (algorithm, bytes) => {
        digestCalls += 1;
        return TEST_CRYPTO.subtle.digest(algorithm, bytes);
      }
    }
  };
  const current = await loadPilotEvidence({
    configuredURL: liveURL,
    configuredIntegrity: pilotIntegrity,
    fallbackURL,
    fetchImpl: async () => response(pilot),
    cryptoImpl,
    now: () => {
      clockCalls += 1;
      assert.equal(digestCalls, pilot.devices.length + 1, "the authority clock must be sampled after feed and audit digests");
      return oldestEvaluatedAt + MAX_LIVE_AGE_MS;
    }
  });
  assert.equal(current.source, "live");
  assert.equal(clockCalls, 1);

  const staleReceipt = clonePilot();
  const now = Date.parse(staleReceipt.generated_at) + 60_000;
  mirrorReceipt(staleReceipt, 0, { evaluated_at: new Date(now - MAX_LIVE_AGE_MS - 1).toISOString() });
  await assert.rejects(
    validatePilotEvidence(staleReceipt, { cryptoImpl: TEST_CRYPTO, now, maxAgeMs: MAX_LIVE_AGE_MS }),
    /receipt evidence is outside the live freshness window/
  );
});

test("integrity failures fall back with specific warnings and timeout boundaries fail deterministically", async () => {
  await assert.rejects(loadPilotEvidence({ fetchImpl: null }), /transport is unavailable/);
  const fallbackCases = [
    { name: "missing pin", pin: "", cryptoImpl: TEST_CRYPTO, live: () => response(pilot), pattern: /requires a SHA-256 integrity pin/, calls: 1 },
    { name: "malformed pin", pin: "sha256:nope", cryptoImpl: TEST_CRYPTO, live: () => response(pilot), pattern: /integrity pin is invalid/, calls: 1 },
    { name: "digest mismatch", pin: `sha256:${"0".repeat(64)}`, cryptoImpl: TEST_CRYPTO, live: () => response(pilot), pattern: /integrity check failed/, calls: 2 },
    { name: "HTTP failure", pin: pilotIntegrity, cryptoImpl: TEST_CRYPTO, live: () => response({ error: "offline" }, { status: 503 }), pattern: /request failed with 503/, calls: 2 }
  ];
  for (const item of fallbackCases) {
    let calls = 0;
    const result = await loadPilotEvidence({
      configuredURL: "https://staging.creed.space/live.json",
      configuredIntegrity: item.pin,
      cryptoImpl: item.cryptoImpl,
      fallbackURL,
      now: liveNow,
      fetchImpl: async (url) => {
        calls += 1;
        return String(url).includes("/live.json") ? item.live() : response(pilot);
      }
    });
    assert.equal(result.source, "recorded", item.name);
    assert.match(result.warning, item.pattern, item.name);
    assert.equal(calls, item.calls, item.name);
  }

  await assert.rejects(
    loadPilotEvidence({
      configuredURL: "https://staging.creed.space/live.json",
      configuredIntegrity: pilotIntegrity,
      cryptoImpl: {},
      fallbackURL,
      now: liveNow,
      fetchImpl: async () => response(pilot)
    }),
    /audit hash verification is unavailable/
  );

  let timeoutCalls = 0;
  const timedOut = await loadPilotEvidence({
    configuredURL: "https://staging.creed.space/live.json",
    configuredIntegrity: pilotIntegrity,
    fallbackURL,
    timeoutMs: 10,
    cryptoImpl: TEST_CRYPTO,
    now: liveNow,
    fetchImpl: async (url, { signal }) => {
      timeoutCalls += 1;
      if (!String(url).includes("/live.json")) return response(pilot);
      return new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
  });
  assert.equal(timedOut.source, "recorded");
  assert.match(timedOut.warning, /timed out/i);
  assert.equal(timeoutCalls, 2);

  for (const timeoutMs of [0, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMEOUT_MS + 1, "10"]) {
    await assert.rejects(
      loadRecorded(async () => response(pilot), { timeoutMs }),
      /timeout is invalid/,
      String(timeoutMs)
    );
  }
  await assert.doesNotReject(loadRecorded(async () => response(pilot), { timeoutMs: MAX_TIMEOUT_MS }));

  let completedSignal;
  await loadRecorded(async (url, { signal }) => {
    completedSignal = signal;
    return response(buildEvidence(1));
  }, { timeoutMs: 50 });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(completedSignal.aborted, false, "a cleared success timer must not abort later");
});

test("the deadline wins when fetch or body readers ignore abort", { timeout: 3000 }, async () => {
  const liveURL = "https://staging.creed.space/live.json";
  const neverFetch = () => new Promise(() => {});
  const neverReader = (cancel = () => new Promise(() => {})) => ({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : null },
    body: {
      getReader: () => ({
        read: () => new Promise(() => {}),
        cancel,
        releaseLock: () => {}
      })
    }
  });

  for (const item of [
    { name: "fetch ignores abort", stalled: neverFetch },
    { name: "reader ignores abort", stalled: async () => neverReader() },
    { name: "reader rejects cancellation", stalled: async () => neverReader(async () => { throw new Error("cancel rejected"); }) }
  ]) {
    let calls = 0;
    const fetchImpl = async (url, options) => {
      calls += 1;
      if (String(url).includes("/live.json")) return item.stalled(url, options);
      return response(pilot);
    };
    const started = Date.now();
    const fallback = await loadPilotEvidence({
      configuredURL: liveURL,
      configuredIntegrity: pilotIntegrity,
      fallbackURL,
      fetchImpl,
      cryptoImpl: TEST_CRYPTO,
      now: liveNow,
      timeoutMs: 10
    });
    assert.equal(fallback.source, "recorded", item.name);
    assert.match(fallback.warning, /timed out/, item.name);
    assert.equal(calls, 2, item.name);
    assert.ok(Date.now() - started < 1000, `${item.name} did not return promptly`);

    await assert.rejects(
      loadRecorded(item.stalled, { timeoutMs: 10 }),
      /timed out/,
      `${item.name} recorded path`
    );
  }

  let rejectLate;
  let calls = 0;
  const lateRejectingFetch = async (url) => {
    calls += 1;
    if (!String(url).includes("/live.json")) return response(pilot);
    return new Promise((resolve, reject) => { rejectLate = reject; });
  };
  const fallback = await loadPilotEvidence({
    configuredURL: liveURL,
    configuredIntegrity: pilotIntegrity,
    fallbackURL,
    fetchImpl: lateRejectingFetch,
    cryptoImpl: TEST_CRYPTO,
    now: liveNow,
    timeoutMs: 10
  });
  assert.equal(fallback.source, "recorded");
  assert.equal(calls, 2);
  rejectLate(new Error("late transport rejection"));
  await new Promise((resolve) => setImmediate(resolve));

  let resolveLateResponse;
  let lateReads = 0;
  let lateCancellations = 0;
  let lateReleases = 0;
  const lateResolvingFetch = async (url) => {
    if (!String(url).includes("/live.json")) return response(pilot);
    return new Promise((resolve) => { resolveLateResponse = resolve; });
  };
  const lateFallback = await loadPilotEvidence({
    configuredURL: liveURL,
    configuredIntegrity: pilotIntegrity,
    fallbackURL,
    fetchImpl: lateResolvingFetch,
    cryptoImpl: TEST_CRYPTO,
    now: liveNow,
    timeoutMs: 10
  });
  assert.equal(lateFallback.source, "recorded");
  resolveLateResponse({
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : null },
    body: {
      getReader: () => ({
        read() {
          lateReads += 1;
          return new Promise(() => {});
        },
        cancel() {
          lateCancellations += 1;
          return new Promise(() => {});
        },
        releaseLock() {
          lateReleases += 1;
        }
      })
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateReads, 0, "an already-aborted signal must prevent the first read");
  assert.equal(lateCancellations, 1, "the late body must be released without awaiting hostile cancellation");
  assert.equal(lateReleases, 1);
});

test("strict UTF-8, JSON syntax, and evidence validation fail as distinct layers", async () => {
  const duplicateMember = new TextEncoder().encode(
    pilotPayload.replace(/"generated_at":"[^"]+"/, (field) => `"generated_at":"1900-01-01T00:00:00Z",${field}`)
  );
  const cases = [
    { name: "invalid UTF-8", bytes: Uint8Array.from([0xc3, 0x28]), pattern: /not strict UTF-8/ },
    { name: "invalid JSON", bytes: new TextEncoder().encode("{"), pattern: /not valid JSON/ },
    { name: "duplicate JSON member", bytes: duplicateMember, pattern: /duplicate JSON fields/ },
    { name: "invalid evidence", bytes: new TextEncoder().encode("{}"), pattern: /metadata is invalid/ }
  ];
  for (const item of cases) {
    await assert.rejects(
      loadRecorded(async () => byteResponse(item.bytes)),
      item.pattern,
      item.name
    );
  }
});

test("the streamed byte limit accepts exactly two MiB and rejects declared oversize before body access", async () => {
  const exact = new Uint8Array(MAX_FEED_BYTES);
  exact.fill(0x20);
  exact.set(pilotBytes);
  const exactResult = await loadRecorded(async () => byteResponse(exact, { contentLength: MAX_FEED_BYTES }));
  assert.equal(exactResult.source, "recorded");

  let bodyAccesses = 0;
  const declaredOversize = {
    ok: true,
    status: 200,
    headers: {
      get: (name) => name === "content-type" ? "application/json" : name === "content-length" ? String(MAX_FEED_BYTES + 1) : null
    },
    get body() {
      bodyAccesses += 1;
      throw new Error("body must not be touched");
    }
  };
  await assert.rejects(
    loadRecorded(async () => declaredOversize),
    /exceeds the size limit/
  );
  assert.equal(bodyAccesses, 0);
});

test("Content-Length must be a canonical bounded nonnegative safe integer", async () => {
  for (const contentLength of ["0", String(pilotBytes.byteLength), String(MAX_FEED_BYTES)]) {
    const result = await loadRecorded(async () => byteResponse(pilotBytes, { contentLength }));
    assert.equal(result.source, "recorded", contentLength);
  }

  const invalidLengths = ["", "-1", "+1", "01", "1.0", "1e3", "Infinity", "NaN", String(Number.MAX_SAFE_INTEGER + 1)];
  for (const contentLength of invalidLengths) {
    let bodyAccesses = 0;
    const body = response(pilot).body;
    const malformed = {
      ok: true,
      status: 200,
      headers: {
        get: (name) => name === "content-type" ? "application/json" : name === "content-length" ? contentLength : null
      },
      get body() {
        bodyAccesses += 1;
        return body;
      }
    };
    await assert.rejects(loadRecorded(async () => malformed), /content length is invalid/, contentLength);
    assert.equal(bodyAccesses, 0, contentLength);
  }
});

test("a deceptive streamed length is cancelled on the first cumulative byte over the limit", async () => {
  let pulls = 0;
  let cancelReason = "";
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls <= 2) controller.enqueue(new Uint8Array(1024 * 1024));
      else if (pulls === 3) controller.enqueue(new Uint8Array(1));
      else controller.close();
    },
    cancel(reason) {
      cancelReason = String(reason);
    }
  }, { highWaterMark: 0 });
  await assert.rejects(
    loadRecorded(async () => new Response(stream, {
      headers: { "content-type": "application/json", "content-length": "1" }
    })),
    /exceeds the size limit/
  );
  assert.equal(pulls, 3);
  assert.match(cancelReason, /exceeds the size limit/);

  const brokenCancelResponse = {
    ok: true,
    status: 200,
    headers: { get: (name) => name === "content-type" ? "application/json" : null },
    body: {
      getReader: () => ({
        read: async () => ({ done: false, value: new Uint8Array(MAX_FEED_BYTES + 1) }),
        cancel: async () => { throw new Error("cancel failed"); },
        releaseLock: () => {}
      })
    }
  };
  await assert.rejects(
    loadRecorded(async () => brokenCancelResponse),
    /exceeds the size limit/
  );
});

test("pathological chunk counts and empty chunks reject promptly even when cancellation never settles", async () => {
  for (const item of [
    { name: "too many chunks", chunk: new Uint8Array([0x20]), maximumReads: 4097, pattern: /too many chunks/ },
    { name: "empty chunk", chunk: new Uint8Array(), maximumReads: 1, pattern: /invalid byte stream/ }
  ]) {
    let reads = 0;
    let cancelReason = "";
    let released = false;
    const boundedResponse = {
      ok: true,
      status: 200,
      headers: { get: (name) => name === "content-type" ? "application/json" : null },
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            return { done: false, value: item.chunk };
          },
          cancel: (reason) => {
            cancelReason = String(reason);
            return new Promise(() => {});
          },
          releaseLock: () => { released = true; }
        })
      }
    };
    await assert.rejects(loadRecorded(async () => boundedResponse), item.pattern, item.name);
    assert.equal(reads, item.maximumReads, item.name);
    assert.match(cancelReason, item.pattern, item.name);
    assert.equal(released, true, item.name);
  }
});
