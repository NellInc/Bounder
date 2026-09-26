import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "./lib/system-model.mjs";

// The unit-coverage gate, in two tiers.
//
// Gated: first-party modules that run under Node -- root modules, runtime/ and scripts/ -- held
// to per-file floors. Reported: browser-only modules (ui/, simulator/ and the page entry
// scripts). Most of their code needs a DOM or WebGL, so it is proved behaviourally by the
// Playwright acceptance suite, which gathers no coverage; a per-file floor over them would be
// either failing or theatre. They are still printed, so a reader of the gated table cannot take
// its totals for the whole shipped surface.
//
// V8 coverage lands in a private temporary directory that is removed afterwards, including on
// Ctrl-C: a fixed shared path lets concurrent runs delete each other's data, and an unremoved
// mktemp directory leaks about 15 MB per run.

export const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const C8_BIN = join(repositoryRoot, "node_modules", "c8", "bin", "c8.js");
export const COVERAGE_FLOORS = Object.freeze({ lines: 85, branches: 75, functions: 85 });
export const GATED_INCLUDES = Object.freeze(["*.js", "runtime/**/*.js", "scripts/**/*.{js,mjs}"]);
export const BROWSER_ONLY_MODULES = Object.freeze([
  "simulator-bootstrap.js", "simulator-fallback.js", "simulator.js", "site.js", "ui/**/*.js", "simulator/**/*.js"
]);
const GATED_EXCLUDES = Object.freeze(["playwright.config.js", ...BROWSER_ONLY_MODULES.filter((pattern) => !pattern.includes("/"))]);
export const TEST_COMMAND = Object.freeze(["node", "--test", "tests/*.test.js"]);
export const COVERAGE_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);

export function gateArguments(tempDirectory) {
  return [
    "--all", "--clean", `--temp-directory=${tempDirectory}`, "--reporter=text",
    "--check-coverage", "--per-file",
    ...Object.entries(COVERAGE_FLOORS).map(([metric, floor]) => `--${metric}=${floor}`),
    ...GATED_INCLUDES.map((pattern) => `--include=${pattern}`),
    ...GATED_EXCLUDES.map((pattern) => `--exclude=${pattern}`),
    ...TEST_COMMAND
  ];
}

export function browserReportArguments(tempDirectory) {
  return [
    "report", "--all", `--temp-directory=${tempDirectory}`, "--reporter=text",
    ...BROWSER_ONLY_MODULES.map((pattern) => `--include=${pattern}`)
  ];
}

function runNode(args, { spawnImpl, cwd }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnImpl(process.execPath, args, { cwd, stdio: "inherit" });
    child.once("error", rejectPromise);
    // A child killed by a signal has no exit code; that is a failed gate, never a pass.
    child.once("close", (code) => resolvePromise(Number.isInteger(code) ? code : 1));
  });
}

export async function runCoverage({
  root = repositoryRoot,
  c8 = C8_BIN,
  spawnImpl = spawn,
  temporaryParent = process.env.TMPDIR || tmpdir(),
  processApi = process,
  logger = console
} = {}) {
  const directory = await mkdtemp(join(temporaryParent, "bounder-c8-"));
  const onSignal = (signal) => {
    rmSync(directory, { recursive: true, force: true });
    for (const name of COVERAGE_SIGNALS) processApi.off(name, handlers.get(name));
    processApi.kill(processApi.pid, signal);
  };
  const handlers = new Map(COVERAGE_SIGNALS.map((signal) => [signal, () => onSignal(signal)]));
  for (const [signal, handler] of handlers) processApi.on(signal, handler);
  try {
    const gate = await runNode([c8, ...gateArguments(directory)], { spawnImpl, cwd: root });
    logger.log("\nBrowser-only modules: reported, not gated. The Playwright acceptance suite proves them behaviourally and gathers no coverage.");
    const report = await runNode([c8, ...browserReportArguments(directory)], { spawnImpl, cwd: root });
    return gate !== 0 ? gate : report;
  } finally {
    for (const [signal, handler] of handlers) processApi.off(signal, handler);
    await rm(directory, { recursive: true, force: true });
  }
}

/* c8 ignore start -- direct-entry plumbing is covered through the exported command API. */
if (isMainModule(import.meta.url)) {
  runCoverage().then((code) => { process.exitCode = code; }, (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
