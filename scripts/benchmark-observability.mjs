import { performance } from "node:perf_hooks";

import { isMainModule } from "./lib/system-model.mjs";

import {
  DEFAULT_OBSERVABILITY_BUDGETS,
  PLATFORMS,
  aggregateFleetSnapshot,
  deriveFleetEvents,
  validateObservabilityBudgets
} from "../runtime/observability/guardian-fleet-state.js";

export const BENCHMARK_NOW_MS = Date.parse("2026-08-31T12:00:00.000Z");
export const PROCESS_CPU_CLOCK = Object.freeze({
  now() {
    const usage = process.cpuUsage();
    return (usage.user + usage.system) / 1_000;
  }
});

export function makeBenchmarkHeartbeat(index, nowMs = BENCHMARK_NOW_MS) {
  const platform = PLATFORMS[index % PLATFORMS.length];
  return {
    version: "creedspace-bounder-guardian-heartbeat/v1",
    visibility: "fleet-private",
    fleet_id: "relief-fleet",
    guardian_id: `bounder-benchmark-${String(index).padStart(5, "0")}`,
    platform,
    boot_id: `boot-${index}`,
    sequence: 12,
    generated_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + 60_000).toISOString(),
    state: "healthy",
    reason: "none",
    policy: {
      policy_id: `policy-${index}`,
      digest: `sha256:${index.toString(16).padStart(64, "0")}`,
      sequence: 42,
      expires_at: new Date(nowMs + 300_000).toISOString(),
      verified: true
    },
    checkpoint: {
      sequence: 42,
      persisted_at: new Date(nowMs - 1_000).toISOString(),
      rollback_detected: false
    },
    continuity_lease_expires_at: new Date(nowMs + 120_000).toISOString(),
    evidence: { freshest_at: new Date(nowMs - 5_000).toISOString(), required_max_age_ms: 30_000 },
    decisions: {
      window_ms: 60_000,
      evaluated: 10,
      allowed: 8,
      held: 2,
      failures: 0,
      latency_ms: { p50: 1, p95: 3, p99: 5, max: 7 }
    },
    audit: { queued: 0, oldest_queued_age_ms: 0 },
    resources: { cpu_percent: 25, memory_percent: 30, network_tx_bytes: 2048, network_rx_bytes: 4096 }
  };
}

export async function runObservabilityBenchmark({
  guardianCount = DEFAULT_OBSERVABILITY_BUDGETS.fleet_max_guardians,
  budgets: budgetOverrides = {},
  nowMs = BENCHMARK_NOW_MS,
  cpuClock = PROCESS_CPU_CLOCK,
  wallClock = performance,
  warmupRuns = 1,
  measuredRuns = 3
} = {}) {
  const budgets = validateObservabilityBudgets(budgetOverrides);
  if (!Number.isSafeInteger(guardianCount) || guardianCount < 1 || guardianCount > budgets.fleet_max_guardians) {
    throw new Error("benchmark Guardian count is invalid");
  }
  if (!Number.isSafeInteger(warmupRuns) || warmupRuns < 0 || warmupRuns > 10) throw new Error("benchmark warmup count is invalid");
  if (!Number.isSafeInteger(measuredRuns) || measuredRuns < 1 || measuredRuns > 9 || measuredRuns % 2 === 0) {
    throw new Error("benchmark measured count must be an odd integer from 1 through 9");
  }
  const heartbeats = Array.from({ length: guardianCount }, (_, index) => makeBenchmarkHeartbeat(index, nowMs));
  const expectedGuardians = heartbeats.map(({ guardian_id, platform }) => ({ guardian_id, platform }));
  const aggregate = () => aggregateFleetSnapshot({ fleetId: "relief-fleet", expectedGuardians, heartbeats, nowMs, cycleStartedAtMs: nowMs, budgets });
  for (let run = 0; run < warmupRuns; run += 1) aggregate();
  const cpuSamples = [];
  const wallSamples = [];
  let snapshot;
  for (let run = 0; run < measuredRuns; run += 1) {
    const cpuStarted = cpuClock.now();
    const wallStarted = wallClock.now();
    snapshot = aggregate();
    const wallDuration = wallClock.now() - wallStarted;
    const cpuDuration = cpuClock.now() - cpuStarted;
    for (const [label, duration] of [["CPU", cpuDuration], ["wall", wallDuration]]) {
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
        throw new Error(`benchmark ${label} clock is invalid`);
      }
    }
    cpuSamples.push(cpuDuration);
    wallSamples.push(wallDuration);
  }
  const median = (samples) => [...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)];
  const aggregationCpuMs = median(cpuSamples);
  const aggregationWallMs = median(wallSamples);
  const connected = await deriveFleetEvents({ currentHeartbeat: heartbeats[0], observedAtMs: nowMs, budgets });
  const encoder = new TextEncoder();
  const sizes = {
    heartbeat_bytes: encoder.encode(JSON.stringify(heartbeats[0])).byteLength,
    snapshot_bytes: encoder.encode(JSON.stringify(snapshot)).byteLength,
    event_bytes: encoder.encode(JSON.stringify(connected[0])).byteLength
  };
  const limits = {
    heartbeat_bytes: budgets.heartbeat_max_bytes,
    snapshot_bytes: budgets.snapshot_max_bytes,
    event_bytes: budgets.event_max_bytes
  };
  const failures = [];
  for (const [key, value] of Object.entries(sizes)) if (value > limits[key]) failures.push(`${key} ${value} > ${limits[key]}`);
  if (guardianCount === budgets.fleet_max_guardians && aggregationCpuMs > budgets.aggregation_10000_max_cpu_ms) {
    failures.push(`aggregation_cpu_ms ${aggregationCpuMs.toFixed(3)} > ${budgets.aggregation_10000_max_cpu_ms}`);
  }
  return Object.freeze({
    version: "bounder-observability-benchmark/v2",
    scope: budgets.scope,
    guardian_count: guardianCount,
    measurement: Object.freeze({
      pass_fail: "process-cpu-time",
      diagnostic: "monotonic-wall-time"
    }),
    aggregation_cpu_ms: Number(aggregationCpuMs.toFixed(3)),
    aggregation_cpu_samples_ms: cpuSamples.map((value) => Number(value.toFixed(3))),
    aggregation_wall_ms: Number(aggregationWallMs.toFixed(3)),
    aggregation_wall_samples_ms: wallSamples.map((value) => Number(value.toFixed(3))),
    warmup_runs: warmupRuns,
    measured_runs: measuredRuns,
    sizes,
    limits,
    passed: failures.length === 0,
    failures,
    does_not_establish: ["production capacity", "Guardian decision latency", "hardware performance"]
  });
}

export async function runBenchmarkCli(args = process.argv.slice(2), logger = console, benchmarkOptions = {}) {
  if (args.length) throw new Error(`unknown benchmark arguments: ${args.join(" ")}`);
  const result = await runObservabilityBenchmark(benchmarkOptions);
  logger.log(JSON.stringify(result, null, 2));
  if (!result.passed) throw new Error(`observability benchmark failed: ${result.failures.join("; ")}`);
  return result;
}

if (isMainModule(import.meta.url)) {
  runBenchmarkCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
