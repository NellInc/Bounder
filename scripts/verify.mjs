import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { repositoryRoot } from "./lib/system-model.mjs";

export const DEFAULT_VERIFICATION_PHASES = Object.freeze([
  Object.freeze({ id: "descriptor", command: "npm", args: ["run", "system:check"], timeout_ms: 60_000 }),
  Object.freeze({ id: "contracts", command: "npm", args: ["run", "test:observability"], timeout_ms: 180_000 }),
  Object.freeze({ id: "observability-performance", command: "npm", args: ["run", "benchmark:observability"], timeout_ms: 180_000 }),
  Object.freeze({ id: "unit-coverage", command: "npm", args: ["run", "test:coverage"], timeout_ms: 900_000 }),
  Object.freeze({ id: "publication-build", command: "npm", args: ["run", "build"], timeout_ms: 300_000 }),
  Object.freeze({ id: "browser", command: "npm", args: ["run", "test:browser"], timeout_ms: 1_200_000 }),
  Object.freeze({ id: "design-lint", command: "npx", args: ["--yes", "impeccable@3.2.1", "detect", "."], timeout_ms: 300_000 }),
  Object.freeze({ id: "documentation", command: "npm", args: ["run", "docs:check"], timeout_ms: 60_000 })
]);

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function validatePhase(phase) {
  if (!phase || typeof phase !== "object" || !/^[a-z][a-z0-9-]*$/.test(phase.id) || typeof phase.command !== "string" || !Array.isArray(phase.args)) {
    throw new Error("verification phase is invalid");
  }
  if (!Number.isSafeInteger(phase.timeout_ms) || phase.timeout_ms < 1 || phase.timeout_ms > 7_200_000) {
    throw new Error(`verification phase timeout is invalid: ${phase.id}`);
  }
}

export async function executeVerificationPhase(phase, {
  root = repositoryRoot,
  spawnImpl = spawn,
  clock = () => Date.now(),
  timers = globalThis
} = {}) {
  validatePhase(phase);
  const started = clock();
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawnImpl(phase.command, phase.args, {
      cwd: root,
      env: { ...process.env, CI: process.env.CI || "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = timers.setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, phase.timeout_ms);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timeout);
      rejectPromise(new Error(`verification phase ${phase.id} could not start: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timeout);
      resolvePromise({
        exit_code: Number.isInteger(code) ? code : 1,
        signal: signal || null,
        timed_out: timedOut,
        duration_ms: Math.max(0, clock() - started),
        stdout,
        stderr
      });
    });
  });
}

async function readCandidate(root) {
  const runGit = async (args) => {
    const phase = { id: "candidate-git", command: "/usr/bin/git", args: ["--no-optional-locks", "-C", root, ...args], timeout_ms: 30_000 };
    const result = await executeVerificationPhase(phase, { root });
    if (result.exit_code !== 0) throw new Error(`candidate Git inspection failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  const [commit, status] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["status", "--porcelain=v1", "--untracked-files=all"])
  ]);
  const producerCommits = [];
  try {
    const producerReceipt = JSON.parse(await readFile(join(root, "artifacts", "producer-derivation", "latest.json"), "utf8"));
    const statement = producerReceipt.producer_statement;
    if (producerReceipt.success !== true || producerReceipt.version !== "bounder-producer-derivation-verification/v1" || !statement || statement.version !== "bounder-evidence-provenance/v1") {
      throw new Error("producer receipt is not successful and complete");
    }
    for (const record of [...statement.contracts, ...statement.outputs.filter(({ path }) => path.startsWith("data/"))]) {
      const bytes = await readFile(join(root, record.path));
      if (bytes.byteLength !== record.bytes || hash(bytes) !== record.sha256) throw new Error(`producer receipt drift: ${record.path}`);
    }
    producerCommits.push(statement.producer_source.commit);
  } catch {}
  return { publisher_commit: commit, producer_commits: producerCommits, dirty: status.length > 0 };
}

async function hashArtifacts(root, paths) {
  const artifacts = [];
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    artifacts.push({ path, bytes: bytes.byteLength, sha256: hash(bytes) });
  }
  return artifacts;
}

function sanitizeTimestamp(value) {
  return value.replaceAll(":", "-").replaceAll(".", "-");
}

export async function runVerification({
  root = repositoryRoot,
  phases = DEFAULT_VERIFICATION_PHASES,
  phaseRunner = executeVerificationPhase,
  outputRoot = join(root, "artifacts", "verification"),
  clock = () => Date.now(),
  candidateReader = readCandidate,
  artifactPaths = [
    "system/bounder-system.v1.json",
    "schemas/creedspace-bounder-guardian-heartbeat-v1.schema.json",
    "schemas/creedspace-bounder-fleet-snapshot-v1.schema.json",
    "schemas/creedspace-bounder-fleet-event-v1.schema.json",
    "schemas/creedspace-bounder-telemetry-envelope-v1.schema.json"
  ],
  logger = console
} = {}) {
  if (!Array.isArray(phases) || phases.length === 0) throw new Error("verification phases are empty");
  const ids = new Set();
  for (const phase of phases) {
    validatePhase(phase);
    if (ids.has(phase.id)) throw new Error(`duplicate verification phase: ${phase.id}`);
    ids.add(phase.id);
  }
  const startedAtMs = clock();
  const startedAt = new Date(startedAtMs).toISOString();
  const candidate = await candidateReader(root);
  await mkdir(outputRoot, { recursive: true });
  const runDirectory = await mkdtemp(join(outputRoot, `${sanitizeTimestamp(startedAt)}-`));
  const results = [];
  const unverified = [];
  let failed = false;

  for (const phase of phases) {
    if (failed) {
      unverified.push({ phase: phase.id, reason: "skipped after an earlier phase failed" });
      continue;
    }
    logger.log(`verify:${phase.id}`);
    let result;
    try {
      result = await phaseRunner(phase, { root });
    } catch (error) {
      result = { exit_code: 1, signal: null, timed_out: false, duration_ms: 0, stdout: "", stderr: error.message };
    }
    const log = `${result.stdout || ""}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`;
    const logPath = join(runDirectory, `${phase.id}.log`);
    await writeFile(logPath, log, { encoding: "utf8", flag: "wx" });
    const phaseResult = {
      id: phase.id,
      command: [phase.command, ...phase.args],
      exit_code: result.exit_code,
      signal: result.signal || null,
      timed_out: Boolean(result.timed_out),
      duration_ms: result.duration_ms,
      log_path: `${phase.id}.log`,
      log_sha256: hash(log)
    };
    results.push(phaseResult);
    if (phaseResult.exit_code !== 0 || phaseResult.timed_out) failed = true;
  }

  const finishedAtMs = clock();
  const receipt = {
    version: "bounder-verification/v1",
    candidate,
    started_at: startedAt,
    finished_at: new Date(finishedAtMs).toISOString(),
    environment: { platform: process.platform, architecture: process.arch, node: process.version },
    phases: results,
    artifacts: await hashArtifacts(root, artifactPaths),
    claims: failed ? [] : [
      "source_behavior", "browser_behavior", "publisher_integrity", "runtime_observability", "observability_performance",
      ...(candidate.producer_commits.length ? ["producer_derivation", "cross_repository_compatibility"] : [])
    ],
    unverified: [
      ...unverified,
      ...(candidate.producer_commits.length ? [] : [{ proof_class: "producer_derivation", reason: "no current producer-derivation receipt matches the website bytes" }]),
      { proof_class: "deployment_parity", reason: "no live verification was authorized" },
      { proof_class: "physical_safety", reason: "simulation and repository proof cannot establish physical safety" },
      { proof_class: "human_legal_regulatory", reason: "requires appropriate human review" }
    ],
    success: !failed
  };
  const receiptSource = `${JSON.stringify(receipt, null, 2)}\n`;
  const temporaryPath = join(runDirectory, ".receipt.tmp");
  const receiptPath = join(runDirectory, "receipt.json");
  await writeFile(temporaryPath, receiptSource, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, receiptPath);
  const latestTemporary = join(runDirectory, ".latest.tmp");
  const latestPath = join(outputRoot, "latest.json");
  await writeFile(latestTemporary, receiptSource, { encoding: "utf8", flag: "wx" });
  await rename(latestTemporary, latestPath);
  logger.log(`Verification receipt: ${receiptPath}`);
  return Object.freeze({ receipt: Object.freeze(receipt), receiptPath });
}

export async function runVerifyCli(args = process.argv.slice(2), logger = console) {
  let phases = DEFAULT_VERIFICATION_PHASES;
  if (args.length) {
    if (args.length !== 2 || args[0] !== "--phase") throw new Error("usage: npm run verify -- [--phase <id>]");
    phases = DEFAULT_VERIFICATION_PHASES.filter(({ id }) => id === args[1]);
    if (!phases.length) throw new Error(`unknown verification phase: ${args[1]}`);
  }
  const result = await runVerification({ phases, logger });
  if (!result.receipt.success) throw new Error("verification failed; inspect the receipt and phase log");
  return result;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runVerifyCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
