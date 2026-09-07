import { ACTIONS, HEX_SHA256, MAX_JSON_DEPTH, MAX_VECTOR_BYTES, RECEIPT_CODE, RECEIPT_KEYS, SHA256, assertBoolean, assertExactKeys, assertSafeInteger, assertString, compareInstants, deepFreeze, equalBytes, isPlainObject, snapshotJSON, toBytes, withStage } from "./primitives.js";
import { TRUSTED_AUDIT_KEY, TRUSTED_FLEET_KEY, decodeBase64, sha256Hex } from "../crypto/encoding.js";
import { ENVELOPE_VERSION, GOLDEN_VERSION, POLICY_VERSION, ROUNDTRIP_VERSION, parseRFC3339, validatePolicy } from "./contracts.js";
import { evaluatePolicyRequest } from "./evaluator.js";
import { parseStrictJSON } from "../json/policy-json.js";
import { validateRequest } from "./request.js";

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

/**
 * Verifies recorded evidence against exact signed source bytes.
 * @returns {Promise<object|undefined>} Frozen bound evidence, or undefined for an unmatched source.
 * @throws {Error} Invalid evidence, tagged with verificationStage="receipt".
 */
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
