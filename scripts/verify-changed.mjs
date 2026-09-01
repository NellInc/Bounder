import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkChanged } from "./check-changed.mjs";
import { loadSystemModel, repositoryRoot } from "./lib/system-model.mjs";
import { DEFAULT_VERIFICATION_PHASES, executeVerificationPhase } from "./verify.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

export function selectChangedPhases(model, plan, { producerRoot = process.env.BOUNDER_PRODUCER_ROOT || "" } = {}) {
  const ids = new Set(plan.commands);
  const skipped = [];
  if (ids.has("verify")) {
    const phases = [...DEFAULT_VERIFICATION_PHASES];
    if (ids.has("producer_derivation")) {
      if (producerRoot) phases.splice(1, 0, { id: "producer-derivation", command: "npm", args: ["run", "verify:producer", "--", "--producer-root", producerRoot], timeout_ms: 900_000 });
      else skipped.push({ command: "producer_derivation", reason: "BOUNDER_PRODUCER_ROOT is unavailable" });
    }
    return { phases, skipped };
  }
  if (ids.has("unit_coverage")) ids.delete("unit");
  for (const diagnostic of ["inspect", "check_changed", "verify"]) ids.delete(diagnostic);
  const phases = [];
  for (const command of model.commands) {
    if (!ids.has(command.id)) continue;
    if (command.id === "producer_derivation" && !producerRoot) {
      skipped.push({ command: command.id, reason: "BOUNDER_PRODUCER_ROOT is unavailable" });
      continue;
    }
    const argv = command.id === "producer_derivation"
      ? [...command.argv, "--", "--producer-root", producerRoot]
      : command.argv;
    phases.push({ id: command.id.replaceAll("_", "-"), command: argv[0], args: argv.slice(1), timeout_ms: command.timeout_seconds * 1000 });
  }
  return { phases, skipped };
}

function parseArguments(args) {
  const forwarded = [];
  let requireProducer = false;
  for (const argument of args) {
    if (argument === "--require-producer") requireProducer = true;
    else forwarded.push(argument);
  }
  return { forwarded, requireProducer };
}

export async function verifyChanged(args = process.argv.slice(2), {
  root = repositoryRoot,
  phaseRunner = executeVerificationPhase,
  clock = () => Date.now(),
  logger = console,
  producerRoot = process.env.BOUNDER_PRODUCER_ROOT || ""
} = {}) {
  const { forwarded, requireProducer } = parseArguments(args);
  const [{ plan }, model] = await Promise.all([checkChanged(forwarded, { root }), loadSystemModel({ root })]);
  const { phases, skipped } = selectChangedPhases(model, plan, { producerRoot });
  if (requireProducer && skipped.some(({ command }) => command === "producer_derivation")) {
    throw new Error("producer derivation was selected and --require-producer forbids skipping it");
  }
  const started = clock();
  const outputRoot = join(root, "artifacts", "changed-verification");
  await mkdir(outputRoot, { recursive: true });
  const runRoot = await mkdtemp(join(outputRoot, `${new Date(started).toISOString().replaceAll(":", "-").replaceAll(".", "-")}-`));
  const results = [];
  let success = true;
  for (const phase of phases) {
    if (!success) {
      skipped.push({ command: phase.id, reason: "skipped after an earlier selected command failed" });
      continue;
    }
    logger.log(`verify:changed:${phase.id}`);
    const result = await phaseRunner(phase, { root });
    const source = `${result.stdout || ""}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`;
    await writeFile(join(runRoot, `${phase.id}.log`), source, { flag: "wx" });
    results.push({
      id: phase.id,
      command: [phase.command, ...phase.args],
      exit_code: result.exit_code,
      timed_out: Boolean(result.timed_out),
      duration_ms: result.duration_ms,
      log_sha256: hash(source)
    });
    success = result.exit_code === 0 && !result.timed_out;
  }
  const receipt = {
    version: "bounder-changed-verification/v1",
    started_at: new Date(started).toISOString(),
    finished_at: new Date(clock()).toISOString(),
    plan,
    phases: results,
    skipped,
    success
  };
  const source = `${JSON.stringify(receipt, null, 2)}\n`;
  const receiptPath = join(runRoot, "receipt.json");
  await writeFile(receiptPath, source, { flag: "wx" });
  const latestTemporary = join(runRoot, ".latest.tmp");
  await writeFile(latestTemporary, source, { flag: "wx" });
  await rename(latestTemporary, join(outputRoot, "latest.json"));
  logger.log(`Changed-path verification receipt: ${receiptPath}`);
  if (!success) throw new Error("changed-path verification failed; inspect its receipt and logs");
  return Object.freeze({ receipt: Object.freeze(receipt), receiptPath });
}

export function reportVerifyChangedCliFailure(error, logger = console) {
  logger.error(error.message);
  process.exitCode = 1;
}

/* c8 ignore start -- direct-entry failure plumbing is covered through the exported command API. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyChanged().catch(reportVerifyChangedCliFailure);
}
/* c8 ignore stop */
