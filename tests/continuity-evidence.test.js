import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";
import test from "node:test";

import {
  createContinuityLeaseController,
  createContinuityReplayGuard,
  fetchContinuityEnvelope,
  formatEvidenceTime,
  validateContinuityEvidence,
  verifyContinuityEnvelope
} from "../continuity-evidence.js";

const NOW = Date.parse("2026-07-16T12:00:00Z");
const KEY_ID = "bounder_lab_guardian";
const MAX_BYTES = 32 * 1024;
const TRUSTED_URL = "https://bounder-fleet-continuity-staging.onrender.com/evidence.json";
const baseEvidence = {
  version: "bounder-continuity-evidence/v1",
  fleet_id: "relief-fleet",
  mode: "real-fleet-postgresql",
  generated_at: "2026-07-16T11:55:00Z",
  expires_at: "2026-07-16T12:10:00Z",
  healthy: true,
  device_count: 100,
  platform_counts: { aerial: 17, ground: 17, marine: 17, warehouse: 17, inspection: 16, fixed_machinery: 16 },
  policies_verified: 100,
  checkpoints_verified: 100,
  evaluated: 100,
  allowed: 15,
  held: 85,
  signed_audits: 6,
  failure_count: 0,
  cycle_duration_ms: 1234
};

const evidence = (overrides = {}) => ({
  ...baseEvidence,
  ...overrides,
  platform_counts: {
    ...baseEvidence.platform_counts,
    ...(overrides.platform_counts || {})
  }
});

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicRaw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");

const signedEnvelope = (payload = JSON.stringify(evidence()), overrides = {}) => {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return {
    version: "bounder-continuity-envelope/v1",
    algorithm: "Ed25519",
    public_key_id: KEY_ID,
    payload: bytes.toString("base64"),
    signature: sign(null, bytes, privateKey).toString("base64"),
    ...overrides
  };
};

const verify = (envelope, overrides = {}) => verifyContinuityEnvelope({
  envelope,
  publicKeyHex: publicRaw.toString("hex"),
  publicKeyID: KEY_ID,
  cryptoImpl: webcrypto,
  nowMs: NOW,
  replayGuard: createContinuityReplayGuard(),
  ...overrides
});

const timerHarness = () => {
  const token = Symbol("continuity timeout");
  let callback;
  let delay;
  const cleared = [];
  return {
    timers: {
      setTimeout(next, nextDelay) {
        callback = next;
        delay = nextDelay;
        return token;
      },
      clearTimeout(clearedToken) {
        cleared.push(clearedToken);
      }
    },
    fire: () => callback(),
    state: () => ({ callback, delay, cleared: [...cleared], token })
  };
};

const jsonResponse = (body = '{"ok":true}', { status = 200, contentType = "application/json", contentLength } = {}) => {
  const headers = new Headers();
  if (contentType !== null) headers.set("content-type", contentType);
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return new Response(body, { status, headers });
};

test("valid evidence is order-independent and returned as a frozen defensive snapshot", () => {
  const input = evidence({ generated_at: "2026-07-16T11:55:00.123456789Z" });
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  const verified = validateContinuityEvidence(reordered, NOW);

  assert.equal(verified.held, 85);
  assert.notStrictEqual(verified, reordered);
  assert.notStrictEqual(verified.platform_counts, reordered.platform_counts);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.platform_counts), true);

  reordered.healthy = false;
  reordered.platform_counts.aerial = 1;
  assert.equal(verified.healthy, true);
  assert.equal(verified.platform_counts.aerial, 17);
  assert.throws(() => { verified.healthy = false; }, TypeError);
  assert.throws(() => { verified.platform_counts.aerial = 1; }, TypeError);
});

test("continuity evidence enforces each independent complete-cycle invariant", async (t) => {
  const cases = [
    ["exact device count", (value) => { value.device_count = 99; }],
    ["all policies verified", (value) => { value.policies_verified = 99; }],
    ["all checkpoints verified", (value) => { value.checkpoints_verified = 99; }],
    ["all devices evaluated", (value) => { value.evaluated = 99; }],
    ["decisions partition evaluations", (value) => { value.allowed = 14; }],
    ["zero failures", (value) => { value.failure_count = 1; }],
    ["explicit healthy result", (value) => { value.healthy = false; }]
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const changed = evidence();
      mutate(changed);
      assert.throws(() => validateContinuityEvidence(changed, NOW), /does not prove a complete healthy fleet cycle/);
    });
  }
});

test("counter representation and platform totals fail at their distinct boundaries", async (t) => {
  for (const [name, counter] of [["negative", -1], ["fractional", 1.5], ["unsafe", Number.MAX_SAFE_INTEGER + 1]]) {
    await t.test(`${name} counter`, () => {
      assert.throws(() => validateContinuityEvidence(evidence({ cycle_duration_ms: counter }), NOW), /counters are invalid/);
    });
  }
  const cases = [
    ["platform count below one", { platform_counts: { aerial: 0 } }, /platform count is invalid/],
    ["platform total mismatch", { platform_counts: { aerial: 16 } }, /totals are inconsistent/],
    ["signed audit total mismatch", { signed_audits: 5 }, /totals are inconsistent/]
  ];
  for (const [name, overrides, pattern] of cases) {
    await t.test(name, () => assert.throws(() => validateContinuityEvidence(evidence(overrides), NOW), pattern));
  }
});

test("timestamps require primitive canonical UTC values with real calendar dates", async (t) => {
  const cases = [
    ["array coercion", { generated_at: ["2026-07-16T11:55:00Z"] }, NOW],
    ["locale text", { generated_at: "July 16, 2026 11:55:00 UTC" }, NOW],
    ["impossible date", { generated_at: "2026-02-29T11:55:00Z", expires_at: "2026-03-01T12:10:00Z" }, Date.parse("2026-03-01T12:00:00Z")],
    ["excess fractional precision", { generated_at: "2026-07-16T11:55:00.1234567890Z" }, NOW]
  ];
  for (const [name, overrides, nowMs] of cases) {
    await t.test(name, () => assert.throws(() => validateContinuityEvidence(evidence(overrides), nowMs), /generated_at is invalid/));
  }
  await t.test("clock must be a safe whole millisecond", () => {
    for (const nowMs of [Number.NaN, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => validateContinuityEvidence(evidence(), nowMs), /clock is invalid/);
    }
  });
});

test("freshness comparisons enforce exact nanosecond boundaries", async (t) => {
  const cases = [
    ["expiry at now", { expires_at: "2026-07-16T12:00:00.000Z" }, false],
    ["expiry one nanosecond after now", { expires_at: "2026-07-16T12:00:00.000000001Z" }, true],
    ["future skew exactly five minutes", { generated_at: "2026-07-16T12:05:00.000Z" }, true],
    ["future skew over five minutes by one nanosecond", { generated_at: "2026-07-16T12:05:00.000000001Z" }, false],
    ["validity exactly thirty minutes", { expires_at: "2026-07-16T12:25:00.000Z" }, true],
    ["validity over thirty minutes by one nanosecond", { expires_at: "2026-07-16T12:25:00.000000001Z" }, false],
    ["expiry equal to generation", { generated_at: "2026-07-16T12:04:00.000Z", expires_at: "2026-07-16T12:04:00.000Z" }, false]
  ];
  for (const [name, overrides, accepted] of cases) {
    await t.test(name, () => {
      if (accepted) {
        assert.equal(validateContinuityEvidence(evidence(overrides), NOW).generated_at, evidence(overrides).generated_at);
      } else {
        assert.throws(() => validateContinuityEvidence(evidence(overrides), NOW), /stale or has an invalid validity window/);
      }
    });
  }
});

test("cycle duration cannot exceed the signed evidence validity window", () => {
  assert.equal(validateContinuityEvidence(evidence({ cycle_duration_ms: 15 * 60 * 1000 }), NOW).cycle_duration_ms, 15 * 60 * 1000);
  assert.throws(
    () => validateContinuityEvidence(evidence({ cycle_duration_ms: 15 * 60 * 1000 + 1 }), NOW),
    /cycle duration exceeds its validity window/
  );
});

test("evidence schema rejects unknown fields and malformed nested fields", () => {
  assert.throws(() => validateContinuityEvidence(null, NOW), /continuity evidence is invalid/);

  const changed = evidence();
  changed.command = "actuate";
  assert.throws(() => validateContinuityEvidence(changed, NOW), /continuity evidence fields are invalid/);

  const nested = evidence();
  nested.platform_counts.command = 1;
  assert.throws(() => validateContinuityEvidence(nested, NOW), /platform counts fields are invalid/);
});

test("evidence metadata pins each identity field", async (t) => {
  for (const [field, value] of [["version", "v2"], ["fleet_id", "other-fleet"], ["mode", "simulation"]]) {
    await t.test(field, () => {
      assert.throws(() => validateContinuityEvidence(evidence({ [field]: value }), NOW), /metadata is invalid/);
    });
  }
});

test("timestamp formatting keeps explicit date, time, and zone fields with nanosecond input", () => {
  const formatted = formatEvidenceTime("2026-07-16T23:10:32.808059651Z");
  assert.equal(
    formatted.includes("2026") && formatted.includes("Jul") && /\d{2}:\d{2}/.test(formatted) && /(?:[A-Z]{2,5}|GMT[+-]\d{1,2}(?::\d{2})?)$/.test(formatted.trim()),
    true,
    formatted
  );
});

test("continuity envelope verifies exact Ed25519 payload bytes", async () => {
  const payload = Buffer.from(JSON.stringify(evidence()));
  const verified = await verify(signedEnvelope(payload));
  assert.deepEqual(verified, evidence());
  assert.equal(Object.isFrozen(verified), true);

  const corrupted = Buffer.from(payload);
  corrupted[corrupted.length - 2] ^= 1;
  await assert.rejects(() => verify({ ...signedEnvelope(payload), payload: corrupted.toString("base64") }), /signature is invalid/);
});

test("freshness is sampled after asynchronous signature verification", async () => {
  let releaseVerification;
  const verificationGate = new Promise((resolve) => { releaseVerification = resolve; });
  let clockMs = NOW;
  const delayedCrypto = {
    subtle: {
      importKey: (...arguments_) => webcrypto.subtle.importKey(...arguments_),
      async verify(...arguments_) {
        await verificationGate;
        return webcrypto.subtle.verify(...arguments_);
      }
    }
  };
  const pending = verify(signedEnvelope(), {
    cryptoImpl: delayedCrypto,
    nowMs: undefined,
    clock: () => clockMs
  });
  clockMs = Date.parse(baseEvidence.expires_at);
  releaseVerification();
  await assert.rejects(pending, /stale or has an invalid validity window/);
});

test("a replay guard rejects duplicate and rolled-back signed cycles", async () => {
  const guard = createContinuityReplayGuard();
  const older = evidence({ generated_at: "2026-07-16T11:59:00.000000001Z" });
  const newer = evidence({ generated_at: "2026-07-16T11:59:00.000000002Z" });
  assert.equal((await verify(signedEnvelope(JSON.stringify(older)), { replayGuard: guard })).generated_at, older.generated_at);
  assert.equal((await verify(signedEnvelope(JSON.stringify(newer)), { replayGuard: guard })).generated_at, newer.generated_at);
  await assert.rejects(() => verify(signedEnvelope(JSON.stringify(newer)), { replayGuard: guard }), /replayed or rolled back/);
  await assert.rejects(() => verify(signedEnvelope(JSON.stringify(older)), { replayGuard: guard }), /replayed or rolled back/);
  assert.throws(() => createContinuityReplayGuard(Number.NaN), /guard state is invalid/);
});

test("envelope metadata, encoding, and crypto prerequisites fail closed", async (t) => {
  const cases = [
    ["unknown envelope field", { ...signedEnvelope(), command: "actuate" }, {}, /envelope fields are invalid/],
    ["unpinned identity", signedEnvelope(undefined, { public_key_id: "wrong" }), {}, /metadata is invalid/],
    ["empty pinned identity", signedEnvelope(undefined, { public_key_id: "" }), { publicKeyID: "" }, /metadata is invalid/],
    ["missing WebCrypto", signedEnvelope(), { cryptoImpl: {} }, /verification is unavailable/],
    ["invalid public key", signedEnvelope(), { publicKeyHex: "AA".repeat(32) }, /public key is invalid/],
    ["noncanonical payload base64", { ...signedEnvelope(), payload: "e30" }, {}, /payload is not canonical base64/],
    ["noncanonical trailing base64 bits", { ...signedEnvelope(), payload: "AB==" }, {}, /payload is not canonical base64/],
    ["oversized signature", { ...signedEnvelope(), signature: "A".repeat(92) }, {}, /signature is too large/],
    ["short signature", { ...signedEnvelope(), signature: Buffer.alloc(63).toString("base64") }, {}, /envelope size is invalid/]
  ];
  for (const [name, envelope, overrides, pattern] of cases) {
    await t.test(name, () => assert.rejects(() => verify(envelope, overrides), pattern));
  }
});

test("decoded payload size accepts the exact limit and rejects one byte over", async () => {
  const serialized = JSON.stringify(evidence());
  const exact = Buffer.from(serialized + " ".repeat(MAX_BYTES - Buffer.byteLength(serialized)));
  assert.equal(exact.byteLength, MAX_BYTES);
  assert.equal((await verify(signedEnvelope(exact))).device_count, 100);

  const oversized = Buffer.concat([exact, Buffer.from(" ")]);
  await assert.rejects(() => verify(signedEnvelope(oversized)), /payload is too large/);
});

test("validly signed malformed, corrupt, and ambiguous JSON is rejected", async (t) => {
  const serialized = JSON.stringify(evidence());
  const cases = [
    ["malformed UTF-8", Buffer.from([0xff]), /payload is not valid JSON/],
    ["invalid JSON", Buffer.from("{"), /payload is not valid JSON/],
    ["excess JSON depth", "[".repeat(34) + "0" + "]".repeat(34), /payload is not valid JSON/],
    ["duplicate escaped root field", serialized.replace('"healthy":true', '"healt\\u0068y":false,"healthy":true'), /duplicate JSON fields/],
    ["duplicate nested platform field", serialized.replace('"aerial":17', '"aerial":1,"aerial":17'), /duplicate JSON fields/]
  ];
  for (const [name, payload, pattern] of cases) {
    await t.test(name, () => assert.rejects(() => verify(signedEnvelope(payload)), pattern));
  }
});

test("transport accepts only the exact trusted default-port endpoint", async (t) => {
  const rejected = [
    "not a URL",
    "http://bounder-fleet-continuity-staging.onrender.com/evidence.json",
    "https://bounder-fleet-continuity-staging.onrender.com:8443/evidence.json",
    "https://user@bounder-fleet-continuity-staging.onrender.com/evidence.json",
    "https://bounder-fleet-continuity-staging.onrender.com/other.json",
    "https://bounder-fleet-continuity-staging.onrender.com/evidence.json?next=1",
    "https://bounder-fleet-continuity-staging.onrender.com/evidence.json#fragment",
    "https://example.com/evidence.json"
  ];
  for (const url of rejected) {
    await t.test(url, async () => {
      let fetched = false;
      await assert.rejects(() => fetchContinuityEnvelope(url, { fetchImpl: async () => { fetched = true; } }), /URL is not trusted/);
      assert.equal(fetched, false);
    });
  }

  await t.test("explicit default port is the same trusted origin", async () => {
    const harness = timerHarness();
    const result = await fetchContinuityEnvelope(TRUSTED_URL.replace(".com/", ".com:443/"), {
      fetchImpl: async () => jsonResponse(),
      timers: harness.timers
    });
    assert.deepEqual(result, { ok: true });
  });

  await t.test("timeout boundaries cannot be clamped into an unintended delay", async () => {
    for (const timeoutMs of [0, 0.5, 2_147_483_648, Number.POSITIVE_INFINITY]) {
      let fetched = false;
      await assert.rejects(() => fetchContinuityEnvelope(TRUSTED_URL, {
        fetchImpl: async () => { fetched = true; },
        timeoutMs
      }), /transport is unavailable/);
      assert.equal(fetched, false, `timeout ${timeoutMs} reached fetch`);
    }
    const harness = timerHarness();
    assert.deepEqual(await fetchContinuityEnvelope(TRUSTED_URL, {
      fetchImpl: async () => jsonResponse(),
      timers: harness.timers,
      timeoutMs: 2_147_483_647
    }), { ok: true });
    assert.equal(harness.state().delay, 2_147_483_647);
  });
});

test("transport pins JSON media type and preserves hardened fetch options", async (t) => {
  for (const contentType of ["application/json", "Application/JSON; charset=utf-8"]) {
    await t.test(`accepts ${contentType}`, async () => {
      const harness = timerHarness();
      let options;
      const result = await fetchContinuityEnvelope(TRUSTED_URL, {
        fetchImpl: async (_url, received) => {
          options = received;
          return jsonResponse(undefined, { contentType });
        },
        timers: harness.timers
      });
      assert.deepEqual(result, { ok: true });
      assert.deepEqual(
        { cache: options.cache, credentials: options.credentials, mode: options.mode, redirect: options.redirect, referrerPolicy: options.referrerPolicy },
        { cache: "no-store", credentials: "omit", mode: "cors", redirect: "error", referrerPolicy: "no-referrer" }
      );
      assert.equal(options.signal.aborted, false);
      assert.deepEqual(harness.state().cleared, [harness.state().token]);
      harness.fire();
      assert.equal(options.signal.aborted, false, "a cleared stale timer must not abort a completed request");
    });
  }
  for (const contentType of [null, "application/jsonp", "text/json"]) {
    await t.test(`rejects ${String(contentType)}`, async () => {
      const harness = timerHarness();
      await assert.rejects(() => fetchContinuityEnvelope(TRUSTED_URL, {
        fetchImpl: async () => jsonResponse(undefined, { contentType }),
        timers: harness.timers
      }), /content type is invalid/);
      assert.deepEqual(harness.state().cleared, [harness.state().token]);
    });
  }
});

test("transport rejects status, invalid lengths, and invalid outer JSON", async (t) => {
  const cases = [
    ["HTTP failure", jsonResponse("error", { status: 503 }), /returned 503/],
    ["invalid content length", jsonResponse(undefined, { contentLength: "12x" }), /content length is invalid/],
    ["invalid JSON", jsonResponse("{"), /not valid JSON/],
    ["invalid string escape", jsonResponse('{"value":"\\q"}'), /not valid JSON/],
    ["unterminated string", jsonResponse('{"value":"open}'), /not valid JSON/],
    ["unterminated array", jsonResponse("["), /not valid JSON/],
    ["trailing array comma", jsonResponse('[1,]'), /not valid JSON/],
    ["missing array comma", jsonResponse('[1 2]'), /not valid JSON/],
    ["invalid literal", jsonResponse('{"value":truth}'), /not valid JSON/],
    ["invalid UTF-8", jsonResponse(new Uint8Array([0xff])), /not valid UTF-8/],
    ["duplicate outer field", jsonResponse('{"ok":true,"ok":false}'), /duplicate JSON fields/]
  ];
  for (const [name, response, pattern] of cases) {
    await t.test(name, async () => {
      const harness = timerHarness();
      await assert.rejects(() => fetchContinuityEnvelope(TRUSTED_URL, { fetchImpl: async () => response, timers: harness.timers }), pattern);
      assert.deepEqual(harness.state().cleared, [harness.state().token]);
    });
  }
});

test("the duplicate-aware parser preserves valid JSON grammar", async () => {
  const source = '{"emptyObject":{},"emptyArray":[],"values":[true,false,null,-1.5e+2],"escaped":"line\\n\\u0061"}';
  const harness = timerHarness();
  assert.deepEqual(await fetchContinuityEnvelope(TRUSTED_URL, {
    fetchImpl: async () => jsonResponse(source),
    timers: harness.timers
  }), {
    emptyObject: {},
    emptyArray: [],
    values: [true, false, null, -150],
    escaped: "line\na"
  });
});

test("transport enforces the cumulative byte cap before buffering excess data", async (t) => {
  const serialized = '{"ok":true}';
  const exactBody = serialized + " ".repeat(MAX_BYTES - Buffer.byteLength(serialized));
  const exactHarness = timerHarness();
  assert.deepEqual(await fetchContinuityEnvelope(TRUSTED_URL, {
    fetchImpl: async () => jsonResponse(exactBody, { contentLength: MAX_BYTES }),
    timers: exactHarness.timers
  }), { ok: true });

  for (const [name, lengthHeader] of [["absent length", undefined], ["understated length", 1]]) {
    await t.test(name, async () => {
      let cancellations = 0;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_BYTES));
          controller.enqueue(new Uint8Array([0x20]));
        },
        cancel() {
          cancellations += 1;
        }
      });
      const headers = new Headers({ "content-type": "application/json" });
      if (lengthHeader !== undefined) headers.set("content-length", String(lengthHeader));
      const response = { ok: true, status: 200, headers, body: stream };
      const harness = timerHarness();
      await assert.rejects(() => fetchContinuityEnvelope(TRUSTED_URL, { fetchImpl: async () => response, timers: harness.timers }), /feed is too large/);
      assert.equal(cancellations, 1);
      assert.deepEqual(harness.state().cleared, [harness.state().token]);
    });
  }

  await t.test("declared excess is rejected before reading", async () => {
    let readerRequests = 0;
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json", "content-length": String(MAX_BYTES + 1) }),
      body: { getReader() { readerRequests += 1; } }
    };
    const harness = timerHarness();
    await assert.rejects(() => fetchContinuityEnvelope(TRUSTED_URL, { fetchImpl: async () => response, timers: harness.timers }), /feed is too large/);
    assert.equal(readerRequests, 0);
  });

  await t.test("cancellation failure cannot mask the size failure", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_BYTES + 1));
      },
      cancel() {
        throw new Error("cancel failed");
      }
    });
    const response = { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), body: stream };
    const harness = timerHarness();
    await assert.rejects(() => fetchContinuityEnvelope(TRUSTED_URL, { fetchImpl: async () => response, timers: harness.timers }), /feed is too large/);
  });

  await t.test("a cancellation promise that never settles cannot block the size failure", async () => {
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader() {
          return {
            read: async () => ({ done: false, value: new Uint8Array(MAX_BYTES + 1) }),
            cancel: () => new Promise(() => {}),
            releaseLock() {}
          };
        }
      }
    };
    const harness = timerHarness();
    await Promise.race([
      assert.rejects(
        fetchContinuityEnvelope(TRUSTED_URL, { fetchImpl: async () => response, timers: harness.timers }),
        /feed is too large/
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error("continuity cancellation blocked the bound failure")), 100))
    ]);
  });

  await t.test("a non-progressing empty chunk is rejected and cancelled", async () => {
    let cancellations = 0;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(0));
      },
      cancel() {
        cancellations += 1;
      }
    });
    const response = { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), body: stream };
    const harness = timerHarness();
    await assert.rejects(
      () => fetchContinuityEnvelope(TRUSTED_URL, { fetchImpl: async () => response, timers: harness.timers, timeoutMs: 10 }),
      /feed body is invalid/
    );
    assert.equal(cancellations, 1);
    assert.deepEqual(harness.state().cleared, [harness.state().token]);
  });
});

test("live proof expires fail-closed and stale timers cannot overwrite newer state", () => {
  const selectors = [
    "[data-continuity-state]", "[data-continuity-devices]", "[data-continuity-policies]",
    "[data-continuity-checkpoints]", "[data-continuity-decisions]", "[data-continuity-updated]",
    "[data-continuity-note]"
  ];
  const nodes = new Map(selectors.map((selector) => [selector, {
    textContent: "",
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); }
  }]));
  const root = { dataset: {}, querySelector: (selector) => nodes.get(selector) };
  let clockMs = NOW;
  let nextToken = 0;
  const callbacks = new Map();
  const cleared = [];
  const timers = {
    setTimeout(callback, delay) {
      const token = ++nextToken;
      callbacks.set(token, { callback, delay });
      return token;
    },
    clearTimeout(token) { cleared.push(token); }
  };
  const controller = createContinuityLeaseController(root, { clock: () => clockMs, timers });
  const first = evidence({ expires_at: "2026-07-16T12:10:00Z", allowed: 15, held: 85 });
  assert.equal(controller.showVerified(first), true);
  const firstToken = nextToken;
  assert.equal(root.dataset.state, "verified");
  assert.equal(callbacks.get(firstToken).delay, 10 * 60 * 1000);

  const second = evidence({ generated_at: "2026-07-16T11:59:00Z", expires_at: "2026-07-16T12:20:00Z", allowed: 16, held: 84 });
  assert.equal(controller.showVerified(second), true);
  const secondToken = nextToken;
  assert.deepEqual(cleared, [firstToken]);
  assert.equal(nodes.get("[data-continuity-decisions]").textContent, "16 allow / 84 hold");

  callbacks.get(firstToken).callback();
  assert.equal(root.dataset.state, "verified", "a cancelled older generation must not downgrade newer proof");
  clockMs = Date.parse(second.expires_at);
  callbacks.get(secondToken).callback();
  assert.equal(root.dataset.state, "unavailable");
  assert.equal(nodes.get("[data-continuity-state]").textContent, "Recorded proof");

  assert.equal(controller.showVerified(second), false, "already-expired proof must not be rendered as live");

  clockMs = NOW;
  controller.showVerified(first);
  const invalidClockToken = nextToken;
  clockMs = Number.NaN;
  callbacks.get(invalidClockToken).callback();
  assert.equal(root.dataset.state, "unavailable", "a corrupt clock at expiry must fail closed");

  clockMs = NOW;
  controller.showVerified(first);
  const disposedToken = nextToken;
  controller.dispose();
  callbacks.get(disposedToken).callback();
  assert.equal(root.dataset.state, "verified", "a disposed controller must ignore its stale callback");

  controller.showUnavailable();
  assert.equal(root.dataset.state, "unavailable");

  assert.throws(() => createContinuityLeaseController(null), /controller is unavailable/);
});

test("transport timeout promptly races both fetch and body reads", async (t) => {
  await t.test("fetch implementation never settles and ignores abort", async () => {
    const harness = timerHarness();
    let signal;
    const pending = fetchContinuityEnvelope(TRUSTED_URL, {
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
      timers: harness.timers,
      timeoutMs: 1234
    });
    let settled = false;
    const observed = pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(harness.state().delay, 1234);
    const rejected = assert.rejects(pending, /continuity feed timed out/);
    harness.fire();
    await rejected;
    await observed;
    assert.equal(settled, true);
    assert.equal(signal.aborted, true);
    assert.deepEqual(harness.state().cleared, [harness.state().token]);
  });

  await t.test("response reader never settles and ignores abort", async () => {
    const harness = timerHarness();
    let signal;
    let markReaderEntered;
    let cancellations = 0;
    const readerEntered = new Promise((resolve) => { markReaderEntered = resolve; });
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader() {
          return {
            read() {
              markReaderEntered();
              return new Promise(() => {});
            },
            cancel() {
              cancellations += 1;
              return new Promise(() => {});
            },
            releaseLock() {}
          };
        }
      }
    };
    const pending = fetchContinuityEnvelope(TRUSTED_URL, {
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return response;
      },
      timers: harness.timers,
      timeoutMs: 4321
    });
    await readerEntered;
    let settled = false;
    const observed = pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(harness.state().delay, 4321);
    const rejected = assert.rejects(pending, /continuity feed timed out/);
    harness.fire();
    await rejected;
    await observed;
    assert.equal(settled, true);
    assert.equal(signal.aborted, true);
    assert.equal(cancellations, 1, "timeout abort must attempt to release the stalled reader");
    assert.deepEqual(harness.state().cleared, [harness.state().token]);
  });

  await t.test("a response arriving after timeout is cancelled before its first read", async () => {
    const harness = timerHarness();
    let resolveTransport;
    let reads = 0;
    let cancellations = 0;
    let releases = 0;
    const pending = fetchContinuityEnvelope(TRUSTED_URL, {
      fetchImpl: () => new Promise((resolve) => { resolveTransport = resolve; }),
      timers: harness.timers,
      timeoutMs: 25
    });
    harness.fire();
    await assert.rejects(pending, /continuity feed timed out/);

    resolveTransport({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader() {
          return {
            read() {
              reads += 1;
              return new Promise(() => {});
            },
            cancel() {
              cancellations += 1;
              return new Promise(() => {});
            },
            releaseLock() {
              releases += 1;
            }
          };
        }
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(reads, 0, "an already-aborted signal must prevent the first read");
    assert.equal(cancellations, 1, "the late body must be released without awaiting hostile cancellation");
    assert.equal(releases, 1);
  });

  await t.test("a transport rejection after timeout remains handled", async () => {
    const harness = timerHarness();
    let rejectTransport;
    const pending = fetchContinuityEnvelope(TRUSTED_URL, {
      fetchImpl: async () => new Promise((_resolve, reject) => { rejectTransport = reject; }),
      timers: harness.timers,
      timeoutMs: 25
    });
    harness.fire();
    await assert.rejects(pending, /continuity feed timed out/);
    rejectTransport(new Error("late transport failure"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(harness.state().cleared, [harness.state().token]);
  });
});

test("module import does not bootstrap against Node DOM-like globals", () => {
  const environment = { ...process.env };
  delete environment.NODE_V8_COVERAGE;
  const moduleUrl = new URL("../continuity-evidence.js", import.meta.url).href;
  const script = `
    globalThis.document = { querySelector() { throw new Error("bootstrap ran in Node"); } };
    globalThis.window = { location: { hostname: "www.bounder.io" } };
    await import(${JSON.stringify(moduleUrl)});
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8", env: environment });
  assert.equal(result.status, 0, result.stderr);
});
