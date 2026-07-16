const MAX_FEED_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 3500;
const PLATFORM_CLASSES = new Set([
  "aerial",
  "ground",
  "marine",
  "warehouse",
  "inspection",
  "fixed_machinery"
]);

export const validatePilotEvidence = (evidence) => {
  if (!evidence || evidence.version !== "bounder-fleet-evidence/v1" || evidence.fleet_id !== "relief-fleet") {
    throw new Error("pilot evidence metadata is invalid");
  }
  const summary = evidence.summary;
  if (
    !summary ||
    !Number.isInteger(summary.devices) ||
    !Number.isInteger(summary.allowed) ||
    !Number.isInteger(summary.blocked) ||
    !Number.isInteger(summary.passed) ||
    summary.devices < 1 ||
    summary.devices > 500 ||
    summary.passed !== summary.devices ||
    summary.allowed + summary.blocked !== summary.devices ||
    !Array.isArray(evidence.devices) ||
    evidence.devices.length !== summary.devices
  ) {
    throw new Error("pilot evidence summary is invalid");
  }

  const deviceIDs = new Set();
  const platformCounts = Object.fromEntries([...PLATFORM_CLASSES].map((platform) => [platform, 0]));
  let allowed = 0;
  let passed = 0;
  for (const device of evidence.devices) {
    const receipt = device?.receipt;
    const audit = device?.fleet_audit;
    const duplicate = audit?.dimensions_triggered;
    const hasPolicy = receipt?.code !== "policy_unavailable";
    if (
      typeof device.device_id !== "string" ||
      device.device_id.length < 1 ||
      device.device_id.length > 255 ||
      !PLATFORM_CLASSES.has(device.platform_class) ||
      typeof device.scenario !== "string" ||
      typeof device.expected_code !== "string" ||
      typeof receipt?.code !== "string" ||
      typeof receipt.allowed !== "boolean" ||
      receipt.version !== "bounder-creedspace-receipt/v1" ||
      receipt.device_id !== device.device_id ||
      Number.isNaN(Date.parse(receipt.evaluated_at)) ||
      audit?.action_type !== "physical_interlock" ||
      !/^[0-9a-f]{64}$/.test(audit.input_hash) ||
      audit.decision !== (receipt.allowed ? "allow" : "block") ||
      audit.rationale !== receipt.reason ||
      !duplicate
    ) {
      throw new Error("pilot Guardian evidence is invalid");
    }
    if (hasPolicy) {
      if (
        receipt.fleet_id !== evidence.fleet_id ||
        !/^sha256:[0-9a-f]{64}$/.test(receipt.policy_id) ||
        !Number.isSafeInteger(receipt.policy_sequence) ||
        receipt.policy_sequence < 1 ||
        typeof receipt.signing_key_id !== "string" ||
        receipt.signing_key_id.length < 1 ||
        audit.policy_version !== `creedspace-bounder-policy/v1#${receipt.policy_sequence}`
      ) {
        throw new Error("pilot policy evidence is invalid");
      }
    } else if (
      receipt.allowed ||
      "fleet_id" in receipt ||
      "policy_id" in receipt ||
      "policy_sequence" in receipt ||
      "signing_key_id" in receipt ||
      audit.policy_version !== "creedspace-bounder-policy/v1#0"
    ) {
      throw new Error("pilot unavailable-policy evidence is invalid");
    }
    for (const field of ["device_id", "fleet_id", "policy_id", "policy_sequence", "signing_key_id", "action", "allowed", "code", "reason", "evaluated_at"]) {
      if (duplicate[field] !== receipt[field]) throw new Error("pilot audit evidence is inconsistent");
    }
    const derivedPassed = device.expected_code === receipt.code;
    if (device.passed !== derivedPassed) throw new Error("pilot pass evidence is inconsistent");
    if (deviceIDs.has(device.device_id)) throw new Error("pilot Guardian identity is duplicated");
    deviceIDs.add(device.device_id);
    platformCounts[device.platform_class] += 1;
    allowed += Number(receipt.allowed);
    passed += Number(derivedPassed);
  }
  if (summary.allowed !== allowed || summary.blocked !== summary.devices - allowed || summary.passed !== passed) {
    throw new Error("pilot summary totals are inconsistent");
  }
  for (const platform of PLATFORM_CLASSES) {
    if (summary.platform_counts?.[platform] !== platformCounts[platform]) {
      throw new Error("pilot platform counts are inconsistent");
    }
  }
  return evidence;
};

const resolveFeedURL = (value, baseURL) => {
  const url = new URL(value, baseURL);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  const trustedHost =
    url.hostname === "bounder.io" ||
    url.hostname.endsWith(".bounder.io") ||
    url.hostname === "creed.space" ||
    url.hostname.endsWith(".creed.space");
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || (!loopback && !trustedHost)) {
    throw new Error("staging feed must use HTTPS on a Bounder or Creed Space host");
  }
  if (url.username || url.password || url.hash) throw new Error("staging feed URL contains unsupported credentials or fragment");
  return url;
};

const fetchBoundedJSON = async (url, fetchImpl, timeoutMs, expectedDigest = "", cryptoImpl = globalThis.crypto) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`staging feed request failed with ${response.status}`);
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) throw new Error("staging feed did not return JSON");
    const declaredLength = Number(response.headers?.get?.("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) throw new Error("staging feed exceeds the size limit");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FEED_BYTES) throw new Error("staging feed exceeds the size limit");
    if (expectedDigest) {
      if (!/^sha256:[0-9a-f]{64}$/.test(expectedDigest)) throw new Error("staging feed integrity pin is invalid");
      if (!cryptoImpl?.subtle) throw new Error("staging feed integrity verification is unavailable");
      const digestBytes = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", bytes));
      const actualDigest = `sha256:${[...digestBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      if (actualDigest !== expectedDigest) throw new Error("staging feed integrity check failed");
    }
    let decoded;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("staging feed is not strict UTF-8");
    }
    try {
      return JSON.parse(decoded);
    } catch {
      throw new Error("staging feed is not valid JSON");
    }
  } finally {
    clearTimeout(timeout);
  }
};

export const loadPilotEvidence = async ({
  configuredURL = "",
  configuredIntegrity = "",
  fallbackURL = "./data/bounder-staging-pilot.v1.json",
  baseURL = globalThis.location?.href ?? "https://www.bounder.io/simulator.html",
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) => {
  if (typeof fetchImpl !== "function") throw new Error("staging feed transport is unavailable");
  let liveError;
  if (configuredURL.trim()) {
    try {
      const liveURL = resolveFeedURL(configuredURL.trim(), baseURL);
      if (!configuredIntegrity.trim()) throw new Error("live staging feed requires a SHA-256 integrity pin");
      const evidence = validatePilotEvidence(await fetchBoundedJSON(liveURL, fetchImpl, timeoutMs, configuredIntegrity.trim(), cryptoImpl));
      return { evidence, source: "live", sourceLabel: "Live staging evidence", warning: "" };
    } catch (error) {
      liveError = error instanceof Error ? error.message : "live staging feed failed";
    }
  }

  const fallback = resolveFeedURL(fallbackURL, baseURL);
  const evidence = validatePilotEvidence(await fetchBoundedJSON(fallback, fetchImpl, timeoutMs));
  return {
    evidence,
    source: "recorded",
    sourceLabel: "Recorded software pilot",
    warning: liveError ? `Live feed unavailable: ${liveError}` : ""
  };
};
