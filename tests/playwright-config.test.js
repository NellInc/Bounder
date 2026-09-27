import assert from "node:assert/strict";
import test from "node:test";

import config from "../playwright.config.js";

test("browser acceptance always builds and serves an isolated publication artifact", () => {
  assert.deepEqual(config.use.trace, { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true });
  assert.equal(config.retries, 0, "browser failures may not be hidden by a passing retry");
  assert.equal(config.webServer?.reuseExistingServer, false);
  assert.equal(config.webServer?.url, `${config.use?.baseURL}/`);
  assert.equal(
    config.webServer?.command,
    "npm run build && exec node scripts/serve-site.mjs --root _site --host 127.0.0.1 --port 4173",
    "browser acceptance must use the keep-alive loopback server (python's http.server resets module fetches under load), started with exec: serve-site's parent watch only fires if Node is the runner's direct child"
  );
  assert.ok(
    config.webServer?.timeout >= 120_000,
    "the web server budget must cover a cold publication build on a loaded machine; a short budget kills the build mid-promotion and leaves a poisoned lock"
  );
});
