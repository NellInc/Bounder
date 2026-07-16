const ENVELOPE_VERSION = "bounder-continuity-envelope/v1";
const EVIDENCE_VERSION = "bounder-continuity-evidence/v1";
const EXPECTED_FLEET = "relief-fleet";
const EXPECTED_HOST = "bounder-fleet-continuity-staging.onrender.com";
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_VALIDITY_MS = 30 * 60 * 1000;

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields are invalid`);
  }
};

const decodeBase64 = (value, label) => {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${label} is not canonical base64`);
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`${label} is not canonical base64`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (btoa(binary) !== value) throw new Error(`${label} is not canonical base64`);
  return bytes;
};

const decodeHex = (value, label) => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} is invalid`);
  return Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16));
};

export const validateContinuityEvidence = (evidence, nowMs = Date.now()) => {
  exactKeys(evidence, [
    "version", "fleet_id", "mode", "generated_at", "expires_at", "healthy",
    "device_count", "platform_counts", "policies_verified", "checkpoints_verified",
    "evaluated", "allowed", "held", "signed_audits", "failure_count", "cycle_duration_ms"
  ], "continuity evidence");
  if (evidence.version !== EVIDENCE_VERSION || evidence.fleet_id !== EXPECTED_FLEET || evidence.mode !== "real-fleet-postgresql") {
    throw new Error("continuity evidence metadata is invalid");
  }
  const generatedAt = Date.parse(evidence.generated_at);
  const expiresAt = Date.parse(evidence.expires_at);
  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || generatedAt > nowMs + MAX_FUTURE_SKEW_MS || expiresAt <= nowMs || expiresAt <= generatedAt || expiresAt - generatedAt > MAX_VALIDITY_MS) {
    throw new Error("continuity evidence is stale or has an invalid validity window");
  }
  const counters = ["device_count", "policies_verified", "checkpoints_verified", "evaluated", "allowed", "held", "signed_audits", "failure_count", "cycle_duration_ms"];
  if (counters.some((field) => !Number.isSafeInteger(evidence[field]) || evidence[field] < 0)) {
    throw new Error("continuity evidence counters are invalid");
  }
  if (evidence.device_count !== 100 || evidence.policies_verified !== evidence.device_count || evidence.checkpoints_verified !== evidence.device_count || evidence.evaluated !== evidence.device_count || evidence.allowed + evidence.held !== evidence.evaluated || evidence.failure_count !== 0 || evidence.healthy !== true) {
    throw new Error("continuity evidence does not prove a complete healthy fleet cycle");
  }
  exactKeys(evidence.platform_counts, ["aerial", "ground", "marine", "warehouse", "inspection", "fixed_machinery"], "platform counts");
  const platformTotal = Object.values(evidence.platform_counts).reduce((total, count) => {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("platform count is invalid");
    return total + count;
  }, 0);
  if (platformTotal !== evidence.device_count || evidence.signed_audits !== Object.keys(evidence.platform_counts).length) {
    throw new Error("continuity platform or signed-audit totals are inconsistent");
  }
  return evidence;
};

export const verifyContinuityEnvelope = async ({ envelope, publicKeyHex, publicKeyID, cryptoImpl = globalThis.crypto, nowMs = Date.now() }) => {
  exactKeys(envelope, ["version", "algorithm", "public_key_id", "payload", "signature"], "continuity envelope");
  if (envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== "Ed25519" || envelope.public_key_id !== publicKeyID) {
    throw new Error("continuity envelope metadata is invalid");
  }
  if (!cryptoImpl?.subtle) throw new Error("continuity signature verification is unavailable");
  const payloadBytes = decodeBase64(envelope.payload, "continuity payload");
  const signature = decodeBase64(envelope.signature, "continuity signature");
  if (signature.length !== 64 || payloadBytes.length > MAX_RESPONSE_BYTES) throw new Error("continuity envelope size is invalid");
  const publicKey = await cryptoImpl.subtle.importKey("raw", decodeHex(publicKeyHex, "continuity public key"), { name: "Ed25519" }, false, ["verify"]);
  if (!await cryptoImpl.subtle.verify({ name: "Ed25519" }, publicKey, signature, payloadBytes)) {
    throw new Error("continuity evidence signature is invalid");
  }
  let evidence;
  try {
    evidence = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    throw new Error("continuity payload is not valid JSON");
  }
  return validateContinuityEvidence(evidence, nowMs);
};

const fetchEnvelope = async (url, timeoutMs = 7000) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== EXPECTED_HOST || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/evidence.json") {
    throw new Error("continuity feed URL is not trusted");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(parsed, { cache: "no-store", credentials: "omit", mode: "cors", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) throw new Error(`continuity feed returned ${response.status}`);
    if (!(response.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) throw new Error("continuity feed content type is invalid");
    const declaredLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
    if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("continuity feed is too large");
    const body = await response.text();
    if (new TextEncoder().encode(body).length > MAX_RESPONSE_BYTES) throw new Error("continuity feed is too large");
    return JSON.parse(body);
  } finally {
    clearTimeout(timeout);
  }
};

const renderEvidence = (root, evidence) => {
  root.dataset.state = "verified";
  root.querySelector("[data-continuity-state]").textContent = "Verified live";
  root.querySelector("[data-continuity-state]").setAttribute("aria-label", "Live staging evidence verified");
  root.querySelector("[data-continuity-devices]").textContent = String(evidence.device_count);
  root.querySelector("[data-continuity-policies]").textContent = String(evidence.policies_verified);
  root.querySelector("[data-continuity-checkpoints]").textContent = String(evidence.checkpoints_verified);
  root.querySelector("[data-continuity-decisions]").textContent = `${evidence.allowed} allow / ${evidence.held} hold`;
  root.querySelector("[data-continuity-updated]").textContent = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(new Date(evidence.generated_at));
  root.querySelector("[data-continuity-note]").textContent = "Exact Ed25519 payload verified in this browser. All 100 software Guardians completed policy sync, signed checkpoint verification, and local interlock evaluation.";
};

const renderUnavailable = (root) => {
  root.dataset.state = "unavailable";
  root.querySelector("[data-continuity-state]").textContent = "Recorded proof";
  root.querySelector("[data-continuity-state]").setAttribute("aria-label", "Live staging evidence unavailable, recorded proof remains available");
  for (const selector of ["[data-continuity-devices]", "[data-continuity-policies]", "[data-continuity-checkpoints]", "[data-continuity-decisions]", "[data-continuity-updated]"]) {
    root.querySelector(selector).textContent = "Unavailable";
  }
  root.querySelector("[data-continuity-note]").textContent = "The live staging proof is unavailable or could not be verified. The simulator continues with immutable recorded evidence and does not treat network failure as authority.";
};

const bootstrap = async () => {
  const root = document.querySelector("[data-continuity]");
  if (!root) return;
  if (!new Set(["bounder.io", "www.bounder.io"]).has(window.location.hostname)) {
    renderUnavailable(root);
    return;
  }
  const configuredURL = document.querySelector('meta[name="bounder-continuity-feed"]')?.content || "";
  const publicKeyHex = document.querySelector('meta[name="bounder-continuity-public-key"]')?.content || "";
  const publicKeyID = document.querySelector('meta[name="bounder-continuity-key-id"]')?.content || "";
  try {
    const envelope = await fetchEnvelope(configuredURL);
    renderEvidence(root, await verifyContinuityEnvelope({ envelope, publicKeyHex, publicKeyID }));
  } catch {
    renderUnavailable(root);
  }
};

if (typeof document !== "undefined") bootstrap();
