import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "./system-model.mjs";

export const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export const MANIFEST_NAME = /^bounder-reference-v(\d+)\.(\d+)\.(\d+)\.manifest\.json$/u;
export const PRODUCER_ROLE = "decision_producer";
export const PRODUCER_REPOSITORY = "https://github.com/NellInc/Bounder-from-org";

// Segment-wise numeric ordering. A lexical sort puts 1.9.0 above 1.10.0 and would silently
// verify a superseded producer tree.
export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export async function listSealedManifests(root) {
  const entries = await readdir(join(root, "release"));
  return entries
    .map((name) => ({ name, match: MANIFEST_NAME.exec(name) }))
    .filter(({ match }) => match !== null)
    .map(({ name, match }) => ({ name, version: match.slice(1, 4).map(Number) }))
    .sort((left, right) => compareVersions(left.version, right.version));
}

// The shipped manifest is the single source of truth for which producer tree a release claims.
// A workflow that hardcodes a commit keeps attesting to a frozen tree after the next release
// moves the claim, and reports green while proving nothing about what was actually shipped.
export async function resolveProducerCommit(root, { role = PRODUCER_ROLE } = {}) {
  const sealed = await listSealedManifests(root);
  if (sealed.length === 0) throw new Error("no sealed release manifest is present in release/");
  const newest = sealed.at(-1);
  const path = `release/${newest.name}`;
  const manifest = JSON.parse(await readFile(join(root, path), "utf8"));
  if (manifest.manifest_version !== "bounder-release-manifest/v2") {
    throw new Error(`${path} is not a manifest v2 record and names no evidence producer`);
  }
  const producers = Array.isArray(manifest.evidence_producers) ? manifest.evidence_producers : [];
  const producer = producers.find((entry) => entry?.role === role);
  if (!producer) throw new Error(`${path} declares no evidence producer with role ${role}`);
  if (!/^[0-9a-f]{40}$/u.test(producer.commit || "")) {
    throw new Error(`${path} names an invalid ${role} commit: ${producer.commit}`);
  }
  const version = newest.version.join(".");
  return { manifest_path: path, release_version: version, repository: producer.repository, commit: producer.commit };
}

export async function runResolveProducerCommitCli(args = process.argv.slice(2), { root = repositoryRoot, logger = console } = {}) {
  const unknown = args.filter((argument) => argument !== "--commit");
  if (unknown.length) throw new Error(`unknown release-producer arguments: ${unknown.join(" ")}`);
  const resolved = await resolveProducerCommit(root);
  logger.log(args.includes("--commit") ? resolved.commit : JSON.stringify(resolved));
  return resolved;
}

/* c8 ignore start -- direct-entry failure plumbing is covered through the exported command API. */
if (isMainModule(import.meta.url)) {
  runResolveProducerCommitCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
