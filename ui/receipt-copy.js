// Presentation only. Recorded receipts keep their producer bytes: codes, reasons and adapter
// outputs are never rewritten in the evidence. These helpers choose the words a visitor reads
// beside that evidence, in plain British English, and fall back to the recorded text whenever
// a string is not one they know, so a producer change can never be hidden behind a stale gloss.

const OUTCOME_HEADLINES = Object.freeze({ allowed: "Request allowed", held: "Request held" });

// Short stage labels keyed by the recorded code. Unknown codes fall back to the outcome alone.
const STAGE_REASONS = Object.freeze({
  allowed: "All checks pass",
  civilian_proximity: "Civilians too close",
  friendly_force_proximity: "Own team too close",
  protected_site: "Protected site",
  humanitarian_corridor_protected: "Humanitarian corridor",
  surrender_protected: "Surrender signalled",
  incapacitated_person_protected: "Incapacitated person",
  positive_identification_required: "Identity unconfirmed",
  proportionality_unconfirmed: "Consequence check unresolved",
  human_authorization_required: "No current human authorisation",
  altitude_above_maximum: "Above the altitude ceiling",
  weather_outside_envelope: "Wind above the limit",
  operating_window_closed: "Outside the operating window",
  transport_unavailable: "Link lost",
  policy_replay: "Replayed policy"
});

// Codes that appear only in the recorded Fleet run, never on the stage.
const FLEET_REASONS = Object.freeze({
  inside_exclusion_zone: "Inside an exclusion zone",
  evidence_stale: "Evidence missing or stale",
  policy_unavailable: "No verified policy",
  policy_expired: "Policy expired"
});

// Exact recorded strings mapped to plain en-GB wording. Matching is exact on purpose.
const ADAPTER_GLOSSES = Object.freeze({
  "LOITER authorized; fixture generation has no vehicle channel": "Loiter authorised. No command was sent: this recorded fixture has no vehicle link",
  "Await authorized window": "Wait for the authorised operating window",
  "Hold pending current human authorization": "Hold pending current human authorisation",
  "No new adapter authority": "No new command authority",
  "Hold outside friendly separation": "Hold outside the team-separation distance",
  "Hold pending positive identification": "Hold until identity is confirmed",
  "Hold pending a satisfied proportionality condition": "Hold until the consequence check is satisfied"
});

const REASON_GLOSSES = Object.freeze({
  "current human authorization is required for this action": "current human authorisation is required for this action",
  "policy is not active": "the policy is not active: its operating window is closed",
  "MAVLink transport has no current heartbeat": "the vehicle link (MAVLink) has no current heartbeat",
  "friendly-force distance is below the signed minimum separation": "one of the operator’s own teams is closer than the signed minimum separation",
  "positive identification has not been confirmed": "the identity check has not been confirmed",
  "the signed proportionality condition has not been satisfied": "the signed consequence check has not been satisfied"
});

const text = (value) => String(value ?? "").trim();

export const outcomeHeadline = (allowed) => (allowed ? OUTCOME_HEADLINES.allowed : OUTCOME_HEADLINES.held);

export const stageBadge = (receipt) => {
  const outcome = receipt?.allowed ? "Allowed" : "Held";
  const reason = Object.hasOwn(STAGE_REASONS, receipt?.code) ? STAGE_REASONS[receipt.code] : "";
  return reason ? `${outcome} · ${reason}` : outcome;
};

// The plain label for a recorded code, shared by the stage badge and the Fleet rows. An unknown
// code is returned as recorded, so a new producer code is never hidden behind a stale label.
export const reasonLabel = (code) => {
  const recorded = text(code);
  if (Object.hasOwn(STAGE_REASONS, recorded)) return STAGE_REASONS[recorded];
  if (Object.hasOwn(FLEET_REASONS, recorded)) return FLEET_REASONS[recorded];
  return recorded;
};

// Recorded Fleet scenario names that use targeting or US wording, shown in plain en-GB words.
const SCENARIO_GLOSSES = Object.freeze({
  "friendly force separation": "team separation",
  "positive identification": "identity check",
  proportionality: "consequence check",
  "human authorization": "human authorisation"
});

export const glossScenario = (value) => {
  const recorded = text(value);
  return Object.hasOwn(SCENARIO_GLOSSES, recorded) ? SCENARIO_GLOSSES[recorded] : recorded;
};

export const glossAdapterOutput = (value) => {
  const recorded = text(value);
  return Object.hasOwn(ADAPTER_GLOSSES, recorded) ? ADAPTER_GLOSSES[recorded] : recorded;
};

export const glossReason = (value) => {
  const recorded = text(value);
  return Object.hasOwn(REASON_GLOSSES, recorded) ? REASON_GLOSSES[recorded] : recorded;
};
