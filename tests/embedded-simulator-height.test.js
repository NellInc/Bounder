import assert from "node:assert/strict";
import test from "node:test";

// site.js is a DOM entry point rather than a module with exports, so it is exercised here against
// a minimal fake window: the listener it registers is captured and driven directly.
const contentWindow = { name: "embedded simulator" };
const iframe = { style: { height: "980px" }, contentWindow };
let post;

globalThis.document = {
  querySelector: (selector) => (selector === "[data-bounder-simulator]" ? iframe : undefined)
};
globalThis.window = {
  innerHeight: 700,
  location: { origin: "https://www.bounder.io" },
  addEventListener(type, listener) {
    assert.equal(type, "message");
    post = listener;
  }
};

await import("../site.js");

const send = (data, { origin = "https://www.bounder.io", source = contentWindow } = {}) => {
  post({ origin, source, data });
};
const height = ({ height: value, ...rest } = {}) => {
  send({ type: "bounder-simulator-height", height: value }, rest);
  return iframe.style.height;
};

test("site.js subscribes for embedded simulator height messages", () => {
  assert.equal(typeof post, "function");
});

test("a height inside the accepted band is applied verbatim", () => {
  assert.equal(height({ height: 1200 }), "1200px");
  assert.equal(height({ height: 1200.2 }), "1201px");
});

test("a short report is clamped up to the minimum rather than discarded", () => {
  assert.equal(height({ height: 499 }), "500px");
  assert.equal(height({ height: 0 }), "500px");
});

test("a tall narrow-viewport report is clamped to the ceiling rather than discarded", () => {
  // The embedded simulator is several thousand pixels tall on a phone; the old range test
  // rejected 2401 outright and left the iframe at its stale CSS height.
  assert.equal(height({ height: 2401 }), "2401px");
  assert.equal(height({ height: 4800 }), "4800px");
  assert.equal(height({ height: 9_000_000 }), "5600px");
});

test("the ceiling follows the parent viewport but never falls below 2400px", () => {
  globalThis.window.innerHeight = 200;
  assert.equal(height({ height: 9_000_000 }), "2400px");
  globalThis.window.innerHeight = 1000;
  assert.equal(height({ height: 9_000_000 }), "8000px");
  globalThis.window.innerHeight = 700;
});

test("untrusted, mistyped or non-finite messages leave the iframe untouched", () => {
  iframe.style.height = "980px";
  assert.equal(height({ height: Number.NaN }), "980px");
  assert.equal(height({ height: Number.POSITIVE_INFINITY }), "980px");
  assert.equal(height({ height: "2000" }), "980px");
  assert.equal(height({ height: 1200, origin: "https://attacker.example" }), "980px");
  assert.equal(height({ height: 1200, source: { other: true } }), "980px");
  send({ type: "something-else", height: 1200 });
  assert.equal(iframe.style.height, "980px");
  send(undefined);
  assert.equal(iframe.style.height, "980px");
});
