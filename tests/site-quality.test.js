import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
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

test("canonical pages publish complete metadata", async () => {
  const pages = ["index.html", "simulator.html", "contact.html", "privacy.html", "terms.html"];
  for (const path of pages) {
    const html = await readSiteFile(path);
    assert.match(html, /<html lang="en-GB">/i, `${path} lost its language`);
    assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/i, `${path} lost its referrer policy`);
    assert.match(html, /<link rel="canonical" href="https:\/\/www\.bounder\.io\//i, `${path} lost its canonical URL`);
    assert.equal((html.match(/<h1\b/gi) ?? []).length, 1, `${path} must contain one h1`);
    assert.doesNotMatch(html, /class="copyright">©\s+\d{4}/, `${path} reintroduced a maintenance-sensitive footer year`);
  }
});

const SITE_ORIGIN = "https://www.bounder.io";
const linkedPages = ["index.html", "simulator.html", "contact.html", "privacy.html", "terms.html", "404.html"];
const elementIds = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id));

/* A reference is valid only if the file it names is in the publication allowlist: a file that
   exists in the repository but outside canonicalPublicPaths passes an existence check and then
   404s on Pages. A `page.html#id` reference must also land on an element the page declares. */
test("every local reference resolves to a published file and every fragment to a declared id", async () => {
  const { inspectPublicTree } = await import("../scripts/build-site.mjs");
  const published = new Set((await inspectPublicTree()).filter(({ type }) => type === "file").map(({ path }) => path));
  const pages = new Map(await Promise.all(linkedPages.map(async (path) => [path, await readSiteFile(path)])));
  for (const [path, html] of pages) {
    // href/src may be relative; a meta content= value counts only as a same-origin absolute URL
    // (canonical Open Graph images and endpoints), since it carries many non-URL values too.
    const references = [
      ...[...html.matchAll(/\s(?:href|src)="([^"]*)"/gi)].map(([, value]) => value),
      ...[...html.matchAll(/\scontent="(https:\/\/www\.bounder\.io\/[^"]*)"/gi)].map(([, value]) => value)
    ];
    for (const raw of references) {
      const reference = raw.replaceAll("&amp;", "&");
      if (!reference) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference) && !reference.startsWith(`${SITE_ORIGIN}/`)) continue;
      const url = new URL(reference, `${SITE_ORIGIN}/${path}`);
      if (url.origin !== SITE_ORIGIN) continue;
      let target = decodeURIComponent(url.pathname.slice(1));
      if (target === "" || target.endsWith("/")) target += "index.html";
      assert.ok(published.has(target), `${path} references ${reference}, which is not in the published tree`);
      const fragment = decodeURIComponent(url.hash.slice(1));
      if (fragment && target.endsWith(".html")) {
        const targetHtml = pages.get(target) ?? await readSiteFile(target);
        assert.ok(elementIds(targetHtml).has(fragment), `${path} links ${reference}, but ${target} declares no id="${fragment}"`);
      }
    }
  }
});

test("repository guidance names only the canonical repository", async () => {
  const [readme, security] = await Promise.all([readSiteFile("README.md"), readSiteFile("SECURITY.md")]);
  assert.doesNotMatch(`${readme}\n${security}`, /github\.com\/NellWatson\/Bounder/);
  assert.doesNotMatch(security, /docs\/(?:THREAT_MODEL|LEGACY_STATUS)\.md/);
});

const workflowPaths = async () => (await readdir(new URL(".github/workflows/", root)))
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
  .map((name) => `.github/workflows/${name}`);

test("every workflow action is pinned to an immutable commit", async () => {
  const paths = await workflowPaths();
  assert.ok(paths.includes(".github/workflows/codeql.yml"), "the workflow inventory lost CodeQL");
  for (const path of paths) {
    const workflow = await readSiteFile(path);
    for (const [, action] of workflow.matchAll(/uses:\s*([^\s#]+)/g)) {
      assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/, `${path} contains a mutable action reference: ${action}`);
    }
  }
});

/* actions/checkout otherwise writes its token into .git/config, where every later step --
   including pull-request-head code and third-party devDependencies -- can read it. No step
   here fetches or pushes after checkout, so no step needs the persisted credential. */
test("every checkout leaves no credential behind in the workspace", async () => {
  for (const path of await workflowPaths()) {
    const lines = (await readSiteFile(path)).split("\n");
    lines.forEach((line, index) => {
      if (!/uses:\s*actions\/checkout@/.test(line)) return;
      const indent = line.match(/^\s*/)[0].length;
      const step = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        const text = lines[next];
        if (text.trim() && text.match(/^\s*/)[0].length <= indent && !/^\s*with:/.test(text)) break;
        if (/^\s*- /.test(text) && text.match(/^\s*/)[0].length < indent) break;
        step.push(text);
      }
      assert.match(step.join("\n"), /^\s+persist-credentials: false$/m, `${path}:${index + 1} checkout persists its credential`);
    });
  }
});

/* Expression values interpolated into run: are pasted into the shell script before it runs,
   so they are routed through env: and quoted instead. The pattern covers event data and step
   outputs, whose derivation could change to include untrusted input later. */
test("workflow shell scripts receive expressions through the environment, not by interpolation", async () => {
  for (const path of await workflowPaths()) {
    const lines = (await readSiteFile(path)).split("\n");
    let inRun = false;
    let runIndent = 0;
    lines.forEach((line, index) => {
      const indent = line.match(/^\s*/)[0].length;
      if (inRun && line.trim() && indent <= runIndent) inRun = false;
      const run = line.match(/^(\s*)(?:- )?run:\s*(.*)$/);
      if (run) {
        inRun = true;
        runIndent = run[1].length;
        assert.doesNotMatch(run[2], /\$\{\{/, `${path}:${index + 1} interpolates an expression into run:`);
        return;
      }
      if (inRun) assert.doesNotMatch(line, /\$\{\{/, `${path}:${index + 1} interpolates an expression into run:`);
    });
  }
});

test("pull-request workflows cancel superseded runs without cancelling main or deployments", async () => {
  for (const path of await workflowPaths()) {
    const workflow = await readSiteFile(path);
    assert.match(workflow, /^concurrency:/m, `${path} declares no concurrency group`);
    if (path.endsWith("deploy-pages.yml")) {
      assert.match(workflow, /group: github-pages\n\s+cancel-in-progress: false/, "a deployment may never be cancelled mid-flight");
    } else {
      assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/, `${path} may cancel runs on main`);
      assert.match(workflow, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}/, `${path} may replace a pending main run`);
    }
  }
});

test("the required quality check has a unique name and deployment observes the published version", async () => {
  const quality = await readSiteFile(".github/workflows/site-quality.yml");
  assert.match(quality, /  verify:\n    name: Site quality gate\n/);
  const deploy = await readSiteFile(".github/workflows/deploy-pages.yml");
  const deployedJob = deploy.split("\n  deploy:\n")[1];
  assert.ok(deployedJob, "the deployment job is missing");
  assert.match(deployedJob, /persist-credentials: false/);
  assert.match(deployedJob, /node-version-file: \.nvmrc/);
  const install = deployedJob.indexOf("run: npm ci --ignore-scripts");
  assert.ok(install >= 0 && install < deployedJob.indexOf("run: npm run check:live"), "the fresh deploy runner must install the live check's dependencies first");
  assert.match(deployedJob, /run: npm run check:live -- --url https:\/\/www\.bounder\.io --attempts 10/);
  assert.ok(deployedJob.indexOf("actions/deploy-pages@") < deployedJob.indexOf("run: npm run check:live"), "the observation must follow deployment");
  assert.doesNotMatch(deployedJob, /continue-on-error: true/, "failed live observation must fail the deployment result");
});

test("private producer access is isolated from PR code and public generator logs", async () => {
  const workflow = await readSiteFile(".github/workflows/receipt-drift.yml");
  const [localJob, producerJob] = workflow.split("\n  producer:\n");
  assert.ok(producerJob, "private producer access requires a separate job and runner");
  assert.doesNotMatch(localJob, /secrets\.|repository: NellInc\/Bounder-from-org|path: producer\b/);
  assert.match(localJob, /name: Local contract checks/);
  assert.match(producerJob, /needs: verify/);
  assert.match(producerJob, /if: \$\{\{ github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request' \}\}/);
  assert.match(producerJob, /environment: producer-verification/);
  assert.match(producerJob, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(producerJob, /ref: \$\{\{ steps\.producer\.outputs\.commit \}\}/);
  assert.match(producerJob, /fetch-depth: 0/, "ancestry proof needs the producer default-branch history");
  assert.equal((producerJob.match(/persist-credentials: false/g) || []).length, 2);
  assert.equal((producerJob.match(/secrets\.BOUNDER_PRODUCER_READ_TOKEN/g) || []).length, 2, "only availability and checkout may refer to the credential");
  assert.match(producerJob, /npm run verify:producer -- --producer-root \.\.\/producer > "\$RUNNER_TEMP\/producer-derivation\.log" 2>&1/);
  assert.match(producerJob, /exit 1/);
  assert.doesNotMatch(workflow, /pull_request_target|upload-artifact|cat .*producer-derivation\.log/);
});

test("CodeQL analyses the workflows as well as the JavaScript", async () => {
  const workflow = await readSiteFile(".github/workflows/codeql.yml");
  assert.match(workflow, /language: \[javascript-typescript, actions\]/);
  assert.match(workflow, /category: "\/language:\$\{\{ matrix\.language \}\}"/);
  const dependabot = await readSiteFile(".github/dependabot.yml");
  assert.match(dependabot, /codeql-action:\n\s+patterns:\n\s+- "github\/codeql-action\*"/, "CodeQL init and analyze must be bumped together");
});

test("an unavailable producer token is reported as unverified, never as a silent pass", async () => {
  const workflow = await readSiteFile(".github/workflows/receipt-drift.yml");
  assert.match(workflow, /^name: Contract drift \(producer derivation when token present\)$/m);
  assert.match(workflow, /::warning title=Producer derivation unverified::/);
  assert.match(workflow, /\$GITHUB_STEP_SUMMARY/);
});

test("the issue tracker routes security reports to private disclosure", async () => {
  const config = await readSiteFile(".github/ISSUE_TEMPLATE/config.yml");
  assert.match(config, /url: https:\/\/github\.com\/NellInc\/Bounder\/security\/advisories\/new/);
  const template = await readSiteFile(".github/ISSUE_TEMPLATE/operator-demo.yml");
  assert.match(template, /security\/advisories\/new/, "the simulator finding form does not redirect security reports");
  assert.doesNotMatch(template, /placeholder: "\d+\.\d+\.\d+"/, "a version placeholder goes stale at the next release");
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

  // The sitemaps.org 0.9 schema declares <url> as a sequence: loc, lastmod?, changefreq?, priority?.
  const schemaOrder = ["loc", "lastmod", "changefreq", "priority"];
  for (const [, body] of sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const children = [...body.matchAll(/<([a-z]+)>/g)].map(([, name]) => name);
    assert.ok(children.every((name) => schemaOrder.includes(name)), `unexpected sitemap element in: ${children.join(", ")}`);
    const positions = children.map((name) => schemaOrder.indexOf(name));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), `sitemap <url> children are out of schema order: ${children.join(", ")}`);
    assert.equal(new Set(children).size, children.length, `sitemap <url> repeats an element: ${children.join(", ")}`);
  }

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

test("home page distinguishes public browser source from the private decision producer", async () => {
  const html = await readSiteFile("index.html");
  const hero = html.match(/<div class="hero-content">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(hero);
  // The public repository holds the website and contracts; the decision engine is private,
  // so the call to action names what the link actually opens.
  assert.match(hero, /href="https:\/\/github\.com\/NellInc\/Bounder"[^>]*>Source and contracts/);
  assert.doesNotMatch(hero, /Explore the code/);
  assert.match(hero, /An open physical-interlock architecture\./);
  // No unqualified safety guarantee for a simulation-only testbed.
  assert.doesNotMatch(html, /authorised and safe|device-safe action/);
  assert.doesNotMatch(hero, /Local by design|hero-note/);
  assert.match(html, /Development testbed/);
  assert.match(html, /working towards deployment/);
  assert.match(html, /Website source on GitHub/);
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
  const source = graph.find((entry) => entry["@type"] === "SoftwareSourceCode");
  assert.equal(source.codeRepository, "https://github.com/NellInc/Bounder");
  assert.deepEqual(source.programmingLanguage, ["HTML", "CSS", "JavaScript"]);
});

test("contact intent guidance adds no mandatory field and is associated with the message", async () => {
  const html = await readSiteFile("contact.html");
  // The hint suggests content; it must not read as if the required field were optional.
  assert.match(html, /id="message-hint" class="form-hint">It helps to say whether/);
  assert.doesNotMatch(html, /Optional starting point/);
  assert.match(html, /<p class="form-hint form-required-note">All fields are required\.<\/p>/);
  assert.match(html, /<form\b[^>]*aria-labelledby="contact-form-title"/);
  assert.match(html, /<textarea[^>]*aria-describedby="message-hint"[^>]*required/);
  const required = [...html.matchAll(/<(?:input|textarea)\b[^>]*\brequired[^>]*>/g)];
  assert.equal(required.length, 4);
  assert.match(html, /We welcome research collaborations and contributions/);
});

test("standalone simulator leads with its own heading and hands straight over to the workbench", async () => {
  const html = await readSiteFile("simulator.html");
  const home = await readSiteFile("index.html");
  const hero = html.match(/<section class="hero"[\s\S]*?<\/section>/)[0];
  const heading = (page) => page.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)[1];
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.notEqual(heading(html), heading(home), "the simulator page must not repeat the home page's h1");
  assert.doesNotMatch(hero, /hero-interlock/, "the home page's interlock argument is not repeated here");
  // The skip link and the in-page call to action land on the workbench, not the hero.
  assert.match(html, /<a class="skip-link" href="#scenario-lab">Skip to simulator<\/a>/);
  assert.match(html, /<section class="simulator-workbench" id="scenario-lab" tabindex="-1"/);
  assert.match(hero, /href="#scenario-lab"/);
  assert.doesNotMatch(html, /class="simulator-intro"/);
  assert.equal((html.match(/Scenario laboratory/g) || []).length, 0);
  assert.match(html, /interlockObserver.observe\(interlock\)/);
  assert.match(await readSiteFile("simulator.css"), /\.simulator-embed \.hero,/);
});

test("simulator evidence and schema files open outside the page, including inside the home-page embed", async () => {
  const html = await readSiteFile("simulator.html");
  const workbench = html.match(/<section class="simulator-workbench"[\s\S]*?<section class="rules-context/)[0];
  const anchors = [...workbench.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(anchors.length > 10);
  for (const tag of anchors) {
    const href = tag.match(/href="([^"]*)"/)?.[1] ?? "";
    if (href.startsWith("#")) continue;
    // A download does not navigate the frame; everything else must leave it.
    if (/\bdownload\b/.test(tag)) continue;
    assert.match(tag, /target="_blank"/, `${href} would replace the embedded simulator`);
    assert.match(tag, /rel="noopener noreferrer"/, `${href} lacks rel="noopener noreferrer"`);
  }
});

test("public presentation keeps development status concise without repeated disclaimer blocks", async () => {
  const home = await readSiteFile("index.html");
  const simulator = await readSiteFile("simulator.html");
  assert.match(home, /Development testbed/);
  assert.match(home, /The path to deployment/);
  assert.doesNotMatch(home, /Optional evidence is never|Reference software, honestly|not certified flight-control|Live hardware is outside project scope/);
  assert.doesNotMatch(simulator, /No actuator connected|Permission to operate is never|Demonstrator, not deployment assurance|not certified safety software/);
  const continuity = await readSiteFile("continuity-evidence.js");
  assert.match(continuity, /The figures shown are from the recorded 100-Guardian run, not live\./);
  // The recorded figures sit on screen beside the note, so it describes them, not a place to go.
  assert.doesNotMatch(continuity, /remains available to inspect/);
  // The fallback never points "below" at a link that sits beside it, and never shouts
  // "Unavailable" in the live-metric cells.
  assert.doesNotMatch(continuity, /Explore the recorded run below|textContent = "Unavailable"/);
  assert.doesNotMatch(continuity, /does not treat network failure as authority/);
});

/* The browser reflow test renders one width per declared breakpoint band. A breakpoint added to
   a stylesheet without a matching width would leave its band unrendered by any test. */
test("the browser breakpoint sweep renders a width inside every declared max-width band", async () => {
  const breakpoints = new Set();
  for (const path of ["styles.css", "simulator.css"]) {
    for (const [, value] of (await readSiteFile(path)).matchAll(/@media[^{]*max-width:\s*(\d+)px/g)) breakpoints.add(Number(value));
  }
  const spec = await readSiteFile("tests/browser/site.spec.js");
  const sweep = spec.slice(spec.indexOf("across every declared breakpoint band"));
  const passes = sweep.slice(sweep.indexOf("const passes = ["), sweep.indexOf("for (const { width, height, paths } of passes)"));
  const widths = [...passes.matchAll(/\{ width: (\d+), height: \d+, paths: (?:everyPath|complexPaths) \}/g)].map(([, width]) => Number(width));
  assert.ok(widths.includes(320), "the sweep must render the WCAG 1.4.10 reflow width of 320px");
  const edges = [0, ...[...breakpoints].sort((left, right) => left - right)];
  for (let index = 1; index < edges.length; index += 1) {
    const [low, high] = [edges[index - 1] + 1, edges[index]];
    assert.ok(widths.some((width) => width >= low && width <= high), `no browser width renders the ${low}-${high}px band`);
  }
});

/* The home page's offline state shows the recorded 100-Guardian run in place of live figures.
   Those cells are static markup, so they are derived here from the published recording: a
   re-recorded run that changes any figure fails until the page says the same thing. */
test("the recorded-run figures on the home page match the published recording", async () => {
  const home = await readSiteFile("index.html");
  const pilot = JSON.parse(await readSiteFile("data/bounder-staging-pilot.v1.json"));
  const block = home.match(/<div class="continuity-recorded" data-continuity-recorded>([\s\S]*?)<\/dl>\s*<\/div>/)?.[1];
  assert.ok(block, "the recorded-run block is missing from index.html");
  assert.match(block, /Recorded run · not live/, "the recorded figures must say they are not live");
  const cells = [...block.matchAll(/<dt>([^<]+)<\/dt><dd>([\s\S]*?)<\/dd>/g)]
    .map(([, label, value]) => [label, value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")]);
  const generated = new Date(pilot.generated_at);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const passed = pilot.devices.filter((device) => device.expected_code === device.receipt.code).length;
  assert.deepEqual(cells, [
    ["Guardians", String(pilot.summary.devices)],
    ["Platform classes", String(Object.keys(pilot.summary.platform_counts).length)],
    ["Expected outcomes", `${passed} of ${pilot.devices.length}`],
    ["Local decisions", `${pilot.summary.allowed} allow / ${pilot.summary.blocked} hold`],
    ["Recorded", `${generated.getUTCDate()} ${months[generated.getUTCMonth()]} ${generated.getUTCFullYear()}`]
  ]);
  assert.match(block, new RegExp(`<time datetime="${pilot.generated_at}">`));
  // The lede must not promise a verified proof in states where nothing is verified.
  const summary = home.match(/<p class="continuity-summary"[^>]*>([\s\S]*?)<\/p>/)[1];
  assert.doesNotMatch(summary, /proof below is checked in your browser/);
  assert.match(summary, /When the live feed is reachable/);
});

test("the licence notice keeps the Bounder name and marks out of the Apache-2.0 grant", async () => {
  // LICENSE grants copyright in every tracked file, and the wordmark traces a commercial face;
  // NOTICE is where the carve-out travels with redistributed copies.
  const notice = await readSiteFile("NOTICE");
  assert.match(notice, /^The Bounder name, wordmark and mark are not licensed under Apache-2\.0\.$/m);
  const brandSource = await readSiteFile("design/brand-source/README.md");
  assert.match(brandSource, /Avenir Next Heavy/);
  assert.match(brandSource, /BOUNDER_WORDMARK_FONT/);
});

/* One name for one object: the recorded receipt is "recorded interlock receipt (Go engine)"
   everywhere a visitor reads it, never the bare "Go receipt" that reads like go/no-go. */
test("visitor-facing copy names the recorded receipt one way, without bare 'Go receipt' jargon", async () => {
  for (const path of ["simulator.html", "simulator-fallback.js", "simulator/controller.js", "ui/policy-panel.js", "index.html"]) {
    const source = await readSiteFile(path);
    assert.doesNotMatch(source, /\bGo (?:interlock )?receipt\b/, `${path} still says "Go receipt"`);
  }
});

const readExplainer = (path) => readFile(new URL(`../${path}`, import.meta.url));

test("the published explainer preserves the accepted corrected master", async () => {
  const bytes = await readExplainer("assets/video/bounder-explainer-v1.mp4");
  assert.equal(bytes.byteLength, 43726947);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "1b90d7e36e503fbcb4ec531a152925cdbf3d9a33b60f62cff57b002773545b04");
});

test("the homepage offers opt-in native playback, captions and the complete transcript", async () => {
  const html = (await readExplainer("index.html")).toString();
  const player = html.match(/<video\b[\s\S]*?<\/video>/u)?.[0] ?? "";
  assert.match(player, /controls playsinline preload="none"/u);
  assert.doesNotMatch(player, /\b(?:autoplay|loop|muted)\b/u);
  assert.match(player, /poster="assets\/video\/bounder-explainer-v1.jpg"/u);
  assert.match(player, /kind="captions"[^>]*srclang="en"[^>]*default/u);
  assert.match(html, /href="#explainer">Watch the film/u);
  const transcript = html.match(/<div class="explainer-transcript-copy">([\s\S]*?)<\/div>/u)?.[1] ?? "";
  assert.equal((transcript.match(/<p>/gu) ?? []).length, 8);
  assert.match(transcript, /Bounder is currently simulation-only/u);
  assert.match(transcript, /cached authority still expires/u);
  assert.match(transcript, /physical safety remains a separate engineering and validation responsibility/u);
});

test("English caption cues are ordered and stay inside the two-minute film", async () => {
  const text = (await readExplainer("assets/video/bounder-explainer-v1.vtt")).toString();
  assert.ok(text.startsWith("WEBVTT\n"));
  const toSeconds = (time) => time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  const cues = [...text.matchAll(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/gu)];
  assert.equal(cues.length, 41);
  let previousEnd = 0;
  for (const [, startText, endText] of cues) {
    const start = toSeconds(startText), end = toSeconds(endText);
    assert.ok(start >= previousEnd && end > start && end <= 120);
    previousEnd = end;
  }
});
