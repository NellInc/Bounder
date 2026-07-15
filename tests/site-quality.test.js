import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

  assert.doesNotMatch(parallax, /transition:\s*height/i);
  assert.doesNotMatch(scrollArrow, /bounce/i);
  assert.doesNotMatch(scrollArrow, /transition:\s*all/i);
});
