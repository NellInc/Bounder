const ENVELOPE_VERSION = "bounder-continuity-envelope/v1";
const EVIDENCE_VERSION = "bounder-continuity-evidence/v1";
const EXPECTED_FLEET = "relief-fleet";
const EXPECTED_HOST = "bounder-fleet-continuity-staging.onrender.com";
const EXPECTED_ORIGIN = `https://${EXPECTED_HOST}`;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_PAYLOAD_BYTES = 32 * 1024;
const ED25519_SIGNATURE_BYTES = 64;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_VALIDITY_MS = 30 * 60 * 1000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const MAX_JSON_DEPTH = 32;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields are invalid`);
  }
};

const decodeBase64 = (value, label, maxBytes) => {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0) {
    throw new Error(`${label} is not canonical base64`);
  }
  if (value.length > 4 * Math.ceil(maxBytes / 3)) throw new Error(`${label} is too large`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${label} is not canonical base64`);
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const decodedLength = (value.length / 4) * 3 - padding;
  if (decodedLength > maxBytes) throw new Error(`${label} is too large`);
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

const parseUtcTimestamp = (value, label) => {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) throw new Error(`${label} is invalid`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label} is invalid`);
  }
  const millisecondsText = fraction.padEnd(3, "0").slice(0, 3) || "000";
  const milliseconds = Date.parse(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}.${millisecondsText}Z`);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid`);
  const subMillisecondNanoseconds = BigInt(fraction.padEnd(9, "0").slice(3) || "0");
  return Object.freeze({
    milliseconds,
    epochNanoseconds: BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND + subMillisecondNanoseconds
  });
};

const continuityTimestampOrderKey = (value, label) => {
  parseUtcTimestamp(value, label);
  const match = UTC_TIMESTAMP.exec(value);
  const fraction = (match[7] || "").padEnd(9, "0");
  return `${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}${match[6]}${fraction}`;
};

class DuplicateJsonMemberError extends Error {}

const rejectDuplicateJsonMembers = (source) => {
  let index = 0;
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const syntaxError = () => { throw new SyntaxError("invalid JSON"); };
  const skipWhitespace = () => {
    while (index < source.length && /[\t\n\r ]/.test(source[index])) index += 1;
  };
  const readString = () => {
    if (source[index] !== '"') syntaxError();
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '"') {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      if (character === "\\") {
        index += 1;
        if (index >= source.length) syntaxError();
        if (source[index] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(index + 1, index + 5))) syntaxError();
          index += 5;
        } else if ('"\\/bfnrt'.includes(source[index])) {
          index += 1;
        } else {
          syntaxError();
        }
      } else {
        if (source.charCodeAt(index) <= 0x1f) syntaxError();
        index += 1;
      }
    }
    syntaxError();
  };
  const scanValue = (depth) => {
    if (depth > MAX_JSON_DEPTH) syntaxError();
    skipWhitespace();
    const character = source[index];
    if (character === "{") {
      index += 1;
      const names = new Set();
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (index < source.length) {
        skipWhitespace();
        const name = readString();
        if (names.has(name)) throw new DuplicateJsonMemberError();
        names.add(name);
        skipWhitespace();
        if (source[index] !== ":") syntaxError();
        index += 1;
        scanValue(depth + 1);
        skipWhitespace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") syntaxError();
        index += 1;
      }
      syntaxError();
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      while (index < source.length) {
        scanValue(depth + 1);
        skipWhitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") syntaxError();
        index += 1;
      }
      syntaxError();
    }
    if (character === '"') {
      readString();
      return;
    }
    numberPattern.lastIndex = index;
    const number = numberPattern.exec(source);
    if (number) {
      index = numberPattern.lastIndex;
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (source.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    syntaxError();
  };
  scanValue(0);
  skipWhitespace();
  if (index !== source.length) syntaxError();
};

const parseUniqueJson = (source) => {
  rejectDuplicateJsonMembers(source);
  return JSON.parse(source);
};

export const validateContinuityEvidence = (evidence, nowMs = Date.now()) => {
  if (!Number.isSafeInteger(nowMs)) throw new Error("continuity evidence clock is invalid");
  const evidenceFields = [
    "version", "fleet_id", "mode", "generated_at", "expires_at", "healthy",
    "device_count", "platform_counts", "policies_verified", "checkpoints_verified",
    "evaluated", "allowed", "held", "signed_audits", "failure_count", "cycle_duration_ms"
  ];
  exactKeys(evidence, evidenceFields, "continuity evidence");
  const snapshot = { ...evidence };
  exactKeys(snapshot, evidenceFields, "continuity evidence");
  if (snapshot.version !== EVIDENCE_VERSION || snapshot.fleet_id !== EXPECTED_FLEET || snapshot.mode !== "real-fleet-postgresql") {
    throw new Error("continuity evidence metadata is invalid");
  }
  const generatedAt = parseUtcTimestamp(snapshot.generated_at, "continuity generated_at");
  const expiresAt = parseUtcTimestamp(snapshot.expires_at, "continuity expires_at");
  const nowNanoseconds = BigInt(nowMs) * NANOSECONDS_PER_MILLISECOND;
  const validityNanoseconds = expiresAt.epochNanoseconds - generatedAt.epochNanoseconds;
  if (generatedAt.epochNanoseconds > nowNanoseconds + BigInt(MAX_FUTURE_SKEW_MS) * NANOSECONDS_PER_MILLISECOND ||
      expiresAt.epochNanoseconds <= nowNanoseconds || validityNanoseconds <= 0n ||
      validityNanoseconds > BigInt(MAX_VALIDITY_MS) * NANOSECONDS_PER_MILLISECOND) {
    throw new Error("continuity evidence is stale or has an invalid validity window");
  }
  const counters = ["device_count", "policies_verified", "checkpoints_verified", "evaluated", "allowed", "held", "signed_audits", "failure_count", "cycle_duration_ms"];
  if (counters.some((field) => !Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0)) {
    throw new Error("continuity evidence counters are invalid");
  }
  if (BigInt(snapshot.cycle_duration_ms) * NANOSECONDS_PER_MILLISECOND > validityNanoseconds) {
    throw new Error("continuity evidence cycle duration exceeds its validity window");
  }
  if (snapshot.device_count !== 100 || snapshot.policies_verified !== snapshot.device_count || snapshot.checkpoints_verified !== snapshot.device_count || snapshot.evaluated !== snapshot.device_count || snapshot.allowed + snapshot.held !== snapshot.evaluated || snapshot.failure_count !== 0 || snapshot.healthy !== true) {
    throw new Error("continuity evidence does not prove a complete healthy fleet cycle");
  }
  exactKeys(snapshot.platform_counts, ["aerial", "ground", "marine", "warehouse", "inspection", "fixed_machinery"], "platform counts");
  const platformCounts = { ...snapshot.platform_counts };
  const platformTotal = Object.values(platformCounts).reduce((total, count) => {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("platform count is invalid");
    return total + count;
  }, 0);
  if (platformTotal !== snapshot.device_count || snapshot.signed_audits !== Object.keys(platformCounts).length) {
    throw new Error("continuity platform or signed-audit totals are inconsistent");
  }
  return Object.freeze({ ...snapshot, platform_counts: Object.freeze(platformCounts) });
};

export const createContinuityReplayGuard = (initialGeneratedAt = null) => {
  let latestGeneratedAtKey = initialGeneratedAt === null
    ? null
    : continuityTimestampOrderKey(initialGeneratedAt, "continuity replay guard state");
  return Object.freeze({
    accept(evidence) {
      const generatedAtKey = continuityTimestampOrderKey(evidence?.generated_at, "continuity generated_at");
      if (latestGeneratedAtKey !== null && generatedAtKey <= latestGeneratedAtKey) {
        throw new Error("continuity evidence was replayed or rolled back");
      }
      latestGeneratedAtKey = generatedAtKey;
      return evidence;
    }
  });
};

const defaultReplayGuard = createContinuityReplayGuard();

export const verifyContinuityEnvelope = async ({
  envelope,
  publicKeyHex,
  publicKeyID,
  cryptoImpl = globalThis.crypto,
  nowMs,
  clock = Date.now,
  replayGuard = defaultReplayGuard
}) => {
  exactKeys(envelope, ["version", "algorithm", "public_key_id", "payload", "signature"], "continuity envelope");
  if (typeof publicKeyID !== "string" || publicKeyID.trim().length === 0 || envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== "Ed25519" || envelope.public_key_id !== publicKeyID) {
    throw new Error("continuity envelope metadata is invalid");
  }
  if (!cryptoImpl?.subtle) throw new Error("continuity signature verification is unavailable");
  const payloadBytes = decodeBase64(envelope.payload, "continuity payload", MAX_PAYLOAD_BYTES);
  const signature = decodeBase64(envelope.signature, "continuity signature", ED25519_SIGNATURE_BYTES);
  if (signature.length !== ED25519_SIGNATURE_BYTES) throw new Error("continuity envelope size is invalid");
  const publicKey = await cryptoImpl.subtle.importKey("raw", decodeHex(publicKeyHex, "continuity public key"), { name: "Ed25519" }, false, ["verify"]);
  if (!await cryptoImpl.subtle.verify({ name: "Ed25519" }, publicKey, signature, payloadBytes)) {
    throw new Error("continuity evidence signature is invalid");
  }
  let evidence;
  try {
    evidence = parseUniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch (error) {
    if (error instanceof DuplicateJsonMemberError) throw new Error("continuity payload contains duplicate JSON fields");
    throw new Error("continuity payload is not valid JSON");
  }
  if (nowMs === undefined && typeof clock !== "function") throw new Error("continuity evidence clock is invalid");
  const verificationTime = nowMs === undefined ? clock() : nowMs;
  const verified = validateContinuityEvidence(evidence, verificationTime);
  if (!replayGuard || typeof replayGuard.accept !== "function") throw new Error("continuity replay guard is invalid");
  return replayGuard.accept(verified);
};

export const formatEvidenceTime = (value) => new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short"
}).format(new Date(parseUtcTimestamp(value, "continuity timestamp").milliseconds));

const readBoundedBody = async (response, maxBytes, signal) => {
  if (!response.body?.getReader) throw new Error("continuity feed body is unavailable");
  const reader = response.body.getReader();
  let cancellationRequested = false;
  const cancelReader = (reason) => {
    if (cancellationRequested || typeof reader.cancel !== "function") return;
    cancellationRequested = true;
    try {
      void Promise.resolve(reader.cancel(reason)).catch(() => {});
    } catch {
      // Cancellation is best effort. The timeout or stream-bound failure remains authoritative.
    }
  };
  const cancelForAbort = () => cancelReader(signal?.reason);
  signal?.addEventListener("abort", cancelForAbort, { once: true });
  const chunks = [];
  let total = 0;
  try {
    if (signal?.aborted) {
      cancelForAbort();
      throw signal.reason instanceof Error ? signal.reason : new Error("continuity feed was aborted");
    }
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength === 0) {
        cancelReader("continuity feed body is invalid");
        throw new Error("continuity feed body is invalid");
      }
      if (value.byteLength > maxBytes - total) {
        cancelReader("continuity feed is too large");
        throw new Error("continuity feed is too large");
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    signal?.removeEventListener("abort", cancelForAbort);
    try {
      reader.releaseLock();
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
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("continuity feed is not valid UTF-8");
  }
};

export const fetchContinuityEnvelope = async (url, {
  timeoutMs = 7000,
  fetchImpl = globalThis.fetch,
  timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
} = {}) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("continuity feed URL is not trusted");
  }
  if (parsed.origin !== EXPECTED_ORIGIN || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/evidence.json") {
    throw new Error("continuity feed URL is not trusted");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS
    || typeof fetchImpl !== "function" || typeof timers?.setTimeout !== "function" || typeof timers?.clearTimeout !== "function") {
    throw new Error("continuity feed transport is unavailable");
  }
  const controller = new AbortController();
  const timeoutError = new Error("continuity feed timed out");
  const operation = (async () => {
    const response = await fetchImpl(parsed, { cache: "no-store", credentials: "omit", mode: "cors", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) throw new Error(`continuity feed returned ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error("continuity feed content type is invalid");
    const lengthHeader = (response.headers.get("content-length") || "").trim();
    if (lengthHeader && !/^\d+$/.test(lengthHeader)) throw new Error("continuity feed content length is invalid");
    const declaredLength = lengthHeader ? Number(lengthHeader) : 0;
    if (!Number.isSafeInteger(declaredLength)) throw new Error("continuity feed content length is invalid");
    if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("continuity feed is too large");
    const body = await readBoundedBody(response, MAX_RESPONSE_BYTES, controller.signal);
    try {
      return parseUniqueJson(body);
    } catch (error) {
      if (error instanceof DuplicateJsonMemberError) throw new Error("continuity feed contains duplicate JSON fields");
      throw new Error("continuity feed is not valid JSON");
    }
  })();
  let settled = false;
  let rejectTimeout;
  const timeoutFailure = new Promise((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timeout = timers.setTimeout(() => {
    if (settled) return;
    rejectTimeout(timeoutError);
    controller.abort(timeoutError);
  }, timeoutMs);
  try {
    return await Promise.race([operation, timeoutFailure]);
  } finally {
    settled = true;
    timers.clearTimeout(timeout);
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
  root.querySelector("[data-continuity-updated]").textContent = formatEvidenceTime(evidence.generated_at);
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

export const createContinuityLeaseController = (root, {
  clock = Date.now,
  timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
} = {}) => {
  if (!root || typeof root.querySelector !== "function" || typeof clock !== "function"
    || typeof timers?.setTimeout !== "function" || typeof timers?.clearTimeout !== "function") {
    throw new Error("continuity lease controller is unavailable");
  }
  let generation = 0;
  let timerHandle;
  let timerActive = false;

  const clearTimer = () => {
    if (!timerActive) return;
    timers.clearTimeout(timerHandle);
    timerHandle = undefined;
    timerActive = false;
  };

  const scheduleExpiry = (expiresAtMs, expectedGeneration, sampledNowMs = clock()) => {
    if (generation !== expectedGeneration) return;
    if (!Number.isFinite(sampledNowMs)) {
      renderUnavailable(root);
      return;
    }
    const remainingMs = expiresAtMs - sampledNowMs;
    if (remainingMs <= 0) {
      renderUnavailable(root);
      return;
    }
    timerHandle = timers.setTimeout(() => {
      timerActive = false;
      timerHandle = undefined;
      scheduleExpiry(expiresAtMs, expectedGeneration);
    }, remainingMs);
    timerActive = true;
  };

  return Object.freeze({
    showVerified(evidence) {
      const expectedGeneration = ++generation;
      clearTimer();
      const expiresAtMs = parseUtcTimestamp(evidence?.expires_at, "continuity expires_at").milliseconds;
      const nowMs = clock();
      if (!Number.isFinite(nowMs) || expiresAtMs <= nowMs) {
        renderUnavailable(root);
        return false;
      }
      renderEvidence(root, evidence);
      scheduleExpiry(expiresAtMs, expectedGeneration, nowMs);
      return true;
    },
    showUnavailable() {
      generation += 1;
      clearTimer();
      renderUnavailable(root);
    },
    dispose() {
      generation += 1;
      clearTimer();
    }
  });
};

const bootstrap = async () => {
  const root = document.querySelector("[data-continuity]");
  if (!root) return;
  const leaseController = createContinuityLeaseController(root);
  if (!new Set(["bounder.io", "www.bounder.io"]).has(window.location.hostname)) {
    leaseController.showUnavailable();
    return;
  }
  const configuredURL = document.querySelector('meta[name="bounder-continuity-feed"]')?.content || "";
  const publicKeyHex = document.querySelector('meta[name="bounder-continuity-public-key"]')?.content || "";
  const publicKeyID = document.querySelector('meta[name="bounder-continuity-key-id"]')?.content || "";
  try {
    const envelope = await fetchContinuityEnvelope(configuredURL);
    leaseController.showVerified(await verifyContinuityEnvelope({ envelope, publicKeyHex, publicKeyID }));
  } catch {
    leaseController.showUnavailable();
  }
};

const isNodeRuntime = typeof process !== "undefined" && Boolean(process.versions?.node);
if (!isNodeRuntime && typeof document !== "undefined" && typeof window !== "undefined") bootstrap();
