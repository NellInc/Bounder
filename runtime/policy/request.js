import { ACTIONS, METTLE_TIERS, REQUEST_STATE_KEYS, assertBoolean, assertExactKeys, assertFiniteNumber } from "./primitives.js";
import { parseRFC3339 } from "./contracts.js";

export const validateRequest = (request, { publishedRoundTrip = true } = {}) => {
  assertExactKeys(request, ["action", "state", "evidence"], "round-trip request");
  if (!ACTIONS.has(request.action) || (publishedRoundTrip && request.action !== "loiter")) {
    throw new Error("round-trip request action is invalid");
  }
  assertExactKeys(request.state, REQUEST_STATE_KEYS, "round-trip request state");
  for (const key of [
    "gps_fix", "inside_exclusion_zone", "inside_protected_site", "inside_humanitarian_corridor", "positive_identification",
    "proportionality_satisfied", "surrender_observed", "incapacitated_observed", "human_authorization_confirmed"
  ]) assertBoolean(request.state[key], `round-trip request state ${key}`);
  assertFiniteNumber(request.state.battery_percent, "round-trip battery percentage", { min: 0, max: 100 });
  assertFiniteNumber(request.state.altitude_metres, "round-trip altitude", { min: 0, max: 1_000_000 });
  const boundedState = {
    civilian_distance_metres: 10_000_000,
    friendly_distance_metres: 10_000_000,
    wind_speed_metres_per_second: 1_000,
    visibility_metres: 10_000_000
  };
  for (const [key, max] of Object.entries(boundedState)) {
    assertFiniteNumber(request.state[key], `round-trip request state ${key}`, { min: 0, max });
  }
  assertExactKeys(request.evidence, ["mettle_tier", "verified_at"], "round-trip request evidence");
  if (!METTLE_TIERS.has(request.evidence.mettle_tier) || request.evidence.mettle_tier === "") {
    throw new Error("round-trip Mettle tier is invalid");
  }
  return parseRFC3339(request.evidence.verified_at, "round-trip evidence verified_at");
};
