import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkLive, observeLive, parseCheckLiveArguments, runCheckLiveCli } from "../scripts/check-live.mjs";
import { startStaticServer } from "../scripts/serve-site.mjs";

async function servedTree(t, version) {
  const root = await mkdtemp(join(tmpdir(), "bounder-live-check-"));
  await writeFile(join(root, "VERSION"), `${version}\n`);
  await writeFile(join(root, "index.html"), "<!doctype html><title>Bounder</title>\n");
  await writeFile(join(root, "404.html"), "<!doctype html><title>Not found</title>\n");
  const server = await startStaticServer({ root, logger: { log() {}, error() {} } });
  t.after(async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(root, { recursive: true, force: true });
  });
  const { port } = server.address();
  return { root, url: `http://127.0.0.1:${port}` };
}

test("live check arguments are exact and refuse ambiguous targets", () => {
  assert.deepEqual(parseCheckLiveArguments(["--url", "https://www.bounder.io", "--attempts", "3", "--delay-ms", "0", "--expect-version", "1.2.4", "--json"]), {
    url: "https://www.bounder.io", expectVersion: "1.2.4", attempts: 3, delayMs: 0, json: true
  });
  assert.throws(() => parseCheckLiveArguments([]), /missing --url/);
  assert.throws(() => parseCheckLiveArguments(["--bad"]), /unknown/);
  assert.throws(() => parseCheckLiveArguments(["--url"]), /requires a value/);
  assert.throws(() => parseCheckLiveArguments(["--url", "not a url"]), /not a URL/);
  assert.throws(() => parseCheckLiveArguments(["--url", "ftp://example.test"]), /plain http/);
  assert.throws(() => parseCheckLiveArguments(["--url", "https://user:secret@example.test"]), /without credentials/);
  assert.throws(() => parseCheckLiveArguments(["--url", "https://example.test/?q=1"]), /query/);
  assert.throws(() => parseCheckLiveArguments(["--url", "https://example.test", "--attempts", "0"]), /1 through 120/);
  assert.throws(() => parseCheckLiveArguments(["--url", "https://example.test", "--delay-ms", "1.5"]), /0 through 600000/);
  assert.throws(() => parseCheckLiveArguments(["--url", "https://example.test", "--expect-version", "v1"]), /release version/);
});

test("live check verifies the served VERSION and homepage from a real local server", async (t) => {
  const { url } = await servedTree(t, "1.2.4");
  const verified = await checkLive({ url, expectedVersion: "1.2.4", delayMs: 0 });
  assert.equal(verified.verified, true);
  assert.equal(verified.observed_version, "1.2.4");
  assert.equal(verified.homepage_status, 200);
  assert.equal(verified.attempts_used, 1);

  const stale = await checkLive({ url: `${url}/`, expectedVersion: "1.2.5", attempts: 2, delayMs: 0 });
  assert.equal(stale.verified, false);
  assert.equal(stale.attempts_used, 2);
  assert.match(stale.failures[0], /served VERSION is "1\.2\.4", expected 1\.2\.5/);
});

test("live check retries until the new bytes appear and reports every failure shape", async () => {
  const served = ["1.2.3", "1.2.3", "1.2.4"];
  const requested = [];
  const fetchImpl = async (target, init) => {
    requested.push({ target, cache: init.cache });
    const isVersion = new URL(target).pathname.endsWith("/VERSION");
    return new Response(isVersion ? `${served.shift()}\n` : "<!doctype html>", { status: 200, headers: { "content-type": isVersion ? "text/plain" : "text/html; charset=utf-8" } });
  };
  const sleeps = [];
  const result = await checkLive({ url: "https://site.test", expectedVersion: "1.2.4", attempts: 5, delayMs: 7, fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, now: () => 42 });
  assert.equal(result.verified, true);
  assert.equal(result.attempts_used, 3);
  assert.deepEqual(sleeps, [7, 7]);
  assert.ok(requested.every(({ cache }) => cache === "no-store"));
  assert.ok(requested.some(({ target }) => target === "https://site.test/VERSION?live-check=42"));

  const status = (versionStatus, homeStatus, homeType = "text/html") => async (target) => (new URL(target).pathname.endsWith("/VERSION")
    ? new Response("1.2.4\n", { status: versionStatus })
    : new Response("x", { status: homeStatus, headers: { "content-type": homeType } }));
  assert.deepEqual((await observeLive({ url: "https://site.test", expectedVersion: "1.2.4", fetchImpl: status(404, 200) })).failures, ["VERSION returned HTTP 404"]);
  assert.deepEqual((await observeLive({ url: "https://site.test", expectedVersion: "1.2.4", fetchImpl: status(200, 503) })).failures, ["homepage returned HTTP 503"]);
  assert.deepEqual((await observeLive({ url: "https://site.test", expectedVersion: "1.2.4", fetchImpl: status(200, 200, "application/json") })).failures, ["homepage content type is application/json"]);
  const offline = await checkLive({ url: "https://site.test", expectedVersion: "1.2.4", fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(offline.verified, false);
  assert.deepEqual(offline.failures, ["request failed: offline"]);
});

test("live check CLI reads the local VERSION by default and never sets the exit code itself", async (t) => {
  const { root, url } = await servedTree(t, "1.2.4");
  const messages = [];
  const logger = { log: (message) => messages.push(message) };
  const passed = await runCheckLiveCli(["--url", url], logger, { root });
  assert.equal(passed.verified, true);
  assert.match(messages[0], /serves VERSION 1\.2\.4/);
  const failed = await runCheckLiveCli(["--url", url, "--expect-version", "9.9.9", "--delay-ms", "0"], logger, { root });
  assert.equal(failed.verified, false);
  assert.match(messages[1], /^Not verified:/);
  const json = await runCheckLiveCli(["--url", url, "--json"], logger, { root });
  assert.equal(JSON.parse(messages[2]).version, "bounder-live-check/v1");
  assert.equal(json.verified, true);
  assert.equal(process.exitCode, undefined);
  await writeFile(join(root, "VERSION"), "unknown\n");
  await assert.rejects(() => runCheckLiveCli(["--url", url], logger, { root }), /does not hold a release version/);
});
