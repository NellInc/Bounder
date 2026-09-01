import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadSystemModel, repositoryRoot } from "./lib/system-model.mjs";

const WIKI_LINK = /\[\[bounder:([^\]]+)\]\]/g;
const CITATION = /`((?:\.?\.?\/)?[A-Za-z0-9_./-]+):(\d+)(?:-(\d+))?`/g;
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

export async function assertFileLine(root, sourcePath, start, end, sourcePage) {
  const absolute = resolve(root, sourcePath);
  const fromRoot = absolute.slice(resolve(root).length + 1);
  if (fromRoot.startsWith("..") || absolute === resolve(root)) throw new Error(`${sourcePage} has unsafe citation path: ${sourcePath}`);
  let source;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error("not a file");
    source = await readFile(absolute, "utf8");
  } catch {
    throw new Error(`${sourcePage} cites missing file: ${sourcePath}`);
  }
  const lineCount = source.split("\n").length;
  if (start < 1 || end < start || end > lineCount) throw new Error(`${sourcePage} cites invalid range ${sourcePath}:${start}-${end}`);
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

  for (const relativeWikiPath of wikiPaths) {
    const projectPath = `_wiki/${relativeWikiPath}`;
    const source = await readFile(join(wikiRoot, relativeWikiPath), "utf8");
    if (!["index.md", "log.md"].includes(relativeWikiPath)) {
      const updated = WIKI_UPDATED.exec(source)?.[1];
      if (!updated || Number.isNaN(Date.parse(`${updated}T00:00:00Z`)) || updated > new Date().toISOString().slice(0, 10)) {
        errors.push(`${projectPath} has invalid or future wiki:updated metadata`);
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
    for (const match of source.matchAll(CITATION)) {
      citationsChecked += 1;
      try {
        await assertFileLine(root, match[1], Number(match[2]), Number(match[3] || match[2]), projectPath);
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

  const report = Object.freeze({
    version: "bounder-docs-check/v1",
    pages_checked: wikiPaths.length,
    links_checked: linksChecked,
    citations_checked: citationsChecked,
    claim_holds: model.documentation.claim_holds.length,
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
    logger.log(`Documentation: ${report.pages_checked} pages, ${report.links_checked} links, ${report.citations_checked} citations, ${report.claim_holds} explicit claim holds`);
    for (const warning of report.warnings) logger.warn(`HELD: ${warning}`);
  }
  return report;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runDocsCheckCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
