import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { describeFleetDevice } from "../ui/fleet-view.js";
import { asSentence } from "../ui/text.js";

const pilot = JSON.parse(await readFile(new URL("../data/bounder-staging-pilot.v1.json", import.meta.url), "utf8"));

test("recorded reason fragments are shaped into sentences for display only", () => {
  assert.equal(asSentence("civilian distance is below the signed minimum separation"), "Civilian distance is below the signed minimum separation.");
  assert.equal(asSentence("  published vector request timed out "), "Published vector request timed out.");
  assert.equal(asSentence(""), "");
  assert.equal(asSentence(undefined), "");
});

test("sentence shaping is idempotent, so re-reading displayed text never compounds it", () => {
  for (const value of ["Request denied", "Request denied.", "Is this current?", "a fragment"]) {
    assert.equal(asSentence(asSentence(value)), asSentence(value));
  }
});

test("Fleet search text is what a visitor can read, never the collapsed receipt JSON", () => {
  const matches = (query) => pilot.devices.filter((device) => describeFleetDevice(device).search.includes(query)).length;
  const allowed = pilot.devices.filter((device) => device.receipt.allowed).length;
  // Every receipt JSON contains the key "allowed"; only the allowed rows may match it.
  assert.equal(matches("allowed"), allowed);
  for (const hidden of ["policy_id", "fleet_id", "sha256", "2026-"]) assert.equal(matches(hidden), 0, hidden);
  assert.equal(matches("bounder-marine-003"), 1);
});

test("a replayed policy shows its rejected update instead of reading as accepted", () => {
  const replays = pilot.devices.filter((device) => typeof device.update_error === "string");
  assert.ok(replays.length > 0);
  for (const device of replays) {
    const text = describeFleetDevice(device);
    assert.equal(text.verdict, "Allowed request", "the verdict must not repeat the 'allowed' code");
    assert.match(text.detail, /Rejected update: Policy sequence has already been accepted\. The previously verified policy stayed in force\.$/);
    assert.match(text.search, /rejected update/);
  }
});

test("held Guardians keep their recorded code in the verdict and a sentence-cased reason", () => {
  const held = pilot.devices.find((device) => device.receipt.code === "civilian_proximity");
  const text = describeFleetDevice(held);
  assert.equal(text.verdict, "Protective hold · civilian proximity");
  assert.match(text.detail, /^[A-Z][^.]* · civilian protection\. Civilian distance is below the signed minimum separation\.$/);
});
