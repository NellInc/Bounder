// Internal validation and immutable-byte helpers shared by the policy seams.
export const MAX_VECTOR_BYTES = 128 * 1024;

export const MAX_JSON_DEPTH = 64;

export const SHA256 = /^sha256:[0-9a-f]{64}$/;

export const HEX_SHA256 = /^[0-9a-f]{64}$/;

export const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

export const RECEIPT_CODE = /^[a-z][a-z0-9_]*$/;

export const ACTIONS = new Set(["land", "loiter", "rtl", "intercept"]);

export const LEVELS = new Set(["constitutional", "org", "team", "agent"]);

export const METTLE_TIERS = new Set(["", "bronze", "silver", "gold", "platinum"]);

export const POLICY_KEYS = [
  "version", "policy_id", "issuer", "subject", "fleet_id", "sequence", "issued_at", "not_before", "expires_at",
  "source_policies", "constraints"
];

export const CONSTRAINT_KEYS = [
  "allowed_actions", "require_gps_fix", "require_outside_exclusion_zones", "min_battery_percent", "max_altitude_metres",
  "required_mettle_tier", "max_evidence_age_seconds", "min_civilian_distance_metres", "min_friendly_distance_metres",
  "require_outside_protected_sites", "require_outside_humanitarian_corridors", "max_wind_speed_metres_per_second",
  "min_visibility_metres", "rules_of_engagement_actions", "evidence_only_actions", "require_positive_identification",
  "require_proportionality_satisfied", "prohibit_action_on_surrender", "prohibit_action_on_incapacitated",
  "require_human_authorization"
];

export const REQUEST_STATE_KEYS = [
  "gps_fix", "battery_percent", "altitude_metres", "inside_exclusion_zone", "civilian_distance_metres",
  "friendly_distance_metres", "inside_protected_site", "inside_humanitarian_corridor", "wind_speed_metres_per_second",
  "visibility_metres", "positive_identification", "proportionality_satisfied", "surrender_observed",
  "incapacitated_observed", "human_authorization_confirmed"
];

export const RECEIPT_KEYS = [
  "version", "device_id", "fleet_id", "policy_id", "policy_sequence", "signing_key_id", "action", "allowed", "code",
  "reason", "evaluated_at"
];

export const isPlainObject = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const assertExactKeys = (value, expected, label) => {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    throw new Error(`${label} contains missing or unsupported fields`);
  }
};

export const assertString = (value, label, { max = MAX_VECTOR_BYTES, pattern } = {}) => {
  if (typeof value !== "string" || value.length === 0 || value.length > max || !/\S/u.test(value) || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid`);
  }
};

export const assertFiniteNumber = (value, label, { min = -Infinity, max = Infinity } = {}) => {
  if (typeof value !== "number" || !Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
      value < min || value > max) throw new Error(`${label} is invalid`);
};

export const assertSafeInteger = (value, label, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} is invalid`);
};

export const assertBoolean = (value, label) => {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
};

export const hasUnpairedSurrogate = (value) => {
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

export const toBytes = (value, label = "bytes") => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error(`${label} are invalid`);
};

export const snapshotJSON = (value, label = "value", depth = 0, ancestors = new WeakSet()) => {
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

export const deepFreeze = (value, seen = new WeakSet()) => {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

export const immutableBytesProperty = (target, name, bytes) => {
  const privateBytes = toBytes(bytes, name).slice();
  Object.defineProperty(target, name, {
    enumerable: true,
    configurable: false,
    get: () => privateBytes.slice()
  });
};

export const equalBytes = (left, right) => {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
};

export const compareInstants = (left, right) => {
  if (left.epochNanoseconds < right.epochNanoseconds) return -1;
  return Number(left.epochNanoseconds > right.epochNanoseconds);
};

export const withStage = (error, stage) => {
  const staged = error instanceof Error ? error : new Error(String(error));
  if (!("verificationStage" in staged)) Object.defineProperty(staged, "verificationStage", { value: stage, enumerable: false });
  return staged;
};
