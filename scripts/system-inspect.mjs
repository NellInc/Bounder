import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { gitChangedPaths, loadSystemModel, planForPaths, repositoryRoot } from "./lib/system-model.mjs";

const execFileAsync = promisify(execFile);
const gitEnvironment = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function inspectGit(root, args, { optional = false } = {}) {
  try {
    const { stdout } = await execFileAsync("/usr/bin/git", ["--no-optional-locks", "-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: gitEnvironment
    });
    return stdout.trim();
  } catch (error) {
    if (optional) return null;
    throw new Error(`git ${args.join(" ")} failed: ${error.message}`);
  }
}

export async function repositoryState(root) {
  const [head, branch, upstream, changes] = await Promise.all([
    inspectGit(root, ["rev-parse", "HEAD"]),
    inspectGit(root, ["branch", "--show-current"]),
    inspectGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { optional: true }),
    gitChangedPaths({ root })
  ]);
  let relation = null;
  if (upstream) {
    const counts = await inspectGit(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], { optional: true });
    if (counts) {
      const [ahead, behind] = counts.split(/\s+/).map(Number);
      relation = { ahead, behind };
    }
  }
  return { root, head, branch, upstream, relation, dirty: changes.length > 0, changed_paths: changes };
}

export async function schemaInventory(root) {
  const directory = join(root, "schemas");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const schemas = [];
  const ids = new Map();
  const collisions = [];
  for (const name of names) {
    const bytes = await readFile(join(directory, name));
    const parsed = JSON.parse(bytes.toString("utf8"));
    const record = { path: `schemas/${name}`, id: parsed.$id || null, sha256: hash(bytes) };
    schemas.push(record);
    if (record.id) {
      const prior = ids.get(record.id);
      if (prior && prior.sha256 !== record.sha256) collisions.push({ id: record.id, paths: [prior.path, record.path] });
      else ids.set(record.id, record);
    }
  }
  return { schemas, collisions };
}

export async function compareProducerContracts(siteRoot, producerRoot) {
  const contractRoot = join(producerRoot, "contracts");
  try {
    await access(contractRoot);
  } catch {
    return [];
  }
  const producerNames = new Set((await readdir(contractRoot)).filter((name) => name.endsWith(".json")));
  const siteNames = (await readdir(join(siteRoot, "schemas"))).filter((name) => name.endsWith(".json") && producerNames.has(name)).sort();
  const results = [];
  for (const name of siteNames) {
    const [siteBytes, producerBytes] = await Promise.all([
      readFile(join(siteRoot, "schemas", name)),
      readFile(join(contractRoot, name))
    ]);
    results.push({
      name,
      site_sha256: hash(siteBytes),
      producer_sha256: hash(producerBytes),
      equal: Buffer.compare(siteBytes, producerBytes) === 0
    });
  }
  return results;
}

export async function discoverProducer(model, root) {
  const role = model.roles.find(({ id }) => id === "decision_producer");
  for (const candidate of role.local_discovery) {
    const candidateRoot = resolve(root, candidate);
    try {
      await access(join(candidateRoot, ".git"));
      const state = await repositoryState(candidateRoot);
      state.remote = await inspectGit(candidateRoot, ["remote", "get-url", "origin"], { optional: true });
      state.contracts = await compareProducerContracts(root, candidateRoot);
      return state;
    } catch {
      continue;
    }
  }
  return null;
}

export async function inspectSystem({ root = repositoryRoot, clock = () => Date.now() } = {}) {
  const startedAt = clock();
  const model = await loadSystemModel({ root });
  const [repository, version, schemas, producer] = await Promise.all([
    repositoryState(root),
    readFile(join(root, "VERSION"), "utf8").then((value) => value.trim()),
    schemaInventory(root),
    discoverProducer(model, root)
  ]);
  const manifestPath = `release/bounder-reference-v${version}.manifest.json`;
  let manifest = null;
  try {
    const bytes = await readFile(join(root, manifestPath));
    const parsed = JSON.parse(bytes.toString("utf8"));
    manifest = {
      path: manifestPath,
      sha256: hash(bytes),
      manifest_version: parsed.manifest_version || "bounder-release-manifest/v1",
      canonical_interlock: parsed.canonical_interlock || null,
      publisher_source: parsed.publisher_source || null,
      evidence_producers: parsed.evidence_producers || null,
      build: parsed.build || null,
      deployment: parsed.deployment || null,
      live_observation: parsed.live_observation || null,
      pinned_paths: Array.isArray(parsed.files) ? parsed.files.map(({ path }) => path).sort() : []
    };
  } catch {
    manifest = { path: manifestPath, missing: true };
  }
  const pinnedPaths = new Set(manifest.pinned_paths || []);
  const unpinnedPublicSchemas = schemas.schemas
    .map(({ path }) => path)
    .filter((path) => !pinnedPaths.has(path));
  const changedPlan = planForPaths(model, repository.changed_paths);
  let lastVerification = null;
  try {
    const receipt = JSON.parse(await readFile(join(root, "artifacts", "verification", "latest.json"), "utf8"));
    lastVerification = {
      success: receipt.success === true,
      candidate: receipt.candidate || null,
      duration_ms: Array.isArray(receipt.phases) ? receipt.phases.reduce((total, phase) => total + (Number.isSafeInteger(phase.duration_ms) ? phase.duration_ms : 0), 0) : null
    };
  } catch {}
  const provenanceFields = manifest.missing ? [] : [
    manifest.canonical_interlock || manifest.publisher_source,
    manifest.evidence_producers,
    manifest.build,
    manifest.deployment,
    manifest.live_observation
  ];
  const provenanceComplete = provenanceFields.filter(Boolean).length;
  const generatedViews = await Promise.all([
    access(join(root, "_wiki", "generated", "task-routes.md")).then(() => true, () => false),
    access(join(root, ".github", "generated", "impact-rules.json")).then(() => true, () => false)
  ]);
  return Object.freeze({
    version: "bounder-inspection/v1",
    observed_at: new Date().toISOString(),
    system_id: model.system_id,
    repository,
    release: { version, manifest, unpinned_public_schemas: unpinnedPublicSchemas },
    producer,
    schemas: {
      count: schemas.schemas.length,
      identity_collisions: schemas.collisions,
      producer_comparisons: producer?.contracts || []
    },
    health: {
      descriptor: { roles: model.roles.length, components: model.components.length, artifacts: model.artifacts.length, impact_rules: model.impact_rules.length },
      generated_views_current: generatedViews.every(Boolean),
      changed_path_match_rate: repository.changed_paths.length ? (repository.changed_paths.length - changedPlan.unmatched_paths.length) / repository.changed_paths.length : 1,
      producer_contract_parity: { equal: producer?.contracts.filter(({ equal }) => equal).length || 0, total: producer?.contracts.length || 0 },
      provenance_completeness: { complete: provenanceComplete, required: manifest.canonical_interlock ? 1 : 5 },
      last_aggregate_verification: lastVerification,
      orientation_probe_ms: Math.max(0, clock() - startedAt)
    },
    tools: { node: process.version, platform: process.platform, architecture: process.arch },
    budgets: model.budgets,
    holds: model.documentation.holds,
    next_safe_command: repository.dirty ? "npm run check:changed" : "npm run inspect -- --json"
  });
}

export function renderInspectionHuman(report) {
  const relation = report.repository.relation
    ? `${report.repository.relation.ahead} ahead, ${report.repository.relation.behind} behind`
    : "no upstream relation";
  const lines = [
    `Bounder ${report.release.version} | ${report.repository.branch}@${report.repository.head.slice(0, 12)} | ${relation}`,
    `Working tree: ${report.repository.dirty ? `${report.repository.changed_paths.length} changed paths` : "clean"}`,
    `Manifest: ${report.release.manifest.missing ? "missing" : `${report.release.manifest.path} (${report.release.manifest.sha256.slice(0, 12)})`}`,
    `Unpinned public schemas: ${(report.release.unpinned_public_schemas || []).length}${(report.release.unpinned_public_schemas || []).length ? ` | ${report.release.unpinned_public_schemas.join(", ")}` : ""}`,
    `System descriptor: valid | ${report.schemas.count} schemas | ${report.schemas.identity_collisions.length} local identity collisions`,
    report.producer
      ? `Producer candidate: ${report.producer.remote || report.producer.root} | ${report.producer.branch}@${report.producer.head.slice(0, 12)} | ${report.producer.dirty ? "dirty" : "clean"}`
      : "Producer candidate: unavailable",
    `Producer contract parity: ${report.schemas.producer_comparisons.filter(({ equal }) => equal).length}/${report.schemas.producer_comparisons.length} byte-identical`,
    `Control health: ${report.health.generated_views_current ? "generated views current" : "generated views missing"} | changed-path match ${(report.health.changed_path_match_rate * 100).toFixed(1)}% | provenance ${report.health.provenance_completeness.complete}/${report.health.provenance_completeness.required} | orientation ${report.health.orientation_probe_ms} ms`,
    "Holds:"
  ];
  for (const hold of report.holds) lines.push(`  * ${hold}`);
  lines.push(`Next safe command: ${report.next_safe_command}`);
  return lines.join("\n");
}

export async function runInspectCli(args = process.argv.slice(2), logger = console) {
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length) throw new Error(`unknown inspect arguments: ${unknown.join(" ")}`);
  const report = await inspectSystem();
  logger.log(args.includes("--json") ? JSON.stringify(report, null, 2) : renderInspectionHuman(report));
  return report;
}

/* c8 ignore start -- direct-entry failure plumbing is covered through the exported command API. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  runInspectCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
