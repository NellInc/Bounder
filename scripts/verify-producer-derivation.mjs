import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

export const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const PRODUCER_REPOSITORY = "https://github.com/NellInc/Bounder-from-org";
export const PRODUCER_DEFAULT_REF = "master";
export const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
export const SHARED_CONTRACTS = Object.freeze([
  "bounder-evidence-provenance-v1.schema.json",
  "bounder-resilience-evidence.v1.schema.json",
  "bounder.receipt-bundle.v1.schema.json",
  "bounder.receipt.v1.schema.json",
  "creedspace-bounder-checkpoint-v1.schema.json",
  "creedspace-bounder-envelope-v1.schema.json",
  "creedspace-bounder-fleet-event-v1.schema.json",
  "creedspace-bounder-fleet-snapshot-v1.schema.json",
  "creedspace-bounder-guardian-heartbeat-v1.schema.json",
  "creedspace-bounder-policy-v1.schema.json",
  "creedspace-bounder-profile-v1.schema.json",
  "creedspace-bounder-roundtrip-v1.schema.json",
  "creedspace-bounder-telemetry-envelope-v1.schema.json"
]);
export const PUBLISHED_OUTPUTS = Object.freeze([
  "data/bounder-receipts.v1.json",
  "data/creedspace-bounder-golden-v1.json",
  "data/creedspace-bounder-roundtrip-v1.json"
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compare = (left, right) => left.localeCompare(right, "en");

function validateRelativePath(value, label = "path") {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${label} is unsafe`);
  }
  const normalized = value.split("/");
  if (normalized.some((part) => !part || part === "." || part === "..") || normalized.join("/") !== value) {
    throw new Error(`${label} is unsafe`);
  }
  return value;
}

function contained(root, path, label = "path") {
  const target = resolve(root, ...validateRelativePath(path, label).split("/"));
  const fromRoot = relative(resolve(root), target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} escapes its root`);
  }
  return target;
}

async function fileBytes(root, path, label = path) {
  const target = contained(root, path, label);
  const info = await stat(target);
  if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size > MAX_EXPORT_BYTES) {
    throw new Error(`${label} is not a bounded regular file`);
  }
  const bytes = await readFile(target);
  if (bytes.byteLength !== info.size) throw new Error(`${label} changed while being read`);
  return bytes;
}

function normalizeRemote(value) {
  return value.trim().replace(/\.git$/u, "").replace(/^git@github\.com:/u, "https://github.com/");
}

export function validateRecordInventory(records, label) {
  if (!Array.isArray(records) || records.length === 0) throw new Error(`${label} inventory is empty`);
  const paths = records.map((record) => record?.path);
  if (new Set(paths).size !== paths.length) throw new Error(`${label} inventory has duplicate paths`);
  if (JSON.stringify([...paths].sort(compare)) !== JSON.stringify(paths)) throw new Error(`${label} inventory is not sorted`);
  for (const record of records) {
    validateRelativePath(record.path, `${label} path`);
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > MAX_EXPORT_BYTES) throw new Error(`${label} byte count is invalid`);
    if (!/^[0-9a-f]{64}$/u.test(record.sha256)) throw new Error(`${label} digest is invalid`);
  }
}

export async function verifyRecordInventory(root, records, label) {
  validateRecordInventory(records, label);
  for (const record of records) {
    const bytes = await fileBytes(root, record.path, `${label} ${record.path}`);
    if (bytes.byteLength !== record.bytes || sha256(bytes) !== record.sha256) {
      throw new Error(`${label} hash mismatch: ${record.path}`);
    }
  }
}

export async function verifyProducerExport({ siteRoot, exportRoot, expectedCommit }) {
  const source = await fileBytes(exportRoot, "bounder-evidence-provenance.v1.json", "producer provenance");
  const provenance = JSON.parse(source.toString("utf8"));
  const schema = JSON.parse(await readFile(join(siteRoot, "schemas", "bounder-evidence-provenance-v1.schema.json"), "utf8"));
  const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validator(provenance)) {
    const detail = validator.errors.map(({ instancePath, message }) => `${instancePath || "/"} ${message}`).join("; ");
    throw new Error(`producer provenance schema validation failed: ${detail}`);
  }
  if (provenance.producer_source.repository !== PRODUCER_REPOSITORY || provenance.producer_source.commit !== expectedCommit || provenance.producer_source.clean !== true) {
    throw new Error("producer provenance identifies the wrong source revision");
  }
  await verifyRecordInventory(exportRoot, provenance.contracts, "producer contracts");
  await verifyRecordInventory(exportRoot, provenance.outputs, "producer outputs");

  const expectedContracts = SHARED_CONTRACTS.map((name) => `schemas/${name}`).sort(compare);
  if (JSON.stringify(provenance.contracts.map(({ path }) => path)) !== JSON.stringify(expectedContracts)) {
    throw new Error("producer provenance contract inventory is incomplete");
  }
  for (const name of SHARED_CONTRACTS) {
    const [siteBytes, producerBytes] = await Promise.all([
      fileBytes(siteRoot, `schemas/${name}`, `website schema ${name}`),
      fileBytes(exportRoot, `schemas/${name}`, `producer schema ${name}`)
    ]);
    if (!siteBytes.equals(producerBytes)) throw new Error(`shared contract drift: ${name}`);
  }
  for (const path of PUBLISHED_OUTPUTS) {
    const output = provenance.outputs.find((record) => record.path === path);
    if (!output) throw new Error(`producer provenance omits published output: ${path}`);
    const [siteBytes, producerBytes] = await Promise.all([
      fileBytes(siteRoot, path, `website evidence ${path}`),
      fileBytes(exportRoot, path, `producer evidence ${path}`)
    ]);
    if (!siteBytes.equals(producerBytes)) throw new Error(`producer-derived evidence drift: ${path}`);
  }
  return Object.freeze({ provenance, provenance_sha256: sha256(source) });
}

export const EXECUTE_KILL_ESCALATION_MS = 5_000;

const asBuffer = (chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));

export async function execute(command, args, { cwd, timeoutMs = 600_000, escalationMs = EXECUTE_KILL_ESCALATION_MS, killImpl = (pid, signal) => process.kill(pid, signal) } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: process.env.CI || "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });
    // Chunks are concatenated and decoded once: per-chunk decoding corrupts multi-byte
    // sequences split across a chunk boundary, and these strings are hashed into the sealed
    // derivation receipt as generator_stdout_sha256 / generator_stderr_sha256.
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    let timedOut = false;
    let escalation = null;
    // The generator is a wrapper process; signalling only the direct child leaves grandchildren
    // holding the stdio pipes open so "close" never fires and the timeout has no upper bound.
    const signalGroup = (signal) => {
      try {
        if (Number.isInteger(child.pid)) killImpl(-child.pid, signal);
        else child.kill(signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The generator already exited; nothing is left to signal.
        }
      }
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      signalGroup("SIGTERM");
      escalation = setTimeout(() => signalGroup("SIGKILL"), escalationMs);
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timeout);
      if (escalation !== null) clearTimeout(escalation);
    };
    child.stdout.on("data", (chunk) => { stdoutChunks.push(asBuffer(chunk)); });
    child.stderr.on("data", (chunk) => { stderrChunks.push(asBuffer(chunk)); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      rejectPromise(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code !== 0) rejectPromise(new Error(`${command} failed (${timedOut ? "timeout" : code ?? signal}): ${stderr.trim() || stdout.trim()}`));
      else resolvePromise({ stdout, stderr });
    });
  });
}

async function git(root, args) {
  const { stdout } = await execute("/usr/bin/git", ["--no-optional-locks", "-C", root, ...args], { cwd: root, timeoutMs: 30_000 });
  return stdout.trim();
}

export async function inspectProducerCheckout(producerRoot) {
  const root = await realpath(resolve(producerRoot));
  const [commit, status, remote] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(root, ["remote", "get-url", "origin"])
  ]);
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("producer checkout has no full commit identity");
  if (status) throw new Error("producer checkout must be clean for derivation proof");
  if (normalizeRemote(remote) !== PRODUCER_REPOSITORY) throw new Error(`unexpected producer origin: ${remote}`);
  return Object.freeze({ root, commit, repository: PRODUCER_REPOSITORY, default_ref: PRODUCER_DEFAULT_REF });
}

export function parseProducerArguments(args, environment = process.env) {
  const options = { producerRoot: environment.BOUNDER_PRODUCER_ROOT || "", json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--producer-root") {
      options.producerRoot = args[index += 1] || "";
      if (!options.producerRoot) throw new Error("--producer-root requires a path");
    } else throw new Error(`unknown producer verification argument: ${argument}`);
  }
  if (!options.producerRoot) throw new Error("set BOUNDER_PRODUCER_ROOT or pass --producer-root");
  return options;
}

export async function verifyProducerDerivation({
  siteRoot = repositoryRoot,
  producerRoot,
  outputRoot = join(siteRoot, "artifacts", "producer-derivation"),
  checkoutInspector = inspectProducerCheckout,
  commandRunner = execute,
  exportVerifier = verifyProducerExport,
  gitRunner = git,
  clock = () => new Date().toISOString()
} = {}) {
  const producer = await checkoutInspector(producerRoot);
  await mkdir(outputRoot, { recursive: true });
  const scratchParent = await mkdtemp(join(outputRoot, ".work-"));
  const exportRoot = join(scratchParent, "export");
  const startedAt = clock();
  try {
    const execution = await commandRunner("python3", ["scripts/export-website-artifacts.py", "--output", exportRoot], { cwd: producer.root });
    const result = await exportVerifier({ siteRoot, exportRoot, expectedCommit: producer.commit });
    const receipt = {
      version: "bounder-producer-derivation-verification/v1",
      producer,
      publisher: { repository: "https://github.com/NellInc/Bounder", commit: await gitRunner(siteRoot, ["rev-parse", "HEAD"]) },
      started_at: startedAt,
      finished_at: clock(),
      contracts: SHARED_CONTRACTS,
      outputs: PUBLISHED_OUTPUTS,
      producer_statement: result.provenance,
      provenance_sha256: result.provenance_sha256,
      generator_stdout_sha256: sha256(execution.stdout),
      generator_stderr_sha256: sha256(execution.stderr),
      success: true
    };
    const runRoot = join(outputRoot, `${startedAt.replaceAll(":", "-").replaceAll(".", "-")}-${producer.commit.slice(0, 8)}`);
    await mkdir(runRoot, { recursive: false });
    const source = `${JSON.stringify(receipt, null, 2)}\n`;
    await writeFile(join(runRoot, "receipt.json"), source, { flag: "wx" });
    const latestTemporary = join(runRoot, ".latest.tmp");
    await writeFile(latestTemporary, source, { flag: "wx" });
    await rename(latestTemporary, join(outputRoot, "latest.json"));
    return Object.freeze({ receipt: Object.freeze(receipt), receiptPath: join(runRoot, "receipt.json") });
  } finally {
    await rm(scratchParent, { recursive: true, force: true });
  }
}

export async function runVerifyProducerCli(args = process.argv.slice(2), logger = console) {
  const options = parseProducerArguments(args);
  const result = await verifyProducerDerivation({ producerRoot: options.producerRoot });
  logger.log(options.json ? JSON.stringify(result.receipt, null, 2) : `Producer derivation verified: ${result.receiptPath}`);
  return result;
}

/* c8 ignore start -- direct-entry failure plumbing is covered through the exported command API. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runVerifyProducerCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
