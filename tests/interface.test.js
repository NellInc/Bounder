import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [indexHtml, simulatorHtml, simulatorScript, simulatorStyles, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../simulator.html", import.meta.url), "utf8"),
  readFile(new URL("../simulator.js", import.meta.url), "utf8"),
  readFile(new URL("../simulator.css", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

test("the homepage positions Bounder within the Guardian and Creed Space Fleet architecture", () => {
  assert.match(indexHtml, /<strong>Guardian<\/strong> is the general pattern/);
  assert.match(indexHtml, /<strong>Bounder<\/strong> is the Guardian for embodied movement and physical-action boundaries/);
  assert.match(indexHtml, /<strong>Creed Space Fleet<\/strong> distributes and governs its policies/);
  assert.match(indexHtml, /ground robots, autonomous boats, warehouse vehicles, inspection platforms/);
});

test("simulator exposes focused WASD and altitude navigation", () => {
  assert.match(simulatorHtml, /tabindex="0"/);
  assert.match(simulatorHtml, /aria-keyshortcuts="W A S D Q E"/);
  assert.match(simulatorHtml, /Use Q to descend and E to climb/);
});

test("town buildings use footprint-aware ridged roofs", () => {
  assert.match(simulatorScript, /makeGableRoofGeometry\(spec\.width, spec\.depth\)/);
  assert.doesNotMatch(simulatorScript, /roof\.scale\.z = spec\.depth \/ spec\.width/);
});

test("the simulator stage keeps a widescreen desktop presentation", () => {
  assert.match(simulatorStyles, /aspect-ratio: 16 \/ 9/);
  assert.match(simulatorStyles, /grid-template-areas:\s*"header rules actuation"\s*"header rules receipt"/);
});

test("the custom Bounder lockup is integrated into the shared wordmark", () => {
  assert.match(simulatorHtml, /assets\/bounder-mark\.svg/);
  assert.match(simulatorHtml, /class="brand-lockup"/);
  assert.match(styles, /mask: url\("assets\/bounder-wordmark\.svg"\)/);
});

test("Creed Space Fleet control is visible, interactive, and evidence backed", () => {
  assert.match(simulatorHtml, /Creed Space Fleet/);
  assert.match(simulatorHtml, /data-action="fleet"/);
  assert.match(simulatorHtml, /data-fleet-nodes/);
  assert.match(simulatorStyles, /\.fleet-control-panel\.is-active/);
});

test("resilience laboratory exposes deterministic fault controls and live-stream fallback", () => {
  assert.match(simulatorHtml, /Fleet resilience laboratory/);
  assert.match(simulatorHtml, /data-resilience-action="run"/);
  assert.match(simulatorHtml, /data-resilience-action="step"/);
  assert.match(simulatorHtml, /data-resilience-scrubber/);
  assert.match(simulatorHtml, /bounder-resilience-evidence\.v1\.schema\.json/);
  assert.match(simulatorHtml, /name="bounder-resilience-stream"/);
  assert.match(simulatorStyles, /\.resilience-console/);
  assert.match(simulatorStyles, /\.fleet-node\.is-affected/);
});

test("recorded evidence is labelled without claiming unavailable browser authentication", () => {
  assert.match(simulatorHtml, /fixture omits the audit public key bytes/);
  assert.match(simulatorHtml, /audit signatures are recorded evidence rather than authenticated here/);
  assert.doesNotMatch(simulatorHtml, /streams verified Fleet events/);
  assert.match(simulatorHtml, /inspect the recorded decision receipt/);
  assert.doesNotMatch(simulatorHtml, /signed decision receipt/);
  assert.doesNotMatch(simulatorScript, /Verify the signed baseline/);
  assert.match(simulatorScript, /Recorded as verified by Go engine/);
  assert.doesNotMatch(simulatorScript, /"Ed25519 verified by engine"/);
});

test("simulator exposes a local signed-policy verifier and WebGL-independent evidence view", () => {
  assert.match(simulatorHtml, /data-policy-roundtrip/);
  assert.match(simulatorHtml, /data-policy-action="sample"/);
  assert.match(simulatorHtml, /data-policy-file/);
  assert.match(simulatorHtml, /policy-roundtrip\.js/);
  assert.match(simulatorHtml, /simulator-bootstrap\.js/);
});

test("rollback proof scenarios expose local and Fleet floors plus bounded authority", () => {
  assert.match(simulatorHtml, /Rollback-proof checkpoint/);
  assert.match(simulatorHtml, /data-resilience="local-floor"/);
  assert.match(simulatorHtml, /data-resilience="fleet-floor"/);
  assert.match(simulatorHtml, /data-resilience="lease"/);
  assert.match(simulatorHtml, /creedspace-bounder-checkpoint-v1\.schema\.json/);
  assert.match(simulatorStyles, /\.continuity-proof\.is-held/);
});

test("rules-of-engagement scenarios are visible and evidence-only", () => {
  for (const scenario of ["surrender", "incapacitated", "identification", "proportionality", "human_authorization"]) {
    assert.match(simulatorHtml, new RegExp(`data-scenario="${scenario}"`));
  }
  assert.match(simulatorHtml, /does not issue authority or generate a deployment receipt/);
});

test("guided operator tour deep-links to six evidence-backed proofs", () => {
  assert.match(simulatorHtml, /data-action="tour"/);
  assert.match(simulatorHtml, /data-operator-tour/);
  assert.match(simulatorHtml, /data-tour-action="previous"/);
  assert.match(simulatorHtml, /data-tour-action="next"/);
  assert.match(simulatorStyles, /\.operator-tour/);
});
