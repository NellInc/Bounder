import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const expectedScenarios = ["safe", "civilian", "friendly", "protected", "humanitarian", "altitude", "weather", "window", "link", "replay"];

test("receipt bundle is complete, versioned, and fail-safe", async () => {
  const bundle = JSON.parse(await readFile(new URL("data/bounder-receipts.v1.json", root), "utf8"));
  assert.equal(bundle.version, "bounder-receipt-bundle/v1");
  assert.equal(bundle.engine, "bounder-io/interlock");
  assert.deepEqual(bundle.receipts.map(({ scenario }) => scenario), expectedScenarios);
  assert.equal(new Set(bundle.receipts.map(({ scenario }) => scenario)).size, expectedScenarios.length);
  for (const receipt of bundle.receipts) {
    assert.equal(receipt.version, "bounder-receipt/v1");
    assert.match(receipt.policy_hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(receipt.adapter.command_sent, false);
    assert.equal(typeof receipt.signature_verified, "boolean");
    assert.ok(receipt.reason.length > 0);
  }
  assert.equal(bundle.receipts.find(({ scenario }) => scenario === "safe").allowed, true);
  assert.ok(bundle.receipts.filter(({ allowed }) => !allowed).length === 9);
});

test("simulator consumes same-origin receipts and vendored Three.js", async () => {
  const source = await readFile(new URL("simulator.js", root), "utf8");
  const html = await readFile(new URL("simulator.html", root), "utf8");
  assert.match(source, /fetch\("\.\/data\/bounder-receipts\.v1\.json"/);
  assert.doesNotMatch(source, /const scenarios\s*=/);
  assert.doesNotMatch(source, /esm\.sh|unpkg\.com|jsdelivr\.net/);
  assert.match(html, /vendor\/three\/three\.module\.min\.js/);
  assert.doesNotMatch(html, /esm\.sh|unpkg\.com|jsdelivr\.net/);
  await readFile(new URL("vendor/three/LICENSE", root), "utf8");
  await readFile(new URL("vendor/three/three.core.min.js", root), "utf8");
});
