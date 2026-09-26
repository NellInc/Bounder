import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { glossAdapterOutput, glossReason, outcomeHeadline, stageBadge } from "../ui/receipt-copy.js";

const bundle = JSON.parse(await readFile(new URL("../data/bounder-receipts.v1.json", import.meta.url), "utf8"));
const receipts = Object.values(bundle.receipts);

test("the stage badge names every recorded outcome in plain words, never the raw code", () => {
  for (const receipt of receipts) {
    const badge = stageBadge(receipt);
    assert.match(badge, receipt.allowed ? /^Allowed · / : /^Held · /, receipt.code);
    assert.doesNotMatch(badge, /_/, `${receipt.code} badge must not show a snake_case code`);
    assert.ok(!badge.includes(receipt.code), receipt.code);
  }
  assert.equal(stageBadge({ allowed: false, code: "unknown_future_code" }), "Held");
  assert.equal(stageBadge({ allowed: true, code: "unknown_future_code" }), "Allowed");
  assert.equal(stageBadge(undefined), "Held");
});

test("the headline uses the same vocabulary as the recorded outcome", () => {
  assert.equal(outcomeHeadline(true), "Request allowed");
  assert.equal(outcomeHeadline(false), "Request held");
});

test("adapter and reason glosses read in British English and leave unknown text untouched", () => {
  for (const receipt of receipts) {
    const adapter = glossAdapterOutput(receipt.adapter.output);
    const reason = glossReason(receipt.reason);
    for (const value of [adapter, reason]) {
      assert.doesNotMatch(value, /authoriz/i, `${receipt.code}: ${value}`);
      assert.doesNotMatch(value, /fixture generation|vehicle channel/, `${receipt.code}: ${value}`);
    }
  }
  // Matching is exact, so a changed producer string is shown as recorded rather than glossed.
  assert.equal(glossAdapterOutput("Await authorized window soon"), "Await authorized window soon");
  assert.equal(glossReason("  policy is not active  "), "the policy is not active: its operating window is closed");
  assert.equal(glossReason(undefined), "");
});

test("the allowed receipt gloss stays truthful about authorisation and sending", () => {
  const allowed = receipts.find((receipt) => receipt.allowed);
  assert.equal(allowed.adapter.command_authorized, true);
  assert.equal(allowed.adapter.command_sent, false);
  assert.match(glossAdapterOutput(allowed.adapter.output), /^Loiter authorised\. No command was sent/);
});

test("source guard: the touch-scroll restore relies on a private field the pinned OrbitControls still has", async () => {
  const [vendor, controller] = await Promise.all([
    readFile(new URL("../vendor/three/OrbitControls.js", import.meta.url), "utf8"),
    readFile(new URL("../simulator/controller.js", import.meta.url), "utf8")
  ]);
  // Damping replays _sphericalDelta after pointercancel; the controller clears it to undo the tilt.
  assert.match(vendor, /this\._sphericalDelta = new Spherical\(\);/);
  assert.match(vendor, /this\.domElement\.addEventListener\( 'pointercancel', this\._onPointerUp \);/);
  assert.match(controller, /controls\._sphericalDelta\?\.set\(0, 0, 0\);/);
  assert.match(controller, /canvas\.addEventListener\("pointercancel", \(event\) => \{/);
});

test("source guard: starting quality comes from the page and the renderer's own context, applied through Detail", async () => {
  const controller = await readFile(new URL("../simulator/controller.js", import.meta.url), "utf8");
  // No second probe context: on a software rasteriser it costs as much as the renderer itself.
  assert.doesNotMatch(controller, /failIfMajorPerformanceCaveat:/);
  assert.equal((controller.match(/getContext\(/g) ?? []).length, 1);
  assert.match(controller, /softwareRenderer\(renderer\.getContext\(\)\)/);
  assert.match(controller, /UNMASKED_RENDERER_WEBGL/);
  assert.match(controller, /qualityControl\.dispatchEvent\(new Event\('change'\)\);/);
  // Low power really drops shadows: the lights state changes and every material recompiles.
  assert.match(controller, /sun\.castShadow = !low;/);
  assert.match(controller, /material\.needsUpdate = true;/);
});
