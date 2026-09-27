import { DuplicateJsonMemberError, parseUniqueJson } from "./runtime/json/strict-json.js";

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

// A browser that cannot run Ed25519 verification has not seen bad evidence; it cannot judge
// any. Callers tell the two apart so the page never reports a healthy feed as unavailable.
export class ContinuityUnsupportedError extends Error {
  constructor(message = "this browser cannot verify Ed25519 signatures") {
    super(message);
    this.name = "ContinuityUnsupportedError";
  }
}

// allowRepeat lets a refreshing page re-read the proof it already holds ("no newer proof
// yet") without treating it as a replay. A strictly older generated_at is still rejected.
export const createContinuityReplayGuard = (initialGeneratedAt = null, { allowRepeat = false } = {}) => {
  let latestGeneratedAtKey = initialGeneratedAt === null
    ? null
    : continuityTimestampOrderKey(initialGeneratedAt, "continuity replay guard state");
  return Object.freeze({
    accept(evidence) {
      const generatedAtKey = continuityTimestampOrderKey(evidence?.generated_at, "continuity generated_at");
      if (latestGeneratedAtKey !== null
        && (generatedAtKey < latestGeneratedAtKey || (generatedAtKey === latestGeneratedAtKey && !allowRepeat))) {
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
  if (!cryptoImpl?.subtle) throw new ContinuityUnsupportedError("continuity signature verification is unavailable");
  const payloadBytes = decodeBase64(envelope.payload, "continuity payload", MAX_PAYLOAD_BYTES);
  const signature = decodeBase64(envelope.signature, "continuity signature", ED25519_SIGNATURE_BYTES);
  if (signature.length !== ED25519_SIGNATURE_BYTES) throw new Error("continuity envelope size is invalid");
  const publicKeyBytes = decodeHex(publicKeyHex, "continuity public key");
  let signatureValid;
  try {
    const publicKey = await cryptoImpl.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
    signatureValid = await cryptoImpl.subtle.verify({ name: "Ed25519" }, publicKey, signature, payloadBytes);
  } catch (error) {
    // WebCrypto reports an unrecognised algorithm as NotSupportedError (Chromium before 137,
    // Firefox before 129, Safari before 17). Anything else stays an ordinary failure.
    if (error?.name === "NotSupportedError") throw new ContinuityUnsupportedError();
    throw error;
  }
  if (!signatureValid) throw new Error("continuity evidence signature is invalid");
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

const MONTHS_SHORT = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

// Built from fixed parts in UTC rather than Intl, whose month abbreviations and joiners
// differ by engine and ICU build ("Sept" or "Sep", "," or " at"). Every visitor sees the
// same string for the same proof, and it matches the UTC timestamps in the evidence.
export const formatEvidenceTime = (value) => {
  const date = new Date(parseUtcTimestamp(value, "continuity timestamp").milliseconds);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
};

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
  timers = globalThis
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

const METRIC_SELECTORS = Object.freeze([
  "[data-continuity-devices]", "[data-continuity-policies]", "[data-continuity-checkpoints]",
  "[data-continuity-decisions]", "[data-continuity-updated]"
]);
const NO_FIGURE = "—";
const NBSP = " ";

const renderEvidence = (root, evidence) => {
  root.dataset.state = "verified";
  delete root.dataset.reason;
  delete root.dataset.reasonDetail;
  root.querySelector("[data-continuity-state]").textContent = "Verified live";
  root.querySelector("[data-continuity-state]").setAttribute("aria-label", "Live staging evidence verified");
  root.querySelector("[data-continuity-devices]").textContent = String(evidence.device_count);
  root.querySelector("[data-continuity-policies]").textContent = String(evidence.policies_verified);
  root.querySelector("[data-continuity-checkpoints]").textContent = String(evidence.checkpoints_verified);
  // Non-breaking spaces keep each count with its word when the narrow cell wraps.
  root.querySelector("[data-continuity-decisions]").textContent = `${evidence.allowed}${NBSP}allow / ${evidence.held}${NBSP}hold`;
  const issued = root.querySelector("[data-continuity-updated]");
  issued.textContent = formatEvidenceTime(evidence.generated_at);
  // Machine-readable instant for <time>: HTML allows three fractional digits, so milliseconds.
  issued.setAttribute("datetime", new Date(parseUtcTimestamp(evidence.generated_at, "continuity timestamp").milliseconds).toISOString());
  root.querySelector("[data-continuity-note]").textContent = "Exact Ed25519 payload verified in this browser. All 100 software Guardians completed policy sync, signed checkpoint verification, and local interlock evaluation.";
};

const RECORDED_RUN = "The figures shown are from the recorded 100-Guardian run, not live.";

// Every state other than "verified" is a fail-closed placeholder: no figure from an
// unverified, expired or unreachable feed is ever shown, and each says truthfully why.
const unavailableStates = Object.freeze({
  offline: {
    badge: "Live feed offline",
    label: "Live staging feed offline; the recorded run remains available",
    note: () => `The live staging feed did not return a usable response, so no live figures are shown. ${RECORDED_RUN}`
  },
  expired: {
    badge: "Proof expired",
    label: "Last live proof expired; the recorded run remains available",
    note: ({ expiresAt }) => `The last verified proof expired${expiresAt ? ` at ${formatEvidenceTime(expiresAt)}` : ""}, and no newer proof has been verified yet. ${RECORDED_RUN}`
  },
  unsupported: {
    badge: "Cannot verify here",
    label: "This browser cannot verify the live proof; the recorded run remains available",
    note: () => `This browser cannot verify Ed25519 signatures, so no live figures are shown. The signed payload can still be inspected. ${RECORDED_RUN}`
  },
  invalid: {
    badge: "Proof not verified",
    label: "Live proof failed verification; the recorded run remains available",
    note: () => `The live feed responded, but its proof did not pass verification in this browser, so no live figures are shown. ${RECORDED_RUN}`
  },
  preview: {
    badge: "Live proof unavailable",
    label: "Live verification runs only on bounder.io; the recorded run remains available",
    note: () => `Live verification runs only on bounder.io. ${RECORDED_RUN}`
  }
});

const renderUnavailable = (root, reason = "offline", { expiresAt, detail } = {}) => {
  const state = unavailableStates[reason] ? reason : "offline";
  const copy = unavailableStates[state];
  root.dataset.state = "unavailable";
  root.dataset.reason = state;
  // Kept for diagnosis only; nothing reads it back as a signal.
  if (typeof detail === "string" && detail) root.dataset.reasonDetail = detail.slice(0, 200);
  else delete root.dataset.reasonDetail;
  root.querySelector("[data-continuity-state]").textContent = copy.badge;
  root.querySelector("[data-continuity-state]").setAttribute("aria-label", copy.label);
  // The live cells are hidden in this state (the recorded run shows instead), and they are
  // cleared as well, so no unverified or expired figure survives anywhere in the DOM.
  for (const selector of METRIC_SELECTORS) root.querySelector(selector).textContent = NO_FIGURE;
  root.querySelector("[data-continuity-updated]").removeAttribute?.("datetime");
  root.querySelector("[data-continuity-note]").textContent = copy.note({ expiresAt });
};

export const createContinuityLeaseController = (root, {
  clock = Date.now,
  timers = globalThis
} = {}) => {
  if (!root || typeof root.querySelector !== "function" || typeof clock !== "function"
    || typeof timers?.setTimeout !== "function" || typeof timers?.clearTimeout !== "function") {
    throw new Error("continuity lease controller is unavailable");
  }
  let generation = 0;
  let timerHandle;
  let timerActive = false;
  let status = "idle";
  let lease = null;

  const clearTimer = () => {
    if (!timerActive) return;
    timers.clearTimeout(timerHandle);
    timerHandle = undefined;
    timerActive = false;
  };

  const expire = (expiresAt) => {
    status = "expired";
    lease = null;
    renderUnavailable(root, "expired", { expiresAt });
  };

  const scheduleExpiry = (expiresAtMs, expiresAt, expectedGeneration, sampledNowMs = clock()) => {
    if (generation !== expectedGeneration) return;
    if (!Number.isFinite(sampledNowMs)) {
      expire(expiresAt);
      return;
    }
    const remainingMs = expiresAtMs - sampledNowMs;
    if (remainingMs <= 0) {
      expire(expiresAt);
      return;
    }
    timerHandle = timers.setTimeout(() => {
      timerActive = false;
      timerHandle = undefined;
      scheduleExpiry(expiresAtMs, expiresAt, expectedGeneration);
    }, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
    timerActive = true;
  };

  return Object.freeze({
    showVerified(evidence) {
      const expectedGeneration = ++generation;
      clearTimer();
      const expiresAtMs = parseUtcTimestamp(evidence?.expires_at, "continuity expires_at").milliseconds;
      const nowMs = clock();
      if (!Number.isFinite(nowMs) || expiresAtMs <= nowMs) {
        expire(evidence.expires_at);
        return false;
      }
      status = "verified";
      lease = { expiresAtMs, expiresAt: evidence.expires_at, generation: expectedGeneration };
      renderEvidence(root, evidence);
      scheduleExpiry(expiresAtMs, evidence.expires_at, expectedGeneration, nowMs);
      return true;
    },
    showUnavailable(reason = "offline", detail) {
      generation += 1;
      clearTimer();
      status = "unavailable";
      lease = null;
      renderUnavailable(root, reason, { detail });
    },
    // Background tabs throttle timers, so a page returning to view re-checks its lease at
    // once instead of showing an expired proof as live until the throttled timer fires.
    checkExpiry() {
      if (status !== "verified" || !lease) return status;
      const nowMs = clock();
      if (!Number.isFinite(nowMs) || lease.expiresAtMs <= nowMs) {
        generation += 1;
        clearTimer();
        expire(lease.expiresAt);
      }
      return status;
    },
    status() {
      return status;
    },
    dispose() {
      generation += 1;
      clearTimer();
    }
  });
};

export const CONTINUITY_REFRESH = Object.freeze({
  // Re-read the feed a minute before the lease ends, and at least every five minutes
  // (the producer publishes a new proof roughly every five minutes with a 15-minute lease).
  leadMs: 60_000,
  intervalMs: 5 * 60_000,
  minDelayMs: 20_000,
  // Bounded backoff after a failed read; the last value repeats while the page is visible.
  retryDelaysMs: Object.freeze([15_000, 30_000, 60_000, 120_000, 300_000])
});

export const classifyContinuityFailure = (error) => {
  if (error instanceof ContinuityUnsupportedError) return "unsupported";
  if (error?.continuityStage === "transport") return "offline";
  return "invalid";
};

/*
 * Keeps the live proof current without ever broadening what is shown:
 * - a strictly newer verified proof replaces the current one and re-arms its lease;
 * - the same proof again is "no newer proof yet", never a failure;
 * - a failed read leaves a still-valid proof in place until its own expiry, which the lease
 *   controller enforces independently; only then does the page fall back;
 * - reads pause while the page is hidden and resume, due or not, when it returns.
 */
export const startContinuityMonitor = ({
  controller,
  load,
  clock = Date.now,
  timers = globalThis,
  visibility = null,
  schedule = CONTINUITY_REFRESH,
  classify = classifyContinuityFailure
} = {}) => {
  if (!controller || typeof controller.showVerified !== "function" || typeof controller.status !== "function"
    || typeof load !== "function" || typeof clock !== "function"
    || typeof timers?.setTimeout !== "function" || typeof timers?.clearTimeout !== "function") {
    throw new Error("continuity monitor is unavailable");
  }
  let disposed = false;
  let timerHandle;
  let timerActive = false;
  let dueAtMs = null;
  let inFlight = null;
  let failures = 0;
  let latestGeneratedAtKey = null;
  let unsubscribe = null;

  const isHidden = () => Boolean(visibility && typeof visibility.isHidden === "function" && visibility.isHidden());

  const clearTimer = () => {
    if (!timerActive) return;
    timers.clearTimeout(timerHandle);
    timerHandle = undefined;
    timerActive = false;
  };

  const startTimer = (delayMs) => {
    clearTimer();
    timerHandle = timers.setTimeout(() => {
      timerActive = false;
      timerHandle = undefined;
      void refresh();
    }, Math.max(0, Math.min(delayMs, MAX_TIMER_DELAY_MS)));
    timerActive = true;
  };

  const arm = (delayMs) => {
    if (disposed) return;
    const nowMs = clock();
    dueAtMs = Number.isFinite(nowMs) ? nowMs + delayMs : null;
    if (isHidden()) {
      clearTimer();
      return;
    }
    startTimer(delayMs);
  };

  const delayAfterProof = (evidence) => {
    const expiresAtMs = parseUtcTimestamp(evidence.expires_at, "continuity expires_at").milliseconds;
    const untilLead = expiresAtMs - schedule.leadMs - clock();
    return Math.max(schedule.minDelayMs, Math.min(schedule.intervalMs, Number.isFinite(untilLead) ? untilLead : schedule.minDelayMs));
  };

  const retryDelay = () => schedule.retryDelaysMs[Math.min(failures, schedule.retryDelaysMs.length) - 1];

  const settle = async () => {
    let evidence;
    try {
      evidence = await load();
    } catch (error) {
      if (disposed) return "disposed";
      failures += 1;
      const reason = classify(error);
      // A still-valid proof stays until its own lease ends, and an expired one keeps its
      // more specific "expired at" note; only a page with nothing verified is downgraded.
      if (controller.status() !== "verified" && controller.status() !== "expired") {
        controller.showUnavailable(reason, error instanceof Error ? error.message : "");
      }
      if (reason !== "unsupported") arm(retryDelay());
      return "failed";
    }
    if (disposed) return "disposed";
    const generatedAtKey = continuityTimestampOrderKey(evidence?.generated_at, "continuity generated_at");
    if (latestGeneratedAtKey !== null && generatedAtKey <= latestGeneratedAtKey) {
      failures = 0;
      arm(delayAfterProof(evidence));
      return "unchanged";
    }
    latestGeneratedAtKey = generatedAtKey;
    if (!controller.showVerified(evidence)) {
      failures += 1;
      arm(retryDelay());
      return "expired";
    }
    failures = 0;
    arm(delayAfterProof(evidence));
    return "verified";
  };

  const refresh = () => {
    if (disposed) return Promise.resolve("disposed");
    if (inFlight) return inFlight;
    clearTimer();
    dueAtMs = null;
    inFlight = settle().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const onVisibilityChange = () => {
    if (disposed) return;
    if (isHidden()) {
      clearTimer();
      return;
    }
    if (typeof controller.checkExpiry === "function") controller.checkExpiry();
    if (inFlight || dueAtMs === null) return;
    const remainingMs = dueAtMs - clock();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) void refresh();
    else startTimer(remainingMs);
  };

  if (visibility && typeof visibility.subscribe === "function") unsubscribe = visibility.subscribe(onVisibilityChange);

  return Object.freeze({
    refresh,
    dispose() {
      disposed = true;
      clearTimer();
      if (typeof unsubscribe === "function") unsubscribe();
    }
  });
};

const bootstrap = () => {
  const root = document.querySelector("[data-continuity]");
  if (!root) return;
  // Read by site.js: a page whose verifier never started says so instead of "Checking" forever.
  root.dataset.continuityStarted = "true";
  const leaseController = createContinuityLeaseController(root);
  if (!new Set(["bounder.io", "www.bounder.io"]).has(window.location.hostname)) {
    leaseController.showUnavailable("preview");
    return;
  }
  const configuredURL = document.querySelector('meta[name="bounder-continuity-feed"]')?.content || "";
  const publicKeyHex = document.querySelector('meta[name="bounder-continuity-public-key"]')?.content || "";
  const publicKeyID = document.querySelector('meta[name="bounder-continuity-key-id"]')?.content || "";
  const replayGuard = createContinuityReplayGuard(null, { allowRepeat: true });
  const load = async () => {
    let envelope;
    try {
      envelope = await fetchContinuityEnvelope(configuredURL);
    } catch (error) {
      const failure = new Error(error instanceof Error ? error.message : "continuity feed failed");
      failure.continuityStage = "transport";
      throw failure;
    }
    return verifyContinuityEnvelope({ envelope, publicKeyHex, publicKeyID, replayGuard });
  };
  const visibility = {
    isHidden: () => document.visibilityState === "hidden",
    subscribe(listener) {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    }
  };
  void startContinuityMonitor({ controller: leaseController, load, visibility }).refresh();
};

const isNodeRuntime = typeof process !== "undefined" && Boolean(process.versions?.node);
if (!isNodeRuntime && typeof document !== "undefined" && typeof window !== "undefined") bootstrap();
