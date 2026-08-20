import assert from "node:assert/strict";
import test from "node:test";

import config from "../playwright.config.js";

test("browser acceptance always builds and serves an isolated publication artifact", () => {
  assert.equal(config.retries, 0, "browser failures may not be hidden by a passing retry");
  assert.equal(config.webServer?.reuseExistingServer, false);
  assert.equal(config.webServer?.url, `${config.use?.baseURL}/`);
  assert.equal(
    config.webServer?.command,
    "npm run build && python3 -m http.server 4173 --bind 127.0.0.1 --directory _site"
  );
});
