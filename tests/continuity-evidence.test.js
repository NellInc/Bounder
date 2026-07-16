import assert from "node:assert/strict";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";
import test from "node:test";

import { validateContinuityEvidence, verifyContinuityEnvelope } from "../continuity-evidence.js";

const now = Date.parse("2026-07-16T12:00:00Z");
const evidence = () => ({
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
});

test("continuity evidence requires a complete, current 100-Guardian cycle", () => {
  assert.equal(validateContinuityEvidence(evidence(), now).held, 85);
  for (const mutation of [
    (value) => { value.healthy = false; },
    (value) => { value.checkpoints_verified = 99; },
    (value) => { value.failure_count = 1; },
    (value) => { value.expires_at = "2026-07-16T11:59:59Z"; },
    (value) => { value.platform_counts.aerial = 16; }
  ]) {
    const changed = evidence();
    mutation(changed);
    assert.throws(() => validateContinuityEvidence(changed, now));
  }
});

test("continuity envelope verifies exact Ed25519 payload bytes against the pinned key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = Buffer.from(JSON.stringify(evidence()));
  const signature = sign(null, payload, privateKey);
  const publicJWK = publicKey.export({ format: "jwk" });
  const publicRaw = Buffer.from(publicJWK.x, "base64url");
  const envelope = {
    version: "bounder-continuity-envelope/v1",
    algorithm: "Ed25519",
    public_key_id: "bounder_lab_guardian",
    payload: payload.toString("base64"),
    signature: signature.toString("base64")
  };
  const verified = await verifyContinuityEnvelope({ envelope, publicKeyHex: publicRaw.toString("hex"), publicKeyID: "bounder_lab_guardian", cryptoImpl: webcrypto, nowMs: now });
  assert.equal(verified.device_count, 100);

  envelope.signature = Buffer.alloc(64).toString("base64");
  await assert.rejects(() => verifyContinuityEnvelope({ envelope, publicKeyHex: publicRaw.toString("hex"), publicKeyID: "bounder_lab_guardian", cryptoImpl: webcrypto, nowMs: now }), /signature is invalid/);
});

test("continuity envelope rejects unknown fields and unpinned identities", async () => {
  const changed = evidence();
  changed.command = "actuate";
  assert.throws(() => validateContinuityEvidence(changed, now), /fields are invalid/);

  const envelope = { version: "bounder-continuity-envelope/v1", algorithm: "Ed25519", public_key_id: "wrong", payload: "e30=", signature: Buffer.alloc(64).toString("base64") };
  await assert.rejects(() => verifyContinuityEnvelope({ envelope, publicKeyHex: "00".repeat(32), publicKeyID: "bounder_lab_guardian", cryptoImpl: webcrypto, nowMs: now }), /metadata is invalid/);
});
