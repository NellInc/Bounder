import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("published Creed Space vector verifies over exact payload bytes", async () => {
  const vector = JSON.parse(await readFile(new URL("data/creedspace-bounder-golden-v1.json", root), "utf8"));
  assert.equal(vector.version, "creedspace-bounder-golden/v1");
  assert.equal(vector.envelope.envelope_version, "creedspace-bounder-envelope/v1");
  assert.equal(vector.envelope.algorithm, "Ed25519");
  const payload = Buffer.from(vector.envelope.payload, "base64");
  const signature = Buffer.from(vector.envelope.signature, "base64");
  const publicKey = Buffer.from(vector.public_key, "base64");
  assert.equal(publicKey.length, 32);
  assert.equal(signature.length, 64);
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const key = createPublicKey({ key: Buffer.concat([spkiPrefix, publicKey]), format: "der", type: "spki" });
  assert.equal(verify(null, payload, key, signature), true);
  const policy = JSON.parse(payload.toString("utf8"));
  assert.equal(policy.version, "creedspace-bounder-policy/v1");
  assert.equal(policy.subject, "bounder-alpha");
  assert.equal(policy.fleet_id, "relief-fleet");
  assert.equal(policy.sequence, 42);
  assert.match(`sha256:${createHash("sha256").update(payload).digest("hex")}`, /^sha256:[0-9a-f]{64}$/);
});

test("published vector maps to a signed canonical Go receipt for the exact policy sequence", async () => {
  const [vector, roundTrip] = await Promise.all([
    readFile(new URL("data/creedspace-bounder-golden-v1.json", root), "utf8").then(JSON.parse),
    readFile(new URL("data/creedspace-bounder-roundtrip-v1.json", root), "utf8").then(JSON.parse)
  ]);
  const policy = JSON.parse(Buffer.from(vector.envelope.payload, "base64").toString("utf8"));
  assert.equal(roundTrip.version, "creedspace-bounder-roundtrip/v1");
  assert.equal(roundTrip.source_payload_sha256, `sha256:${createHash("sha256").update(Buffer.from(vector.envelope.payload, "base64")).digest("hex")}`);
  assert.equal(roundTrip.receipt.device_id, policy.subject);
  assert.equal(roundTrip.receipt.fleet_id, policy.fleet_id);
  assert.equal(roundTrip.receipt.policy_id, policy.policy_id);
  assert.equal(roundTrip.receipt.policy_sequence, policy.sequence);
  assert.equal(roundTrip.receipt.allowed, true);
  assert.deepEqual(JSON.parse(roundTrip.fleet_audit.certificate.payload), roundTrip.receipt);
  assert.equal(roundTrip.fleet_audit.input_hash, createHash("sha256").update(roundTrip.fleet_audit.certificate.payload).digest("hex"));
  const auditPublicKey = Buffer.from(roundTrip.audit_public_key, "base64");
  const auditKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), auditPublicKey]), format: "der", type: "spki" });
  assert.equal(verify(null, Buffer.from(roundTrip.fleet_audit.certificate.payload), auditKey, Buffer.from(roundTrip.fleet_audit.certificate.signature, "base64")), true);
  const schema = JSON.parse(await readFile(new URL("schemas/creedspace-bounder-roundtrip-v1.schema.json", root), "utf8"));
  assert.equal(schema.properties.version.const, "creedspace-bounder-roundtrip/v1");
  assert.equal(schema.properties.request.properties.action.const, "loiter");
  assert.equal(schema.properties.request.properties.state.additionalProperties, false);
  assert.deepEqual(
    new Set(schema.properties.request.properties.state.required),
    new Set(Object.keys(roundTrip.request.state))
  );
  assert.equal(schema.properties.request.properties.evidence.additionalProperties, false);
  assert.equal(schema.properties.audit_public_key.$ref, "#/$defs/base64");
});
