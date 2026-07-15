const panel = document.querySelector("[data-policy-roundtrip]");

if (panel) {
  const sampleButton = panel.querySelector("[data-policy-action='sample']");
  const fileInput = panel.querySelector("[data-policy-file]");
  const status = panel.querySelector("[data-policy-status]");
  const statusLabel = status.querySelector("span");
  const statusMessage = status.querySelector("strong");
  const fields = Object.fromEntries(
    [...panel.querySelectorAll("[data-policy-field]")].map((element) => [element.dataset.policyField, element])
  );
  const steps = Object.fromEntries(
    [...panel.querySelectorAll("[data-policy-step]")].map((element) => [element.dataset.policyStep, element])
  );

  const MAX_VECTOR_BYTES = 128 * 1024;
  const POLICY_VERSION = "creedspace-bounder-policy/v1";
  const ENVELOPE_VERSION = "creedspace-bounder-envelope/v1";

  const setStatus = (state, label, message) => {
    status.dataset.state = state;
    statusLabel.textContent = label;
    statusMessage.textContent = message;
  };

  const setStep = (name, state, message) => {
    const step = steps[name];
    step.dataset.state = state;
    step.querySelector("small").textContent = message;
  };

  const reset = () => {
    setStatus("idle", "Ready", "Choose the published vector or a local compatible file.");
    setStep("envelope", "idle", "Awaiting signed bytes");
    setStep("signature", "idle", "Awaiting Ed25519 verification");
    setStep("policy", "idle", "Awaiting schema checks");
    setStep("receipt", "idle", "Awaiting matching Go evidence");
    for (const field of Object.values(fields)) field.textContent = "Not loaded";
  };

  const decodeBase64 = (value, label) => {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_VECTOR_BYTES * 2) {
      throw new Error(`${label} is missing or too large`);
    }
    let binary;
    try {
      binary = atob(value);
    } catch {
      throw new Error(`${label} is not valid base64`);
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  };

  const digest = async (bytes) => {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };

  const validatePolicy = (policy) => {
    if (!policy || policy.version !== POLICY_VERSION) throw new Error("unsupported policy version");
    for (const key of ["policy_id", "issuer", "subject", "fleet_id", "issued_at", "not_before", "expires_at"]) {
      if (typeof policy[key] !== "string" || policy[key].length === 0) throw new Error(`policy ${key} is invalid`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(policy.policy_id)) throw new Error("policy ID is invalid");
    if (!Number.isSafeInteger(policy.sequence) || policy.sequence < 1) throw new Error("policy sequence is invalid");
    if (!Array.isArray(policy.source_policies) || policy.source_policies.length === 0) throw new Error("source policy provenance is missing");
    if (!policy.constraints || !Array.isArray(policy.constraints.allowed_actions) || policy.constraints.allowed_actions.length === 0) {
      throw new Error("policy constraints are invalid");
    }
    const notBefore = Date.parse(policy.not_before);
    const expiresAt = Date.parse(policy.expires_at);
    if (!Number.isFinite(notBefore) || !Number.isFinite(expiresAt) || expiresAt <= notBefore) {
      throw new Error("policy validity window is invalid");
    }
    return { notBefore, expiresAt };
  };

  const verifyEnvelope = async (vector) => {
    if (!vector || vector.version !== "creedspace-bounder-golden/v1") throw new Error("unsupported vector version");
    const envelope = vector.envelope;
    if (!envelope || envelope.envelope_version !== ENVELOPE_VERSION || envelope.algorithm !== "Ed25519") {
      throw new Error("unsupported signed envelope");
    }
    if (typeof envelope.public_key_id !== "string" || envelope.public_key_id.length === 0) throw new Error("public key ID is missing");
    const payloadBytes = decodeBase64(envelope.payload, "payload");
    const signatureBytes = decodeBase64(envelope.signature, "signature");
    const publicKeyBytes = decodeBase64(vector.public_key, "public key");
    if (payloadBytes.byteLength > MAX_VECTOR_BYTES || signatureBytes.byteLength !== 64 || publicKeyBytes.byteLength !== 32) {
      throw new Error("signed envelope dimensions are invalid");
    }
    setStep("envelope", "verified", `${payloadBytes.byteLength} exact signed bytes loaded`);

    let key;
    try {
      key = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    } catch {
      throw new Error("this browser cannot verify Ed25519 signatures");
    }
    const signatureValid = await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, payloadBytes);
    if (!signatureValid) throw new Error("Ed25519 signature verification failed");
    setStep("signature", "verified", `Verified with ${envelope.public_key_id}`);

    let policy;
    try {
      policy = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
    } catch {
      throw new Error("signed payload is not strict UTF-8 JSON");
    }
    const validity = validatePolicy(policy);
    setStep("policy", "verified", `${policy.constraints.allowed_actions.length} allowed recovery actions; ${policy.source_policies.length} source policies`);
    return { envelope, payloadBytes, policy, validity };
  };

  const findRecordedReceipt = async (policy, payloadBytes) => {
    const response = await fetch("./data/creedspace-bounder-roundtrip-v1.json", { cache: "no-cache", credentials: "same-origin" });
    if (!response.ok) throw new Error("recorded round-trip evidence is unavailable");
    const evidence = await response.json();
    if (evidence.version !== "creedspace-bounder-roundtrip/v1") throw new Error("round-trip evidence version is invalid");
    const payloadDigest = `sha256:${await digest(payloadBytes)}`;
    const receipt = evidence.receipt;
    if (
      evidence.source_payload_sha256 !== payloadDigest ||
      receipt?.device_id !== policy.subject ||
      receipt?.fleet_id !== policy.fleet_id ||
      receipt?.policy_id !== policy.policy_id ||
      receipt?.policy_sequence !== policy.sequence
    ) {
      setStep("receipt", "unmatched", "No signed Go receipt matches this exact policy sequence");
      return undefined;
    }
    const certificate = evidence.fleet_audit?.certificate;
    if (!certificate?.payload || !certificate.signature || !evidence.audit_public_key) throw new Error("signed audit certificate is missing");
    const certifiedReceipt = JSON.parse(certificate.payload);
    if (JSON.stringify(certifiedReceipt) !== JSON.stringify(receipt)) throw new Error("recorded receipt certificate is inconsistent");
    if (evidence.fleet_audit.input_hash !== await digest(new TextEncoder().encode(certificate.payload))) {
      throw new Error("recorded receipt digest is inconsistent");
    }
    const auditKey = await crypto.subtle.importKey(
      "raw",
      decodeBase64(evidence.audit_public_key, "audit public key"),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const auditValid = await crypto.subtle.verify(
      { name: "Ed25519" },
      auditKey,
      decodeBase64(certificate.signature, "audit signature"),
      new TextEncoder().encode(certificate.payload)
    );
    if (!auditValid) throw new Error("signed audit receipt verification failed");
    setStep("receipt", "evidenced", `Signed Go receipt verified: ${receipt.code}, sequence ${receipt.policy_sequence}`);
    return evidence;
  };

  const inspectVector = async (vector) => {
    reset();
    setStatus("working", "Verifying", "Checking exact payload bytes and the Ed25519 signature locally.");
    try {
      const verified = await verifyEnvelope(vector);
      const recorded = await findRecordedReceipt(verified.policy, verified.payloadBytes);
      const payloadDigest = await digest(verified.payloadBytes);
      fields.issuer.textContent = verified.policy.issuer;
      fields.subject.textContent = verified.policy.subject;
      fields.fleet.textContent = verified.policy.fleet_id;
      fields.sequence.textContent = String(verified.policy.sequence);
      fields.key.textContent = verified.envelope.public_key_id;
      fields.policy.textContent = verified.policy.policy_id;
      fields.digest.textContent = `sha256:${payloadDigest}`;
      fields.receipt.textContent = recorded
        ? `${recorded.receipt.code} · ${recorded.receipt.device_id} · policy sequence ${recorded.receipt.policy_sequence}`
        : "No matching recorded receipt";

      const now = Date.now();
      if (now < verified.validity.notBefore) {
        setStatus("held", "Signature verified · held", "The policy is validly signed but is not active yet. Bounder would not grant authority.");
      } else if (now >= verified.validity.expiresAt) {
        setStatus("held", "Signature verified · expired", "The historical vector is authentic, but its authority has expired. Bounder keeps the actuator held.");
      } else {
        setStatus("verified", "Contract verified", "Signed Fleet authority is current. A device guardian may now evaluate local conditions against it.");
      }
    } catch (error) {
      setStatus("rejected", "Rejected", error instanceof Error ? error.message : "The vector could not be verified.");
      const firstIdle = Object.values(steps).find((step) => !step.dataset.state || step.dataset.state === "idle");
      if (firstIdle) {
        firstIdle.dataset.state = "rejected";
        firstIdle.querySelector("small").textContent = "Verification stopped here";
      }
    }
  };

  const loadPublishedExample = async () => {
    sampleButton.disabled = true;
    try {
      const response = await fetch("./data/creedspace-bounder-golden-v1.json", { cache: "no-cache", credentials: "same-origin" });
      if (!response.ok) throw new Error(`published vector request failed with ${response.status}`);
      await inspectVector(await response.json());
    } catch (error) {
      reset();
      setStatus("rejected", "Unavailable", error instanceof Error ? error.message : "The published vector could not be loaded.");
    } finally {
      sampleButton.disabled = false;
    }
  };

  sampleButton.addEventListener("click", loadPublishedExample);
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_VECTOR_BYTES) {
      reset();
      setStatus("rejected", "Rejected", "The local JSON file exceeds the 128 KiB inspection limit.");
      fileInput.value = "";
      return;
    }
    try {
      await inspectVector(JSON.parse(await file.text()));
    } catch {
      reset();
      setStatus("rejected", "Rejected", "The local file is not valid JSON.");
    } finally {
      fileInput.value = "";
    }
  });
}
