import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pages = ["index.html", "simulator.html", "contact.html", "privacy.html", "terms.html", "404.html"];
const readPage = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/* GitHub Pages cannot emit response headers, so a meta policy is the only enforcement route.
   A meta CSP fails silently and closed: nothing in the page reports a stale hash, so these
   assertions are the only thing standing between an edited inline script and a dead page. */
const INLINE_SCRIPT = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script>/gi;

const inlineScriptHashes = (html) => {
  const hashes = [];
  for (const [, attributes, body] of html.matchAll(INLINE_SCRIPT)) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    // JSON-LD is data, not an executed script, so it is outside script-src entirely.
    if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attributes)) continue;
    hashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return hashes;
};

const parsePolicy = (html, path) => {
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/i);
  assert.ok(match, `${path} lost its Content-Security-Policy meta`);
  const directives = new Map();
  for (const clause of match[1].split(";")) {
    const [name, ...values] = clause.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), values);
  }
  return directives;
};

test("every published page carries an enforceable content security policy", async () => {
  for (const path of pages) {
    const policy = parsePolicy(await readPage(path), path);
    assert.deepEqual(policy.get("default-src"), ["'self'"], `${path} lost its default-src fallback`);
    assert.deepEqual(policy.get("base-uri"), ["'self'"], `${path} allows a base tag to retarget relative URLs`);
    assert.deepEqual(policy.get("object-src"), ["'none'"], `${path} allows plugin content`);
    assert.deepEqual(policy.get("style-src"), ["'self'"], `${path} allows foreign or inline styles`);
    assert.ok(policy.get("script-src")?.includes("'self'"), `${path} lost same-origin script loading`);
    for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", "*"]) {
      assert.ok(!policy.get("script-src")?.includes(forbidden), `${path} weakened script-src with ${forbidden}`);
    }
  }
});

test("each inline script is allowed by its own hash rather than by unsafe-inline", async () => {
  for (const path of pages) {
    const html = await readPage(path);
    const allowed = parsePolicy(html, path).get("script-src") ?? [];
    const hashes = inlineScriptHashes(html);

    for (const hash of hashes) {
      assert.ok(allowed.includes(hash), `${path} contains an inline script not allowed by script-src (expected ${hash})`);
    }
    // A hash left behind after its script is deleted or externalised is dead policy weight.
    for (const entry of allowed.filter((value) => value.startsWith("'sha256-"))) {
      assert.ok(hashes.includes(entry), `${path} declares ${entry} but has no matching inline script`);
    }
  }
});

// Every meta-configured endpoint a page may contact. A feed repointed at another host without a
// matching connect-src entry would be blocked silently and fall back to recorded evidence.
const endpointMetas = ["bounder-continuity-feed", "bounder-staging-feed", "bounder-resilience-stream"];

test("every endpoint origin a page configures is an origin its policy permits", async () => {
  for (const path of pages) {
    const html = await readPage(path);
    const connect = parsePolicy(html, path).get("connect-src") ?? [];
    assert.ok(connect.includes("'self'"), `${path} lost same-origin fetching`);
    const origins = new Set();
    for (const name of endpointMetas) {
      const value = html.match(new RegExp(`<meta name="${name}" content="([^"]*)">`, "i"))?.[1] ?? "";
      if (!value) continue;
      const origin = new URL(value, "https://www.bounder.io/").origin;
      if (origin !== "https://www.bounder.io") origins.add(origin);
    }
    for (const origin of origins) {
      assert.ok(connect.includes(origin), `${path} configures an endpoint on ${origin} but connect-src does not allow it`);
    }
    const foreign = connect.filter((value) => value !== "'self'");
    assert.deepEqual(foreign.sort(), [...origins].sort(), `${path} connect-src permits origins it never configures`);
  }
});

test("no page reintroduces inline event handlers or style attributes", async () => {
  for (const path of pages) {
    const html = await readPage(path);
    // Either construct requires 'unsafe-inline'/'unsafe-hashes' and would silently stop working.
    assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+\s*=/i, `${path} reintroduced an inline event handler`);
    assert.doesNotMatch(html, /<[a-z][^>]*\sstyle\s*=\s*["']/i, `${path} reintroduced an inline style attribute`);
    assert.doesNotMatch(html, /<style[\s>]/i, `${path} reintroduced an inline style block`);
  }
});
