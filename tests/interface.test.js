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
