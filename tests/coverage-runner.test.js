import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BROWSER_ONLY_MODULES,
  COVERAGE_FLOORS,
  COVERAGE_SIGNALS,
  browserReportArguments,
  gateArguments,
  runCoverage
} from "../scripts/coverage.mjs";

function fakeProcess() {
  const listeners = new Map();
  return {
    pid: 4242,
    killed: [],
    listeners,
    on(signal, handler) { listeners.set(signal, handler); },
    off(signal, handler) { if (listeners.get(signal) === handler) listeners.delete(signal); },
    kill(pid, signal) { this.killed.push([pid, signal]); }
  };
}

function fakeSpawn(exitCodes, calls, { onSpawn } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    const code = exitCodes.shift();
    setImmediate(() => {
      onSpawn?.(args);
      if (code instanceof Error) child.emit("error", code);
      else child.emit("close", code, code === null ? "SIGKILL" : null);
    });
    return child;
  };
}

async function scratch(t) {
  const parent = await mkdtemp(join(tmpdir(), "bounder-coverage-runner-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  return parent;
}

test("the gate holds per-file floors over Node modules and reports browser-only modules separately", () => {
  const gate = gateArguments("/scratch/c8");
  assert.ok(gate.includes("--temp-directory=/scratch/c8"));
  assert.ok(gate.includes("--check-coverage") && gate.includes("--per-file"));
  for (const [metric, floor] of Object.entries(COVERAGE_FLOORS)) assert.ok(gate.includes(`--${metric}=${floor}`), metric);
  assert.deepEqual(gate.slice(-3), ["node", "--test", "tests/*.test.js"]);
  for (const excluded of ["playwright.config.js", "simulator.js", "site.js", "simulator-bootstrap.js", "simulator-fallback.js"]) {
    assert.ok(gate.includes(`--exclude=${excluded}`), excluded);
  }

  const report = browserReportArguments("/scratch/c8");
  assert.equal(report[0], "report");
  assert.equal(report.includes("--check-coverage"), false, "browser-only modules are reported, not gated");
  for (const pattern of ["ui/**/*.js", "simulator/**/*.js"]) assert.ok(BROWSER_ONLY_MODULES.includes(pattern) && report.includes(`--include=${pattern}`));
});

test("coverage data lives in a private directory that is removed after every outcome", async (t) => {
  const parent = await scratch(t);
  for (const [codes, expected] of [[[0, 0], 0], [[1, 0], 1], [[0, 2], 2], [[null, 0], 1]]) {
    const calls = [];
    const processApi = fakeProcess();
    const logged = [];
    const code = await runCoverage({
      root: "/repo",
      c8: "/repo/c8.js",
      temporaryParent: parent,
      spawnImpl: fakeSpawn([...codes], calls, {
        onSpawn: (args) => writeFile(join(args.find((arg) => arg.startsWith("--temp-directory=")).slice(16), "coverage-1.json"), "{}").catch(() => {})
      }),
      processApi,
      logger: { log: (line) => logged.push(line) }
    });
    assert.equal(code, expected, `exit codes ${codes}`);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, process.execPath);
    assert.equal(calls[0].options.cwd, "/repo");
    assert.equal(calls[0].args[0], "/repo/c8.js");
    assert.equal(calls[1].args[1], "report");
    assert.match(logged[0], /reported, not gated/);
    assert.deepEqual(await readdir(parent), [], "the V8 coverage directory leaked");
    assert.equal(processApi.listeners.size, 0, "signal handlers leaked");
  }

  const failing = await runCoverage({ temporaryParent: parent, spawnImpl: fakeSpawn([new Error("spawn failed")], []), processApi: fakeProcess(), logger: { log() {} } })
    .then(() => null, (error) => error);
  assert.match(failing.message, /spawn failed/);
  assert.deepEqual(await readdir(parent), []);
});

test("an interrupted coverage run removes its directory before re-raising the signal", async (t) => {
  const parent = await scratch(t);
  const processApi = fakeProcess();
  let release;
  const spawnImpl = () => {
    const child = new EventEmitter();
    release = () => child.emit("close", 0, null);
    return child;
  };
  const running = runCoverage({ temporaryParent: parent, spawnImpl, processApi, logger: { log() {} } });
  while (!release) await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal((await readdir(parent)).length, 1);
  assert.deepEqual([...processApi.listeners.keys()].sort(), [...COVERAGE_SIGNALS].sort());
  processApi.listeners.get("SIGINT")();
  assert.deepEqual(await readdir(parent), [], "the directory survived the interrupt");
  assert.deepEqual(processApi.killed, [[4242, "SIGINT"]]);
  assert.equal(processApi.listeners.size, 0);
  const first = release;
  release = null;
  first();
  while (!release) await new Promise((resolvePromise) => setImmediate(resolvePromise));
  release();
  assert.equal(await running, 0);
});
