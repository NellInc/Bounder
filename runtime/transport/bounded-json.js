import { MAX_VECTOR_BYTES, assertSafeInteger, deepFreeze, immutableBytesProperty, toBytes } from "../policy/primitives.js";
import { parseStrictJSON } from "../json/policy-json.js";

export const FETCH_TIMEOUT_MS = 10_000;

const MAX_RESPONSE_CHUNKS = 4096;

export const fetchBoundedJSON = async (
  url,
  {
    maxBytes = MAX_VECTOR_BYTES,
    timeoutMs = FETCH_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    signal,
    description = "JSON request",
    baseURL = globalThis.document?.baseURI ?? globalThis.location?.href,
    expectedURL,
    expectedOrigin
  } = {}
) => {
  assertSafeInteger(maxBytes, `${description} byte limit`, { min: 1 });
  assertSafeInteger(timeoutMs, `${description} timeout`, { min: 1, max: 60_000 });
  if (typeof fetchImpl !== "function") throw new Error(`${description} cannot be fetched`);
  if (signal !== undefined && (typeof signal?.aborted !== "boolean" || typeof signal?.addEventListener !== "function" ||
      typeof signal?.removeEventListener !== "function")) throw new Error(`${description} abort signal is invalid`);
  let requestURL;
  let requiredURL;
  try {
    requestURL = new URL(url, baseURL);
    requiredURL = new URL(expectedURL ?? requestURL.href, baseURL);
  } catch {
    throw new Error(`${description} URL is invalid`);
  }
  const requiredOrigin = expectedOrigin ?? requiredURL.origin;
  if (requestURL.href !== requiredURL.href || requestURL.origin !== requiredOrigin) {
    throw new Error(`${description} URL or origin is not allowed`);
  }
  if (signal?.aborted) throw new Error(`${description} was aborted`);
  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  let reader;

  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = reject;
  });
  const cancelReader = () => {
    if (!reader) return;
    try {
      void Promise.resolve(reader.cancel()).catch(() => {});
    } catch {
      // Cancellation is best effort. The original abort, timeout, or bound remains authoritative.
    }
  };
  const forwardAbort = () => {
    externallyAborted = true;
    controller.abort(signal?.reason);
    cancelReader();
    rejectAbort(new Error(`${description} was aborted`));
  };
  signal?.addEventListener("abort", forwardAbort, { once: true });

  let rejectTimeout;
  const timeout = new Promise((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    cancelReader();
    rejectTimeout(new Error(`${description} timed out`));
  }, timeoutMs);

  const read = (async () => {
    const response = await fetchImpl(requestURL.href, {
      cache: "no-cache",
      credentials: "same-origin",
      redirect: "error",
      signal: controller.signal
    });
    if (controller.signal.aborted) {
      try {
        void Promise.resolve(response?.body?.cancel?.(controller.signal.reason)).catch(() => {});
      } catch {
        // A late response body is released best effort. The abort or timeout remains authoritative.
      }
      throw new Error(`${description} was aborted`);
    }
    if (!response?.ok) throw new Error(`${description} failed with ${response?.status ?? "an unknown status"}`);
    let responseURL;
    try {
      responseURL = new URL(response.url);
    } catch {
      throw new Error(`${description} response URL is invalid`);
    }
    if (responseURL.href !== requiredURL.href || responseURL.origin !== requiredOrigin) {
      throw new Error(`${description} response URL or origin is not allowed`);
    }
    const contentType = response.headers?.get?.("content-type") ?? "";
    if (contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new Error(`${description} did not return application/json`);
    }
    const contentLength = response.headers?.get?.("content-length");
    if (contentLength !== null && contentLength !== undefined) {
      if (typeof contentLength !== "string" || !/^(?:0|[1-9]\d*)$/.test(contentLength)) {
        throw new Error(`${description} content length is invalid`);
      }
      const declaredLength = Number(contentLength);
      if (!Number.isSafeInteger(declaredLength) || declaredLength > maxBytes) {
        controller.abort();
        throw new Error(`${description} exceeds the ${maxBytes}-byte limit`);
      }
    }
    if (!response.body?.getReader) throw new Error(`${description} has no readable response body`);
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    let chunkCount = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = toBytes(value, `${description} response`);
        if (chunk.byteLength === 0) {
          controller.abort();
          cancelReader();
          throw new Error(`${description} returned an empty response chunk`);
        }
        chunkCount += 1;
        if (chunkCount > MAX_RESPONSE_CHUNKS) {
          controller.abort();
          cancelReader();
          throw new Error(`${description} exceeds the ${MAX_RESPONSE_CHUNKS}-chunk limit`);
        }
        length += chunk.byteLength;
        if (length > maxBytes) {
          controller.abort();
          cancelReader();
          throw new Error(`${description} exceeds the ${maxBytes}-byte limit`);
        }
        chunks.push(chunk);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // A malformed reader cannot override the authoritative transport result.
      }
      reader = undefined;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const result = { value: deepFreeze(parseStrictJSON(bytes, description, { maxBytes })) };
    immutableBytesProperty(result, "bytes", bytes);
    return Object.freeze(result);
  })();

  try {
    return await Promise.race([read, timeout, aborted]);
  } catch (error) {
    if (timedOut) throw new Error(`${description} timed out`);
    if (externallyAborted) throw new Error(`${description} was aborted`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
};
