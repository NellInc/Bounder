import { parseStrictJSON } from "./policy-roundtrip.js";

const deepFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.isFrozen(value) ? value : Object.freeze(value);
};

export const SIMULATOR_SCENARIOS = deepFreeze([
  "safe",
  "civilian",
  "friendly",
  "protected",
  "humanitarian",
  "surrender",
  "incapacitated",
  "identification",
  "proportionality",
  "human_authorization",
  "altitude",
  "weather",
  "window",
  "link",
  "replay"
]);

export const SIMULATOR_RULES = deepFreeze([
  "all",
  "fleet",
  "authority",
  "civilian",
  "friendly",
  "protected",
  "humanitarian",
  "surrender",
  "incapacitated",
  "identification",
  "proportionality",
  "authorization",
  "operating",
  "weather",
  "link"
]);

const RECEIPT_CONTRACTS = deepFreeze({
  safe: { rule: "all", code: "allowed", action: "loiter", allowed: true, source: "bounder-io/interlock" },
  civilian: { rule: "civilian", code: "civilian_proximity", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["civilian_distance_metres", 5] },
  friendly: { rule: "friendly", code: "friendly_force_proximity", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["friendly_distance_metres", 10] },
  protected: { rule: "protected", code: "protected_site", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["inside_protected_site", true] },
  humanitarian: { rule: "humanitarian", code: "humanitarian_corridor_protected", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["inside_humanitarian_corridor", true] },
  surrender: { rule: "surrender", code: "surrender_protected", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["surrender_observed", true] },
  incapacitated: { rule: "incapacitated", code: "incapacitated_person_protected", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["incapacitated_observed", true] },
  identification: { rule: "identification", code: "positive_identification_required", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["positive_identification", false] },
  proportionality: { rule: "proportionality", code: "proportionality_unconfirmed", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["proportionality_satisfied", false] },
  human_authorization: { rule: "authorization", code: "human_authorization_required", action: "intercept", allowed: false, source: "bounder-io/interlock", state: ["human_authorization_confirmed", false] },
  altitude: { rule: "operating", code: "altitude_above_maximum", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["altitude_metres", 120] },
  weather: { rule: "weather", code: "weather_outside_envelope", action: "loiter", allowed: false, source: "bounder-io/interlock", state: ["wind_speed_metres_per_second", 26] },
  window: { rule: "operating", code: "operating_window_closed", action: "loiter", allowed: false, source: "bounder-io/interlock" },
  link: { rule: "link", code: "transport_unavailable", action: "loiter", allowed: false, source: "bounder-io/adapter" },
  replay: { rule: "authority", code: "policy_replay", action: "loiter", allowed: false, source: "bounder-io/interlock" }
});

const SAFE_RECEIPT_STATE = deepFreeze({
  gps_fix: true,
  battery_percent: 80,
  altitude_metres: 30,
  inside_exclusion_zone: false,
  civilian_distance_metres: 120,
  friendly_distance_metres: 150,
  inside_protected_site: false,
  inside_humanitarian_corridor: false,
  wind_speed_metres_per_second: 4,
  visibility_metres: 8000,
  positive_identification: true,
  proportionality_satisfied: true,
  surrender_observed: false,
  incapacitated_observed: false,
  human_authorization_confirmed: true
});

export const RESILIENCE_CONTRACTS = deepFreeze({
  "network-partition": { route: "civilian", rule: "link", code: "civilian_proximity", faultCode: "fleet_unreachable", affectedDevice: "bounder-alpha" },
  "audit-outage": { route: "civilian", rule: "fleet", code: "civilian_proximity", faultCode: "audit_unreachable", affectedDevice: "bounder-alpha" },
  "corrupted-envelope": { route: "replay", rule: "fleet", code: "invalid_signature", faultCode: "signature_corrupted", affectedDevice: "bounder-bravo" },
  "clock-rollback": { route: "window", rule: "operating", code: "clock_rollback", faultCode: "time_rollback", affectedDevice: "bounder-charlie" },
  "guardian-restart": { route: "replay", rule: "fleet", code: "policy_replay", faultCode: "process_restart", affectedDevice: "bounder-charlie" },
  "key-revocation": { route: "replay", rule: "fleet", code: "unknown_key", faultCode: "retired_key_used", affectedDevice: "bounder-alpha" },
  "stale-evidence": { route: "weather", rule: "authority", code: "evidence_stale", faultCode: "evidence_aged_out", affectedDevice: "bounder-hotel" },
  "partial-rollout": { route: "civilian", rule: "fleet", code: "civilian_proximity", faultCode: "mixed_policy_sequences", affectedDevice: "six canaries" },
  "fleet-revocation": { route: "link", rule: "fleet", code: "policy_unavailable", faultCode: "policy_removed", affectedDevice: "all guardians" },
  "offline-expiry": { route: "link", rule: "authority", code: "policy_expired", faultCode: "cache_expired", affectedDevice: "bounder-alpha" },
  "coherent-snapshot-rollback": { route: "replay", rule: "fleet", code: "state_rollback_detected", faultCode: "snapshot_restored", affectedDevice: "bounder-delta" },
  "continuity-lease-expiry": { route: "link", rule: "authority", code: "continuity_lease_expired", faultCode: "lease_expired", affectedDevice: "bounder-echo" }
});

// The public Fleet fixture records signature bytes and their key identifiers,
// but deliberately does not publish the corresponding audit public key.  The
// browser can therefore check the payload mirror, digest and encoding only.
export const FLEET_AUDIT_AUTHENTICATION = deepFreeze({
  authenticated: false,
  label: "Recorded Fleet signature; audit public key unavailable"
});

const RECORDED_GUARDIAN_IDS = deepFreeze([
  "bounder-alpha", "bounder-bravo", "bounder-charlie", "bounder-delta",
  "bounder-echo", "bounder-foxtrot", "bounder-golf", "bounder-hotel",
  "bounder-india", "bounder-juliet", "bounder-kilo", "bounder-lima",
  "bounder-mike", "bounder-november", "bounder-oscar", "bounder-papa"
]);

const RECORDED_FLEET_CONTRACTS = deepFreeze({
  "bounder-alpha": ["safe recovery", "allowed"],
  "bounder-bravo": ["civilian protection", "civilian_proximity"],
  "bounder-charlie": ["friendly force separation", "friendly_force_proximity"],
  "bounder-delta": ["protected site", "protected_site"],
  "bounder-echo": ["humanitarian corridor", "humanitarian_corridor_protected"],
  "bounder-foxtrot": ["exclusion zone", "inside_exclusion_zone"],
  "bounder-golf": ["weather envelope", "weather_outside_envelope"],
  "bounder-hotel": ["stale assurance", "evidence_stale"],
  "bounder-india": ["policy replay", "allowed"],
  "bounder-juliet": ["policy absent or revoked", "policy_unavailable"],
  "bounder-kilo": ["offline policy expiry", "policy_expired"],
  "bounder-lima": ["surrender protection", "surrender_protected"],
  "bounder-mike": ["incapacitated person protection", "incapacitated_person_protected"],
  "bounder-november": ["positive identification", "positive_identification_required"],
  "bounder-oscar": ["proportionality", "proportionality_unconfirmed"],
  "bounder-papa": ["human authorization", "human_authorization_required"]
});

export const RECORDED_GUARDIAN_ALIASES = deepFreeze(Object.fromEntries(RECORDED_GUARDIAN_IDS.map((id, index) => [
  id,
  `bounder-${["aerial", "ground", "marine", "warehouse", "inspection", "fixed_machinery"][index % 6]}-${String(index + 1).padStart(3, "0")}`
])));

const RECEIPT_KEYS = Object.freeze([
  "version", "scenario", "rule", "decision_source", "signature_verified", "allowed", "code", "reason",
  "action", "subject", "policy_id", "issuer", "sequence", "evaluated_at", "policy_hash", "evidence", "state", "adapter"
]);
const EVIDENCE_KEYS = Object.freeze(["tier", "session_id", "auditor", "auditor_key_id", "verified_at", "age_seconds"]);
const STATE_KEYS = Object.freeze([
  "gps_fix", "battery_percent", "altitude_metres", "inside_exclusion_zone", "civilian_distance_metres",
  "friendly_distance_metres", "inside_protected_site", "inside_humanitarian_corridor", "wind_speed_metres_per_second",
  "visibility_metres", "positive_identification", "proportionality_satisfied", "surrender_observed",
  "incapacitated_observed", "human_authorization_confirmed"
]);
const ADAPTER_KEYS = Object.freeze(["command_authorized", "command_sent", "output"]);
const FLEET_KEYS = Object.freeze(["version", "generated_at", "fleet_id", "policy_profile", "summary", "devices", "lab", "resilience"]);
const FLEET_SUMMARY_KEYS = Object.freeze(["devices", "allowed", "blocked", "passed"]);
const FLEET_DEVICE_KEYS = Object.freeze(["device_id", "scenario", "expected_code", "passed", "receipt", "fleet_audit"]);
const FLEET_REPLAY_DEVICE_KEYS = Object.freeze([...FLEET_DEVICE_KEYS, "update_error"]);
const FLEET_RECEIPT_KEYS = Object.freeze([
  "version", "device_id", "fleet_id", "policy_id", "policy_sequence", "signing_key_id", "action", "allowed", "code", "reason", "evaluated_at"
]);
const FLEET_UNAVAILABLE_RECEIPT_KEYS = Object.freeze(["version", "device_id", "action", "allowed", "code", "reason", "evaluated_at"]);
const FLEET_AUDIT_KEYS = Object.freeze(["decision", "input_hash", "policy_version", "rationale", "dimensions_triggered", "certificate", "action_type"]);
const FLEET_CERTIFICATE_KEYS = Object.freeze(["signature", "payload", "public_key_id"]);
const FLEET_LAB_KEYS = Object.freeze([
  "mode", "policy_id", "enrolled_devices", "persisted_audits", "signed_audits", "staged_policy_version", "revoked_policy_version", "stages"
]);
const FLEET_LAB_STAGE_KEYS = Object.freeze(["name", "devices", "allowed", "blocked", "passed", "detail"]);
const RESILIENCE_KEYS = Object.freeze(["version", "mode", "scenarios"]);
const RESILIENCE_SCENARIO_KEYS = Object.freeze(["id", "name", "fault", "expected_code", "safe_response", "proof", "affected_device", "events"]);
const RESILIENCE_EVENT_KEYS = Object.freeze(["at_ms", "kind", "device_id", "status", "code", "message", "policy_sequence"]);
const BOOLEAN_STATE_FIELDS = new Set([
  "gps_fix", "inside_exclusion_zone", "inside_protected_site", "inside_humanitarian_corridor", "positive_identification",
  "proportionality_satisfied", "surrender_observed", "incapacitated_observed", "human_authorization_confirmed"
]);
const RECEIPT_STATE_MAXIMUMS = deepFreeze({
  battery_percent: 100,
  altitude_metres: 1_000_000,
  civilian_distance_metres: 10_000_000,
  friendly_distance_metres: 10_000_000,
  wind_speed_metres_per_second: 1_000,
  visibility_metres: 10_000_000
});
const EVIDENCE_TIERS = new Set(["bronze", "silver", "gold", "platinum"]);
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/;
const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const FLEET_ACTIONS = new Set(["land", "loiter", "rtl", "intercept"]);
const MAX_RECEIPT_EVIDENCE_AGE_SECONDS = 604_800;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const MAX_RESILIENCE_TIME_MS = 60_000;
const MAX_FLEET_DEVICES = 500;
const RECORDED_FLEET_DEVICES = RECORDED_GUARDIAN_IDS.length;
const MAX_LAB_STAGES = 64;
export const MAX_RESILIENCE_EVENT_CHARACTERS = 16 * 1024;
export const MAX_RECEIPT_BUNDLE_BYTES = 128 * 1024;
export const MAX_FLEET_EVIDENCE_BYTES = 512 * 1024;
export const MAX_SIMULATOR_STREAM_CHUNKS = 4096;
export const SIMULATOR_FETCH_TIMEOUT_MS = 10_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const parseSimulatorJSON = (
  input,
  label = "simulator evidence",
  { maxBytes = MAX_FLEET_EVIDENCE_BYTES } = {}
) => {
  try {
    return deepFreeze(parseStrictJSON(input, label, { maxBytes }));
  } catch (error) {
    if (error instanceof Error && /duplicate object key/.test(error.message)) {
      throw new Error(`${label} contains duplicate JSON fields`, { cause: error });
    }
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
};

const isPlainObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertPlainObject = (value, label) => {
  if (!isPlainObject(value)) throw new Error(`${label} is invalid`);
};

const assertExactKeys = (value, expected, label) => {
  assertPlainObject(value, label);
  const actual = Reflect.ownKeys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => typeof key !== "string" || key !== wanted[index]) ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor || !("value" in descriptor) || !descriptor.enumerable;
    })
  ) {
    throw new Error(`${label} fields are invalid`);
  }
};

const readDenseDataArray = (value, label, { length, minLength = length, maxLength = length } = {}) => {
  try {
    if (
      !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Number.isSafeInteger(value.length) || value.length < 0 ||
      (length !== undefined && value.length !== length) ||
      (minLength !== undefined && value.length < minLength) ||
      (maxLength !== undefined && value.length > maxLength)
    ) {
      throw new Error();
    }
    const expectedLength = value.length;
    const ownKeys = Reflect.ownKeys(value);
    const expectedKeys = ["length", ...Array.from({ length: expectedLength }, (_, index) => String(index))].sort();
    const sortedKeys = [...ownKeys].sort();
    if (
      sortedKeys.length !== expectedKeys.length ||
      sortedKeys.some((key, index) => typeof key !== "string" || key !== expectedKeys[index])
    ) {
      throw new Error();
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== expectedLength ||
      lengthDescriptor.enumerable || lengthDescriptor.configurable
    ) {
      throw new Error();
    }
    return Array.from({ length: expectedLength }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
      return descriptor.value;
    });
  } catch {
    throw new Error(`${label} is invalid`);
  }
};

const assertString = (value, label, { max = 2048, pattern } = {}) => {
  if (
    typeof value !== "string" || value.length < 1 || value.length > max ||
    !/\S/.test(value) || (pattern && !pattern.test(value))
  ) {
    throw new Error(`${label} is invalid`);
  }
};

const parseUTCNanoseconds = (value, label) => {
  assertString(value, label, { max: 64 });
  const match = RFC3339_UTC.exec(value);
  if (!match) throw new Error(`${label} is invalid`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label} is invalid`);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const epochMilliseconds = date.getTime();
  if (!Number.isFinite(epochMilliseconds)) throw new Error(`${label} is invalid`);
  return BigInt(epochMilliseconds) * 1_000_000n + BigInt(fraction.padEnd(9, "0") || "0");
};

const assertDate = (value, label) => parseUTCNanoseconds(value, label);

const assertNonNegativeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
};

const sameJSONValue = (left, right) => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameJSONValue(value, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameJSONValue(left[key], right[key]));
};

const readonlyMap = (map) => Object.freeze({
  size: map.size,
  get: (key) => map.get(key),
  has: (key) => map.has(key),
  keys: () => map.keys(),
  values: () => map.values(),
  entries: () => map.entries(),
  [Symbol.iterator]: () => map[Symbol.iterator]()
});

const sha256Hex = async (value, cryptoImpl) => {
  if (!cryptoImpl?.subtle) throw new Error("fleet evidence digest verification is unavailable");
  const digest = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const readBoundedBytes = async (response, maxBytes, label, signal) => {
  const reader = response?.body?.getReader?.();
  if (!reader) throw new Error(`${label} body streaming is unavailable`);
  const cancelReader = (reason) => {
    try {
      Promise.resolve(reader.cancel(reason)).catch(() => {});
    } catch {
      // The validation or timeout failure remains authoritative.
    }
  };
  const cancelForAbort = () => cancelReader(signal?.reason);
  signal?.addEventListener?.("abort", cancelForAbort, { once: true });
  const chunks = [];
  let total = 0;
  let chunkCount = 0;
  try {
    if (signal?.aborted) {
      cancelReader(signal.reason);
      throw new Error(`${label} request was aborted`, { cause: signal.reason });
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) {
        cancelReader(`${label} returned an invalid byte stream`);
        throw new Error(`${label} returned an invalid byte stream`);
      }
      chunkCount += 1;
      if (chunkCount > MAX_SIMULATOR_STREAM_CHUNKS) {
        cancelReader(`${label} contains too many chunks`);
        throw new Error(`${label} contains too many chunks`);
      }
      if (value.byteLength > maxBytes - total) {
        cancelReader(`${label} exceeds its size limit`);
        throw new Error(`${label} exceeds its size limit`);
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    signal?.removeEventListener?.("abort", cancelForAbort);
    try {
      reader.releaseLock?.();
    } catch {
      // Reader cleanup cannot replace the authoritative transport failure.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const readBoundedJSONResponse = async (response, {
  maxBytes,
  label = "simulator evidence",
  signal
} = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || typeof label !== "string" || !label) {
    throw new Error("simulator evidence limits are invalid");
  }
  if (!response?.ok) throw new Error(`${label} request failed with ${response?.status ?? "an invalid response"}`);
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new Error(`${label} did not return JSON`);
  }
  const lengthHeader = (response.headers?.get?.("content-length") ?? "").trim();
  if (lengthHeader && !/^\d+$/.test(lengthHeader)) throw new Error(`${label} content length is invalid`);
  const declaredLength = lengthHeader ? Number(lengthHeader) : 0;
  if (!Number.isSafeInteger(declaredLength)) throw new Error(`${label} content length is invalid`);
  if (declaredLength > maxBytes) throw new Error(`${label} exceeds its size limit`);
  const bytes = await readBoundedBytes(response, maxBytes, label, signal);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  return parseSimulatorJSON(text, label, { maxBytes });
};

export const fetchSimulatorJSON = async (url, {
  maxBytes,
  label,
  timeoutMs = SIMULATOR_FETCH_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
} = {}) => {
  if (
    typeof fetchImpl !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS ||
    !Number.isSafeInteger(maxBytes) || maxBytes < 1 || typeof label !== "string" || !label ||
    typeof timers?.setTimeout !== "function" || typeof timers?.clearTimeout !== "function"
  ) {
    throw new Error("simulator evidence transport is unavailable");
  }
  const controller = new AbortController();
  let settled = false;
  let rejectTimeout;
  const timeoutFailure = new Promise((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeout = timers.setTimeout.call(globalThis, () => {
    if (settled) return;
    const error = new Error(`${label} request timed out`);
    rejectTimeout(error);
    controller.abort(error);
  }, timeoutMs);
  const operation = (async () => {
    const response = await fetchImpl(url, {
      cache: "no-cache",
      credentials: "same-origin",
      redirect: "error",
      signal: controller.signal
    });
    return readBoundedJSONResponse(response, { maxBytes, label, signal: controller.signal });
  })();
  try {
    return await Promise.race([operation, timeoutFailure]);
  } finally {
    settled = true;
    timers.clearTimeout.call(globalThis, timeout);
  }
};

const validateReceipt = (receipt) => {
  assertExactKeys(receipt, RECEIPT_KEYS, "receipt");
  const contract = Object.hasOwn(RECEIPT_CONTRACTS, receipt.scenario) ? RECEIPT_CONTRACTS[receipt.scenario] : undefined;
  if (!contract || receipt.version !== "bounder-receipt/v1") throw new Error("receipt scenario or version is invalid");
  if (receipt.rule !== contract.rule || receipt.code !== contract.code || receipt.action !== contract.action || receipt.allowed !== contract.allowed) {
    throw new Error("receipt decision contract is invalid");
  }
  if (receipt.decision_source !== contract.source || receipt.signature_verified !== true) {
    throw new Error("receipt provenance is invalid");
  }
  assertString(receipt.reason, "receipt reason", { max: 1024 });
  assertString(receipt.action, "receipt action", { max: 64, pattern: IDENTIFIER });
  assertString(receipt.subject, "receipt subject", { max: 255 });
  assertString(receipt.policy_id, "receipt policy", { max: 255 });
  assertString(receipt.issuer, "receipt issuer", { max: 255 });
  if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1) throw new Error("receipt sequence is invalid");
  assertDate(receipt.evaluated_at, "receipt evaluation time");
  if (typeof receipt.policy_hash !== "string" || !SHA256.test(receipt.policy_hash)) throw new Error("receipt policy hash is invalid");

  assertExactKeys(receipt.evidence, EVIDENCE_KEYS, "receipt evidence");
  if (!EVIDENCE_TIERS.has(receipt.evidence.tier)) throw new Error("receipt evidence tier is invalid");
  for (const key of ["session_id", "auditor", "auditor_key_id"]) assertString(receipt.evidence[key], `receipt evidence ${key}`, { max: 255 });
  assertDate(receipt.evidence.verified_at, "receipt evidence verification time");
  if (
    !Number.isSafeInteger(receipt.evidence.age_seconds) || receipt.evidence.age_seconds < 0 ||
    receipt.evidence.age_seconds > MAX_RECEIPT_EVIDENCE_AGE_SECONDS
  ) {
    throw new Error("receipt evidence age is invalid");
  }

  assertExactKeys(receipt.state, STATE_KEYS, "receipt state");
  for (const key of STATE_KEYS) {
    const value = receipt.state[key];
    if (BOOLEAN_STATE_FIELDS.has(key)) {
      if (typeof value !== "boolean") throw new Error(`receipt state ${key} is invalid`);
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > RECEIPT_STATE_MAXIMUMS[key]) {
      throw new Error(`receipt state ${key} is invalid`);
    }
  }
  if (contract.state && receipt.state[contract.state[0]] !== contract.state[1]) throw new Error("receipt trigger state is invalid");

  assertExactKeys(receipt.adapter, ADAPTER_KEYS, "receipt adapter");
  if (receipt.adapter.command_authorized !== receipt.allowed || receipt.adapter.command_sent !== false) {
    throw new Error("receipt adapter authority is invalid");
  }
  assertString(receipt.adapter.output, "receipt adapter output");
  return receipt;
};

export const validateReceiptBundle = (bundle) => {
  assertExactKeys(bundle, ["version", "engine", "generated_at", "receipts"], "receipt bundle");
  if (bundle.version !== "bounder-receipt-bundle/v1" || bundle.engine !== "bounder-io/interlock") {
    throw new Error("receipt bundle metadata is invalid");
  }
  assertDate(bundle.generated_at, "receipt bundle generation time");
  const receiptValues = readDenseDataArray(bundle.receipts, "receipt bundle scenarios", { length: SIMULATOR_SCENARIOS.length });
  const receipts = new Map();
  for (const [index, receipt] of receiptValues.entries()) {
    validateReceipt(receipt);
    if (receipts.has(receipt.scenario)) throw new Error("receipt scenario is duplicated");
    if (receipt.scenario !== SIMULATOR_SCENARIOS[index]) throw new Error("receipt scenario order is invalid");
    receipts.set(receipt.scenario, receipt);
  }
  if (SIMULATOR_SCENARIOS.some((scenario) => !receipts.has(scenario))) throw new Error("receipt bundle is incomplete");

  const baseline = receipts.get("safe");
  for (const key of STATE_KEYS) {
    if (baseline.state[key] !== SAFE_RECEIPT_STATE[key]) throw new Error("receipt safe baseline state is invalid");
  }
  const generatedAt = parseUTCNanoseconds(bundle.generated_at, "receipt bundle generation time");
  for (const receipt of receipts.values()) {
    for (const key of ["subject", "policy_id", "issuer", "sequence"]) {
      if (receipt[key] !== baseline[key]) throw new Error("receipt bundle provenance is inconsistent");
    }
    for (const key of ["session_id", "auditor", "auditor_key_id"]) {
      if (receipt.evidence[key] !== baseline.evidence[key]) throw new Error("receipt bundle evidence provenance is inconsistent");
    }
    const evaluatedAt = parseUTCNanoseconds(receipt.evaluated_at, "receipt evaluation time");
    const verifiedAt = parseUTCNanoseconds(receipt.evidence.verified_at, "receipt evidence verification time");
    if (
      generatedAt < evaluatedAt || evaluatedAt < verifiedAt ||
      evaluatedAt - verifiedAt !== BigInt(receipt.evidence.age_seconds) * NANOSECONDS_PER_SECOND
    ) {
      throw new Error("receipt evidence time is inconsistent");
    }
    const changedState = RECEIPT_CONTRACTS[receipt.scenario].state?.[0];
    for (const key of STATE_KEYS) {
      if (key !== changedState && receipt.state[key] !== baseline.state[key]) throw new Error("receipt bundle state is inconsistent");
    }
  }
  for (const receipt of receipts.values()) deepFreeze(receipt);
  deepFreeze(bundle);
  return readonlyMap(receipts);
};

const validateFleetDevice = (device, fleetID) => {
  const replayUpdate = Object.hasOwn(device ?? {}, "update_error");
  assertExactKeys(device, replayUpdate ? FLEET_REPLAY_DEVICE_KEYS : FLEET_DEVICE_KEYS, "fleet device");
  const receipt = device.receipt;
  const audit = device.fleet_audit;
  assertString(device.device_id, "fleet device ID", { max: 255 });
  assertString(device.scenario, "fleet device scenario", { max: 255 });
  assertString(device.expected_code, "fleet expected code", { max: 64, pattern: IDENTIFIER });
  const recordedContract = RECORDED_FLEET_CONTRACTS[device.device_id];
  if (!recordedContract || device.scenario !== recordedContract[0] || device.expected_code !== recordedContract[1]) {
    throw new Error("fleet device contract is invalid");
  }
  if (device.passed !== true || !isPlainObject(receipt) || receipt.device_id !== device.device_id || receipt.code !== device.expected_code) {
    throw new Error("fleet device evidence is invalid");
  }
  const requiresReplayUpdate = device.device_id === "bounder-india";
  if (replayUpdate !== requiresReplayUpdate) throw new Error("fleet update error is inconsistent");
  if (requiresReplayUpdate) {
    assertString(device.update_error, "fleet update error", { max: 2048 });
    if (device.update_error !== "policy sequence has already been accepted") throw new Error("fleet update error is inconsistent");
  }
  const unavailable = receipt?.code === "policy_unavailable";
  assertExactKeys(receipt, unavailable ? FLEET_UNAVAILABLE_RECEIPT_KEYS : FLEET_RECEIPT_KEYS, "fleet receipt");
  if (receipt.version !== "bounder-creedspace-receipt/v1" || receipt.allowed !== (receipt.code === "allowed")) throw new Error("fleet receipt is invalid");
  for (const key of ["action", "code", "reason", "evaluated_at"]) assertString(receipt[key], `fleet receipt ${key}`, { max: 2048 });
  if (!FLEET_ACTIONS.has(receipt.action) || !IDENTIFIER.test(receipt.code)) throw new Error("fleet receipt identifier is invalid");
  assertDate(receipt.evaluated_at, "fleet receipt evaluation time");
  if (unavailable) {
    if (receipt.allowed) throw new Error("fleet unavailable-policy receipt is invalid");
  } else if (
    receipt.fleet_id !== fleetID ||
    typeof receipt.policy_id !== "string" || !SHA256.test(receipt.policy_id) ||
    !Number.isSafeInteger(receipt.policy_sequence) || receipt.policy_sequence < 1 ||
    typeof receipt.signing_key_id !== "string" || receipt.signing_key_id.length < 1
  ) {
    throw new Error("fleet policy receipt is invalid");
  }
  if (receipt.action === "intercept" && receipt.allowed) throw new Error("fleet intercept authority is invalid");

  assertExactKeys(audit, FLEET_AUDIT_KEYS, "fleet audit");
  if (
    audit.action_type !== "physical_interlock" ||
    audit.decision !== (receipt.allowed ? "allow" : "block") || audit.rationale !== receipt.reason ||
    typeof audit.input_hash !== "string" || !HEX_SHA256.test(audit.input_hash) ||
    !sameJSONValue(audit.dimensions_triggered, receipt)
  ) {
    throw new Error("fleet audit evidence is inconsistent");
  }
  const expectedPolicyVersion = `creedspace-bounder-policy/v1#${unavailable ? 0 : receipt.policy_sequence}`;
  if (audit.policy_version !== expectedPolicyVersion) throw new Error("fleet audit policy version is inconsistent");
  const certificate = audit.certificate;
  assertExactKeys(certificate, FLEET_CERTIFICATE_KEYS, "fleet audit certificate");
  assertString(certificate.signature, "fleet audit signature", { max: 88 });
  if (certificate.signature.length !== 88 || !certificate.signature.endsWith("==") || !CANONICAL_BASE64.test(certificate.signature)) {
    throw new Error("fleet audit signature is invalid");
  }
  if (certificate.public_key_id !== "bounder_lab_guardian") throw new Error("fleet audit key is invalid");
  assertString(certificate.payload, "fleet audit payload", { max: 16 * 1024 });
  let certified;
  try {
    certified = parseSimulatorJSON(certificate.payload, "fleet audit certificate payload", { maxBytes: 16 * 1024 });
  } catch (error) {
    if (error instanceof Error && /duplicate JSON fields/.test(error.message)) throw error;
    throw new Error("fleet audit payload is invalid", { cause: error });
  }
  if (!sameJSONValue(certified, receipt)) throw new Error("fleet audit certificate is inconsistent");
  if (certificate.payload !== JSON.stringify(receipt)) throw new Error("fleet audit certificate serialization is inconsistent");
  return device;
};

export const deriveFleetSummary = (devices) => {
  const deviceValues = readDenseDataArray(devices, "fleet devices", { minLength: 1, maxLength: MAX_FLEET_DEVICES });
  let allowed = 0;
  let passed = 0;
  for (const device of deviceValues) {
    if (!isPlainObject(device) || !isPlainObject(device.receipt) || typeof device.receipt.allowed !== "boolean" || typeof device.passed !== "boolean") {
      throw new Error("fleet device summary input is invalid");
    }
    allowed += Number(device.receipt.allowed);
    passed += Number(device.passed);
  }
  return Object.freeze({ devices: deviceValues.length, allowed, blocked: deviceValues.length - allowed, passed });
};

const validateFleetLab = (lab, deviceCount) => {
  assertExactKeys(lab, FLEET_LAB_KEYS, "fleet laboratory evidence");
  if (lab.mode !== "real-fleet-postgresql") throw new Error("fleet laboratory mode is invalid");
  for (const key of ["policy_id", "staged_policy_version", "revoked_policy_version"]) {
    assertString(lab[key], `fleet laboratory ${key}`, { max: 255 });
  }
  for (const key of ["enrolled_devices", "persisted_audits", "signed_audits"]) {
    assertNonNegativeInteger(lab[key], `fleet laboratory ${key}`);
  }
  if (lab.enrolled_devices !== deviceCount || lab.signed_audits !== lab.persisted_audits) {
    throw new Error("fleet laboratory totals are inconsistent");
  }
  const stageValues = readDenseDataArray(lab.stages, "fleet laboratory stages", { minLength: 1, maxLength: MAX_LAB_STAGES });
  const names = new Set();
  for (const stage of stageValues) {
    assertExactKeys(stage, FLEET_LAB_STAGE_KEYS, "fleet laboratory stage");
    assertString(stage.name, "fleet laboratory stage name", { max: 255 });
    assertString(stage.detail, "fleet laboratory stage detail", { max: 2048 });
    if (names.has(stage.name) || stage.passed !== true) throw new Error("fleet laboratory stage is invalid");
    names.add(stage.name);
    for (const key of ["devices", "allowed", "blocked"]) assertNonNegativeInteger(stage[key], `fleet laboratory stage ${key}`);
    if (stage.devices > MAX_FLEET_DEVICES || stage.allowed > MAX_FLEET_DEVICES || stage.blocked > MAX_FLEET_DEVICES) {
      throw new Error("fleet laboratory stage totals are invalid");
    }
  }
};

const validateResilienceScenario = (scenario, deviceIDs) => {
  assertExactKeys(scenario, RESILIENCE_SCENARIO_KEYS, "resilience scenario");
  const contract = Object.hasOwn(RESILIENCE_CONTRACTS, scenario.id) ? RESILIENCE_CONTRACTS[scenario.id] : undefined;
  if (!contract || scenario.expected_code !== contract.code) throw new Error("resilience scenario contract is invalid");
  assertString(scenario.name, "resilience name", { max: 160 });
  for (const key of ["fault", "safe_response"]) assertString(scenario[key], `resilience ${key}`, { max: 1024 });
  assertString(scenario.proof, "resilience proof", { max: 2048 });
  assertString(scenario.affected_device, "resilience affected device", { max: 255 });
  if (scenario.affected_device !== "all guardians" && scenario.affected_device !== "six canaries" && !deviceIDs.has(scenario.affected_device)) {
    throw new Error("resilience affected device is invalid");
  }
  if (scenario.affected_device === "six canaries" && deviceIDs.size < 6) throw new Error("resilience canary evidence is incomplete");
  if (scenario.affected_device !== contract.affectedDevice) throw new Error("resilience scenario contract is invalid");
  const eventValues = readDenseDataArray(scenario.events, "resilience events", { length: 4 });
  const kinds = ["baseline", "fault", "decision", "audit"];
  const statuses = ["verified", "fault", "held", "recorded"];
  let previousTime = -1;
  let policySequence;
  eventValues.forEach((event, index) => {
    assertExactKeys(event, RESILIENCE_EVENT_KEYS, "resilience event");
    if (!Number.isSafeInteger(event.at_ms) || event.at_ms <= previousTime || event.at_ms > MAX_RESILIENCE_TIME_MS) {
      throw new Error("resilience event time is invalid");
    }
    if (index === 0 && event.at_ms !== 0) throw new Error("resilience timeline must start at zero");
    if (event.kind !== kinds[index] || event.status !== statuses[index] || event.device_id !== scenario.affected_device) {
      throw new Error("resilience event sequence is invalid");
    }
    assertString(event.code, "resilience event code", { max: 64, pattern: IDENTIFIER });
    assertString(event.message, "resilience event message", { max: 1024 });
    if (!Number.isSafeInteger(event.policy_sequence) || event.policy_sequence < 0) throw new Error("resilience policy sequence is invalid");
    if (policySequence === undefined) policySequence = event.policy_sequence;
    else if (event.policy_sequence !== policySequence) throw new Error("resilience policy sequence is inconsistent");
    previousTime = event.at_ms;
  });
  if (
    eventValues[0].code !== "policy_active" ||
    eventValues[1].code !== contract.faultCode ||
    eventValues[2].code !== scenario.expected_code ||
    eventValues.at(-1).code !== "signed_receipt"
  ) {
    throw new Error("resilience decision or audit result is invalid");
  }
  return scenario;
};

export const validateFleetEvidence = async (evidence, cryptoImpl = globalThis.crypto) => {
  assertExactKeys(evidence, FLEET_KEYS, "fleet evidence");
  if (evidence.version !== "bounder-fleet-evidence/v1" || evidence.fleet_id !== "relief-fleet") {
    throw new Error("fleet evidence metadata is invalid");
  }
  assertDate(evidence.generated_at, "fleet evidence generation time");
  if (evidence.policy_profile !== "creedspace-bounder-policy/v1") throw new Error("fleet policy profile is invalid");
  const summary = evidence.summary;
  assertExactKeys(summary, FLEET_SUMMARY_KEYS, "fleet evidence summary");
  for (const key of FLEET_SUMMARY_KEYS) assertNonNegativeInteger(summary[key], `fleet evidence summary ${key}`);
  const deviceValues = readDenseDataArray(evidence.devices, "fleet evidence devices", { length: RECORDED_FLEET_DEVICES });
  const deviceIDs = new Set();
  for (const device of deviceValues) {
    validateFleetDevice(device, evidence.fleet_id);
    if (deviceIDs.has(device.device_id)) throw new Error("fleet device evidence is duplicated");
    deviceIDs.add(device.device_id);
  }
  if (RECORDED_GUARDIAN_IDS.some((id) => !deviceIDs.has(id))) throw new Error("fleet device identities are incomplete");
  // Pin the validated digest inputs before yielding to asynchronous Web Crypto.
  for (const device of deviceValues) deepFreeze(device);
  deepFreeze(evidence);
  const digests = await Promise.all(deviceValues.map(({ fleet_audit: audit }) => sha256Hex(audit.certificate.payload, cryptoImpl)));
  if (digests.some((digest, index) => digest !== deviceValues[index].fleet_audit.input_hash)) {
    throw new Error("fleet audit digest is inconsistent");
  }
  const derivedSummary = deriveFleetSummary(evidence.devices);
  if (FLEET_SUMMARY_KEYS.some((key) => summary[key] !== derivedSummary[key])) {
    throw new Error("fleet evidence totals are inconsistent");
  }
  validateFleetLab(evidence.lab, deviceValues.length);

  const resilience = evidence.resilience;
  assertExactKeys(resilience, RESILIENCE_KEYS, "fleet resilience evidence");
  if (resilience.version !== "bounder-resilience-evidence/v1" || resilience.mode !== "deterministic-live-replay") {
    throw new Error("fleet resilience evidence is invalid");
  }
  const expectedIDs = Object.keys(RESILIENCE_CONTRACTS);
  const scenarioValues = readDenseDataArray(resilience.scenarios, "fleet resilience scenarios", { length: expectedIDs.length });
  const foundIDs = new Set();
  for (const scenario of scenarioValues) {
    validateResilienceScenario(scenario, deviceIDs);
    if (foundIDs.has(scenario.id)) throw new Error("fleet resilience scenario is duplicated");
    foundIDs.add(scenario.id);
  }
  if (expectedIDs.some((id) => !foundIDs.has(id))) throw new Error("fleet resilience evidence is incomplete");
  return evidence;
};

export const validateResilienceStreamEvent = (scenario, event, expectedIndex) => {
  if (!scenario || !Array.isArray(scenario.events) || !Number.isSafeInteger(expectedIndex) || expectedIndex < 0) {
    throw new Error("resilience stream state is invalid");
  }
  const expected = scenario.events[expectedIndex];
  if (!expected || !isPlainObject(event)) throw new Error("resilience stream event is unexpected");
  assertExactKeys(event, Object.keys(expected), "resilience stream event");
  const expectedKeys = Object.keys(expected);
  for (const key of expectedKeys) {
    if (event[key] !== expected[key]) throw new Error("resilience stream event is foreign or out of order");
  }
  return event;
};

export const createResilienceStreamSequence = (scenario) => {
  if (!isPlainObject(scenario) || !Array.isArray(scenario.events) || scenario.events.length < 1) {
    throw new Error("resilience stream scenario is invalid");
  }
  let expectedIndex = 0;
  let finished = false;
  return Object.freeze({
    push(event) {
      if (finished) throw new Error("resilience stream has already completed");
      const validated = validateResilienceStreamEvent(scenario, event, expectedIndex);
      expectedIndex += 1;
      return Object.freeze({ event: validated, complete: expectedIndex === scenario.events.length });
    },
    finish() {
      if (finished || expectedIndex !== scenario.events.length) {
        throw new Error("resilience stream ended before its recorded receipt");
      }
      finished = true;
      return true;
    },
    get received() {
      return expectedIndex;
    },
    get complete() {
      return expectedIndex === scenario.events.length;
    }
  });
};

export const resolveAffectedGuardianIDs = (affectedDevice, guardianIDs, aliases = new Map()) => {
  if (!Array.isArray(guardianIDs) || guardianIDs.length === 0 || guardianIDs.some((id) => typeof id !== "string" || !id)) {
    throw new Error("guardian identities are invalid");
  }
  if (new Set(guardianIDs).size !== guardianIDs.length) throw new Error("guardian identities are duplicated");
  if (affectedDevice === "all guardians") return [...guardianIDs];
  if (affectedDevice === "six canaries") {
    const canaries = RECORDED_GUARDIAN_IDS.slice(0, 6).map((recordedID) => {
      const hasAlias = aliases instanceof Map ? aliases.has(recordedID) : Object.hasOwn(aliases ?? {}, recordedID);
      return hasAlias ? (aliases instanceof Map ? aliases.get(recordedID) : aliases[recordedID]) : recordedID;
    });
    if (canaries.some((id) => typeof id !== "string" || !guardianIDs.includes(id)) || new Set(canaries).size !== 6) {
      throw new Error("six canaries are unavailable");
    }
    return canaries;
  }
  const hasAlias = aliases instanceof Map ? aliases.has(affectedDevice) : Object.hasOwn(aliases ?? {}, affectedDevice);
  const mapped = hasAlias ? (aliases instanceof Map ? aliases.get(affectedDevice) : aliases[affectedDevice]) : undefined;
  if (hasAlias && (typeof mapped !== "string" || !mapped)) throw new Error("affected guardian alias is invalid");
  const resolved = hasAlias ? mapped : affectedDevice;
  if (!guardianIDs.includes(resolved)) throw new Error("affected guardian is unknown");
  return [resolved];
};

export const resolveFleetGuardianAliases = (recordedIDs, displayedIDs, bindings = RECORDED_GUARDIAN_ALIASES) => {
  for (const [ids, label] of [[recordedIDs, "recorded"], [displayedIDs, "displayed"]]) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
      throw new Error(`${label} guardian identities are invalid`);
    }
  }
  const aliases = new Map();
  for (const recordedID of recordedIDs) {
    const target = bindings instanceof Map
      ? bindings.get(recordedID)
      : Object.hasOwn(bindings ?? {}, recordedID) ? bindings[recordedID] : undefined;
    if (typeof target !== "string" || !displayedIDs.includes(target)) throw new Error("guardian alias binding is incomplete");
    if ([...aliases.values()].includes(target)) throw new Error("guardian alias binding is ambiguous");
    aliases.set(recordedID, target);
  }
  if (Object.keys(RECORDED_GUARDIAN_ALIASES).some((id) => !aliases.has(id))) throw new Error("guardian alias source set is incomplete");
  return aliases;
};

export const resolveResilienceStreamURL = (configuredURL, baseURL, scenarioID) => {
  if (typeof configuredURL !== "string" || !configuredURL.trim()) return undefined;
  if (!Object.hasOwn(RESILIENCE_CONTRACTS, scenarioID)) throw new Error("resilience stream scenario is unknown");
  const base = new URL(baseURL);
  if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error("resilience stream base URL is not trusted");
  const endpoint = new URL(configuredURL.trim(), base);
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (endpoint.origin !== base.origin || (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback))) {
    throw new Error("resilience stream endpoint is not trusted");
  }
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search) throw new Error("resilience stream endpoint is malformed");
  endpoint.searchParams.set("scenario", scenarioID);
  return endpoint.href;
};
