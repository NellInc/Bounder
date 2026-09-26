import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isMainModule, repositoryRoot } from "./lib/system-model.mjs";

// Read-only post-deployment observation: does the site at --url serve this checkout's VERSION?
// It sends two GET requests per attempt and writes nothing, so a deploy workflow or an operator
// can run it after publication to turn "deployed" into "verified in the served bytes". It checks
// publication only; it says nothing about the continuity feed, whose own /health endpoint
// reports freshness.

export const DEFAULT_ATTEMPTS = 1;
export const DEFAULT_DELAY_MS = 20_000;
export const REQUEST_TIMEOUT_MS = 15_000;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function parseCheckLiveArguments(args) {
  const options = { url: "", expectVersion: "", attempts: DEFAULT_ATTEMPTS, delayMs: DEFAULT_DELAY_MS, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--json") {
      options.json = true;
      continue;
    }
    if (!["--url", "--expect-version", "--attempts", "--delay-ms"].includes(name)) throw new Error(`unknown check:live argument: ${name}`);
    const value = args[index += 1];
    if (!value) throw new Error(`${name} requires a value`);
    if (name === "--url") options.url = value;
    else if (name === "--expect-version") options.expectVersion = value;
    else {
      const number = Number(value);
      const [key, min, max] = name === "--attempts" ? ["attempts", 1, 120] : ["delayMs", 0, 600_000];
      if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer from ${min} through ${max}`);
      options[key] = number;
    }
  }
  if (!options.url) throw new Error("missing --url");
  let parsed;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new Error(`--url is not a URL: ${options.url}`);
  }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("--url must be a plain http(s) origin or path without credentials, query or fragment");
  }
  if (options.expectVersion && !VERSION_PATTERN.test(options.expectVersion)) throw new Error("--expect-version must be a release version such as 1.2.4");
  return options;
}

async function fetchText(fetchImpl, url, timeoutMs) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: await response.text() };
}

export async function observeLive({ url, expectedVersion, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS, now = () => Date.now() }) {
  const base = url.endsWith("/") ? url : `${url}/`;
  // A unique query string asks any CDN in front of the site for a fresh copy of VERSION.
  const versionUrl = new URL(`VERSION?live-check=${now()}`, base).href;
  const [version, home] = await Promise.all([fetchText(fetchImpl, versionUrl, timeoutMs), fetchText(fetchImpl, base, timeoutMs)]);
  const observedVersion = version.status === 200 ? version.body.trim() : null;
  const failures = [];
  if (version.status !== 200) failures.push(`VERSION returned HTTP ${version.status}`);
  else if (observedVersion !== expectedVersion) failures.push(`served VERSION is ${JSON.stringify(observedVersion.slice(0, 40))}, expected ${expectedVersion}`);
  if (home.status !== 200) failures.push(`homepage returned HTTP ${home.status}`);
  else if (!/^text\/html\b/iu.test(home.contentType)) failures.push(`homepage content type is ${home.contentType || "missing"}`);
  return { observed_version: observedVersion, homepage_status: home.status, failures };
}

export async function checkLive({
  url,
  expectedVersion,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  now = () => Date.now()
}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      last = await observeLive({ url, expectedVersion, fetchImpl, now });
    } catch (error) {
      last = { observed_version: null, homepage_status: null, failures: [`request failed: ${error.message}`] };
    }
    if (last.failures.length === 0) {
      return Object.freeze({ version: "bounder-live-check/v1", url, expected_version: expectedVersion, verified: true, attempts_used: attempt, ...last });
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return Object.freeze({ version: "bounder-live-check/v1", url, expected_version: expectedVersion, verified: false, attempts_used: attempts, ...last });
}

export async function runCheckLiveCli(args = process.argv.slice(2), logger = console, overrides = {}) {
  const options = parseCheckLiveArguments(args);
  const expectedVersion = options.expectVersion || (await readFile(join(overrides.root || repositoryRoot, "VERSION"), "utf8")).trim();
  if (!VERSION_PATTERN.test(expectedVersion)) throw new Error("the local VERSION file does not hold a release version");
  const result = await checkLive({ url: options.url, expectedVersion, attempts: options.attempts, delayMs: options.delayMs, ...overrides });
  if (options.json) logger.log(JSON.stringify(result, null, 2));
  else if (result.verified) logger.log(`Live: ${options.url} serves VERSION ${expectedVersion} (attempt ${result.attempts_used}).`);
  else logger.log(`Not verified: ${options.url} after ${result.attempts_used} attempt(s): ${result.failures.join("; ")}`);
  return result;
}

/* c8 ignore start -- direct-entry failure plumbing is covered through the exported command API. */
if (isMainModule(import.meta.url)) {
  runCheckLiveCli().then((result) => {
    if (!result.verified) process.exitCode = 1;
  }, (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
