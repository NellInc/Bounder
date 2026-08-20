import { parseStrictJSON } from "./policy-roundtrip.js";

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_MAX_LIVE_AGE_MS = 15 * 60 * 1000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_FEED_CHUNKS = 4096;
const NORMALIZED_TOKEN = /^[a-z][a-z0-9_]*$/;
const RECEIPT_ACTIONS = new Set(["land", "loiter", "rtl", "intercept"]);
const PLATFORM_CLASSES = new Set([
  "aerial",
  "ground",
  "marine",
  "warehouse",
  "inspection",
  "fixed_machinery"
]);

const parseRFC3339Timestamp = (value) => {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText = "", offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return null;
  }
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const subMillisecondNanoseconds = BigInt(fractionText.padEnd(9, "0").slice(3) || "0");
  return BigInt(milliseconds) * 1_000_000n + subMillisecondNanoseconds;
};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const hasExactKeys = (value, required, optional = []) => {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  if (actual.length < required.length || actual.length > required.length + optional.length) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && actual.every((key) => allowed.has(key));
};

const sameJSONStructure = (left, right) => {
  if (Object.is(left, right)) return true;
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) return false;
  return leftKeys.every((key) => sameJSONStructure(left[key], right[key]));
};

const snapshotAndFreeze = (value) => {
  let snapshot;
  try {
    snapshot = structuredClone(value);
  } catch {
    throw new Error("pilot evidence is not cloneable JSON data");
  }
  const freeze = (candidate) => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return candidate;
    for (const nested of Object.values(candidate)) freeze(nested);
    return Object.freeze(candidate);
  };
  return freeze(snapshot);
};

const digestHex = async (bytes, cryptoImpl) => {
  if (!cryptoImpl?.subtle || typeof cryptoImpl.subtle.digest !== "function") {
    throw new Error("pilot audit hash verification is unavailable");
  }
  const digestBytes = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", bytes));
  return [...digestBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

class FreshnessConfigurationError extends Error {}

const validateFreshnessConfiguration = (now, maxAgeMs) => {
  if (maxAgeMs === undefined) return undefined;
  if (typeof maxAgeMs !== "number" || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    throw new FreshnessConfigurationError("pilot evidence freshness limit is invalid");
  }
  if (typeof now !== "function" && (typeof now !== "number" || !Number.isSafeInteger(now))) {
    throw new FreshnessConfigurationError("pilot evidence clock is invalid");
  }
  return BigInt(maxAgeMs) * 1_000_000n;
};

const sampleFreshnessClock = (now) => {
  let nowValue;
  try {
    nowValue = typeof now === "function" ? now() : now;
  } catch {
    throw new FreshnessConfigurationError("pilot evidence clock is invalid");
  }
  if (typeof nowValue !== "number" || !Number.isSafeInteger(nowValue)) {
    throw new FreshnessConfigurationError("pilot evidence clock is invalid");
  }
  return nowValue;
};

export const validatePilotEvidence = async (
  evidence,
  { cryptoImpl = globalThis.crypto, now = Date.now, maxAgeMs } = {}
) => {
  evidence = snapshotAndFreeze(evidence);
  const maxAgeNanoseconds = validateFreshnessConfiguration(now, maxAgeMs);
  const generatedAt = parseRFC3339Timestamp(evidence?.generated_at);
  if (
    !hasExactKeys(evidence, ["version", "generated_at", "fleet_id", "policy_profile", "summary", "devices"]) ||
    evidence.version !== "bounder-fleet-evidence/v1" ||
    evidence.fleet_id !== "relief-fleet" ||
    evidence.policy_profile !== "creedspace-bounder-policy/v1" ||
    generatedAt === null
  ) {
    throw new Error("pilot evidence metadata is invalid");
  }
  const summary = evidence.summary;
  const platformKeys = isRecord(summary?.platform_counts) ? Object.keys(summary.platform_counts) : [];
  if (
    !hasExactKeys(summary, ["devices", "allowed", "blocked", "passed", "platform_counts"]) ||
    !Number.isSafeInteger(summary.devices) ||
    !Number.isSafeInteger(summary.allowed) ||
    !Number.isSafeInteger(summary.blocked) ||
    !Number.isSafeInteger(summary.passed) ||
    summary.devices < 1 ||
    summary.devices > 500 ||
    summary.allowed < 0 ||
    summary.allowed > summary.devices ||
    summary.blocked < 0 ||
    summary.blocked > summary.devices ||
    summary.passed !== summary.devices ||
    summary.allowed + summary.blocked !== summary.devices ||
    !Array.isArray(evidence.devices) ||
    evidence.devices.length !== summary.devices ||
    platformKeys.length !== PLATFORM_CLASSES.size ||
    platformKeys.some(
      (platform) =>
        !PLATFORM_CLASSES.has(platform) ||
        !Number.isSafeInteger(summary.platform_counts[platform]) ||
        summary.platform_counts[platform] < 0 ||
        summary.platform_counts[platform] > summary.devices
    )
  ) {
    throw new Error("pilot evidence summary is invalid");
  }

  const deviceIDs = new Set();
  const platformCounts = Object.fromEntries([...PLATFORM_CLASSES].map((platform) => [platform, 0]));
  const evaluatedInstants = [];
  let allowed = 0;
  let passed = 0;
  for (const device of evidence.devices) {
    const receipt = device?.receipt;
    const audit = device?.fleet_audit;
    const duplicate = audit?.dimensions_triggered;
    const hasPolicy = receipt?.code !== "policy_unavailable";
    const receiptKeys = hasPolicy
      ? ["version", "device_id", "fleet_id", "policy_id", "policy_sequence", "signing_key_id", "action", "allowed", "code", "reason", "evaluated_at"]
      : ["version", "device_id", "action", "allowed", "code", "reason", "evaluated_at"];
    const evaluatedAt = parseRFC3339Timestamp(receipt?.evaluated_at);
    if (
      !hasExactKeys(device, ["device_id", "platform_class", "scenario", "expected_code", "passed", "receipt", "fleet_audit"], ["update_error"]) ||
      typeof device?.device_id !== "string" ||
      device.device_id.length < 1 ||
      device.device_id.length > 255 ||
      !PLATFORM_CLASSES.has(device.platform_class) ||
      typeof device.scenario !== "string" ||
      device.scenario.length < 1 ||
      device.scenario.length > 255 ||
      device.scenario !== device.scenario.trim() ||
      typeof device.expected_code !== "string" ||
      device.expected_code.length > 64 ||
      !NORMALIZED_TOKEN.test(device.expected_code) ||
      typeof device.passed !== "boolean" ||
      (Object.hasOwn(device, "update_error") &&
        (typeof device.update_error !== "string" ||
          device.update_error.length < 1 ||
          device.update_error.length > 1024 ||
          device.update_error !== device.update_error.trim())) ||
      typeof receipt?.action !== "string" ||
      !RECEIPT_ACTIONS.has(receipt.action) ||
      typeof receipt.code !== "string" ||
      receipt.code.length > 64 ||
      !NORMALIZED_TOKEN.test(receipt.code) ||
      typeof receipt?.reason !== "string" ||
      receipt.reason.length < 1 ||
      receipt.reason.length > 1024 ||
      receipt.reason !== receipt.reason.trim() ||
      typeof receipt.allowed !== "boolean" ||
      receipt.allowed !== (receipt.code === "allowed") ||
      (receipt.action === "intercept" && receipt.allowed) ||
      receipt.version !== "bounder-creedspace-receipt/v1" ||
      receipt.device_id !== device.device_id ||
      evaluatedAt === null ||
      evaluatedAt > generatedAt ||
      !hasExactKeys(audit, ["decision", "input_hash", "policy_version", "rationale", "dimensions_triggered", "action_type"]) ||
      audit?.action_type !== "physical_interlock" ||
      !/^[0-9a-f]{64}$/.test(audit.input_hash) ||
      audit.decision !== (receipt.allowed ? "allow" : "block") ||
      audit.rationale !== receipt.reason ||
      typeof audit.policy_version !== "string" ||
      audit.policy_version.length < 1 ||
      audit.policy_version.length > 255
    ) {
      throw new Error("pilot Guardian evidence is invalid");
    }
    if (hasPolicy) {
      if (
        !hasExactKeys(receipt, receiptKeys) ||
        receipt.fleet_id !== evidence.fleet_id ||
        !/^sha256:[0-9a-f]{64}$/.test(receipt.policy_id) ||
        !Number.isSafeInteger(receipt.policy_sequence) ||
        receipt.policy_sequence < 1 ||
        typeof receipt.signing_key_id !== "string" ||
        receipt.signing_key_id.length < 1 ||
        receipt.signing_key_id.length > 255 ||
        receipt.signing_key_id !== receipt.signing_key_id.trim() ||
        audit.policy_version !== `creedspace-bounder-policy/v1#${receipt.policy_sequence}`
      ) {
        throw new Error("pilot policy evidence is invalid");
      }
    } else if (
      !hasExactKeys(receipt, receiptKeys) ||
      receipt.allowed ||
      audit.policy_version !== "creedspace-bounder-policy/v1#0"
    ) {
      throw new Error("pilot unavailable-policy evidence is invalid");
    }
    if (!hasExactKeys(duplicate, receiptKeys) || !sameJSONStructure(receipt, duplicate)) {
      throw new Error("pilot audit evidence is inconsistent");
    }
    const mirroredBytes = new TextEncoder().encode(JSON.stringify(duplicate));
    if (await digestHex(mirroredBytes, cryptoImpl) !== audit.input_hash) {
      throw new Error("pilot audit input hash is inconsistent");
    }
    const derivedPassed = device.expected_code === receipt.code;
    if (device.passed !== derivedPassed) throw new Error("pilot pass evidence is inconsistent");
    if (deviceIDs.has(device.device_id)) throw new Error("pilot Guardian identity is duplicated");
    deviceIDs.add(device.device_id);
    evaluatedInstants.push(evaluatedAt);
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
  if (maxAgeNanoseconds !== undefined) {
    const nowNanoseconds = BigInt(sampleFreshnessClock(now)) * 1_000_000n;
    if (generatedAt > nowNanoseconds || nowNanoseconds - generatedAt > maxAgeNanoseconds) {
      throw new Error("pilot evidence is outside the live freshness window");
    }
    if (evaluatedInstants.some((evaluatedAt) =>
      evaluatedAt > nowNanoseconds || nowNanoseconds - evaluatedAt > maxAgeNanoseconds)) {
      throw new Error("pilot receipt evidence is outside the live freshness window");
    }
  }
  return evidence;
};

const resolveFeedURL = (value, baseURL) => {
  const url = new URL(value, baseURL);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
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

const readBoundedBytes = async (response, signal) => {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("staging feed body streaming is unavailable");
  let cancellationRequested = false;
  const cancelForAbort = () => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    try {
      void Promise.resolve(reader.cancel(signal?.reason)).catch(() => {});
    } catch {
      // The timeout race remains authoritative when cancellation is broken.
    }
  };
  signal?.addEventListener("abort", cancelForAbort, { once: true });
  const cancelAndThrow = (message) => {
    if (!cancellationRequested) {
      cancellationRequested = true;
      try {
        void Promise.resolve(reader.cancel(message)).catch(() => {});
      } catch {
        // The bound error is authoritative even if a broken stream cannot cancel cleanly.
      }
    }
    throw new Error(message);
  };
  const chunks = [];
  let total = 0;
  let chunkCount = 0;
  try {
    if (signal?.aborted) {
      cancelForAbort();
      throw signal.reason instanceof Error ? signal.reason : new Error("staging feed request was aborted");
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) {
        cancelAndThrow("staging feed returned an invalid byte stream");
      }
      chunkCount += 1;
      if (chunkCount > MAX_FEED_CHUNKS) cancelAndThrow("staging feed contains too many chunks");
      const chunk = value;
      total += chunk.byteLength;
      if (total > MAX_FEED_BYTES) {
        cancelAndThrow("staging feed exceeds the size limit");
      }
      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener("abort", cancelForAbort);
    try {
      reader.releaseLock?.();
    } catch {
      // A malformed reader cannot override the authoritative transport result.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const fetchBoundedJSON = async (url, fetchImpl, timeoutMs, expectedDigest = "", cryptoImpl = globalThis.crypto) => {
  if (expectedDigest && !/^sha256:[0-9a-f]{64}$/.test(expectedDigest)) throw new Error("staging feed integrity pin is invalid");
  if (expectedDigest && !cryptoImpl?.subtle) throw new Error("staging feed integrity verification is unavailable");
  const controller = new AbortController();
  const timeoutError = new Error("staging feed request timed out");
  let timeout;
  const operation = (async () => {
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`staging feed request failed with ${response.status}`);
    const contentType = response.headers?.get?.("content-type") ?? "";
    const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
    if (mediaType !== "application/json") throw new Error("staging feed did not return JSON");
    const contentLength = response.headers?.get?.("content-length");
    if (contentLength !== null && contentLength !== undefined) {
      if (typeof contentLength !== "string" || !/^(?:0|[1-9]\d*)$/.test(contentLength)) {
        throw new Error("staging feed content length is invalid");
      }
      const declaredLength = Number(contentLength);
      if (!Number.isSafeInteger(declaredLength)) throw new Error("staging feed content length is invalid");
      if (declaredLength > MAX_FEED_BYTES) throw new Error("staging feed exceeds the size limit");
    }
    const bytes = await readBoundedBytes(response, controller.signal);
    if (expectedDigest) {
      const digestBytes = new Uint8Array(await cryptoImpl.subtle.digest("SHA-256", bytes));
      const actualDigest = `sha256:${[...digestBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      if (actualDigest !== expectedDigest) throw new Error("staging feed integrity check failed");
    }
    try {
      return parseStrictJSON(bytes, "staging feed", { maxBytes: MAX_FEED_BYTES });
    } catch (error) {
      if (error instanceof Error && /not valid UTF-8/.test(error.message)) {
        throw new Error("staging feed is not strict UTF-8");
      }
      if (error instanceof Error && /duplicate object key/.test(error.message)) {
        throw new Error("staging feed contains duplicate JSON fields");
      }
      throw new Error("staging feed is not valid JSON");
    }
  })();
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
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
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
  maxLiveAgeMs = DEFAULT_MAX_LIVE_AGE_MS
} = {}) => {
  if (typeof fetchImpl !== "function") throw new Error("staging feed transport is unavailable");
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error("staging feed timeout is invalid");
  }
  let liveError;
  let liveURLText = "";
  if (typeof configuredURL !== "string") {
    liveError = "live staging feed URL is invalid";
  } else {
    liveURLText = configuredURL.trim();
  }
  if (liveURLText) {
    validateFreshnessConfiguration(now, maxLiveAgeMs);
    try {
      const liveURL = resolveFeedURL(liveURLText, baseURL);
      if (typeof configuredIntegrity !== "string") throw new Error("live staging feed integrity pin is invalid");
      const liveIntegrity = configuredIntegrity.trim();
      if (!liveIntegrity) throw new Error("live staging feed requires a SHA-256 integrity pin");
      const evidence = await validatePilotEvidence(
        await fetchBoundedJSON(liveURL, fetchImpl, timeoutMs, liveIntegrity, cryptoImpl),
        { cryptoImpl, now, maxAgeMs: maxLiveAgeMs }
      );
      return { evidence, source: "live", sourceLabel: "Live staging evidence", warning: "" };
    } catch (error) {
      if (error instanceof FreshnessConfigurationError) throw error;
      liveError = error instanceof Error ? error.message : "live staging feed failed";
    }
  }

  if (typeof fallbackURL !== "string" || !fallbackURL.trim()) throw new Error("recorded staging feed URL is invalid");
  const fallback = resolveFeedURL(fallbackURL.trim(), baseURL);
  const evidence = await validatePilotEvidence(await fetchBoundedJSON(fallback, fetchImpl, timeoutMs), { cryptoImpl });
  return {
    evidence,
    source: "recorded",
    sourceLabel: "Recorded software pilot",
    warning: liveError ? `Live feed unavailable: ${liveError}` : ""
  };
};
