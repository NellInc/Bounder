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

/* GitHub Pages serves 404.html for any unmatched path while leaving the requested URL in the
   address bar, so this is the one page resolved from arbitrary depths. A document-relative
   reference here renders a deep 404 unstyled with a dead recovery link. */
test("the error page resolves identically at every depth", async () => {
  const html = await readSiteFile("404.html");
  const references = [...html.matchAll(/(?:href|src)="([^"]+)"/gi)].map(([, value]) => value);
  assert.ok(references.length >= 4, "404.html lost its references");

  for (const reference of references) {
    assert.match(reference, /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i, `404.html reference "${reference}" is document-relative`);
  }
});

test("body links point at destinations a browser renders", async () => {
  for (const path of ["index.html", "simulator.html", "contact.html", "privacy.html", "terms.html", "404.html"]) {
    const html = await readSiteFile(path);
    // Pages serves .md as text/markdown, which browsers download rather than display. A
    // GitHub blob URL for the same file is fine, because GitHub renders it as HTML.
    for (const [, reference] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) continue;
      assert.doesNotMatch(reference, /\.md(?:[?#]|$)/i, `${path} links a raw Markdown file: ${reference}`);
    }
  }
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

test("sitemap entries cover the indexable pages and agree with the dates those pages state", async () => {
  const sitemap = await readSiteFile("sitemap.xml");
  const entries = [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
    .map(([, loc, lastmod]) => ({ loc, lastmod }));

  // 404.html is excluded by name: it is the one root page served as an error document.
  const indexable = new Map([
    ["https://www.bounder.io/", "index.html"],
    ["https://www.bounder.io/simulator.html", "simulator.html"],
    ["https://www.bounder.io/contact.html", "contact.html"],
    ["https://www.bounder.io/privacy.html", "privacy.html"],
    ["https://www.bounder.io/terms.html", "terms.html"]
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.loc).sort(),
    [...indexable.keys()].sort(),
    "sitemap.xml no longer lists exactly the indexable root pages"
  );

  for (const { loc, lastmod } of entries) {
    const path = indexable.get(loc);
    assert.match(lastmod, /^\d{4}-\d{2}-\d{2}$/, `${loc} has a non-ISO lastmod: ${lastmod}`);
    const [year, month, day] = lastmod.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    assert.equal(parsed.getUTCMonth() + 1, month, `${loc} has an invalid lastmod date: ${lastmod}`);
    assert.equal(parsed.getUTCDate(), day, `${loc} has an invalid lastmod date: ${lastmod}`);

    const html = await readSiteFile(path);
    assert.match(html, new RegExp(`<link rel="canonical" href="${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`),
      `${path} canonical URL does not match its sitemap <loc>`);

    // A page that declares its own revision date is the authority; the sitemap must not lag it.
    const declared = html.match(/"dateModified":\s*"(\d{4}-\d{2}-\d{2})"/)?.[1];
    if (declared) assert.equal(lastmod, declared, `${path} declares dateModified ${declared} but the sitemap says ${lastmod}`);

    const stated = html.match(/Last updated<br><strong>(\d{1,2}) ([A-Z][a-z]+) (\d{4})<\/strong>/);
    if (stated) {
      const [, statedDay, monthName, statedYear] = stated;
      const monthIndex = MONTHS.indexOf(monthName);
      assert.notEqual(monthIndex, -1, `${path} states an unparseable month: ${monthName}`);
      const statedISO = `${statedYear}-${String(monthIndex + 1).padStart(2, "0")}-${String(Number(statedDay)).padStart(2, "0")}`;
      assert.ok(lastmod >= statedISO, `${path} reads "Last updated ${statedDay} ${monthName} ${statedYear}" but the sitemap lastmod ${lastmod} is older`);
      if (declared) assert.equal(declared, statedISO, `${path} visible date and JSON-LD dateModified disagree`);
    }
  }
});

/* GitHub silently falls back to a blank issue form when a template= parameter does not
   resolve, so a drifted name breaks the promise of a structured report with no visible error. */
test("every issue-template link resolves to a template that exists", async () => {
  for (const path of ["index.html", "simulator.html", "contact.html", "privacy.html", "terms.html", "404.html"]) {
    const html = await readSiteFile(path);
    for (const [, template] of html.matchAll(/issues\/new\?template=([A-Za-z0-9._-]+)/g)) {
      await access(new URL(`../.github/ISSUE_TEMPLATE/${template}`, import.meta.url));
    }
  }
});
