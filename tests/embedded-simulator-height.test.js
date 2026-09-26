import assert from "node:assert/strict";
import test from "node:test";

// site.js is a DOM entry point rather than a module with exports, so it is exercised here against
// a minimal fake window: the listener it registers is captured and driven directly.
const heightRequests = [];
const contentWindow = {
  name: "embedded simulator",
  postMessage: (data, targetOrigin) => heightRequests.push({ data, targetOrigin })
};
const frameListeners = {};
// What the frame's own document holds once it loads: the simulator's stage, or an error page.
let frameDocument = { querySelector: (selector) => (selector === ".simulator-stage" ? {} : null) };
let replacement = null;
const iframe = {
  style: { height: "980px" },
  contentWindow,
  get contentDocument() {
    if (frameDocument instanceof Error) throw frameDocument;
    return frameDocument;
  },
  addEventListener: (type, listener) => { frameListeners[type] = listener; },
  replaceWith: (node) => { replacement = node; }
};
let post;

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.textContent = "";
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
}

globalThis.document = {
  querySelector: (selector) => (selector === "[data-bounder-simulator]" ? iframe : undefined),
  createElement: (tag) => new FakeNode(tag)
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

test("site.js asks the frame for a height report when it starts listening and when the frame loads", () => {
  // A frame that reported before the listener existed would otherwise keep its stale CSS height.
  const request = { data: { type: "bounder-simulator-height-request" }, targetOrigin: "https://www.bounder.io" };
  assert.deepEqual(heightRequests, [request]);
  assert.equal(typeof frameListeners.load, "function");
  frameListeners.load();
  assert.deepEqual(heightRequests, [request, request]);
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

test("a loaded frame without the simulator's stage is replaced by links to the simulator and recorded evidence", () => {
  const requestsBefore = heightRequests.length;
  frameDocument = { querySelector: () => null };
  frameListeners.load();
  assert.equal(heightRequests.length, requestsBefore, "an unusable frame is not asked for its height");
  assert.ok(replacement, "the frame must be replaced");
  assert.equal(replacement.className, "home-simulator-unavailable");
  assert.equal(replacement.attributes.role, "status");
  const links = replacement.children[1].children;
  assert.deepEqual(links.map((link) => link.href), ["simulator.html", "data/bounder-receipts.v1.json"]);
});

test("an opaque error page (cross-origin contentDocument) is treated as a failed load", () => {
  replacement = null;
  frameDocument = new DOMException("Blocked a frame from accessing a cross-origin frame.", "SecurityError");
  frameListeners.load();
  assert.ok(replacement);
  replacement = null;
  frameDocument = null;
  frameListeners.load();
  assert.ok(replacement, "a null contentDocument is also a failed load");
});

test("a frame that loads the simulator is kept and asked for its height", () => {
  replacement = null;
  frameDocument = { querySelector: (selector) => (selector === ".simulator-stage" ? {} : null) };
  const requestsBefore = heightRequests.length;
  frameListeners.load();
  assert.equal(replacement, null);
  assert.equal(heightRequests.length, requestsBefore + 1);
});
