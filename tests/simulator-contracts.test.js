import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FLEET_AUDIT_AUTHENTICATION,
  MAX_FLEET_EVIDENCE_BYTES,
  MAX_RECEIPT_BUNDLE_BYTES,
  MAX_SIMULATOR_STREAM_CHUNKS,
  RECORDED_GUARDIAN_ALIASES,
  RESILIENCE_CONTRACTS,
  SIMULATOR_RULES,
  SIMULATOR_SCENARIOS,
  createResilienceStreamSequence,
  fetchSimulatorJSON,
  readBoundedJSONResponse,
  resolveAffectedGuardianIDs,
  resolveFleetGuardianAliases,
  resolveResilienceStreamURL,
  validateFleetEvidence,
  validateReceiptBundle,
  validateResilienceStreamEvent
} from "../simulator-contracts.js";

const receiptFixture = JSON.parse(await readFile(new URL("../data/bounder-receipts.v1.json", import.meta.url), "utf8"));
const fleetFixture = JSON.parse(await readFile(new URL("../data/bounder-fleet-evidence.v1.json", import.meta.url), "utf8"));
const pilotFixture = JSON.parse(await readFile(new URL("../data/bounder-staging-pilot.v1.json", import.meta.url), "utf8"));
const receiptSchema = JSON.parse(await readFile(new URL("../schemas/bounder.receipt.v1.schema.json", import.meta.url), "utf8"));
const clone = (value) => structuredClone(value);

const mutateReceipt = (mutator) => {
  const value = clone(receiptFixture);
  mutator(value, value.receipts.find(({ scenario }) => scenario === "safe"));
  return value;
};

const mutateFleet = (mutator) => {
  const value = clone(fleetFixture);
  mutator(value, value.devices[0]);
  return value;
};

const jsonResponse = (body, headers = {}) => new Response(body, {
  status: 200,
  headers: { "content-type": "application/json", ...headers }
});

test("canonical simulator fixtures validate into immutable, exact runtime contracts", async () => {
  const receipts = clone(receiptFixture);
  const byScenario = validateReceiptBundle(receipts);
  assert.equal(byScenario.size, 15);
  assert.deepEqual([...byScenario.keys()], SIMULATOR_SCENARIOS);
  assert.deepEqual([...byScenario.values()], receipts.receipts);
  assert.deepEqual([...byScenario.entries()], [...byScenario]);
  assert.equal(byScenario.has("safe"), true);
  assert.equal(byScenario.has("unknown"), false);
  assert.equal(byScenario.get("safe").code, "allowed");
  assert.equal(byScenario.set, undefined, "the validated lookup exposes no mutation methods");
  assert.ok(Object.isFrozen(receipts));
  assert.ok(Object.isFrozen(receipts.receipts[0].state));

  const fleet = clone(fleetFixture);
  const validatedFleet = await validateFleetEvidence(fleet);
  assert.equal(validatedFleet.summary.devices, 16);
  assert.ok(Object.isFrozen(validatedFleet));
  assert.ok(Object.isFrozen(validatedFleet.devices[0].fleet_audit.certificate));

  for (const exported of [SIMULATOR_SCENARIOS, SIMULATOR_RULES, RESILIENCE_CONTRACTS, RECORDED_GUARDIAN_ALIASES, FLEET_AUDIT_AUTHENTICATION]) {
    assert.ok(Object.isFrozen(exported));
  }
  assert.equal(FLEET_AUDIT_AUTHENTICATION.authenticated, false);
  assert.match(FLEET_AUDIT_AUTHENTICATION.label, /public key unavailable/i);
});

test("receipt contracts reject malformed shape, provenance, decision and state mutations", () => {
  const cases = [
    ["extra bundle field", (value) => { value.ignored = true; }, /fields/],
    ["missing bundle field", (value) => { delete value.engine; }, /fields/],
    ["unknown scenario", (_value, receipt) => { receipt.scenario = "unknown"; }, /scenario or version/],
    ["duplicate scenario", (value) => { value.receipts[1] = clone(value.receipts[0]); }, /duplicated/],
    ["noncanonical scenario order", (value) => { [value.receipts[0], value.receipts[1]] = [value.receipts[1], value.receipts[0]]; }, /scenario order/],
    ["sparse scenario array", (value) => { delete value.receipts[1]; }, /scenarios is invalid/],
    ["extra scenario index", (value) => { value.receipts[-1] = clone(value.receipts[0]); }, /scenarios is invalid/],
    ["scenario index accessor", (value) => {
      const original = value.receipts[0];
      Object.defineProperty(value.receipts, "0", { enumerable: true, configurable: true, get: () => original });
    }, /scenarios is invalid/],
    ["wrong decision code", (_value, receipt) => { receipt.code = "civilian_proximity"; }, /decision contract/],
    ["unverified signature record", (_value, receipt) => { receipt.signature_verified = false; }, /provenance/],
    ["foreign decision source", (_value, receipt) => { receipt.decision_source = "other/interlock"; }, /provenance/],
    ["malformed policy digest", (_value, receipt) => { receipt.policy_hash = `sha256:${"A".repeat(64)}`; }, /policy hash/],
    ["unsafe sequence", (_value, receipt) => { receipt.sequence = Number.MAX_SAFE_INTEGER + 1; }, /sequence/],
    ["nonfinite state", (_value, receipt) => { receipt.state.altitude_metres = Number.POSITIVE_INFINITY; }, /state altitude/],
    ["battery over boundary", (_value, receipt) => { receipt.state.battery_percent = 101; }, /battery/],
    ["whitespace-only reason", (_value, receipt) => { receipt.reason = " \t "; }, /reason/],
    ["whitespace-only subject", (value) => { for (const receipt of value.receipts) receipt.subject = " \n "; }, /subject/],
    ["whitespace-only evidence ID", (value) => { for (const receipt of value.receipts) receipt.evidence.session_id = "   "; }, /session_id/],
    ["whitespace-only adapter output", (_value, receipt) => { receipt.adapter.output = "   "; }, /output/],
    ["adapter grants denied authority", (value) => { value.receipts[1].adapter.command_authorized = true; }, /adapter authority/],
    ["adapter claims a sent command", (_value, receipt) => { receipt.adapter.command_sent = true; }, /adapter authority/],
    ["unrelated state corruption", (value) => { value.receipts[1].state.battery_percent -= 1; }, /state is inconsistent/],
    ["unsupported nested field", (_value, receipt) => { receipt.evidence.note = "ignored"; }, /fields/]
  ];
  for (const [name, mutator, pattern] of cases) {
    assert.throws(() => validateReceiptBundle(mutateReceipt(mutator)), pattern, name);
  }

  const inherited = Object.assign(Object.create({ version: "shadow" }), clone(receiptFixture));
  assert.throws(() => validateReceiptBundle(inherited), /receipt bundle is invalid/, "non-JSON object prototypes fail closed");
});

test("safe receipt state is an exact baseline even when every other scenario is coherently changed", () => {
  const triggerScenario = {
    altitude_metres: "altitude",
    civilian_distance_metres: "civilian",
    friendly_distance_metres: "friendly",
    inside_humanitarian_corridor: "humanitarian",
    inside_protected_site: "protected",
    wind_speed_metres_per_second: "weather"
  };
  const safeState = receiptFixture.receipts.find(({ scenario }) => scenario === "safe").state;
  for (const [field, original] of Object.entries(safeState)) {
    const candidate = clone(receiptFixture);
    const replacement = typeof original === "boolean" ? !original : original + 1;
    for (const receipt of candidate.receipts) {
      if (receipt.scenario !== triggerScenario[field]) receipt.state[field] = replacement;
    }
    assert.throws(
      () => validateReceiptBundle(candidate),
      /safe baseline state/,
      `${field} cannot redefine the safe baseline coherently across the bundle`
    );
  }
});

test("receipt dates and evidence ages are strict, UTC, ordered, and exact at their boundaries", () => {
  const cases = [
    ["impossible date", (value) => { value.generated_at = "2026-02-30T12:00:00Z"; }],
    ["offset date", (value) => { value.generated_at = "2026-07-13T13:00:00+01:00"; }],
    ["lowercase UTC", (value) => { value.generated_at = "2026-07-13T12:00:00z"; }],
    ["future evaluation", (value, receipt) => { receipt.evaluated_at = "2026-07-13T12:00:01Z"; }],
    ["one-nanosecond future evaluation", (value, receipt) => { receipt.evaluated_at = "2026-07-13T12:00:00.000000001Z"; }],
    ["verification after evaluation", (_value, receipt) => { receipt.evidence.verified_at = "2026-07-13T12:00:01Z"; }],
    ["one-nanosecond future verification", (_value, receipt) => { receipt.evidence.verified_at = "2026-07-13T12:00:00.000000001Z"; }],
    ["age mismatch", (_value, receipt) => { receipt.evidence.age_seconds = 29; }],
    ["one-nanosecond age mismatch", (_value, receipt) => { receipt.evidence.verified_at = "2026-07-13T11:59:30.000000001Z"; }],
    ["negative age", (_value, receipt) => { receipt.evidence.age_seconds = -1; }]
  ];
  for (const [name, mutator] of cases) {
    assert.throws(() => validateReceiptBundle(mutateReceipt(mutator)), /(time|date|age)/i, name);
  }

  const fractional = clone(receiptFixture);
  fractional.generated_at = "2026-07-13T12:00:00.123456789Z";
  for (const receipt of fractional.receipts) {
    receipt.evaluated_at = "2026-07-13T12:00:00.123456789Z";
    receipt.evidence.verified_at = "2026-07-13T11:59:30.123456789Z";
  }
  assert.equal(validateReceiptBundle(fractional).size, 15, "nanosecond-form UTC remains accepted without normalization");
});

test("receipt numeric caps stay aligned with the published schema and reject every excess", () => {
  const stateProperties = receiptSchema.properties.state.properties;
  const maximums = Object.fromEntries(Object.entries(stateProperties)
    .filter(([, definition]) => Object.hasOwn(definition, "maximum"))
    .map(([field, definition]) => [field, definition.maximum]));
  assert.deepEqual(maximums, {
    battery_percent: 100,
    altitude_metres: 1_000_000,
    civilian_distance_metres: 10_000_000,
    friendly_distance_metres: 10_000_000,
    wind_speed_metres_per_second: 1_000,
    visibility_metres: 10_000_000
  });

  for (const [field, maximum] of Object.entries(maximums)) {
    const excessive = clone(receiptFixture);
    excessive.receipts.find(({ scenario }) => scenario === "safe").state[field] = maximum + 1;
    assert.throws(
      () => validateReceiptBundle(excessive),
      new RegExp(`state ${field} is invalid`),
      `${field} rejects the first value above its schema maximum`
    );
  }

  const ageMaximum = receiptSchema.properties.evidence.properties.age_seconds.maximum;
  const exactAge = clone(receiptFixture);
  for (const receipt of exactAge.receipts) {
    receipt.evidence.age_seconds = ageMaximum;
    receipt.evidence.verified_at = "2026-07-06T12:00:00Z";
  }
  assert.equal(validateReceiptBundle(exactAge).size, SIMULATOR_SCENARIOS.length, "evidence age accepts its schema maximum");
  const excessiveAge = clone(receiptFixture);
  excessiveAge.receipts[0].evidence.age_seconds = ageMaximum + 1;
  assert.throws(() => validateReceiptBundle(excessiveAge), /evidence age is invalid/, "evidence age rejects its first value above the schema maximum");
});

test("Fleet devices enforce the canonical identity, scenario and replay-update contracts", async () => {
  const cases = [
    ["missing replay update", (value) => { delete value.devices[8].update_error; }, /update error/],
    ["foreign replay update", (_value, device) => { device.update_error = "sequence rejected"; }, /update error/],
    ["altered replay update", (value) => { value.devices[8].update_error = "accepted"; }, /update error/],
    ["swapped scenario", (_value, device) => { device.scenario = "weather envelope"; }, /device contract/],
    ["swapped expected code", (_value, device) => { device.expected_code = "weather_outside_envelope"; device.receipt.code = device.expected_code; }, /device contract/],
    ["duplicate device", (value) => { value.devices[1].device_id = "bounder-alpha"; value.devices[1].receipt.device_id = "bounder-alpha"; }, /(contract|duplicated)/],
    ["false pass", (_value, device) => { device.passed = false; }, /device evidence/],
    ["incorrect summary", (value) => { value.summary.blocked -= 1; }, /totals/],
    ["unsigned stored audit", (value) => { value.lab.signed_audits -= 1; }, /totals/],
    ["Fleet device index accessor", (value) => {
      const original = value.devices[0];
      Object.defineProperty(value.devices, "0", { enumerable: true, configurable: true, get: () => original });
    }, /fleet evidence devices is invalid/],
    ["extra device field", (_value, device) => { device.note = "ignored"; }, /fields/]
  ];
  for (const [name, mutator, pattern] of cases) {
    await assert.rejects(validateFleetEvidence(mutateFleet(mutator)), pattern, name);
  }
});

test("Fleet certificate mirrors, hashes and signature encodings fail closed without claiming authentication", async () => {
  const cases = [
    ["wrong payload mirror", (_value, device) => {
      device.fleet_audit.certificate.payload = JSON.stringify({ ...device.receipt, reason: "changed" });
    }, /certificate is inconsistent/],
    ["noncanonical receipt serialization", (_value, device) => {
      device.fleet_audit.certificate.payload = JSON.stringify(device.receipt, null, 2);
    }, /serialization/],
    ["wrong payload digest", (_value, device) => { device.fleet_audit.input_hash = "0".repeat(64); }, /digest/],
    ["wrong signature length", (_value, device) => { device.fleet_audit.certificate.signature = "AA=="; }, /signature/],
    ["wrong signature padding", (_value, device) => { device.fleet_audit.certificate.signature = "A".repeat(88); }, /signature/],
    ["noncanonical signature bits", (_value, device) => {
      device.fleet_audit.certificate.signature = `${device.fleet_audit.certificate.signature.slice(0, -4)}AB==`;
    }, /signature/],
    ["unknown audit key", (_value, device) => { device.fleet_audit.certificate.public_key_id = "unknown"; }, /key/]
  ];
  for (const [name, mutator, pattern] of cases) {
    await assert.rejects(validateFleetEvidence(mutateFleet(mutator)), pattern, name);
  }
  assert.equal(FLEET_AUDIT_AUTHENTICATION.authenticated, false);

  const duplicatePayload = mutateFleet((_value, device) => {
    const { certificate } = device.fleet_audit;
    certificate.payload = `{"version":"bounder-creedspace-receipt/v1",${certificate.payload.slice(1)}`;
    device.fleet_audit.input_hash = createHash("sha256").update(certificate.payload).digest("hex");
  });
  await assert.rejects(
    validateFleetEvidence(duplicatePayload),
    /fleet audit certificate payload contains duplicate JSON fields/,
    "a coherently rehashed certificate cannot use duplicate members to create parser ambiguity"
  );
});

test("resilience fixtures pin complete scenarios, monotonic timelines and safe outcomes", async () => {
  const cases = [
    ["missing scenario", (value) => { value.resilience.scenarios.pop(); }, /(scenario count|resilience scenarios)/],
    ["duplicate scenario", (value) => { value.resilience.scenarios[1] = clone(value.resilience.scenarios[0]); }, /duplicated/],
    ["nonmonotonic event", (value) => { value.resilience.scenarios[0].events[1].at_ms = 0; }, /event time/],
    ["late event exhaustion", (value) => { value.resilience.scenarios[0].events[3].at_ms = 60_001; }, /event time/],
    ["wrong event order", (value) => { value.resilience.scenarios[0].events[1].kind = "decision"; }, /event sequence/],
    ["wrong injected fault", (value) => { value.resilience.scenarios[0].events[1].code = "other_fault"; }, /decision or audit/],
    ["changed safe outcome", (value) => { value.resilience.scenarios[0].expected_code = "allowed"; }, /scenario contract/],
    ["foreign affected device", (value) => { value.resilience.scenarios[0].affected_device = "bounder-unknown"; }, /affected device/],
    ["event device mismatch", (value) => { value.resilience.scenarios[0].events[2].device_id = "bounder-bravo"; }, /event sequence/],
    ["oversized event message", (value) => { value.resilience.scenarios[0].events[0].message = "x".repeat(1025); }, /message/]
  ];
  for (const [name, mutator, pattern] of cases) {
    await assert.rejects(validateFleetEvidence(mutateFleet(mutator)), pattern, name);
  }
});

test("every resilience scenario binds its canonical affected Guardian scope", async () => {
  for (const original of fleetFixture.resilience.scenarios) {
    assert.equal(RESILIENCE_CONTRACTS[original.id].affectedDevice, original.affected_device, `${original.id} canonical scope`);
    const value = clone(fleetFixture);
    const scenario = value.resilience.scenarios.find(({ id }) => id === original.id);
    const alternate = scenario.affected_device === "bounder-alpha" ? "bounder-bravo" : "bounder-alpha";
    scenario.affected_device = alternate;
    for (const event of scenario.events) event.device_id = alternate;
    await assert.rejects(
      validateFleetEvidence(value),
      /scenario contract is invalid/,
      `${original.id} must reject the valid but foreign scope ${alternate}`
    );
  }
});

test("stream sequences reject foreign, duplicate, out-of-order, partial and post-completion events", () => {
  const scenario = fleetFixture.resilience.scenarios[0];
  const [first, second] = scenario.events;
  assert.equal(validateResilienceStreamEvent(scenario, clone(first), 0).code, "policy_active");
  assert.throws(() => validateResilienceStreamEvent(scenario, { ...first, extra: true }, 0), /fields/);
  assert.throws(() => validateResilienceStreamEvent(scenario, clone(second), 0), /foreign or out of order/);
  assert.throws(() => validateResilienceStreamEvent(scenario, clone(first), -1), /state/);

  const partial = createResilienceStreamSequence(scenario);
  partial.push(clone(first));
  assert.equal(partial.received, 1);
  assert.throws(() => partial.push(clone(first)), /foreign or out of order/, "duplicates do not advance state");
  assert.throws(() => partial.finish(), /ended before/, "partial completion must trigger recorded fallback");

  const complete = createResilienceStreamSequence(scenario);
  scenario.events.forEach((event, index) => {
    const result = complete.push(clone(event));
    assert.equal(result.complete, index === scenario.events.length - 1);
  });
  assert.equal(complete.finish(), true);
  assert.equal(complete.received, scenario.events.length);
  assert.equal(complete.complete, true);
  assert.throws(() => complete.push(clone(first)), /already completed/);
  assert.throws(() => complete.finish(), /ended before/);
});

test("Fleet aliases preserve canonical guardian and six-canary identities across reordered pilots", () => {
  const recorded = Object.keys(RECORDED_GUARDIAN_ALIASES);
  const displayed = pilotFixture.devices.map(({ device_id }) => device_id);
  const aliases = resolveFleetGuardianAliases([...recorded].reverse(), [...displayed].reverse());
  assert.equal(aliases.size, 16);
  assert.equal(aliases.get("bounder-alpha"), "bounder-aerial-001");
  assert.equal(aliases.get("bounder-foxtrot"), "bounder-fixed_machinery-006");
  assert.deepEqual(
    resolveAffectedGuardianIDs("six canaries", [...displayed].reverse(), aliases),
    [
      "bounder-aerial-001", "bounder-ground-002", "bounder-marine-003",
      "bounder-warehouse-004", "bounder-inspection-005", "bounder-fixed_machinery-006"
    ]
  );
  assert.deepEqual(resolveAffectedGuardianIDs("bounder-alpha", displayed, aliases), ["bounder-aerial-001"]);
  assert.deepEqual(resolveAffectedGuardianIDs("all guardians", displayed, aliases), displayed);

  assert.throws(() => resolveAffectedGuardianIDs("six canaries", displayed.slice(1), aliases), /six canaries/);
  assert.throws(() => resolveAffectedGuardianIDs("bounder-alpha", [...displayed, displayed[0]], aliases), /duplicated/);
  assert.throws(() => resolveAffectedGuardianIDs("bounder-unknown", displayed, aliases), /unknown/);
  assert.throws(() => resolveFleetGuardianAliases(recorded, displayed.slice(1)), /incomplete/);
  const ambiguous = { ...RECORDED_GUARDIAN_ALIASES, "bounder-bravo": "bounder-aerial-001" };
  assert.throws(() => resolveFleetGuardianAliases(recorded, displayed, ambiguous), /ambiguous/);
});

test("resilience stream URLs permit only same-origin HTTPS or loopback HTTP, including IPv6", () => {
  assert.equal(resolveResilienceStreamURL("", "https://www.bounder.io/simulator.html", "network-partition"), undefined);
  assert.equal(
    resolveResilienceStreamURL("/api/resilience/events", "https://www.bounder.io/simulator.html", "network-partition"),
    "https://www.bounder.io/api/resilience/events?scenario=network-partition"
  );
  assert.equal(
    resolveResilienceStreamURL("/events", "http://127.0.0.1:4173/simulator.html", "audit-outage"),
    "http://127.0.0.1:4173/events?scenario=audit-outage"
  );
  assert.equal(
    resolveResilienceStreamURL("/events", "http://[::1]:4173/simulator.html", "clock-rollback"),
    "http://[::1]:4173/events?scenario=clock-rollback"
  );

  const rejected = [
    ["https://evil.example/events", "https://www.bounder.io/simulator.html", "network-partition"],
    ["http://www.bounder.io/events", "http://www.bounder.io/simulator.html", "network-partition"],
    ["https://user:pass@www.bounder.io/events", "https://www.bounder.io/simulator.html", "network-partition"],
    ["/events?scenario=other", "https://www.bounder.io/simulator.html", "network-partition"],
    ["/events#fragment", "https://www.bounder.io/simulator.html", "network-partition"],
    ["/events", "file:///tmp/simulator.html", "network-partition"],
    ["/events", "https://www.bounder.io/simulator.html", "unknown"]
  ];
  for (const args of rejected) assert.throws(() => resolveResilienceStreamURL(...args), /(trusted|malformed|unknown)/);
});

test("bounded simulator JSON accepts the exact boundary and cancels streamed exhaustion", async () => {
  const source = "{}";
  const exact = `${source}${" ".repeat(MAX_RECEIPT_BUNDLE_BYTES - source.length)}`;
  const parsed = await readBoundedJSONResponse(jsonResponse(exact, {
    "content-length": String(MAX_RECEIPT_BUNDLE_BYTES)
  }), { maxBytes: MAX_RECEIPT_BUNDLE_BYTES, label: "receipt bundle" });
  assert.deepEqual(parsed, {});
  assert.ok(Object.isFrozen(parsed));

  await assert.rejects(
    readBoundedJSONResponse(jsonResponse("{}", { "content-length": String(MAX_FLEET_EVIDENCE_BYTES + 1) }), {
      maxBytes: MAX_FLEET_EVIDENCE_BYTES,
      label: "Fleet evidence"
    }),
    /size limit/
  );

  let cancelled = false;
  let releaseAttempted = false;
  let reads = 0;
  const response = {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    body: {
      getReader: () => ({
        read: async () => reads++ === 0
          ? { done: false, value: new Uint8Array(MAX_RECEIPT_BUNDLE_BYTES + 1) }
          : { done: true },
        cancel: async () => { cancelled = true; },
        releaseLock() { releaseAttempted = true; throw new Error("broken reader release"); }
      })
    }
  };
  await assert.rejects(readBoundedJSONResponse(response, {
    maxBytes: MAX_RECEIPT_BUNDLE_BYTES,
    label: "receipt bundle"
  }), /size limit/);
  assert.equal(cancelled, true);
  assert.equal(releaseAttempted, true);
});

test("bounded simulator streams reject non-progress and chunk exhaustion without trusting cancellation", async () => {
  const responseWithReader = (reader) => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    body: { getReader: () => ({ releaseLock() {}, ...reader }) }
  });

  let emptyCancelled = false;
  await assert.rejects(readBoundedJSONResponse(responseWithReader({
    read: async () => ({ done: false, value: new Uint8Array(0) }),
    cancel: () => { emptyCancelled = true; }
  }), { maxBytes: 64, label: "test evidence" }), /invalid byte stream/);
  assert.equal(emptyCancelled, true);

  let reads = 0;
  let excessiveCancelled = false;
  await assert.rejects(readBoundedJSONResponse(responseWithReader({
    read: async () => ({ done: false, value: new Uint8Array([reads++ & 0xff]) }),
    cancel: () => { excessiveCancelled = true; }
  }), { maxBytes: MAX_SIMULATOR_STREAM_CHUNKS + 1, label: "test evidence" }), /too many chunks/);
  assert.equal(reads, MAX_SIMULATOR_STREAM_CHUNKS + 1);
  assert.equal(excessiveCancelled, true);

  const never = new Promise(() => {});
  let deadline;
  try {
    await assert.rejects(Promise.race([
      readBoundedJSONResponse(responseWithReader({
        read: async () => ({ done: false, value: new Uint8Array(65) }),
        cancel: () => never
      }), { maxBytes: 64, label: "test evidence" }),
      new Promise((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error("broken cancellation blocked validation")), 100);
      })
    ]), /size limit/);
  } finally {
    clearTimeout(deadline);
  }
});

test("bounded simulator transport rejects MIME, length, UTF-8, JSON and timeout failures", async () => {
  const cases = [
    [jsonResponse("{}", { "content-type": "text/plain" }), /did not return JSON/],
    [jsonResponse("{}", { "content-length": "12x" }), /content length/],
    [jsonResponse(new Uint8Array([0xc3, 0x28])), /UTF-8/],
    [jsonResponse("{bad"), /valid JSON/]
  ];
  for (const [response, pattern] of cases) {
    await assert.rejects(readBoundedJSONResponse(response, {
      maxBytes: MAX_RECEIPT_BUNDLE_BYTES,
      label: "receipt bundle"
    }), pattern);
  }

  const preAborted = new AbortController();
  preAborted.abort(new Error("caller stopped"));
  let readCalled = false;
  let cancelCalled = false;
  let releaseCalled = false;
  let deadline;
  try {
    await assert.rejects(Promise.race([
      readBoundedJSONResponse({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        body: {
          getReader: () => ({
            read: () => { readCalled = true; return new Promise(() => {}); },
            cancel: () => { cancelCalled = true; },
            releaseLock: () => { releaseCalled = true; }
          })
        }
      }, { maxBytes: 64, label: "test evidence", signal: preAborted.signal }),
      new Promise((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error("pre-aborted simulator read hung")), 100);
      })
    ]), /test evidence request was aborted/);
  } finally {
    clearTimeout(deadline);
  }
  assert.equal(readCalled, false);
  assert.equal(cancelCalled, true);
  assert.equal(releaseCalled, true);

  let cleared = false;
  let request;
  await assert.rejects(fetchSimulatorJSON("/never", {
    maxBytes: 1024,
    label: "test evidence",
    timeoutMs: 5,
    fetchImpl: (url, options) => new Promise((_resolve, reject) => {
      request = { url, options };
      options.signal.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
    }),
    timers: {
      setTimeout: globalThis.setTimeout,
      clearTimeout: (timer) => { cleared = true; globalThis.clearTimeout(timer); }
    }
  }), /request timed out/);
  assert.equal(cleared, true);
  assert.equal(request.url, "/never");
  assert.equal(request.options.cache, "no-cache");
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.redirect, "error");
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.equal(request.options.signal.aborted, true);
});

test("bounded simulator JSON rejects duplicate root, nested, and escaped-equivalent members", async () => {
  for (const [label, source] of [
    ["root", '{"ready":true,"ready":false}'],
    ["nested", '{"outer":{"value":1,"value":2}}'],
    ["escaped alias", String.raw`{"ready":true,"re\u0061dy":false}`]
  ]) {
    await assert.rejects(
      readBoundedJSONResponse(jsonResponse(source), { maxBytes: 1024, label: "test evidence" }),
      /test evidence contains duplicate JSON fields/,
      label
    );
  }
});

test("simulator transport deadlines beat abort-ignoring fetch and body readers", async () => {
  const runDeadlineCase = async (fetchImpl) => {
    let callback;
    let cleared;
    const token = {};
    const pending = fetchSimulatorJSON("/never", {
      maxBytes: 64,
      label: "test evidence",
      timeoutMs: 10,
      fetchImpl,
      timers: {
        setTimeout: (next, delay) => {
          assert.equal(delay, 10);
          callback = next;
          return token;
        },
        clearTimeout: (value) => { cleared = value; }
      }
    });
    await Promise.resolve();
    callback();
    await assert.rejects(pending, /request timed out/);
    assert.equal(cleared, token);
  };

  let fetchSignal;
  await runDeadlineCase((_url, options) => {
    fetchSignal = options.signal;
    return new Promise(() => {});
  });
  assert.equal(fetchSignal.aborted, true);

  let readerCancelled = false;
  await runDeadlineCase(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    body: {
      getReader: () => ({
        read: () => new Promise(() => {}),
        cancel: () => { readerCancelled = true; return new Promise(() => {}); },
        releaseLock() {}
      })
    }
  }));
  assert.equal(readerCancelled, true);
});

test("a response arriving after timeout is cancelled before any background body read", async () => {
  let resolveFetch;
  let fireTimeout;
  let backgroundReads = 0;
  let cancelled = false;
  let released = false;
  const pending = fetchSimulatorJSON("/late", {
    maxBytes: 64,
    label: "late evidence",
    timeoutMs: 10,
    fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
    timers: {
      setTimeout: (callback) => { fireTimeout = callback; return {}; },
      clearTimeout() {}
    }
  });
  await Promise.resolve();
  fireTimeout();
  await assert.rejects(pending, /late evidence request timed out/);

  resolveFetch({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    body: {
      getReader: () => ({
        read: () => { backgroundReads += 1; return new Promise(() => {}); },
        cancel: () => { cancelled = true; },
        releaseLock: () => { released = true; }
      })
    }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(backgroundReads, 0);
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test("simulator transport validates timer and evidence bounds before starting fetch", async () => {
  for (const timeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    let called = false;
    await assert.rejects(fetchSimulatorJSON("/evidence.json", {
      maxBytes: 64,
      label: "test evidence",
      timeoutMs,
      fetchImpl: async () => { called = true; return jsonResponse("{}"); }
    }), /transport is unavailable/, String(timeoutMs));
    assert.equal(called, false, String(timeoutMs));
  }

  await assert.rejects(fetchSimulatorJSON("/evidence.json", {
    maxBytes: 0,
    label: "test evidence",
    fetchImpl: async () => jsonResponse("{}")
  }), /transport is unavailable/);
});

test("Fleet evidence is immutable before asynchronous digest verification yields", async () => {
  let releaseDigest;
  const gate = new Promise((resolve) => { releaseDigest = resolve; });
  const fleet = clone(fleetFixture);
  assert.equal(Object.isFrozen(fleet.devices[0].receipt), false);
  Object.freeze(fleet);
  const pending = validateFleetEvidence(fleet, {
    subtle: {
      digest: async (...args) => {
        await gate;
        return globalThis.crypto.subtle.digest(...args);
      }
    }
  });

  assert.ok(Object.isFrozen(fleet));
  assert.ok(Object.isFrozen(fleet.devices[0].receipt));
  assert.throws(() => { fleet.devices[0].receipt.reason = "changed during digest"; }, TypeError);
  releaseDigest();
  assert.equal(await pending, fleet);
});

test("bounded simulator transport returns JSON and clears its timer", async () => {
  let request;
  let clearedTimer;
  const parsed = await fetchSimulatorJSON("/evidence.json", {
    maxBytes: 64,
    label: "test evidence",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse('{"ready":true}');
    },
    timers: {
      setTimeout: (callback, delay) => ({ callback, delay }),
      clearTimeout: (timer) => { clearedTimer = timer; }
    }
  });

  assert.deepEqual(parsed, { ready: true });
  assert.ok(Object.isFrozen(parsed));
  assert.equal(request.url, "/evidence.json");
  assert.deepEqual(
    { cache: request.options.cache, credentials: request.options.credentials, redirect: request.options.redirect },
    { cache: "no-cache", credentials: "same-origin", redirect: "error" }
  );
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.equal(request.options.signal.aborted, false);
  assert.equal(clearedTimer.delay, 10_000);
});
