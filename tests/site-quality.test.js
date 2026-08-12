import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readSiteFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const historicalPages = [
  "docs/gallery-shift.html",
  "docs/index.html",
  "docs/privacy.html",
  "docs/ride-to-live-shift.html",
  "docs/terms.html"
];

test("historical images retain a native fallback source", async () => {
  for (const path of ["docs/gallery-shift.html", "docs/index.html"]) {
    const html = await readSiteFile(path);
    // impeccable-disable-next-line broken-image: this regex finds image tags so the assertions can reject missing sources
    const images = html.match(/<img\b[^>]*>/gi) ?? [];

    for (const image of images) {
      assert.match(image, /(?:^|\s)src\s*=\s*["'][^"']+["']/i, `${path} contains an image without src`);
    }
  }
});

test("historical policy prose and footers remain readable", async () => {
  for (const path of historicalPages) {
    const html = await readSiteFile(path);
    assert.doesNotMatch(html, /text-align\s*:\s*justify/i, `${path} reintroduced justified prose`);
    assert.match(html, /color: #d1d1d1; background: #171717;/, `${path} lost explicit footer contrast`);
  }
});

test("archived helpers avoid layout and perpetual bounce animations", async () => {
  const [parallax, scrollArrow] = await Promise.all([
    readSiteFile("docs/assets/js/parallax-fix.js"),
    readSiteFile("docs/assets/js/scroll-arrow.js")
  ]);

  // impeccable-disable-next-line layout-transition: the test forbids this exact layout-triggering transition
  assert.doesNotMatch(parallax, /transition:\s*height/i);
  assert.doesNotMatch(scrollArrow, /bounce/i);
  assert.doesNotMatch(scrollArrow, /transition:\s*all/i);
});

test("every historical page is excluded from search indexing", async () => {
  for (const path of [...historicalPages, "docs/contact.html", "docs/404.html"]) {
    const html = await readSiteFile(path);
    assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/i, `${path} is indexable`);
  }
});

test("canonical pages publish complete metadata and valid local references", async () => {
  const pages = ["index.html", "simulator.html", "contact.html", "privacy.html", "terms.html"];
  for (const path of pages) {
    const html = await readSiteFile(path);
    assert.match(html, /<html lang="en-GB">/i, `${path} lost its language`);
    assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/i, `${path} lost its referrer policy`);
    assert.match(html, /<link rel="canonical" href="https:\/\/www\.bounder\.io\//i, `${path} lost its canonical URL`);
    assert.equal((html.match(/<h1\b/gi) ?? []).length, 1, `${path} must contain one h1`);
    assert.doesNotMatch(html, /class="copyright">©\s+\d{4}/, `${path} reintroduced a maintenance-sensitive footer year`);

    for (const [, reference] of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/gi)) {
      if (/^(?:[a-z]+:|\/\/)/i.test(reference)) continue;
      await access(new URL(reference, new URL(path, root)));
    }
  }
});

test("repository guidance names only the canonical repository", async () => {
  const [readme, security] = await Promise.all([readSiteFile("README.md"), readSiteFile("SECURITY.md")]);
  assert.doesNotMatch(`${readme}\n${security}`, /github\.com\/NellWatson\/Bounder/);
  assert.doesNotMatch(security, /docs\/(?:THREAT_MODEL|LEGACY_STATUS)\.md/);
});

test("privileged workflow actions are pinned to immutable commits", async () => {
  for (const path of [
    ".github/workflows/deploy-pages.yml",
    ".github/workflows/receipt-drift.yml",
    ".github/workflows/site-quality.yml"
  ]) {
    const workflow = await readSiteFile(path);
    for (const [, action] of workflow.matchAll(/uses:\s*([^\s#]+)/g)) {
      assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/, `${path} contains a mutable action reference: ${action}`);
    }
  }
});
