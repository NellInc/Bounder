import { MAX_VECTOR_BYTES } from "../runtime/policy/primitives.js";
import { parseStrictJSON } from "../runtime/json/policy-json.js";
import { verifyEnvelope } from "../runtime/policy/contracts.js";
import { validateRoundTripEvidence } from "../runtime/policy/roundtrip.js";
import { fetchBoundedJSON } from "../runtime/transport/bounded-json.js";
import { classifyAuthority, createLatestRequestGate } from "../runtime/policy/presentation-state.js";
import { asSentence } from "./text.js";

// Transport errors carry no verification stage. Tag them, non-enumerably as the runtime's
// own stage tags are, so the failure is shown at the receipt step it actually reached.
const atReceiptStage = (error) => {
  const tagged = error instanceof Error ? error : new Error("The recorded round-trip evidence could not be fetched.");
  if (!("verificationStage" in tagged) && Object.isExtensible(tagged)) {
    Object.defineProperty(tagged, "verificationStage", { value: "receipt", enumerable: false });
  }
  return tagged;
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
    const detail = asSentence(error instanceof Error ? error.message : "The vector could not be verified.");
    const unavailable = label === "Unavailable";
    setStatus("rejected", label, unavailable
      ? `${detail} Check your connection, then retry the published example, or inspect a compatible local JSON file.`
      : detail);
    const stage = error instanceof Error && error.verificationStage in steps ? error.verificationStage : "envelope";
    // A transport failure is not a verdict on the bytes: it marks where evidence ran out.
    setStep(stage, unavailable ? "unavailable" : "rejected", unavailable ? "Evidence could not be fetched" : "Verification stopped here");
  };
  // Envelope, signature and policy are settled as soon as the vector verifies, so a later
  // evidence failure can never be reported against the steps that already passed.
  const renderVerifiedContract = (request, verified) => {
    if (!request.isCurrent()) return;
    setStep("envelope", "verified", `${verified.payloadBytes.byteLength} exact signed bytes loaded`);
    setStep("signature", "verified", `Verified with ${verified.envelope.public_key_id}`);
    setStep("policy", "verified", `${verified.policy.constraints.allowed_actions.length} allowed recovery actions; ${verified.policy.source_policies.length} source policies`);
    fields.issuer.textContent = verified.policy.issuer;
    fields.subject.textContent = verified.policy.subject;
    fields.fleet.textContent = verified.policy.fleet_id;
    fields.sequence.textContent = String(verified.policy.sequence);
    fields.key.textContent = verified.envelope.public_key_id;
    fields.policy.textContent = verified.policy.policy_id;
    fields.digest.textContent = verified.payloadSha256;
  };
  const renderVerified = (request, verified, recorded) => {
    if (!request.isCurrent()) return;
    renderVerifiedContract(request, verified);
    setStep(
      "receipt",
      recorded ? "evidenced" : "unmatched",
      recorded ? `Signed Go receipt verified: ${recorded.receipt.code}, sequence ${recorded.receipt.policy_sequence}` : "No signed Go receipt matches this exact policy sequence"
    );
    fields.receipt.textContent = recorded
      ? `${recorded.receipt.code} · ${recorded.receipt.device_id} · policy sequence ${recorded.receipt.policy_sequence}`
      : "No matching recorded receipt";
    const authority = classifyAuthority(verified.validity, now());
    if (authority === "not-yet-valid") {
      setStatus("held", "Signature verified · held", "The policy is validly signed but is not active yet. Bounder would not grant authority.");
    } else if (authority === "expired") {
      setStatus("held", "Signature verified · expired", "The historical vector is authentic. Its policy has expired, so this inspection supplies no current permission.");
    } else {
      setStatus("verified", "Contract verified", "The simulation policy is current at the inspection time. This browser grants no physical authority.");
    }
  };
  const inspectBytes = async (bytes, request) => {
    let verified;
    try {
      const vector = parseStrictJSON(bytes, "signed vector");
      verified = await verifyVector(vector);
    } catch (error) {
      // A browser without Ed25519 WebCrypto has judged nothing: say so rather than "Rejected".
      const unsupported = error instanceof Error && error.verificationStage === "signature" && /cannot verify Ed25519/.test(error.message);
      rejectCurrent(request, error, unsupported ? "Unsupported" : "Rejected");
      return;
    }
    renderVerifiedContract(request, verified);
    let fetched;
    try {
      fetched = await fetchJSON("./data/creedspace-bounder-roundtrip-v1.json", {
        signal: request.signal,
        description: "recorded round-trip evidence"
      });
    } catch (error) {
      rejectCurrent(request, atReceiptStage(error), "Unavailable");
      return;
    }
    try {
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
    // The button stays enabled while it is focused: disabling it would drop keyboard focus to the
    // page body. A second press simply supersedes the first through the request gate.
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
