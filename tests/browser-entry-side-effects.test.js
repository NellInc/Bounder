import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The staging feed and the 3D controller must not mount the policy panel as a side effect of
// importing a runtime seam. A markup regression in the panel would otherwise abort module
// evaluation and cascade into an import failure of staging-feed.js and the whole simulator.
const selectors = [];
globalThis.document = {
  querySelector(selector) {
    selectors.push(selector);
    return undefined;
  }
};

test("the staging feed depends only on the narrow JSON seam", async () => {
  const source = await readFile(new URL("../staging-feed.js", import.meta.url), "utf8");
  assert.match(source, /import \{ parseStrictJSON \} from "\.\/runtime\/json\/policy-json\.js";/);
  assert.doesNotMatch(source, /from "\.\/policy-roundtrip\.js"/);
});

test("importing the policy runtime, its JSON seam or the staging feed mounts no DOM", async () => {
  await import("../runtime/policy/core.js");
  await import("../runtime/json/policy-json.js");
  await import("../staging-feed.js");
  assert.deepEqual(selectors, []);
});

test("the UI seam is the module that mounts the policy panel", async () => {
  await import("../ui/policy-roundtrip-panel.js");
  assert.deepEqual(selectors, ["[data-policy-roundtrip]"]);
});
