import { ACTIONS, CONSTRAINT_KEYS, LEVELS, MAX_VECTOR_BYTES, METTLE_TIERS, POLICY_KEYS, RFC3339, SHA256, assertBoolean, assertExactKeys, assertFiniteNumber, assertSafeInteger, assertString, compareInstants, deepFreeze, equalBytes, immutableBytesProperty, isPlainObject, snapshotJSON, withStage } from "./primitives.js";
import { TRUSTED_FLEET_KEY, decodeBase64, sha256Hex } from "../crypto/encoding.js";
import { parseStrictJSON } from "../json/policy-json.js";

export const POLICY_VERSION = "creedspace-bounder-policy/v1";

export const PROFILE_VERSION = "creedspace-bounder-profile/v1";

export const ENVELOPE_VERSION = "creedspace-bounder-envelope/v1";

export const GOLDEN_VERSION = "creedspace-bounder-golden/v1";

export const ROUNDTRIP_VERSION = "creedspace-bounder-roundtrip/v1";

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
