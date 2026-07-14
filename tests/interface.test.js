import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [simulatorHtml, simulatorScript, simulatorStyles, styles] = await Promise.all([
  readFile(new URL("../simulator.html", import.meta.url), "utf8"),
  readFile(new URL("../simulator.js", import.meta.url), "utf8"),
  readFile(new URL("../simulator.css", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

test("simulator exposes focused WASD and altitude navigation", () => {
  assert.match(simulatorHtml, /tabindex="0"/);
  assert.match(simulatorHtml, /aria-keyshortcuts="W A S D Q E"/);
  assert.match(simulatorHtml, /Use Q to descend and E to climb/);
  assert.match(simulatorScript, /navigationCodes = new Set\(\["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"\]\)/);
  assert.match(simulatorScript, /updateCameraNavigation\(delta\)/);
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
  assert.match(simulatorScript, /fleetDrones = Array\.from/);
  assert.match(simulatorScript, /bounder-fleet-evidence\.v1\.json/);
  assert.match(simulatorScript, /fleetMode = !fleetMode/);
  assert.match(simulatorStyles, /\.fleet-control-panel\.is-active/);
});

test("resilience laboratory exposes deterministic fault controls and live-stream fallback", () => {
  assert.match(simulatorHtml, /Fleet resilience laboratory/);
  assert.match(simulatorHtml, /data-resilience-action="run"/);
  assert.match(simulatorHtml, /data-resilience-action="step"/);
  assert.match(simulatorHtml, /data-resilience-scrubber/);
  assert.match(simulatorHtml, /bounder-resilience-evidence\.v1\.schema\.json/);
  assert.match(simulatorScript, /new EventSource\(`\.\/api\/resilience\/events\?scenario=/);
  assert.match(simulatorScript, /playResilienceLocally\(\)/);
  assert.match(simulatorStyles, /\.resilience-console/);
  assert.match(simulatorStyles, /\.fleet-node\.is-affected/);
});

test("rollback proof scenarios expose local and Fleet floors plus bounded authority", () => {
  assert.match(simulatorHtml, /Rollback-proof checkpoint/);
  assert.match(simulatorHtml, /data-resilience="local-floor"/);
  assert.match(simulatorHtml, /data-resilience="fleet-floor"/);
  assert.match(simulatorHtml, /data-resilience="lease"/);
  assert.match(simulatorHtml, /creedspace-bounder-checkpoint-v1\.schema\.json/);
  assert.match(simulatorScript, /coherent-snapshot-rollback/);
  assert.match(simulatorScript, /continuity-lease-expiry/);
  assert.match(simulatorScript, /renderContinuityProof/);
  assert.match(simulatorStyles, /\.continuity-proof\.is-held/);
});
