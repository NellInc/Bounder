import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCHMARK_NOW_MS,
  PROCESS_CPU_CLOCK,
  makeBenchmarkHeartbeat,
  runBenchmarkCli,
  runObservabilityBenchmark
} from "../scripts/benchmark-observability.mjs";

test("reference observability benchmark reports bounded payloads and one-pass aggregation without overclaiming", async () => {
  const cpuTicks = [100, 125];
  const wallTicks = [500, 550];
  const result = await runObservabilityBenchmark({
    guardianCount: 1_000,
    cpuClock: { now: () => cpuTicks.shift() },
    wallClock: { now: () => wallTicks.shift() },
    warmupRuns: 0,
    measuredRuns: 1
  });
  assert.equal(result.passed, true);
  assert.equal(result.guardian_count, 1_000);
  assert.equal(result.aggregation_cpu_ms, 25);
  assert.deepEqual(result.aggregation_cpu_samples_ms, [25]);
  assert.equal(result.aggregation_wall_ms, 50);
  assert.deepEqual(result.aggregation_wall_samples_ms, [50]);
  assert.deepEqual(result.measurement, {
    pass_fail: "process-cpu-time",
    diagnostic: "monotonic-wall-time"
  });
  assert.equal(result.warmup_runs, 0);
  assert.equal(result.measured_runs, 1);
  assert.ok(result.sizes.heartbeat_bytes < result.limits.heartbeat_bytes);
  assert.ok(result.sizes.snapshot_bytes < result.limits.snapshot_bytes);
  assert.ok(result.sizes.event_bytes < result.limits.event_bytes);
  assert.deepEqual(result.does_not_establish, ["production capacity", "Guardian decision latency", "hardware performance"]);
  assert.equal(makeBenchmarkHeartbeat(0, BENCHMARK_NOW_MS).generated_at, "2026-08-31T12:00:00.000Z");
  assert.equal(Number.isFinite(PROCESS_CPU_CLOCK.now()), true);
});

test("benchmark enforces count and byte or time failures and its CLI emits stable JSON", async () => {
  await assert.rejects(() => runObservabilityBenchmark({ guardianCount: 0 }), /count/);
  await assert.rejects(() => runObservabilityBenchmark({ warmupRuns: -1 }), /warmup/);
  await assert.rejects(() => runObservabilityBenchmark({ measuredRuns: 2 }), /odd integer/);
  const failed = await runObservabilityBenchmark({
    guardianCount: 10_000,
    cpuClock: { now: (() => { const values = [0, 3_000]; return () => values.shift(); })() },
    wallClock: { now: (() => { const values = [0, 1]; return () => values.shift(); })() },
    warmupRuns: 0,
    measuredRuns: 1
  });
  assert.equal(failed.passed, false);
  assert.match(failed.failures[0], /aggregation_cpu_ms/);
  const messages = [];
  const result = await runBenchmarkCli([], { log: (message) => messages.push(message) }, {
    guardianCount: 1_000,
    cpuClock: { now: (() => { const values = [0, 25]; return () => values.shift(); })() },
    wallClock: { now: (() => { const values = [0, 40]; return () => values.shift(); })() },
    warmupRuns: 0,
    measuredRuns: 1
  });
  assert.equal(result.passed, true);
  assert.equal(JSON.parse(messages[0]).version, "bounder-observability-benchmark/v2");
  await assert.rejects(() => runBenchmarkCli(["--bad"]), /unknown/);
});
