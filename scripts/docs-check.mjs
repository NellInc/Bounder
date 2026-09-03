import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { isMainModule, loadSystemModel, matchesPathPattern, repositoryRoot } from "./lib/system-model.mjs";

const WIKI_LINK = /\[\[bounder:([^\]]+)\]\]/g;
// An optional trailing anchor -- `path:12-14 "exact fragment"` -- opts a citation into a
// content check: the fragment must appear inside the cited range, not merely near it.
const CITATION = /`((?:\.?\.?\/)?[A-Za-z0-9_./-]+):(\d+)(?:-(\d+))?(?: "([^"`\n]+)")?`/g;
const WIKI_UPDATED = /<!-- wiki:updated = (\d{4}-\d{2}-\d{2}) -->/;
const STALE_CLAIMS = Object.freeze([
  "github.com/NellWatson/Bounder",
  "The canonical interlock implementation and this public reference site live in",
  "[`NellInc/Bounder`](https://github.com/NellInc/Bounder). The receipt drift"
]);

export async function collectMarkdown(directory, prefix = "") {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await collectMarkdown(join(directory, entry.name), relativePath));
    else if (entry.isFile() && entry.name.endsWith(".md")) paths.push(relativePath);
  }
  return paths.sort();
}

export async function assertFileLine(root, sourcePath, start, end, sourcePage, anchor = null) {
  const base = resolve(root);
  const absolute = resolve(base, sourcePath);
  // A string slice does not test containment: `../Bounder-from-org/README.md` slices to
  // `from-org/README.md`, which has no leading `..` and would be read from outside the release
  // artifact. Ask the path module for the real relation instead, as build-site.mjs does.
  const fromRoot = relative(base, absolute);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${sourcePage} has unsafe citation path: ${sourcePath}`);
  }
  let source;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("not a file");
    source = await readFile(absolute, "utf8");
  } catch {
    throw new Error(`${sourcePage} cites missing file: ${sourcePath}`);
  }
  const lines = source.split("\n");
  if (start < 1 || end < start || end > lines.length) throw new Error(`${sourcePage} cites invalid range ${sourcePath}:${start}-${end}`);
  if (anchor === null) return;
  if (!lines.slice(start - 1, end).join("\n").includes(anchor)) {
    throw new Error(`${sourcePage} cites ${sourcePath}:${start}-${end} with an anchor absent from that range: ${JSON.stringify(anchor)}`);
  }
}

export function heldClaim(model, path, staleClaim, source) {
  return model.documentation.claim_holds.some((hold) => hold.path === path && hold.contains.includes(staleClaim) && source.includes(hold.contains));
}

export async function checkDocumentation({ root = repositoryRoot, model: suppliedModel = null } = {}) {
  const model = suppliedModel || await loadSystemModel({ root });
  const wikiRoot = join(root, "_wiki");
  const wikiPaths = await collectMarkdown(wikiRoot);
  const errors = [];
  const warnings = [];
  const indexSource = await readFile(join(root, model.documentation.wiki_index), "utf8");
  let linksChecked = 0;
  let citationsChecked = 0;
  let anchoredCitations = 0;
  const citedPathsByPage = new Map();

  for (const relativeWikiPath of wikiPaths) {
    const projectPath = `_wiki/${relativeWikiPath}`;
    const source = await readFile(join(wikiRoot, relativeWikiPath), "utf8");
    if (!["index.md", "log.md"].includes(relativeWikiPath)) {
      // Generated pages carry no freshness marker: they are compiled from the descriptor and
      // byte-compared by `npm run system:generate --check`, so a hand-written date on them
      // would be a claim nobody maintains rather than metadata anybody can trust.
      if (!relativeWikiPath.startsWith("generated/")) {
        const updated = WIKI_UPDATED.exec(source)?.[1];
        if (!updated || Number.isNaN(Date.parse(`${updated}T00:00:00Z`)) || updated > new Date().toISOString().slice(0, 10)) {
          errors.push(`${projectPath} has invalid or future wiki:updated metadata`);
        }
      }
      const wikiId = relativeWikiPath.slice(0, -3);
      if (!indexSource.includes(`[[bounder:${wikiId}]]`)) errors.push(`${projectPath} is missing from _wiki/index.md`);
    }
    for (const match of source.matchAll(WIKI_LINK)) {
      linksChecked += 1;
      const target = `_wiki/${match[1]}.md`;
      try {
        const info = await stat(join(root, target));
        if (!info.isFile()) throw new Error("not a file");
      } catch {
        errors.push(`${projectPath} has unresolved wiki link: ${match[0]}`);
      }
    }
    const citedPaths = new Set();
    citedPathsByPage.set(projectPath, citedPaths);
    for (const match of source.matchAll(CITATION)) {
      citationsChecked += 1;
      if (match[4]) anchoredCitations += 1;
      citedPaths.add(match[1]);
      try {
        await assertFileLine(root, match[1], Number(match[2]), Number(match[3] || match[2]), projectPath, match[4] ?? null);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  const logSource = await readFile(join(root, model.documentation.wiki_log), "utf8");
  const dates = [...logSource.matchAll(/^## \[(\d{4}-\d{2}-\d{2})\]/gm)].map((match) => match[1]);
  for (let index = 1; index < dates.length; index += 1) {
    if (dates[index] < dates[index - 1]) errors.push("_wiki/log.md entries are not chronological");
  }

  const claimPaths = [...new Set([
    "README.md", "SECURITY.md", "guides/INTEGRATION.md", "CLAUDE.md",
    ...wikiPaths.map((path) => `_wiki/${path}`),
    ...model.documentation.claim_holds.map(({ path }) => path)
  ])];
  for (const path of claimPaths) {
    const source = await readFile(join(root, path), "utf8");
    for (const staleClaim of STALE_CLAIMS) {
      if (!source.includes(staleClaim)) continue;
      if (heldClaim(model, path, staleClaim, source)) warnings.push(`${path} contains held stale claim: ${staleClaim}`);
      else errors.push(`${path} contains unheld stale canonical-repository claim: ${staleClaim}`);
    }
  }
  for (const hold of model.documentation.claim_holds) {
    const source = await readFile(join(root, hold.path), "utf8");
    const occurrences = source.split(hold.contains).length - 1;
    if (occurrences !== 1) errors.push(`claim hold ${hold.id} must match exactly once in ${hold.path}; found ${occurrences}`);
  }

  // An impact rule's documentation_refresh is the only mechanism that tells an editor which
  // prose a code change endangers. Maintained by hand it goes stale silently -- a page can cite
  // a path for months without any rule naming it -- so completeness is derived here instead.
  // This warns rather than fails: it reports which pages may need re-reading, and no check can
  // establish that the sentence around a citation is still true.
  const routingWarnings = [];
  for (const rule of model.impact_rules || []) {
    const named = new Set(rule.documentation_refresh);
    const unrouted = [];
    for (const [page, paths] of citedPathsByPage) {
      if (named.has(page)) continue;
      // Generated pages are recompiled from the descriptor by `npm run system:generate` and
      // byte-checked by `system:check`; they never need an editor's refresh pass.
      if (page.startsWith("_wiki/generated/")) continue;
      if ([...paths].some((path) => rule.paths.some((pattern) => matchesPathPattern(path, pattern)))) unrouted.push(page);
    }
    if (unrouted.length) {
      routingWarnings.push(`impact rule ${rule.id} does not route to pages citing its paths: ${unrouted.sort().join(", ")}`);
    }
  }

  const report = Object.freeze({
    version: "bounder-docs-check/v1",
    pages_checked: wikiPaths.length,
    links_checked: linksChecked,
    citations_checked: citationsChecked,
    anchored_citations: anchoredCitations,
    claim_holds: model.documentation.claim_holds.length,
    routing_warnings: routingWarnings,
    warnings,
    errors
  });
  if (errors.length) throw new Error(`documentation check failed:\n${errors.map((error) => `  * ${error}`).join("\n")}`);
  return report;
}

export async function runDocsCheckCli(args = process.argv.slice(2), logger = console) {
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length) throw new Error(`unknown docs:check arguments: ${unknown.join(" ")}`);
  const report = await checkDocumentation();
  if (args.includes("--json")) logger.log(JSON.stringify(report, null, 2));
  else {
    logger.log(`Documentation: ${report.pages_checked} pages, ${report.links_checked} links, ${report.citations_checked} citations (${report.anchored_citations} anchored), ${report.claim_holds} explicit claim holds`);
    for (const warning of report.warnings) logger.warn(`HELD: ${warning}`);
    for (const warning of report.routing_warnings) logger.warn(`UNROUTED: ${warning}`);
  }
  return report;
}

if (isMainModule(import.meta.url)) {
  runDocsCheckCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
