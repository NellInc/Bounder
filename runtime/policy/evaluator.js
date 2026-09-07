import { parseRFC3339, validatePolicy } from "./contracts.js";
import { validateRequest } from "./request.js";

const METTLE_RANK = Object.freeze({ bronze: 1, silver: 2, gold: 3, platinum: 4 });

const decision = (allowed, code, reason) => Object.freeze({ allowed, code, reason });

/**
 * Browser replay of the signed policy contract; this result grants no actuator authority.
 * @returns {Readonly<{allowed: boolean, code: string, reason: string}>}
 */
export const evaluatePolicyRequest = (policy, request, evaluatedAt) => {
  const validity = validatePolicy(policy);
  const verifiedAt = validateRequest(request, { publishedRoundTrip: false });
  const evaluated = typeof evaluatedAt === "string"
    ? parseRFC3339(evaluatedAt, "policy evaluation time")
    : evaluatedAt;
  if (!evaluated || typeof evaluated.epochNanoseconds !== "bigint") throw new Error("policy evaluation time is invalid");
  if (evaluated.epochNanoseconds < validity.notBeforeNanoseconds || evaluated.epochNanoseconds >= validity.expiresAtNanoseconds) {
    return decision(false, "policy_inactive", "the signed policy is not active at the evaluation time");
  }
  const { constraints } = policy;
  const { action, state, evidence } = request;
  if (!constraints.allowed_actions.includes(action)) {
    return decision(false, "action_not_allowed", "the signed policy does not allow this action");
  }
  if (constraints.rules_of_engagement_actions?.includes(action)) {
    if (constraints.prohibit_action_on_surrender && state.surrender_observed) {
      return decision(false, "surrender_protected", "a surrender indication requires the action to remain inhibited");
    }
    if (constraints.prohibit_action_on_incapacitated && state.incapacitated_observed) {
      return decision(false, "incapacitated_person_protected", "an incapacitated person indication requires the action to remain inhibited");
    }
    if (constraints.require_positive_identification && !state.positive_identification) {
      return decision(false, "positive_identification_required", "positive identification has not been confirmed");
    }
    if (constraints.require_proportionality_satisfied && !state.proportionality_satisfied) {
      return decision(false, "proportionality_unconfirmed", "the signed proportionality condition has not been satisfied");
    }
    if (constraints.require_human_authorization && !state.human_authorization_confirmed) {
      return decision(false, "human_authorization_required", "current human authorization is required for this action");
    }
  }
  const requiredTier = constraints.required_mettle_tier;
  if (requiredTier && (METTLE_RANK[evidence.mettle_tier] ?? 0) < (METTLE_RANK[requiredTier] ?? 0)) {
    return decision(false, "assurance_below_minimum", "verified METTLE assurance is below the signed minimum");
  }
  if (constraints.max_evidence_age_seconds > 0) {
    const age = evaluated.epochNanoseconds - verifiedAt.epochNanoseconds;
    if (age > BigInt(constraints.max_evidence_age_seconds) * 1_000_000_000n || age < -60_000_000_000n) {
      return decision(false, "evidence_stale", "verified assurance evidence is missing, stale, or from the future");
    }
  }
  if (constraints.require_gps_fix && !state.gps_fix) {
    return decision(false, "gps_required", "a trusted GPS fix is required");
  }
  if (constraints.require_outside_exclusion_zones && state.inside_exclusion_zone) {
    return decision(false, "inside_exclusion_zone", "local position intersects an exclusion zone");
  }
  if (constraints.min_civilian_distance_metres > 0 && state.civilian_distance_metres < constraints.min_civilian_distance_metres) {
    return decision(false, "civilian_proximity", "civilian distance is below the signed minimum separation");
  }
  if (constraints.min_friendly_distance_metres > 0 && state.friendly_distance_metres < constraints.min_friendly_distance_metres) {
    return decision(false, "friendly_force_proximity", "friendly-force distance is below the signed minimum separation");
  }
  if (constraints.require_outside_protected_sites && state.inside_protected_site) {
    return decision(false, "protected_site", "local position intersects a declared protected site");
  }
  if (constraints.require_outside_humanitarian_corridors && state.inside_humanitarian_corridor) {
    return decision(false, "humanitarian_corridor_protected", "local position intersects an active humanitarian corridor");
  }
  if (constraints.min_battery_percent > 0 && state.battery_percent < constraints.min_battery_percent) {
    return decision(false, "battery_below_minimum", "battery state is below the signed minimum");
  }
  if (constraints.max_altitude_metres > 0 && state.altitude_metres > constraints.max_altitude_metres) {
    return decision(false, "altitude_above_maximum", "altitude is above the signed maximum");
  }
  if (constraints.max_wind_speed_metres_per_second > 0 &&
      state.wind_speed_metres_per_second > constraints.max_wind_speed_metres_per_second) {
    return decision(false, "weather_outside_envelope", "wind speed is above the signed maximum");
  }
  if (constraints.min_visibility_metres > 0 && state.visibility_metres < constraints.min_visibility_metres) {
    return decision(false, "weather_outside_envelope", "visibility is below the signed minimum");
  }
  if (constraints.evidence_only_actions?.includes(action)) {
    return decision(false, "evidence_only_no_actuation", "the action is evaluated for evidence only and can never authorize an actuator");
  }
  return decision(true, "allowed", "signature, policy, and local constraints permit the action");
};
