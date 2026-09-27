import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [indexHtml, simulatorHtml, simulatorScript, simulatorStyles, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../simulator.html", import.meta.url), "utf8"),
  readFile(new URL("../simulator/controller.js", import.meta.url), "utf8"),
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
  // Zoom keys stay in the navigation help: a bare "+" token is the combination delimiter.
  assert.match(simulatorHtml, /aria-keyshortcuts="W A S D Q E"/);
  assert.match(simulatorHtml, /Use Q to descend and E to climb/);
  assert.match(simulatorHtml, /Use plus and minus to zoom/);
});

test("town buildings use footprint-aware ridged roofs", async () => {
  const sceneSource = await readFile(new URL("../simulator/scene.js", import.meta.url), "utf8");
  assert.match(sceneSource, /makeGableRoofGeometry\(spec\.width, spec\.depth\)/);
  assert.doesNotMatch(sceneSource, /roof\.scale\.z = spec\.depth \/ spec\.width/);
});

test("the simulator stage keeps a scene and decision desktop workspace", () => {
  assert.match(simulatorStyles, /aspect-ratio: 16 \/ 9/);
  assert.match(simulatorStyles, /grid-template-columns: minmax\(0, 2\.35fr\) minmax\(280px, 1fr\)/);
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
  assert.match(simulatorHtml, /Checks: contracts, digests and signature format/);
  assert.match(simulatorHtml, /Audit authentication requires the producer’s public keys/);
  assert.doesNotMatch(simulatorHtml, /streams verified Fleet events/);
  assert.match(simulatorHtml, /inspect the recorded decision receipt/);
  assert.doesNotMatch(simulatorHtml, /signed decision receipt/);
  assert.doesNotMatch(simulatorScript, /Verify the signed baseline/);
  assert.match(simulatorScript, /Recorded as verified by Go engine/);
  assert.doesNotMatch(simulatorScript, /"Ed25519 verified by engine"/);
});

test("simulator exposes a local signed-policy verifier and WebGL-independent evidence view", async () => {
  assert.match(simulatorHtml, /data-policy-roundtrip/);
  assert.match(simulatorHtml, /data-policy-action="sample"/);
  assert.match(simulatorHtml, /data-policy-file/);
  assert.match(simulatorHtml, /simulator-bootstrap\.js/);
  // The panel is mounted by the ui/ seam, not by the policy core, so loading the core in a
  // worker or test never touches the DOM. simulator.html must load that seam directly.
  const policyEntry = simulatorHtml.match(/<script type="module" src="([^"]*policy-roundtrip[^"]*\.js)">/)?.[1];
  assert.equal(policyEntry, "ui/policy-roundtrip-panel.js");
  const policyEntrySource = await readFile(new URL(`../${policyEntry}`, import.meta.url), "utf8");
  assert.match(policyEntrySource, /bootstrapPolicyRoundTrip\(document\)/);
  assert.doesNotMatch(await readFile(new URL("../runtime/policy/core.js", import.meta.url), "utf8"), /bootstrapPolicyRoundTrip\(document\)/);
});

test("the simulator canvas leaves vertical page scrolling to the browser on touch devices", () => {
  assert.match(simulatorScript, /canvas\.style\.touchAction = "pan-y";/);
  assert.match(simulatorScript, /controls\.touches = \{ ONE: THREE\.TOUCH\.ROTATE, TWO: THREE\.TOUCH\.DOLLY_ROTATE \};/);
});

// Source guards, not behavioural proof: each pins the code shape of a behaviour that
// tests/browser proves in a real browser (WebGL loss and bootstrap in workspace.spec.js and
// site.spec.js; reduced motion by counting animation frames in site.spec.js).
test("source guard: a WebGL runtime failure releases the renderer and the canvas input surface", () => {
  assert.match(simulatorScript, /controls\.dispose\(\);/);
  assert.match(simulatorScript, /renderer\.dispose\(\);/);
  assert.match(simulatorScript, /releaseCanvasInput\(\);/);
});

test("source guard: reduced motion removes autonomous motion without throttling user-driven frames", () => {
  // No frame gate: a two-second throttle made Play take minutes and camera input lag.
  assert.doesNotMatch(simulatorScript, /reduceMotionTimer/);
  // Autonomous motion alone keeps the loop alive; input, camera moves and state changes render once.
  assert.match(simulatorScript, /if \(\(playing && !reduceMotion\) \|\| pressedNavigationKeys\.size \|\| cameraChanged \|\| tweening\) scheduleAnimation\(\);/);
  // No post-drag camera glide and no animated camera transitions under reduced motion.
  assert.match(simulatorScript, /controls\.enableDamping = !reduceMotion;/);
  assert.match(simulatorScript, /if \(!animate \|\| reduceMotion \|\| !rendererOperational\) \{/);
  // Play jumps to the recorded decision instead of flying the route.
  assert.match(simulatorScript, /Reduced motion: no flight\./);
});

test("every abandoned live resilience stream keeps the recorded local fallback and marks it", () => {
  assert.match(simulatorScript, /const useRecordedEvidence = \(reason\) => \{/);
  assert.match(simulatorScript, /stage\.dataset\.resilienceFallback = "true";\n\s+playResilienceLocally\(\);/);
  assert.doesNotMatch(simulatorScript, /catch \(error\) \{\n\s+playResilienceLocally\(\);/);
});

test("source guard: bootstrap fails closed and always restores the render loop", () => {
  assert.match(simulatorScript, /const showBootstrapFailure = \(\) => \{/);
  assert.match(simulatorScript, /\} finally \{\n\s+bootstrapSettled = true;\n\s+resize\(\);\n\s+scheduleAnimation\(\);\n(?:\s+\/\/[^\n]*\n)*\s+requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{ lastTime = 0; scheduleAnimation\(\); \}\)\);\n\s+\}/);
  // A same-size resize must not clear the canvas; a real one redraws in the same call.
  assert.match(simulatorScript, /if \(sizeChanged\) \{\n\s+renderer\.setSize\(width, height, false\);/);
  assert.match(simulatorScript, /if \(sizeChanged && bootstrapSettled\) \{\n\s+try \{\n\s+renderer\.render\(scene, camera\);/);
  assert.match(simulatorScript, /bootstrap\(\)\.catch\(/);
});

test("Guardian names the component consistently in simulator copy", () => {
  assert.doesNotMatch(simulatorScript, /"[^"]*\b(?:a|the|every|enrolled|older|single|Bounder) guardian\b[^"]*"/);
  assert.match(simulatorScript, /for every enrolled Guardian\./);
  assert.match(simulatorScript, /but older Guardian state\./);
  assert.match(simulatorScript, /"Creed Space Fleet \+ Bounder Guardian"/);
  // The Fleet toggle keeps one accessible name; aria-pressed carries its state.
  assert.doesNotMatch(simulatorScript, /"Single Guardian"/);
  assert.match(simulatorScript, /fleetButton\.setAttribute\("aria-pressed", String\(fleetMode\)\)/);
  assert.match(simulatorHtml, /data-action="fleet" aria-pressed="false" disabled>Fleet view<\/button>/);
});

test("rollback proof scenarios expose local and Fleet floors plus bounded authority", () => {
  assert.match(simulatorHtml, /Rollback-proof checkpoint/);
  assert.match(simulatorHtml, /data-resilience="local-floor"/);
  assert.match(simulatorHtml, /data-resilience="fleet-floor"/);
  assert.match(simulatorHtml, /data-resilience="lease"/);
  assert.match(simulatorHtml, /creedspace-bounder-checkpoint-v1\.schema\.json/);
  assert.match(simulatorStyles, /\.continuity-proof\.is-held/);
});

test("rules-of-engagement scenarios expose the recorded example for inspection", () => {
  for (const scenario of ["surrender", "incapacitated", "identification", "proportionality", "human_authorization"]) {
    assert.match(simulatorHtml, new RegExp(`data-scenario="${scenario}"`));
  }
  assert.match(simulatorHtml, /Inspect the signed example:/);
  assert.match(simulatorHtml, /href="data\/creedspace-bounder-roundtrip-v1\.json"/);
});

test("guided operator tour deep-links to six evidence-backed proofs", () => {
  assert.match(simulatorHtml, /data-action="tour"/);
  assert.match(simulatorHtml, /data-operator-tour/);
  assert.match(simulatorHtml, /data-tour-action="previous"/);
  assert.match(simulatorHtml, /data-tour-action="next"/);
  assert.match(simulatorStyles, /\.operator-tour/);
});

// Simulator shell: restraint copy, valid controls, start-up order and fail-closed states.
const { showFleetUnavailable } = await import("../ui/fleet-view.js");
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [html, css, bootstrap, workbench, fallback] = await Promise.all([
  read("simulator.html"), read("simulator.css"), read("simulator-bootstrap.js"), read("ui/workbench.js"), read("simulator-fallback.js")
]);
const visibleText = (markup) => markup
  .replace(/<script\b[\s\S]*?<\/script>/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

test("site-owned simulator copy uses restraint language, not targeting vocabulary", () => {
  const text = visibleText(html);
  for (const phrase of [/targeting/i, /positive identification/i, /proportionality/i, /friendly/i, /intercept request/i]) {
    assert.doesNotMatch(text, phrase);
  }
  for (const label of ["Team separation", "Identity check", "Consequence check", "Surrender signalled"]) assert.match(text, new RegExp(label));
  // Producer scenario ids and rule keys are unchanged.
  for (const id of ["friendly", "identification", "proportionality", "surrender"]) assert.match(html, new RegExp(`data-scenario="${id}"`));
  // A rule that only holds never reads PASS, which would look like an authorisation.
  assert.doesNotMatch(fallback, /"PASS"/);
});

test("the accessible view states a receipt load failure in plain words, never the raw error", () => {
  assert.doesNotMatch(fallback, /failClosed\([^)]*error\.message/);
  assert.match(fallback, /failClosed\("The recorded interlock receipt bundle could not be loaded or validated\. The simulation remains paused\."\)/);
});

test("both receipt views mark the recorded evaluation time as a machine-readable time, text unchanged", async () => {
  const controller = await read("simulator/controller.js");
  for (const source of [controller, fallback]) {
    assert.match(source, /evaluatedTime\.dateTime = receipt\.evaluated_at;\s+evaluatedTime\.textContent = receipt\.evaluated_at;\s+receiptFields\.evaluated\.replaceChildren\(evaluatedTime\);/);
  }
});

test("the scrubber is a valid labelled range and the canvas shortcuts carry no bare plus token", () => {
  assert.match(html, /<label for="resilience-time">Event time<\/label> <output for="resilience-time"/);
  assert.match(html, /<input id="resilience-time" type="range"[^>]*aria-valuetext="0\.00 seconds, ready"/);
  assert.doesNotMatch(html, /<label class="resilience-scrubber">/);
  assert.match(html, /aria-keyshortcuts="W A S D Q E"/);
});

test("the bootstrap loads first and stays free of imports so it can always fail closed", () => {
  const order = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map(([, src]) => src);
  assert.deepEqual(order, ["simulator-bootstrap.js", "ui/policy-roundtrip-panel.js", "ui/workbench.js"]);
  assert.doesNotMatch(bootstrap, /^\s*(import|export)\b/m);
  assert.match(bootstrap, /stage\.dataset\.bootstrap = "started";/);
  assert.match(bootstrap, /SLOW_START_MS = 20_000/);
  assert.match(bootstrap, /HTMLScriptElement/);
  assert.match(workbench, /failClosedWithoutBootstrap/);
  assert.doesNotMatch(html, /class="evidence-nav"/);
});

test("the stage notice is hidden while loading and the initial headline is pending, not unavailable", () => {
  assert.match(css, /\.simulator-stage:not\(\.is-unavailable\):not\(\.is-slow\) \.webgl-fallback:not\(\.noscript-fallback\)/);
  assert.match(html, /<strong class="decision-outcome">Pending<\/strong>/);
  assert.match(css, /-webkit-backdrop-filter: blur\(10px\);\s*backdrop-filter: blur\(10px\);/);
  assert.doesNotMatch(css, /#efc178;[\s\S]*#efc178;/, "the caution colour is one token");
});

test("an unavailable Fleet leaves no Loading text and says so in the count", () => {
  const element = (dataset = {}) => ({ dataset, textContent: "Loading", title: "x", removeAttribute(name) { delete this[name]; } });
  const stage = element();
  const source = element();
  const count = element();
  const fields = ["name", "devices", "policy", "evidence"].map((key) => element({ fleet: key }));
  const root = {
    querySelector: (selector) => ({ ".simulator-stage": stage, "[data-fleet-source]": source, "[data-fleet-count]": count })[selector],
    querySelectorAll: (selector) => (selector === "[data-fleet]" ? fields : [])
  };
  showFleetUnavailable(root, "Fleet evidence unavailable");
  assert.equal(stage.dataset.fleetReady, "false");
  assert.equal(source.dataset.source, "unavailable");
  assert.equal(count.textContent, "Recorded Fleet evidence could not be loaded.");
  for (const field of fields) {
    assert.equal(field.textContent, "Unavailable");
    assert.equal(field.title, undefined);
  }
});
