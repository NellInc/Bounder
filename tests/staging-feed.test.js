import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPilotEvidence, validatePilotEvidence } from "../staging-feed.js";

const root = new URL("../", import.meta.url);
const pilot = JSON.parse(await readFile(new URL("data/bounder-staging-pilot.v1.json", root), "utf8"));
const pilotIntegrity = `sha256:${createHash("sha256").update(JSON.stringify(pilot)).digest("hex")}`;
const response = (value, { status = 200, contentType = "application/json" } = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": contentType } });

test("the recorded pilot contains 100 device-bound Guardians across six platforms", () => {
  const evidence = validatePilotEvidence(pilot);
  assert.equal(evidence.summary.devices, 100);
  assert.equal(evidence.devices.length, 100);
  assert.equal(Object.keys(evidence.summary.platform_counts).length, 6);
  assert.equal(new Set(evidence.devices.map(({ device_id }) => device_id)).size, 100);
  assert.ok(Object.values(evidence.summary.platform_counts).every((count) => count >= 16));
});

test("a configured Creed Space feed is loaded without browser credentials", async () => {
  const calls = [];
  const result = await loadPilotEvidence({
    configuredURL: "https://staging.creed.space/evidence/bounder-pilot.json",
    configuredIntegrity: pilotIntegrity,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return response(pilot);
    }
  });
  assert.equal(result.source, "live");
  assert.equal(result.evidence.summary.devices, 100);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
});

test("a failed live feed falls back to recorded deterministic evidence", async () => {
  let count = 0;
  const result = await loadPilotEvidence({
    configuredURL: "https://staging.creed.space/evidence/bounder-pilot.json",
    configuredIntegrity: pilotIntegrity,
    fallbackURL: "https://www.bounder.io/data/bounder-staging-pilot.v1.json",
    fetchImpl: async () => {
      count += 1;
      return count === 1 ? response({ error: "offline" }, { status: 503 }) : response(pilot);
    }
  });
  assert.equal(result.source, "recorded");
  assert.match(result.warning, /Live feed unavailable/);
  assert.equal(count, 2);
});

test("live evidence requires an exact SHA-256 pin and falls back on tampering", async () => {
  let count = 0;
  const tampered = structuredClone(pilot);
  tampered.devices[0].scenario = "tampered";
  const result = await loadPilotEvidence({
    configuredURL: "https://staging.creed.space/evidence/bounder-pilot.json",
    configuredIntegrity: pilotIntegrity,
    fallbackURL: "https://www.bounder.io/data/bounder-staging-pilot.v1.json",
    fetchImpl: async () => response(count++ === 0 ? tampered : pilot)
  });
  assert.equal(result.source, "recorded");
  assert.match(result.warning, /integrity check failed/);
});

test("untrusted feed hosts fall back and inconsistent device evidence is rejected", async () => {
	const result = await loadPilotEvidence({
		configuredURL: "https://example.com/pilot.json",
		fetchImpl: async () => response(pilot)
	});
	assert.equal(result.source, "recorded");
	assert.match(result.warning, /Bounder or Creed Space host/);

  const duplicated = structuredClone(pilot);
  duplicated.devices[1].device_id = duplicated.devices[0].device_id;
  duplicated.devices[1].receipt.device_id = duplicated.devices[0].device_id;
  duplicated.devices[1].fleet_audit.dimensions_triggered.device_id = duplicated.devices[0].device_id;
  assert.throws(() => validatePilotEvidence(duplicated), /duplicated/);

  const inconsistentAudit = structuredClone(pilot);
  inconsistentAudit.devices[0].fleet_audit.dimensions_triggered.code = "tampered";
  assert.throws(() => validatePilotEvidence(inconsistentAudit), /audit evidence is inconsistent/);

  const inconsistentSummary = structuredClone(pilot);
  inconsistentSummary.summary.allowed += 1;
  inconsistentSummary.summary.blocked -= 1;
  assert.throws(() => validatePilotEvidence(inconsistentSummary), /summary totals are inconsistent/);
});

test("wrong content types fail closed", async () => {
  await assert.rejects(
    loadPilotEvidence({
      fallbackURL: "https://www.bounder.io/data/bounder-staging-pilot.v1.json",
      fetchImpl: async () => response(pilot, { contentType: "text/html" })
    }),
    /did not return JSON/
  );
});
