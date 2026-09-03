export const MAX_VECTOR_BYTES = 128 * 1024;
export const FETCH_TIMEOUT_MS = 10_000;
export const POLICY_VERSION = "creedspace-bounder-policy/v1";
export const PROFILE_VERSION = "creedspace-bounder-profile/v1";
export const ENVELOPE_VERSION = "creedspace-bounder-envelope/v1";
export const GOLDEN_VERSION = "creedspace-bounder-golden/v1";
export const ROUNDTRIP_VERSION = "creedspace-bounder-roundtrip/v1";

export const TRUSTED_FLEET_KEY = Object.freeze({
  id: "creed-fleet-simulation-2026",
  base64: "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw="
});

export const TRUSTED_AUDIT_KEY = Object.freeze({
  id: "bounder-roundtrip-simulation-2026",
  base64: "/RckOFqgx1tk+3jNYC+h2ZH96/drE8WO1wLqyDXp9hg="
});

const MAX_JSON_DEPTH = 64;
const MAX_RESPONSE_CHUNKS = 4096;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const RECEIPT_CODE = /^[a-z][a-z0-9_]*$/;
const ACTIONS = new Set(["land", "loiter", "rtl", "intercept"]);
const LEVELS = new Set(["constitutional", "org", "team", "agent"]);
const METTLE_TIERS = new Set(["", "bronze", "silver", "gold", "platinum"]);
const POLICY_KEYS = [
  "version", "policy_id", "issuer", "subject", "fleet_id", "sequence", "issued_at", "not_before", "expires_at",
  "source_policies", "constraints"
];
const CONSTRAINT_KEYS = [
  "allowed_actions", "require_gps_fix", "require_outside_exclusion_zones", "min_battery_percent", "max_altitude_metres",
  "required_mettle_tier", "max_evidence_age_seconds", "min_civilian_distance_metres", "min_friendly_distance_metres",
  "require_outside_protected_sites", "require_outside_humanitarian_corridors", "max_wind_speed_metres_per_second",
  "min_visibility_metres", "rules_of_engagement_actions", "evidence_only_actions", "require_positive_identification",
  "require_proportionality_satisfied", "prohibit_action_on_surrender", "prohibit_action_on_incapacitated",
  "require_human_authorization"
];
const REQUEST_STATE_KEYS = [
  "gps_fix", "battery_percent", "altitude_metres", "inside_exclusion_zone", "civilian_distance_metres",
  "friendly_distance_metres", "inside_protected_site", "inside_humanitarian_corridor", "wind_speed_metres_per_second",
  "visibility_metres", "positive_identification", "proportionality_satisfied", "surrender_observed",
  "incapacitated_observed", "human_authorization_confirmed"
];
const RECEIPT_KEYS = [
  "version", "device_id", "fleet_id", "policy_id", "policy_sequence", "signing_key_id", "action", "allowed", "code",
  "reason", "evaluated_at"
];

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertExactKeys = (value, expected, label) => {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    throw new Error(`${label} contains missing or unsupported fields`);
  }
};

const assertString = (value, label, { max = MAX_VECTOR_BYTES, pattern } = {}) => {
  if (typeof value !== "string" || value.length === 0 || value.length > max || !/\S/u.test(value) || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid`);
  }
};

const assertFiniteNumber = (value, label, { min = -Infinity, max = Infinity } = {}) => {
  if (typeof value !== "number" || !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
      value < min || value > max) throw new Error(`${label} is invalid`);
};

const assertSafeInteger = (value, label, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} is invalid`);
};

const assertBoolean = (value, label) => {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
};

const hasUnpairedSurrogate = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const toBytes = (value, label = "bytes") => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`${label} are invalid`);
};

const snapshotJSON = (value, label = "value", depth = 0, ancestors = new WeakSet()) => {
  if (depth > MAX_JSON_DEPTH) throw new Error(`${label} exceeds the ${MAX_JSON_DEPTH}-level nesting limit`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error(`${label} contains an invalid number`);
    return value;
  }
  if (typeof value !== "object") throw new Error(`${label} contains a non-JSON value`);
  if (ancestors.has(value)) throw new Error(`${label} contains a cycle`);
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) throw new Error(`${label} contains a non-JSON object`);
  ancestors.add(value);
  try {
    const result = isArray ? [] : {};
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) throw new Error(`${label} contains a symbol key`);
    if (isArray && keys.some((key) => key !== "length" && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
      throw new Error(`${label} contains unsupported array properties`);
    }
    const expectedKeys = isArray ? value.length : keys.length;
    const dataKeys = keys.filter((key) => key !== "length");
    if (isArray && dataKeys.length !== expectedKeys) throw new Error(`${label} contains a sparse array`);
    for (const key of dataKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error(`${label} contains an accessor or hidden field`);
      result[key] = snapshotJSON(descriptor.value, `${label}.${key}`, depth + 1, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
};

const deepFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

const immutableBytesProperty = (target, name, bytes) => {
  const privateBytes = toBytes(bytes, name).slice();
  Object.defineProperty(target, name, {
    enumerable: true,
    configurable: false,
    get: () => privateBytes.slice()
  });
};

const normalizedDecimal = (token) => {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match) return undefined;
  const [, sign, integer, fraction = "", exponent = "0"] = match;
  let digits = `${integer}${fraction}`.replace(/^0+/, "");
  if (digits === "") return "0e0";
  let scale = BigInt(exponent) - BigInt(fraction.length);
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scale += 1n;
  }
  return `${sign}${digits}e${scale}`;
};

export const parseStrictJSON = (input, label = "JSON", { maxBytes = MAX_VECTOR_BYTES } = {}) => {
  assertSafeInteger(maxBytes, "JSON byte limit", { min: 1 });
  let source;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).byteLength > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
    source = input;
  } else {
    const bytes = toBytes(input, label);
    if (bytes.byteLength > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte limit`);
    try {
      source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error(`${label} is not valid UTF-8`);
    }
  }
  if (source.length === 0 || source.charCodeAt(0) === 0xfeff) throw new Error(`${label} is not strict JSON`);

  let offset = 0;
  const fail = (message = "is not strict JSON") => {
    throw new Error(`${label} ${message} at character ${offset}`);
  };
  const whitespace = () => {
    while (source[offset] === " " || source[offset] === "\t" || source[offset] === "\r" || source[offset] === "\n") offset += 1;
  };
  const parseString = () => {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const code = source.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        let value;
        try {
          value = JSON.parse(source.slice(start, offset));
        } catch {
          fail();
        }
        if (hasUnpairedSurrogate(value)) fail("contains an unpaired Unicode surrogate");
        return value;
      }
      if (code < 0x20) fail();
      if (code === 0x5c) {
        offset += 1;
        const escape = source[offset];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(offset + 1, offset + 5))) fail();
          offset += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escape)) fail();
      }
      offset += 1;
    }
    fail("contains an unterminated string");
  };
  const parseValue = (depth) => {
    if (depth > MAX_JSON_DEPTH) fail(`exceeds the ${MAX_JSON_DEPTH}-level nesting limit`);
    whitespace();
    if (source[offset] === '"') return parseString();
    if (source[offset] === "{") {
      offset += 1;
      const result = {};
      const keys = new Set();
      whitespace();
      if (source[offset] === "}") {
        offset += 1;
        return result;
      }
      while (offset < source.length) {
        whitespace();
        if (source[offset] !== '"') fail("has an invalid object key");
        const key = parseString();
        if (keys.has(key)) fail(`contains duplicate object key ${JSON.stringify(key)}`);
        keys.add(key);
        whitespace();
        if (source[offset] !== ":") fail();
        offset += 1;
        const value = parseValue(depth + 1);
        Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
        whitespace();
        if (source[offset] === "}") {
          offset += 1;
          return result;
        }
        if (source[offset] !== ",") fail();
        offset += 1;
      }
      fail("contains an unterminated object");
    }
    if (source[offset] === "[") {
      offset += 1;
      const result = [];
      whitespace();
      if (source[offset] === "]") {
        offset += 1;
        return result;
      }
      while (offset < source.length) {
        result.push(parseValue(depth + 1));
        whitespace();
        if (source[offset] === "]") {
          offset += 1;
          return result;
        }
        if (source[offset] !== ",") fail();
        offset += 1;
      }
      fail("contains an unterminated array");
    }
    for (const [token, value] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(token, offset)) {
        offset += token.length;
        return value;
      }
    }
    const number = source.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (!number) fail();
    offset += number.length;
    const value = Number(number);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      fail("contains a non-finite or unsafe number");
    }
    if (normalizedDecimal(number) !== normalizedDecimal(JSON.stringify(value))) {
      fail("contains a lossy or underflowed number");
    }
    return value;
  };

  const value = parseValue(0);
  whitespace();
  if (offset !== source.length) fail("has trailing content");
  return value;
};

const bytesToBase64 = (bytes) => {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

export const decodeBase64 = (value, label, { maxBytes = MAX_VECTOR_BYTES } = {}) => {
  assertSafeInteger(maxBytes, `${label} byte limit`, { min: 1 });
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (typeof value !== "string" || value.length === 0 || value.length > maxEncodedLength || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical base64`);
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`${label} is not canonical base64`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > maxBytes || bytesToBase64(bytes) !== value) throw new Error(`${label} is not canonical base64`);
  return bytes;
};

export const sha256Hex = async (bytes, cryptoImpl = globalThis.crypto) => {
  if (!cryptoImpl?.subtle) throw new Error("Web Crypto is unavailable");
  const hash = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", toBytes(bytes)));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const equalBytes = (left, right) => {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
};

const daysInMonth = (year, month) => {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

export const parseRFC3339 = (value, label = "timestamp") => {
  if (typeof value !== "string") throw new Error(`${label} is not strict RFC3339`);
  const match = RFC3339.exec(value);
  if (!match) throw new Error(`${label} is not strict RFC3339`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label} is not a valid calendar time`);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const epochSeconds = BigInt(date.getTime() / 1000);
  const fractionNanoseconds = BigInt(fraction.padEnd(9, "0") || "0");
  const epochNanoseconds = epochSeconds * 1_000_000_000n + fractionNanoseconds;
  const milliseconds = Number(epochNanoseconds) / 1_000_000;
  return Object.freeze({ epochSeconds, fraction, fractionNanoseconds, epochNanoseconds, milliseconds });
};

const compareInstants = (left, right) => {
  if (left.epochNanoseconds < right.epochNanoseconds) return -1;
  return Number(left.epochNanoseconds > right.epochNanoseconds);
};

const validateActionArray = (value, label, allowed = ACTIONS, { nonempty = false, max = allowed.size } = {}) => {
  if (!Array.isArray(value) || (nonempty && value.length === 0) || value.length > max) throw new Error(`${label} is invalid`);
  const unique = new Set();
  for (const action of value) {
    if (typeof action !== "string" || !allowed.has(action) || unique.has(action)) throw new Error(`${label} is invalid`);
    unique.add(action);
  }
};

export const validateConstraints = (constraints) => {
  if (!isPlainObject(constraints)) throw new Error("policy constraints must be an object");
  const keys = Reflect.ownKeys(constraints);
  if (!keys.includes("allowed_actions") || keys.some((key) => typeof key !== "string" || !CONSTRAINT_KEYS.includes(key))) {
    throw new Error("policy constraints contain missing or unsupported fields");
  }
  validateActionArray(constraints.allowed_actions, "policy allowed actions", ACTIONS, { nonempty: true });
  for (const key of [
    "require_gps_fix", "require_outside_exclusion_zones", "require_outside_protected_sites", "require_outside_humanitarian_corridors",
    "require_positive_identification", "require_proportionality_satisfied", "prohibit_action_on_surrender",
    "prohibit_action_on_incapacitated", "require_human_authorization"
  ]) {
    if (key in constraints) assertBoolean(constraints[key], `policy constraint ${key}`);
  }
  if ("min_battery_percent" in constraints) assertFiniteNumber(constraints.min_battery_percent, "policy minimum battery", { min: 0, max: 100 });
  const boundedNumbers = {
    max_altitude_metres: 1_000_000,
    min_civilian_distance_metres: 10_000_000,
    min_friendly_distance_metres: 10_000_000,
    max_wind_speed_metres_per_second: 1_000,
    min_visibility_metres: 10_000_000
  };
  for (const [key, max] of Object.entries(boundedNumbers)) {
    if (key in constraints) assertFiniteNumber(constraints[key], `policy constraint ${key}`, { min: 0, max });
  }
  if ("max_evidence_age_seconds" in constraints) {
    assertSafeInteger(constraints.max_evidence_age_seconds, "policy maximum evidence age", { min: 0, max: 604800 });
  }
  if ("required_mettle_tier" in constraints && !METTLE_TIERS.has(constraints.required_mettle_tier)) {
    throw new Error("policy required Mettle tier is invalid");
  }
  if ("rules_of_engagement_actions" in constraints) {
    validateActionArray(constraints.rules_of_engagement_actions, "policy rules of engagement actions");
    if (constraints.rules_of_engagement_actions.some((action) => !constraints.allowed_actions.includes(action))) {
      throw new Error("policy rules of engagement actions must be allowlisted");
    }
  }
  if ("evidence_only_actions" in constraints) {
    validateActionArray(constraints.evidence_only_actions, "policy evidence-only actions", new Set(["intercept"]));
    if (constraints.evidence_only_actions.some((action) => !constraints.allowed_actions.includes(action))) {
      throw new Error("policy evidence-only actions must be allowlisted");
    }
  }
  if ((constraints.require_positive_identification || constraints.require_proportionality_satisfied ||
      constraints.prohibit_action_on_surrender || constraints.prohibit_action_on_incapacitated ||
      constraints.require_human_authorization) && !constraints.rules_of_engagement_actions?.length) {
    throw new Error("policy rules of engagement safeguards require a scoped action");
  }
  return constraints;
};

export const validateProfile = (profile) => {
  assertExactKeys(profile, ["version", "ttl_seconds", "constraints"], "policy profile");
  if (profile.version !== PROFILE_VERSION) throw new Error("unsupported policy profile version");
  assertSafeInteger(profile.ttl_seconds, "policy profile TTL", { min: 30, max: 3600 });
  validateConstraints(profile.constraints);
  return profile;
};

export const validatePolicy = (policy) => {
  assertExactKeys(policy, POLICY_KEYS, "policy");
  if (policy.version !== POLICY_VERSION) throw new Error("unsupported policy version");
  assertString(policy.policy_id, "policy ID", { max: 160, pattern: SHA256 });
  if (policy.issuer !== "creed.space/fleet") throw new Error("policy issuer is invalid");
  assertString(policy.subject, "policy subject", { max: 255 });
  assertString(policy.fleet_id, "policy fleet ID", { max: 255 });
  assertSafeInteger(policy.sequence, "policy sequence", { min: 1 });
  if (!Array.isArray(policy.source_policies) || policy.source_policies.length === 0 || policy.source_policies.length > 64) {
    throw new Error("source policy provenance is missing or exceeds its bound");
  }
  const sourcePolicyIDs = new Set();
  for (const source of policy.source_policies) {
    assertExactKeys(source, ["id", "version", "level"], "source policy");
    assertString(source.id, "source policy ID", { max: 255 });
    assertString(source.version, "source policy version", { max: 64 });
    if (!LEVELS.has(source.level)) throw new Error("source policy level is invalid");
    if (sourcePolicyIDs.has(source.id)) throw new Error("source policy provenance contains a duplicate ID");
    sourcePolicyIDs.add(source.id);
  }
  validateConstraints(policy.constraints);
  const issued = parseRFC3339(policy.issued_at, "policy issued_at");
  const notBefore = parseRFC3339(policy.not_before, "policy not_before");
  const expires = parseRFC3339(policy.expires_at, "policy expires_at");
  if (compareInstants(issued, notBefore) > 0 || compareInstants(notBefore, expires) >= 0) {
    throw new Error("policy validity timestamps are out of order");
  }
  return Object.freeze({
    issuedAt: issued.milliseconds,
    notBefore: notBefore.milliseconds,
    expiresAt: expires.milliseconds,
    issuedAtNanoseconds: issued.epochNanoseconds,
    notBeforeNanoseconds: notBefore.epochNanoseconds,
    expiresAtNanoseconds: expires.epochNanoseconds
  });
};

const withStage = (error, stage) => {
  const staged = error instanceof Error ? error : new Error(String(error));
  if (!("verificationStage" in staged)) Object.defineProperty(staged, "verificationStage", { value: stage, enumerable: false });
  return staged;
};

export const verifyEnvelope = async (vector, { cryptoImpl = globalThis.crypto } = {}) => {
  let vectorSnapshot;
  let envelope;
  let payloadBytes;
  let signatureBytes;
  let publicKeyBytes;
  try {
    vectorSnapshot = snapshotJSON(vector, "golden vector");
    assertExactKeys(vectorSnapshot, ["version", "public_key", "envelope"], "golden vector");
    if (vectorSnapshot.version !== GOLDEN_VERSION) throw new Error("unsupported vector version");
    envelope = vectorSnapshot.envelope;
    assertExactKeys(envelope, ["envelope_version", "algorithm", "payload", "signature", "public_key_id"], "signed envelope");
    if (envelope.envelope_version !== ENVELOPE_VERSION || envelope.algorithm !== "Ed25519") throw new Error("unsupported signed envelope");
    if (envelope.public_key_id !== TRUSTED_FLEET_KEY.id) throw new Error("untrusted Fleet signing key ID");
    payloadBytes = decodeBase64(envelope.payload, "payload", { maxBytes: MAX_VECTOR_BYTES });
    signatureBytes = decodeBase64(envelope.signature, "signature", { maxBytes: 64 });
    publicKeyBytes = decodeBase64(vectorSnapshot.public_key, "public key", { maxBytes: 32 });
    if (signatureBytes.byteLength !== 64 || publicKeyBytes.byteLength !== 32) throw new Error("signed envelope dimensions are invalid");
  } catch (error) {
    throw withStage(error, "envelope");
  }

  try {
    const trustedKeyBytes = decodeBase64(TRUSTED_FLEET_KEY.base64, "trusted Fleet public key", { maxBytes: 32 });
    if (!equalBytes(publicKeyBytes, trustedKeyBytes)) throw new Error("untrusted Fleet public key");
    if (!cryptoImpl?.subtle) throw new Error("this browser cannot verify Ed25519 signatures");
    const key = await cryptoImpl.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    const valid = await cryptoImpl.subtle.verify({ name: "Ed25519" }, key, signatureBytes, payloadBytes);
    if (!valid) throw new Error("Ed25519 signature verification failed");
  } catch (error) {
    if (error instanceof Error && /untrusted|verification failed|cannot verify/.test(error.message)) throw withStage(error, "signature");
    throw withStage(new Error("this browser cannot verify Ed25519 signatures"), "signature");
  }

  try {
    const policy = parseStrictJSON(payloadBytes, "signed payload");
    const validity = validatePolicy(policy);
    const result = {
      envelope: deepFreeze(envelope),
      payloadSha256: `sha256:${await sha256Hex(payloadBytes, cryptoImpl)}`,
      policy: deepFreeze(policy),
      validity
    };
    immutableBytesProperty(result, "payloadBytes", payloadBytes);
    return Object.freeze(result);
  } catch (error) {
    throw withStage(error, "policy");
  }
};

export const sameJSONValue = (left, right, depth = 0) => {
  if (left === right) return true;
  if (depth > MAX_JSON_DEPTH || left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameJSONValue(value, right[index], depth + 1));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && sameJSONValue(left[key], right[key], depth + 1));
};

const validateReceipt = (receipt, label) => {
  assertExactKeys(receipt, RECEIPT_KEYS, label);
  if (receipt.version !== "bounder-creedspace-receipt/v1") throw new Error(`${label} version is invalid`);
  assertString(receipt.device_id, `${label} device ID`, { max: 255 });
  assertString(receipt.fleet_id, `${label} fleet ID`, { max: 255 });
  assertString(receipt.policy_id, `${label} policy ID`, { max: 160, pattern: SHA256 });
  assertSafeInteger(receipt.policy_sequence, `${label} policy sequence`, { min: 1 });
  if (receipt.signing_key_id !== TRUSTED_FLEET_KEY.id) throw new Error(`${label} signing key ID is untrusted`);
  if (!ACTIONS.has(receipt.action)) throw new Error(`${label} action is invalid`);
  assertBoolean(receipt.allowed, `${label} allowed decision`);
  assertString(receipt.code, `${label} code`, { max: 64, pattern: RECEIPT_CODE });
  assertString(receipt.reason, `${label} reason`, { max: 1024 });
  const evaluated = parseRFC3339(receipt.evaluated_at, `${label} evaluated_at`);
  if (receipt.allowed && receipt.code !== "allowed") throw new Error(`${label} allowed decision code is inconsistent`);
  if (!receipt.allowed && receipt.code === "allowed") throw new Error(`${label} held decision code is inconsistent`);
  return evaluated;
};

const validateRequest = (request, { publishedRoundTrip = true } = {}) => {
  assertExactKeys(request, ["action", "state", "evidence"], "round-trip request");
  if (!ACTIONS.has(request.action) || (publishedRoundTrip && request.action !== "loiter")) {
    throw new Error("round-trip request action is invalid");
  }
  assertExactKeys(request.state, REQUEST_STATE_KEYS, "round-trip request state");
  for (const key of [
    "gps_fix", "inside_exclusion_zone", "inside_protected_site", "inside_humanitarian_corridor", "positive_identification",
    "proportionality_satisfied", "surrender_observed", "incapacitated_observed", "human_authorization_confirmed"
  ]) assertBoolean(request.state[key], `round-trip request state ${key}`);
  assertFiniteNumber(request.state.battery_percent, "round-trip battery percentage", { min: 0, max: 100 });
  assertFiniteNumber(request.state.altitude_metres, "round-trip altitude", { min: 0, max: 1_000_000 });
  const boundedState = {
    civilian_distance_metres: 10_000_000,
    friendly_distance_metres: 10_000_000,
    wind_speed_metres_per_second: 1_000,
    visibility_metres: 10_000_000
  };
  for (const [key, max] of Object.entries(boundedState)) {
    assertFiniteNumber(request.state[key], `round-trip request state ${key}`, { min: 0, max });
  }
  assertExactKeys(request.evidence, ["mettle_tier", "verified_at"], "round-trip request evidence");
  if (!METTLE_TIERS.has(request.evidence.mettle_tier) || request.evidence.mettle_tier === "") {
    throw new Error("round-trip Mettle tier is invalid");
  }
  return parseRFC3339(request.evidence.verified_at, "round-trip evidence verified_at");
};

const METTLE_RANK = Object.freeze({ bronze: 1, silver: 2, gold: 3, platinum: 4 });
const decision = (allowed, code, reason) => Object.freeze({ allowed, code, reason });

export const evaluatePolicyRequest = (policy, request, evaluatedAt) => {
  const validity = validatePolicy(policy);
  const verifiedAt = validateRequest(request, { publishedRoundTrip: false });
  const evaluated = typeof evaluatedAt === "string"
    ? parseRFC3339(evaluatedAt, "policy evaluation time")
    : evaluatedAt;
  if (!evaluated || typeof evaluated.epochNanoseconds !== "bigint") throw new Error("policy evaluation time is invalid");
  if (evaluated.epochNanoseconds < validity.notBeforeNanoseconds || evaluated.epochNanoseconds >= validity.expiresAtNanoseconds) {
    return decision(false, "policy_inactive", "the signed policy is not active at the evaluation time");
  }
  const { constraints } = policy;
  const { action, state, evidence } = request;
  if (!constraints.allowed_actions.includes(action)) {
    return decision(false, "action_not_allowed", "the signed policy does not allow this action");
  }
  if (constraints.rules_of_engagement_actions?.includes(action)) {
    if (constraints.prohibit_action_on_surrender && state.surrender_observed) {
      return decision(false, "surrender_protected", "a surrender indication requires the action to remain inhibited");
    }
    if (constraints.prohibit_action_on_incapacitated && state.incapacitated_observed) {
      return decision(false, "incapacitated_person_protected", "an incapacitated person indication requires the action to remain inhibited");
    }
    if (constraints.require_positive_identification && !state.positive_identification) {
      return decision(false, "positive_identification_required", "positive identification has not been confirmed");
    }
    if (constraints.require_proportionality_satisfied && !state.proportionality_satisfied) {
      return decision(false, "proportionality_unconfirmed", "the signed proportionality condition has not been satisfied");
    }
    if (constraints.require_human_authorization && !state.human_authorization_confirmed) {
      return decision(false, "human_authorization_required", "current human authorization is required for this action");
    }
  }
  const requiredTier = constraints.required_mettle_tier;
  if (requiredTier && (METTLE_RANK[evidence.mettle_tier] ?? 0) < (METTLE_RANK[requiredTier] ?? 0)) {
    return decision(false, "assurance_below_minimum", "verified METTLE assurance is below the signed minimum");
  }
  if (constraints.max_evidence_age_seconds > 0) {
    const age = evaluated.epochNanoseconds - verifiedAt.epochNanoseconds;
    if (age > BigInt(constraints.max_evidence_age_seconds) * 1_000_000_000n || age < -60_000_000_000n) {
      return decision(false, "evidence_stale", "verified assurance evidence is missing, stale, or from the future");
    }
  }
  if (constraints.require_gps_fix && !state.gps_fix) {
    return decision(false, "gps_required", "a trusted GPS fix is required");
  }
  if (constraints.require_outside_exclusion_zones && state.inside_exclusion_zone) {
    return decision(false, "inside_exclusion_zone", "local position intersects an exclusion zone");
  }
  if (constraints.min_civilian_distance_metres > 0 && state.civilian_distance_metres < constraints.min_civilian_distance_metres) {
    return decision(false, "civilian_proximity", "civilian distance is below the signed minimum separation");
  }
  if (constraints.min_friendly_distance_metres > 0 && state.friendly_distance_metres < constraints.min_friendly_distance_metres) {
    return decision(false, "friendly_force_proximity", "friendly-force distance is below the signed minimum separation");
  }
  if (constraints.require_outside_protected_sites && state.inside_protected_site) {
    return decision(false, "protected_site", "local position intersects a declared protected site");
  }
  if (constraints.require_outside_humanitarian_corridors && state.inside_humanitarian_corridor) {
    return decision(false, "humanitarian_corridor_protected", "local position intersects an active humanitarian corridor");
  }
  if (constraints.min_battery_percent > 0 && state.battery_percent < constraints.min_battery_percent) {
    return decision(false, "battery_below_minimum", "battery state is below the signed minimum");
  }
  if (constraints.max_altitude_metres > 0 && state.altitude_metres > constraints.max_altitude_metres) {
    return decision(false, "altitude_above_maximum", "altitude is above the signed maximum");
  }
  if (constraints.max_wind_speed_metres_per_second > 0 &&
      state.wind_speed_metres_per_second > constraints.max_wind_speed_metres_per_second) {
    return decision(false, "weather_outside_envelope", "wind speed is above the signed maximum");
  }
  if (constraints.min_visibility_metres > 0 && state.visibility_metres < constraints.min_visibility_metres) {
    return decision(false, "weather_outside_envelope", "visibility is below the signed minimum");
  }
  if (constraints.evidence_only_actions?.includes(action)) {
    return decision(false, "evidence_only_no_actuation", "the action is evaluated for evidence only and can never authorize an actuator");
  }
  return decision(true, "allowed", "signature, policy, and local constraints permit the action");
};

export const validateRoundTripEvidence = async (
  evidence,
  { policy, payloadBytes, vectorBytes, envelope, cryptoImpl = globalThis.crypto } = {}
) => {
  try {
    const evidenceSnapshot = snapshotJSON(evidence, "round-trip evidence");
    const policySnapshot = policy === undefined ? undefined : snapshotJSON(policy, "verified policy");
    const envelopeSnapshot = envelope === undefined ? undefined : snapshotJSON(envelope, "verified envelope");
    const payloadSnapshot = payloadBytes === undefined ? undefined : toBytes(payloadBytes, "verified payload").slice();
    const vectorSnapshot = vectorBytes === undefined ? undefined : toBytes(vectorBytes, "source vector").slice();
    assertExactKeys(
      evidenceSnapshot,
      ["version", "generated_at", "source_vector_sha256", "source_payload_sha256", "request", "receipt", "fleet_audit", "audit_public_key"],
      "round-trip evidence"
    );
    if (evidenceSnapshot.version !== ROUNDTRIP_VERSION) throw new Error("round-trip evidence version is invalid");
    const generated = parseRFC3339(evidenceSnapshot.generated_at, "round-trip generated_at");
    assertString(evidenceSnapshot.source_vector_sha256, "round-trip source vector digest", { pattern: SHA256 });
    assertString(evidenceSnapshot.source_payload_sha256, "round-trip source payload digest", { pattern: SHA256 });
    validateRequest(evidenceSnapshot.request);
    const receiptEvaluated = validateReceipt(evidenceSnapshot.receipt, "round-trip receipt");
    if (evidenceSnapshot.request.action !== evidenceSnapshot.receipt.action) {
      throw new Error("round-trip request and receipt actions are inconsistent");
    }
    if (compareInstants(generated, receiptEvaluated) !== 0) {
      throw new Error("round-trip evidence timestamps are inconsistent");
    }

    const audit = evidenceSnapshot.fleet_audit;
    assertExactKeys(audit, ["decision", "input_hash", "policy_version", "rationale", "dimensions_triggered", "certificate", "action_type"], "fleet audit");
    if (audit.decision !== (evidenceSnapshot.receipt.allowed ? "allow" : "block") || audit.rationale !== evidenceSnapshot.receipt.reason ||
        audit.policy_version !== `${POLICY_VERSION}#${evidenceSnapshot.receipt.policy_sequence}` || audit.action_type !== "physical_interlock") {
      throw new Error("fleet audit decision semantics are inconsistent");
    }
    assertString(audit.policy_version, "fleet audit policy version", { max: 320 });
    assertString(audit.rationale, "fleet audit rationale", { max: 1024 });
    assertString(audit.input_hash, "fleet audit input hash", { pattern: HEX_SHA256 });
    validateReceipt(audit.dimensions_triggered, "fleet audit dimensions receipt");
    if (!sameJSONValue(audit.dimensions_triggered, evidenceSnapshot.receipt)) throw new Error("fleet audit dimensions are inconsistent");

    const certificate = audit.certificate;
    assertExactKeys(certificate, ["signature", "payload", "public_key_id"], "fleet audit certificate");
    if (certificate.public_key_id !== TRUSTED_AUDIT_KEY.id) throw new Error("untrusted round-trip audit key ID");
    assertString(certificate.payload, "fleet audit certificate payload", { max: 16_384 });
    const certifiedReceipt = parseStrictJSON(certificate.payload, "fleet audit certificate payload");
    validateReceipt(certifiedReceipt, "certified receipt");
    if (!sameJSONValue(certifiedReceipt, evidenceSnapshot.receipt)) throw new Error("recorded receipt certificate is inconsistent");
    const certificateBytes = new TextEncoder().encode(certificate.payload);
    if (audit.input_hash !== await sha256Hex(certificateBytes, cryptoImpl)) throw new Error("recorded receipt digest is inconsistent");

    const auditPublicKey = decodeBase64(evidenceSnapshot.audit_public_key, "audit public key", { maxBytes: 32 });
    const auditSignature = decodeBase64(certificate.signature, "audit signature", { maxBytes: 64 });
    if (auditPublicKey.byteLength !== 32 || auditSignature.byteLength !== 64 ||
        !equalBytes(auditPublicKey, decodeBase64(TRUSTED_AUDIT_KEY.base64, "trusted audit public key", { maxBytes: 32 }))) {
      throw new Error("untrusted round-trip audit public key");
    }
    if (!cryptoImpl?.subtle) throw new Error("Web Crypto is unavailable");
    const auditKey = await cryptoImpl.subtle.importKey("raw", auditPublicKey, { name: "Ed25519" }, false, ["verify"]);
    if (!await cryptoImpl.subtle.verify({ name: "Ed25519" }, auditKey, auditSignature, certificateBytes)) {
      throw new Error("signed audit receipt verification failed");
    }

    const validPolicy = policySnapshot && validatePolicy(policySnapshot);
    if (validPolicy && payloadSnapshot) {
      const payloadPolicy = parseStrictJSON(payloadSnapshot, "verified policy payload");
      validatePolicy(payloadPolicy);
      if (!sameJSONValue(payloadPolicy, policySnapshot)) throw new Error("verified policy is disconnected from its signed payload");
    }
    if (payloadSnapshot && envelopeSnapshot) {
      assertExactKeys(envelopeSnapshot, ["envelope_version", "algorithm", "payload", "signature", "public_key_id"], "verified envelope");
      const envelopePayload = decodeBase64(envelopeSnapshot.payload, "verified envelope payload", { maxBytes: MAX_VECTOR_BYTES });
      const envelopeSignature = decodeBase64(envelopeSnapshot.signature, "verified envelope signature", { maxBytes: 64 });
      const trustedFleetKey = decodeBase64(TRUSTED_FLEET_KEY.base64, "trusted Fleet public key", { maxBytes: 32 });
      if (envelopeSnapshot.envelope_version !== ENVELOPE_VERSION || envelopeSnapshot.algorithm !== "Ed25519" ||
          !equalBytes(envelopePayload, payloadSnapshot) || envelopeSnapshot.public_key_id !== TRUSTED_FLEET_KEY.id ||
          envelopeSignature.byteLength !== 64 || trustedFleetKey.byteLength !== 32) {
        throw new Error("verified envelope is disconnected from its signed payload");
      }
      if (!cryptoImpl?.subtle) throw new Error("Web Crypto is unavailable");
      const fleetKey = await cryptoImpl.subtle.importKey("raw", trustedFleetKey, { name: "Ed25519" }, false, ["verify"]);
      if (!await cryptoImpl.subtle.verify({ name: "Ed25519" }, fleetKey, envelopeSignature, payloadSnapshot)) {
        throw new Error("Fleet envelope signature verification failed");
      }
    }
    let sourceVectorBound = false;
    if (vectorSnapshot && envelopeSnapshot) {
      const sourceVector = parseStrictJSON(vectorSnapshot, "source vector", { maxBytes: MAX_VECTOR_BYTES });
      assertExactKeys(sourceVector, ["version", "public_key", "envelope"], "source vector");
      if (sourceVector.version !== GOLDEN_VERSION || sourceVector.public_key !== TRUSTED_FLEET_KEY.base64 ||
          !sameJSONValue(sourceVector.envelope, envelopeSnapshot)) {
        throw new Error("source vector is disconnected from its verified Fleet envelope");
      }
      sourceVectorBound = true;
    }
    const exactPayloadDigest = payloadSnapshot && `sha256:${await sha256Hex(payloadSnapshot, cryptoImpl)}`;
    const exactVectorDigest = sourceVectorBound && `sha256:${await sha256Hex(vectorSnapshot, cryptoImpl)}`;
    const matchesPolicy = validPolicy && exactPayloadDigest && exactVectorDigest &&
      evidenceSnapshot.source_payload_sha256 === exactPayloadDigest &&
      evidenceSnapshot.source_vector_sha256 === exactVectorDigest &&
      evidenceSnapshot.receipt.device_id === policySnapshot.subject &&
      evidenceSnapshot.receipt.fleet_id === policySnapshot.fleet_id &&
      evidenceSnapshot.receipt.policy_id === policySnapshot.policy_id &&
      evidenceSnapshot.receipt.policy_sequence === policySnapshot.sequence &&
      evidenceSnapshot.receipt.signing_key_id === envelopeSnapshot?.public_key_id &&
      policySnapshot.constraints.allowed_actions.includes(evidenceSnapshot.receipt.action);
    if (!matchesPolicy) return undefined;
    const expected = evaluatePolicyRequest(policySnapshot, evidenceSnapshot.request, receiptEvaluated);
    if (expected.allowed !== evidenceSnapshot.receipt.allowed || expected.code !== evidenceSnapshot.receipt.code ||
        expected.reason !== evidenceSnapshot.receipt.reason) {
      throw new Error("recorded receipt contradicts the signed policy evaluation");
    }
    return deepFreeze(evidenceSnapshot);
  } catch (error) {
    throw withStage(error, "receipt");
  }
};

export const fetchBoundedJSON = async (
  url,
  {
    maxBytes = MAX_VECTOR_BYTES,
    timeoutMs = FETCH_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    signal,
    description = "JSON request",
    baseURL = globalThis.document?.baseURI ?? globalThis.location?.href,
    expectedURL,
    expectedOrigin
  } = {}
) => {
  assertSafeInteger(maxBytes, `${description} byte limit`, { min: 1 });
  assertSafeInteger(timeoutMs, `${description} timeout`, { min: 1, max: 60_000 });
  if (typeof fetchImpl !== "function") throw new Error(`${description} cannot be fetched`);
  if (signal !== undefined && (typeof signal?.aborted !== "boolean" || typeof signal?.addEventListener !== "function" ||
      typeof signal?.removeEventListener !== "function")) throw new Error(`${description} abort signal is invalid`);
  let requestURL;
  let requiredURL;
  try {
    requestURL = new URL(url, baseURL);
    requiredURL = new URL(expectedURL ?? requestURL.href, baseURL);
  } catch {
    throw new Error(`${description} URL is invalid`);
  }
  const requiredOrigin = expectedOrigin ?? requiredURL.origin;
  if (requestURL.href !== requiredURL.href || requestURL.origin !== requiredOrigin) {
    throw new Error(`${description} URL or origin is not allowed`);
  }
  if (signal?.aborted) throw new Error(`${description} was aborted`);
  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  let reader;

  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const cancelReader = () => {
    if (!reader) return;
    try {
      void Promise.resolve(reader.cancel()).catch(() => {});
    } catch {
      // Cancellation is best effort. The original abort, timeout, or bound remains authoritative.
    }
  };
  const forwardAbort = () => {
    externallyAborted = true;
    controller.abort(signal?.reason);
    cancelReader();
    rejectAbort(new Error(`${description} was aborted`));
  };
  signal?.addEventListener("abort", forwardAbort, { once: true });

  let rejectTimeout;
  const timeout = new Promise((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    cancelReader();
    rejectTimeout(new Error(`${description} timed out`));
  }, timeoutMs);

  const read = (async () => {
    const response = await fetchImpl(requestURL.href, {
      cache: "no-cache",
      credentials: "same-origin",
      redirect: "error",
      signal: controller.signal
    });
    if (controller.signal.aborted) {
      try {
        void Promise.resolve(response?.body?.cancel?.(controller.signal.reason)).catch(() => {});
      } catch {
        // A late response body is released best effort. The abort or timeout remains authoritative.
      }
      throw new Error(`${description} was aborted`);
    }
    if (!response?.ok) throw new Error(`${description} failed with ${response?.status ?? "an unknown status"}`);
    let responseURL;
    try {
      responseURL = new URL(response.url);
    } catch {
      throw new Error(`${description} response URL is invalid`);
    }
    if (responseURL.href !== requiredURL.href || responseURL.origin !== requiredOrigin) {
      throw new Error(`${description} response URL or origin is not allowed`);
    }
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new Error(`${description} did not return application/json`);
    }
    const contentLength = response.headers?.get?.("content-length");
    if (contentLength !== null && contentLength !== undefined) {
      if (typeof contentLength !== "string" || !/^(?:0|[1-9]\d*)$/.test(contentLength)) {
        throw new Error(`${description} content length is invalid`);
      }
      const declaredLength = Number(contentLength);
      if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
        controller.abort();
        throw new Error(`${description} exceeds the ${maxBytes}-byte limit`);
      }
    }
    if (!response.body?.getReader) throw new Error(`${description} has no readable response body`);
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    let chunkCount = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = toBytes(value, `${description} response`);
        if (chunk.byteLength === 0) {
          controller.abort();
          cancelReader();
          throw new Error(`${description} returned an empty response chunk`);
        }
        chunkCount += 1;
        if (chunkCount > MAX_RESPONSE_CHUNKS) {
          controller.abort();
          cancelReader();
          throw new Error(`${description} exceeds the ${MAX_RESPONSE_CHUNKS}-chunk limit`);
        }
        length += chunk.byteLength;
        if (length > maxBytes) {
          controller.abort();
          cancelReader();
          throw new Error(`${description} exceeds the ${maxBytes}-byte limit`);
        }
        chunks.push(chunk);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // A malformed reader cannot override the authoritative transport result.
      }
      reader = undefined;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const result = { value: deepFreeze(parseStrictJSON(bytes, description, { maxBytes })) };
    immutableBytesProperty(result, "bytes", bytes);
    return Object.freeze(result);
  })();

  try {
    return await Promise.race([read, timeout, aborted]);
  } catch (error) {
    if (timedOut) throw new Error(`${description} timed out`);
    if (externallyAborted) throw new Error(`${description} was aborted`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
};

export const createLatestRequestGate = () => {
  let generation = 0;
  let activeController;
  return {
    begin() {
      activeController?.abort();
      activeController = new AbortController();
      const ownGeneration = ++generation;
      return Object.freeze({
        signal: activeController.signal,
        isCurrent: () => ownGeneration === generation
      });
    },
    cancel() {
      generation += 1;
      activeController?.abort();
      activeController = undefined;
    }
  };
};

export const classifyAuthority = (validity, now = Date.now()) => {
  let nowNanoseconds;
  if (typeof now === "string") nowNanoseconds = parseRFC3339(now, "authority evaluation time").epochNanoseconds;
  else if (typeof now === "bigint") nowNanoseconds = now;
  else if (isPlainObject(now) && typeof now.epochNanoseconds === "bigint") nowNanoseconds = now.epochNanoseconds;
  else if (typeof now === "number" && Number.isFinite(now)) nowNanoseconds = BigInt(Math.round(now * 1_000_000));
  else throw new Error("authority evaluation time is invalid");
  const notBefore = typeof validity?.notBeforeNanoseconds === "bigint"
    ? validity.notBeforeNanoseconds
    : BigInt(Math.round(validity?.notBefore * 1_000_000));
  const expiresAt = typeof validity?.expiresAtNanoseconds === "bigint"
    ? validity.expiresAtNanoseconds
    : BigInt(Math.round(validity?.expiresAt * 1_000_000));
  if (nowNanoseconds < notBefore) return "not-yet-valid";
  if (nowNanoseconds >= expiresAt) return "expired";
  return "current";
};

export const bootstrapPolicyRoundTrip = (
  root = document,
  {
    fetchJSON = fetchBoundedJSON,
    verifyVector = verifyEnvelope,
    validateEvidence = validateRoundTripEvidence,
    now = Date.now
  } = {}
) => {
  const panel = root.querySelector("[data-policy-roundtrip]");
  if (!panel) return undefined;
  const sampleButton = panel.querySelector("[data-policy-action='sample']");
  const fileInput = panel.querySelector("[data-policy-file]");
  const status = panel.querySelector("[data-policy-status]");
  if (!sampleButton || !fileInput || !status) return undefined;
  const statusLabel = status.querySelector("span");
  const statusMessage = status.querySelector("strong");
  if (!statusLabel || !statusMessage) return undefined;
  const fields = Object.fromEntries([...panel.querySelectorAll("[data-policy-field]")].map((element) => [element.dataset.policyField, element]));
  const steps = Object.fromEntries([...panel.querySelectorAll("[data-policy-step]")].map((element) => [element.dataset.policyStep, element]));
  const requests = createLatestRequestGate();

  const setStatus = (state, label, message) => {
    status.dataset.state = state;
    statusLabel.textContent = label;
    statusMessage.textContent = message;
  };
  const setStep = (name, state, message) => {
    const step = steps[name];
    if (!step) return;
    step.dataset.state = state;
    const detail = step.querySelector("small");
    if (detail) detail.textContent = message;
  };
  const reset = () => {
    setStatus("idle", "Ready", "Choose the published vector or a local compatible file.");
    setStep("envelope", "idle", "Awaiting signed bytes");
    setStep("signature", "idle", "Awaiting Ed25519 verification");
    setStep("policy", "idle", "Awaiting schema checks");
    setStep("receipt", "idle", "Awaiting matching Go evidence");
    for (const field of Object.values(fields)) field.textContent = "Not loaded";
  };
  const begin = () => {
    const request = requests.begin();
    reset();
    setStatus("working", "Verifying", "Checking exact payload bytes and the Ed25519 signature locally.");
    return request;
  };
  const rejectCurrent = (request, error, label = "Rejected") => {
    if (!request.isCurrent()) return;
    setStatus("rejected", label, error instanceof Error ? error.message : "The vector could not be verified.");
    const stage = error instanceof Error && error.verificationStage in steps ? error.verificationStage : "envelope";
    setStep(stage, "rejected", "Verification stopped here");
  };
  const renderVerified = (request, verified, recorded) => {
    if (!request.isCurrent()) return;
    setStep("envelope", "verified", `${verified.payloadBytes.byteLength} exact signed bytes loaded`);
    setStep("signature", "verified", `Verified with ${verified.envelope.public_key_id}`);
    setStep("policy", "verified", `${verified.policy.constraints.allowed_actions.length} allowed recovery actions; ${verified.policy.source_policies.length} source policies`);
    setStep(
      "receipt",
      recorded ? "evidenced" : "unmatched",
      recorded ? `Signed Go receipt verified: ${recorded.receipt.code}, sequence ${recorded.receipt.policy_sequence}` : "No signed Go receipt matches this exact policy sequence"
    );
    fields.issuer.textContent = verified.policy.issuer;
    fields.subject.textContent = verified.policy.subject;
    fields.fleet.textContent = verified.policy.fleet_id;
    fields.sequence.textContent = String(verified.policy.sequence);
    fields.key.textContent = verified.envelope.public_key_id;
    fields.policy.textContent = verified.policy.policy_id;
    fields.digest.textContent = verified.payloadSha256;
    fields.receipt.textContent = recorded
      ? `${recorded.receipt.code} · ${recorded.receipt.device_id} · policy sequence ${recorded.receipt.policy_sequence}`
      : "No matching recorded receipt";
    const authority = classifyAuthority(verified.validity, now());
    if (authority === "not-yet-valid") {
      setStatus("held", "Signature verified · held", "The policy is validly signed but is not active yet. Bounder would not grant authority.");
    } else if (authority === "expired") {
      setStatus("held", "Signature verified · expired", "The historical vector is authentic, but its authority has expired. Bounder keeps the actuator held.");
    } else {
      setStatus("verified", "Contract verified", "Signed Fleet authority is current. A device guardian may now evaluate local conditions against it.");
    }
  };
  const inspectBytes = async (bytes, request) => {
    try {
      const vector = parseStrictJSON(bytes, "signed vector");
      const verified = await verifyVector(vector);
      const fetched = await fetchJSON("./data/creedspace-bounder-roundtrip-v1.json", {
        signal: request.signal,
        description: "recorded round-trip evidence"
      });
      const recorded = await validateEvidence(fetched.value, {
        policy: verified.policy,
        payloadBytes: verified.payloadBytes,
        vectorBytes: bytes,
        envelope: verified.envelope
      });
      renderVerified(request, verified, recorded);
    } catch (error) {
      rejectCurrent(request, error);
    }
  };
  const loadPublishedExample = async () => {
    const request = begin();
    sampleButton.disabled = true;
    fileInput.value = "";
    try {
      const fetched = await fetchJSON("./data/creedspace-bounder-golden-v1.json", {
        signal: request.signal,
        description: "published vector request"
      });
      await inspectBytes(fetched.bytes, request);
    } catch (error) {
      rejectCurrent(request, error, "Unavailable");
    } finally {
      if (request.isCurrent()) sampleButton.disabled = false;
    }
  };

  sampleButton.addEventListener("click", loadPublishedExample);
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const request = begin();
    sampleButton.disabled = false;
    try {
      if (!Number.isSafeInteger(file.size) || file.size > MAX_VECTOR_BYTES) {
        throw new Error("The local JSON file exceeds the 128 KiB inspection limit.");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > MAX_VECTOR_BYTES) throw new Error("The local JSON file exceeds the 128 KiB inspection limit.");
      await inspectBytes(bytes, request);
    } catch (error) {
      rejectCurrent(request, error);
    } finally {
      if (request.isCurrent()) fileInput.value = "";
    }
  });
  reset();
  return Object.freeze({ cancel: requests.cancel, inspectBytes, loadPublishedExample });
};
